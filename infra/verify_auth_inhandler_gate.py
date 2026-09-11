#!/usr/bin/env python3
# 四支 /auth/* 端點：`authorizer_for()` 回 None，那它們到底有沒有驗身分？
#
# 用法：python3 verify_auth_inhandler_gate.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# ── 起因 ──────────────────────────────────────────────────────────
#
# §5 盤點時量到：全 manifest `auth=user` 共 41 支，`authorizer_for()` 回 None 的有 7 支，
# 其中 4 支是 REST_V1 的 `/auth/*`（change-password／logout-all／bind-google／unbind）。
# 🔴 那個組合讀起來像「標了要登入、卻沒掛閘」= 裸端點。
#    而姊妹端點 `auth-bind-line` **在** AUTHORIZER_PILOT 裡 —— 不對稱本身就該查。
#
# 原始碼讀下來它們是 **in-handler 驗證**：
#   shared.GetUserIdentifierWithContext → VerifyTokenWithUserPwGate → VerifyToken
#   （`jwt.ParseWithClaims` ＋ 拒絕非 HMAC signing method ＋ `token.Valid` ＋ 密碼變更撤銷閘）
#   查詢參數 `?userId=` 那條 fallback 回 `fromJWT=false`，四支全部據此 401。
# 但**讀原始碼只是假設**，這支去量。
#
# ── 承重的是 A3，不是 A1 ──────────────────────────────────────────
#
# 🔴 A3（**只帶 `?userId=`、不帶 token**）才是那句「安全鐵律：絕不接受 query param userId」
#    真正宣稱的東西。少了它，A1（什麼都不帶 → 401）與「fallback 其實會放行」相容 ——
#    因為 A1 連 query param 都沒給，那條路徑根本沒被求值。
# 🔴 A4（**簽壞的 token**）撐著 A1／A3：少了它，「有在驗簽」與「一律 401」分不出來。
# 🔴 A5（**合法 token 必須不是 401**）撐著整組：端點整支壞掉時 A1~A4 會全部變綠。
#
# ⚠️ 界線：本支答的是「有沒有驗身分」，**不是**「授權邏輯對不對」
#    （例如能不能解綁別人的帳號）。那是另一件事，沒驗。
#
# ⚠️ 寫入面積：一列合成 `Users`（跑完刪掉並 read-back）。
#    探測固定打 `/auth/unbind`：合法 token ＋ 缺 provider 欄位 ⇒ 業務錯誤早退，不解綁任何東西。
#    **不打** `/auth/change-password`（要現行密碼）與 `/auth/logout-all`（會寫）。

import base64, hashlib, hmac, json, os, subprocess, sys, time
import urllib.error, urllib.request

REGION = "ap-southeast-1"
USERS = "MahjongClubStg_Users"
MARK = "AUTHGATE-DELETEME"
DEFAULT_BASE = "https://ryojaku-api.boyplaymj.com"
PROBE = "/auth/unbind"          # 四支裡最安全的：缺欄位就早退
GATED = "/auth/bind-line"       # 對照組：這支**有**掛 authorizer

TOTAL = FAIL = 0
LAST = ""

def pass_(m):
    global TOTAL; TOTAL += 1; print(f"  ✅ {m}")

def fail_(m):
    global TOTAL, FAIL; TOTAL += 1; FAIL += 1
    print(f"  ❌ {m}")
    if LAST: print(f"      指紋：{LAST}")

def die(m): print(f"\n🔴 前置失敗（本輪什麼都沒驗到）：{m}"); sys.exit(2)
def b64(r): return base64.urlsafe_b64encode(r).decode().rstrip("=")

def sign(payload, secret):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(",",":")).encode())
    p = b64(json.dumps(payload, separators=(",",":")).encode())
    return f"{h}.{p}.{b64(hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())}"

def sh(a):
    r = subprocess.run(a, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr

def req(base, path, token=None, body="{}"):
    global LAST
    r = urllib.request.Request(base + path, method="POST", data=body.encode())
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            c, b = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        c, b = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        LAST = f"connection error: {e}"; return 0, str(e)
    LAST = f"{c} body={b[:140]!r}"
    return c, b

def want(label, code, body, expect):
    if code == expect: pass_(f"{label}（{code}）{body[:70]!r}")
    else: fail_(f"{label}：得到 {code}，期望 {expect}　body={body[:110]!r}")

def want_not_401(label, code, body):
    if code == 0: fail_(f"{label}：連不上 —— {body[:90]!r}")
    elif code == 401: fail_(f"{label}：**401** ⇒ 合法 token 進不去，下面每一格的綠燈都沒有意義")
    else: pass_(f"{label}（{code} ⇒ 過了身分閘，走到業務邏輯）{body[:70]!r}")

def main():
    base = os.environ.get("RYOJAKU_API_BASE", DEFAULT_BASE).rstrip("/")
    uid = f"{MARK}-{int(time.time())}"
    print("══ 前置 ══"); print(f"  API：{base}")
    rc, out, err = sh(["aws","ssm","get-parameter","--region",REGION,
                       "--name","/ryojaku/stg/JWT_SECRET","--with-decryption",
                       "--query","Parameter.Value","--output","text"])
    if rc != 0: die(f"讀不到 JWT_SECRET：{err.strip()[:200]}")
    secret = out.strip()
    rc, _, err = sh(["aws","dynamodb","put-item","--region",REGION,"--table-name",USERS,
                     "--item", json.dumps({"userId":{"S":uid},"displayName":{"S":MARK},
                                           "points":{"N":"0"}})])
    if rc != 0: die(f"建不出測試使用者：{err.strip()[:200]}")
    print(f"  測試使用者：{uid}")
    exp = int(time.time()) + 3600
    good   = sign({"userId":uid,"email":"ag@example.com","exp":exp}, secret)
    forged = sign({"userId":uid,"email":"ag@example.com","exp":exp}, secret + "X")  # 錯的金鑰
    try:
        print("\n══ A5 撐整組·合法 token 必須進得去（端點整支壞掉時 A1~A4 會全綠）══")
        c,b = req(base, PROBE, token=good); want_not_401(f"A5 POST {PROBE} + 合法 token", c, b)

        print("\n══ A1 什麼都不帶 ══")
        c,b = req(base, PROBE); want(f"A1 POST {PROBE} 無 token", c, b, 401)

        print("\n══ A3 承重·只帶 ?userId=（那句「絕不接受 query param userId」的實測）══")
        c,b = req(base, f"{PROBE}?userId={uid}")
        want(f"A3 POST {PROBE}?userId=<合成身分>", c, b, 401)
        c,b = req(base, f"{PROBE}?lineID={uid}")
        want(f"A3b POST {PROBE}?lineID=<合成身分>", c, b, 401)

        print("\n══ A4 撐著 A1/A3·用錯的金鑰簽的 token（證明有在驗簽，不是一律 401）══")
        c,b = req(base, PROBE, token=forged); want(f"A4 POST {PROBE} + 偽造簽章", c, b, 401)

        print("\n══ A6 對照組·有掛 authorizer 的姊妹端點 /auth/bind-line ══")
        c,b = req(base, GATED)
        want(f"A6 POST {GATED} 無 token（authorizer 擋）", c, b, 401)
        c,b = req(base, f"{GATED}?userId={uid}")
        want(f"A6b POST {GATED}?userId=<合成身分>", c, b, 401)

        print("\n══ A7 承重·兩種閘的 401 **body 形狀必須不同**（證明是不同層擋的）══")
        # 🔴 這一格才是「in-handler 真的有在驗」的直接證據：
        #    handler 自己回的是 {"success":false,"error":"unauthorized"}（它的 JSON 格式），
        #    API Gateway 的 authorizer 回的是 {"message":"Unauthorized"}。
        #    ⇒ body 形狀不同 ⇒ A1/A3/A4 是**進到 Lambda 之後**才被擋，
        #      而 A6 在 Lambda 之前就被擋掉。
        #    少了這格，「in-handler 有閘」與「其實也被某個 authorizer 擋掉了」分不出來 ——
        #    兩者在狀態碼上逐字相同（都是 401）。
        _, b_inh = req(base, PROBE)
        _, b_gat = req(base, GATED)
        inh_ok = '"error"' in b_inh and "unauthorized" in b_inh
        gat_ok = '"message"' in b_gat and "Unauthorized" in b_gat
        if inh_ok and gat_ok and b_inh != b_gat:
            pass_(f"A7 兩種 401 的 body 不同 ⇒ 不同層擋的　in-handler={b_inh[:46]!r} gateway={b_gat[:34]!r}")
        else:
            fail_(f"A7 分不出是哪一層擋的：in-handler={b_inh[:70]!r} gateway={b_gat[:70]!r}")
        print("  ℹ️  兩種閘在「擋不擋得住」上讀數相同；差別在**誰先擋** ——")
        print("     authorizer 擋在 Lambda 之前（匿名請求不進 Lambda），in-handler 是每一則都進。")
        print("     那是成本與攻擊面的差別，不是「有沒有驗」的差別。")
    finally:
        print("\n══ 清理（read-back；有殘留 ⇒ rc=2）══")
        sh(["aws","dynamodb","delete-item","--region",REGION,"--table-name",USERS,
            "--key", json.dumps({"userId":{"S":uid}})])
        rc, out, _ = sh(["aws","dynamodb","get-item","--region",REGION,"--table-name",USERS,
                         "--key", json.dumps({"userId":{"S":uid}}),"--consistent-read"])
        if rc != 0 or (out.strip() and json.loads(out).get("Item")):
            print(f"  🔴 {USERS}/{uid} 刪不掉")
            print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過，但清理沒歸零 ⇒ rc=2（本輪不可信）")
            sys.exit(2)
        print("  ✅ 1 筆刪掉且 read-back 確認不存在")
    print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過")
    sys.exit(1 if FAIL else 0)

if __name__ == "__main__":
    main()
