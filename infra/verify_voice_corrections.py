#!/usr/bin/env python3
# D3-d 驗收：語音判台「訂正資料飛輪」兩支端點的線上迴歸網
#   POST /voice-corrections        (auth=user,  RyojakuUserAuth)
#   GET  /admin/voice-corrections  (auth=admin, RyojakuAdminAuth)
# 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4.2 / §4.3 / §4.4
#
# 用法：python3 verify_voice_corrections.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置失敗（**沒測到**，不可讀成通過）
#
# ── 為什麼是這些斷言 ──────────────────────────────────────────────
#
# 🔴 每個「應該被擋」都配一個「應該要通」。
#    只驗攻擊被擋的話，「這支根本沒部署」跟「閘門很嚴」長得一模一樣 ——
#    端點不存在時 API Gateway 對所有人回 403，所有負控都會變綠。
#    ⇒ V3（真 user token 寫得進去）與 V11（真 admin token 讀得出來）是整份的地基。
#
# 🔴 user token 用**真的註冊**拿，不自簽。
#    authorizer 走 shared.VerifyTokenWithUserPwGate，會查 Users 表的 pwChangedAt；
#    自簽一個不存在的 userId 可能在那一步就掛掉，那時的 401 是「使用者不存在」
#    而不是「閘門擋住了」—— 兩者外觀相同，會把 V3 的失敗誤讀成 V1 的成功。
#    ⚠️ app-register 限流：每 IP 每小時 10 次。本腳本用 1 次
#       （security_regression.sh 每輪用 2 次，兩支合計一小時內最多跑 3 輪）。
#
# 🔴 admin token 用 ADMIN_JWT_SECRET 自簽（沿用 verify_admin_role_gate.py 的作法）：
#    我們手上沒有 s2admin 的明文密碼，但有 SSM 的金鑰。自簽反而更精準 ——
#    可以造出 forged（用 **user** 金鑰簽 role=super_admin）那一種，驗 D5 的金鑰分離。
#
# 🔴 V6 是 D3-b 那個修正的線上版，也是本份唯一「不看狀態碼看資料」的斷言。
#    expiresAt 若改回用呼叫端的 ts 算，前端誤送毫秒就會讓 TTL 落在西元五萬七千年
#    ＝ 資料永久保留。方向對隱私是 fail-open：**壞輸入的後果是「留更久」而不是被拒絕，
#    而且那筆資料在 DDB 裡看起來完全正常**。狀態碼全是 200，只有 expiresAt 會說話。

import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

REGION = "ap-southeast-1"
REST_BASE = "https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg"
PREFIX = "MahjongClubStg_"
TABLE = PREFIX + "VoiceCorrections"
MARK = "VCREG-DELETEME"
YEAR = 365 * 24 * 3600

# 🔴 斷言總數一律由程式自己數，不准手寫（沿用 security_regression.sh 的規矩：
#    先前有份報告手抄「17 項」而實際 16，錯的數字被外部查驗者照抄了一次）。
TOTAL = 0
FAIL = 0


def pass_(msg):
    global TOTAL
    TOTAL += 1
    print(f"  ✅ {msg}")


def fail_(msg):
    global TOTAL, FAIL
    TOTAL += 1
    FAIL += 1
    print(f"  ❌ {msg}")


def check(desc, got, want, fp=False):
    """fp=True 代表 got 是剛剛那發 HTTP 的狀態碼 —— 失敗時連指紋一起印。
    ⚠️ 只在「got 來自上一次 req()」時傳 fp=True；對落庫筆數之類的斷言傳它會印出
    一份不相干的指紋，比不印更糟。"""
    if got == want:
        pass_(f"{desc}（{got}）")
    else:
        fail_(f"{desc}：得到 {got!r}，期望 {want!r}")
        detail = LAST_FP if fp else None
        # 🔴 只記狀態碼的斷言對「這是哪一種 403」零鑑別力，而那三種的處置完全不同：
        #    Missing Authentication Token（路由沒佈上／還在傳播）
        #    explicit deny（維護模式 kill switch 被拉下）
        #    UnauthorizedException（authorizer 判定失敗）
        #    2026-09-02 實際踩到：部署後第一發 403 被我讀成「閘門行為不對」，
        #    其實是 stage 傳播窗口；沒有指紋就分不出來。maintenance.go 早寫過
        #    「403 的來源有指紋，不只是狀態碼剛好相同」。
        if detail:
            print(f"      指紋：{detail}")


def die(msg):
    """前置失敗 → rc=2。**不是** rc=1 —— 「沒測到」不可以跟「測了而失敗」同號，
    更不可以跟通過同號。"""
    print(f"\n🔴 前置失敗（本輪什麼都沒驗到）：{msg}")
    sys.exit(2)


# ── 工具 ───────────────────────────────────────────────────────────
def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def sign(payload: dict, secret: str) -> str:
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    msg = f"{header}.{body}".encode()
    mac = hmac.new(secret.encode(), msg, hashlib.sha256).digest()
    return f"{header}.{body}.{b64(mac)}"


def ssm(name: str) -> str:
    out = subprocess.run(
        ["aws", "ssm", "get-parameter", "--region", REGION, "--name", name,
         "--with-decryption", "--query", "Parameter.Value", "--output", "text"],
        capture_output=True, text=True)
    if out.returncode != 0:
        die(f"讀不到 SSM {name}：{out.stderr.strip()[:200]}")
    return out.stdout.strip()


LAST_FP = ""


def req(method, path, token=None, body=None):
    """回 (status, parsed_json_or_raw_text)。連不上一律回 (0, 錯誤字串) ——
    絕不把「打不到」靜靜變成某個狀態碼。
    副作用：把 x-amzn-errortype ＋ body 開頭記進 LAST_FP，供 check() 在失敗時列印。"""
    global LAST_FP
    url = REST_BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw, code, hdrs = resp.read().decode(), resp.status, resp.headers
    except urllib.error.HTTPError as e:
        raw, code, hdrs = e.read().decode(), e.code, e.headers
    except Exception as e:  # 連線層失敗
        LAST_FP = f"connection error: {e}"
        return 0, f"connection error: {e}"
    LAST_FP = (f"x-amzn-errortype={hdrs.get('x-amzn-errortype', '(無)')} "
               f"body={raw[:120]!r}")
    try:
        return code, json.loads(raw)
    except Exception:
        return code, raw


def ddb(*args):
    out = subprocess.run(["aws", "dynamodb", *args, "--region", REGION],
                         capture_output=True, text=True)
    return out.returncode, out.stdout, out.stderr


def scan_mine(user_id):
    """撈本次測試寫進去的列。掃不到分頁完 → 視為前置失敗，不當成 0 筆。"""
    rc, out, err = ddb("query", "--table-name", TABLE,
                       "--key-condition-expression", "pk = :p",
                       "--expression-attribute-values",
                       json.dumps({":p": {"S": "USER#" + user_id}}),
                       "--output", "json")
    if rc != 0:
        die(f"query {TABLE} 失敗：{err.strip()[:200]}")
    d = json.loads(out)
    if d.get("LastEvaluatedKey"):
        die(f"{TABLE} 未分頁完 —— 這一頁的筆數不代表全部")
    return d.get("Items", [])


# ── 主流程 ─────────────────────────────────────────────────────────
def main():
    global FAIL
    ts_tag = int(time.time())

    print("══ 前置：取金鑰、造 token ══")
    user_secret = ssm("/ryojaku/stg/JWT_SECRET")
    admin_secret = ssm("/ryojaku/stg/ADMIN_JWT_SECRET")
    if user_secret == admin_secret:
        die("JWT_SECRET 與 ADMIN_JWT_SECRET 相同 —— D5 金鑰分離未成立，V10 會失去意義")

    exp = int(time.time()) + 3600
    admin_tok = sign({"sub": "s2admin", "role": "super_admin", "exp": exp}, admin_secret)
    # forged：用 **user** 的金鑰簽一個 role=super_admin。D5 之後必須在驗簽階段就被打掉。
    forged_tok = sign({"sub": "s2admin", "role": "super_admin", "exp": exp}, user_secret)
    # 亂簽：完全錯誤的金鑰，驗 user 端 authorizer 真的在驗簽。
    bogus_tok = sign({"userId": "nobody", "sub": "nobody", "exp": exp}, "not-the-real-secret")

    # 真 user：註冊一個帳號拿真 token（理由見檔頭）。
    email = f"vcreg+{ts_tag}@example.com"
    code, body = req("POST", "/app-register", body={
        "email": email, "password": "VcReg12345!", "displayName": MARK})
    if code != 200 or not isinstance(body, dict) or not body.get("token"):
        die("註冊測試帳號失敗（最常見原因：app-register 每 IP 每小時 10 次的限流）。"
            f"回應 {code}：{str(body)[:200]}")
    user_tok = body["token"]
    user_id = (body.get("data") or body.get("user") or {}).get("userId", "")
    if not user_id:
        die(f"註冊成功但取不到 userId：{str(body)[:200]}")
    print(f"  測試帳號 {user_id}")

    good = {"text": "自摸平胡", "normalizedText": "自摸平胡",
            "parsed": ["selfDraw"], "corrected": ["selfDraw", "pinghu"],
            "added": ["pinghu"], "removed": [], "unmatched": "",
            "hadDiff": True, "rulesetVersion": "v1", "engineVersion": "e1",
            "ts": ts_tag}

    print("\n══ POST /voice-corrections：user 閘門 ══")
    code, nobody_resp = req("POST", "/voice-corrections", body=good)
    check("V1 不帶 token → 401（gateway RyojakuUserAuth 生效）", code, 401, fp=True)

    # 🔴 V1b：光看 401 分不出是哪一層擋的。
    #    設計冊 §4.3 要求 user 端點**同時**做三件事（manifest auth:user／列進
    #    AUTHORIZER_PILOT／handler 自己 fail-closed），而「三者缺一，漏掉的那一項
    #    不會產生任何錯誤訊號」—— 因為 gateway 與 handler 都回 401。
    #    若哪天有人把 voice-corrections 從 AUTHORIZER_PILOT 拿掉，V1 照樣綠
    #    （handler 的第二道防線接住了），gateway 那層就靜靜退休了。
    #    body 分得出來：gateway 回 API Gateway 制式的 {"message":"Unauthorized"}，
    #    handler 回自己的 {"success":false,"error":"unauthorized"}。
    if isinstance(nobody_resp, dict) and nobody_resp.get("message") == "Unauthorized":
        pass_("V1b 擋在 gateway 那層（body 是 API Gateway 制式的 message 形狀）")
    elif isinstance(nobody_resp, dict) and "error" in nobody_resp:
        fail_("V1b 擋下它的是 handler 不是 gateway —— voice-corrections 可能已從 "
              f"AUTHORIZER_PILOT 掉出去，第一層形同退休。body={nobody_resp!r}")
    else:
        fail_(f"V1b 認不得這個 401 是哪一層回的：{str(nobody_resp)[:160]}")

    code, _ = req("POST", "/voice-corrections", token=bogus_tok, body=good)
    check("V2 錯金鑰簽的 token → 401", code, 401, fp=True)

    code, resp = req("POST", "/voice-corrections", token=user_tok, body=good)
    check("V3【正控】真 user token → 200（端點真的活著，否則以下負控全是假綠）", code, 200, fp=True)
    if code != 200:
        print(f"      回應：{str(resp)[:300]}")

    # ts<=0 → 400。這同時證明「已經穿過授權層走到業務層」——
    # 若這裡回 401，代表 V3 的 200 是別的原因造成的。
    bad_ts = dict(good, ts=0)
    code, _ = req("POST", "/voice-corrections", token=user_tok, body=bad_ts)
    check("V4 ts<=0 → 400（而非 401：證明已穿過授權層）", code, 400, fp=True)

    # hadDiff=false 也要寫（§4.4）
    nodiff = dict(good, hadDiff=False, added=[], removed=[],
                  corrected=["selfDraw"], text="自摸", normalizedText="自摸")
    code, _ = req("POST", "/voice-corrections", token=user_tok, body=nodiff)
    check("V5 hadDiff=false 也回 200（§4.4「嘗試」與「完成」分開記）", code, 200, fp=True)

    # V6：毫秒級 ts。expiresAt 必須仍以伺服器時刻起算。
    ms_ts = ts_tag * 1000
    code, _ = req("POST", "/voice-corrections", token=user_tok, body=dict(good, ts=ms_ts))
    check("V6a 毫秒級 ts 仍被接受 → 200（不靠拒收來防呆）", code, 200, fp=True)

    print("\n══ 落庫檢查（DDB 真的有這幾筆）══")
    items = scan_mine(user_id)
    check("V7 DDB 實際筆數（V3 + V5 + V6a，ts<=0 那筆不該寫進去）", len(items), 3)

    now = int(time.time())
    ms_rows = [i for i in items if i.get("ts", {}).get("N") == str(ms_ts)]
    if len(ms_rows) != 1:
        fail_(f"V6b 找不到毫秒 ts 那一筆（找到 {len(ms_rows)} 筆），無法驗 expiresAt 起算點")
    else:
        exp_at = int(ms_rows[0]["expiresAt"]["N"])
        drift = exp_at - (now + YEAR)
        if abs(drift) <= 300:
            pass_(f"V6b expiresAt 以伺服器時刻起算（now+365d 誤差 {drift}s）")
        else:
            fail_("V6b expiresAt 起算點錯了：expiresAt=%d，now+365d=%d，差 %d 秒"
                  "（若接近 ts+365d 就是 D3-b 那個 fail-open 缺陷回歸了）"
                  % (exp_at, now + YEAR, drift))
        # 反向再問一次：它絕對不可以等於「呼叫端 ts + 365 天」。
        if exp_at == ms_ts + YEAR:
            fail_("V6c expiresAt 正好等於 ts+365d —— TTL 落在西元五萬七千年，資料永不自清")
        else:
            pass_("V6c expiresAt ≠ 呼叫端 ts+365d（毫秒誤送不會弄壞 TTL）")

    nodiff_rows = [i for i in items if i.get("hadDiff", {}).get("BOOL") is False]
    check("V8 hadDiff=false 那筆確實落庫（否則「判很準」與「沒人用」在資料上同形）",
          len(nodiff_rows), 1)

    print("\n══ GET /admin/voice-corrections：admin 閘門 ══")
    code, _ = req("GET", "/admin/voice-corrections")
    check("V9 不帶 token → 401", code, 401, fp=True)

    code, _ = req("GET", "/admin/voice-corrections", token=user_tok)
    check("V10 user token → 401（D8 拍板：不區分「無效」與「有效但非 admin」）", code, 401, fp=True)

    code, _ = req("GET", "/admin/voice-corrections", token=forged_tok)
    check("V11 用 user 金鑰偽簽 role=super_admin → 401（D5 金鑰分離）", code, 401, fp=True)

    code, resp = req("GET", "/admin/voice-corrections", token=admin_tok)
    check("V12【正控】真 admin token → 200", code, 200, fp=True)

    if code == 200 and isinstance(resp, dict):
        recs = resp.get("data")
        if recs is None:
            fail_("V13 data 是 null —— JS 端 extractSuggestions 直接讀 .length 會 TypeError")
        elif not isinstance(recs, list):
            fail_(f"V13 data 不是陣列而是 {type(recs).__name__}")
        else:
            pass_(f"V13 data 是陣列（{len(recs)} 筆）不是 null")

            mine = [r for r in recs if r.get("userId") == user_id]
            check("V14 後台讀得到本次寫入的三筆", len(mine), 3)

            # 🔴 飛輪契約：extractSuggestions 讀這五個鍵（feedback.js:86-104）。
            #    少任何一個，飛輪只會安靜地少找到一類建議 —— 不報錯、不少一支函式。
            need = ["unmatched", "added", "removed", "text", "userId"]
            if mine:
                missing = [k for k in need if k not in mine[0]]
                if missing:
                    fail_(f"V15 飛輪契約缺鍵：{missing}（extractSuggestions 會安靜少找一類建議）")
                else:
                    pass_(f"V15 飛輪契約五個鍵齊全：{need}")

                # 空集合要回 [] 不回 null（JS 直接讀 .length）
                empt = [r for r in mine if r.get("hadDiff") is False]
                if not empt:
                    fail_("V16 找不到 hadDiff=false 那筆，無法驗空集合形狀")
                elif empt[0].get("added") is None or empt[0].get("removed") is None:
                    fail_("V16 空集合回了 null（added=%r removed=%r）—— JS 讀 .length 會炸"
                          % (empt[0].get("added"), empt[0].get("removed")))
                else:
                    pass_("V16 空集合回 [] 不回 null")
            else:
                fail_("V15/V16 未測到（後台回傳裡找不到本次寫入的列）")

        sk = resp.get("skipped")
        if isinstance(sk, int):
            check("V17 skipped 是數字且本次為 0（形狀不對的列不被靜靜吞掉）", sk, 0)
        else:
            fail_(f"V17 skipped 不是數字而是 {sk!r}")
    else:
        fail_("V13～V17 未測到（admin 正控沒回 200）")
        print(f"      回應：{str(resp)[:300]}")

    # ── 清理：只刪本次這個 userId 的列 ──────────────────────────
    print("\n── 清理 ──")
    left = scan_mine(user_id)
    for it in left:
        rc, _, err = ddb("delete-item", "--table-name", TABLE, "--key",
                         json.dumps({"pk": it["pk"], "sk": it["sk"]}))
        if rc != 0:
            fail_(f"刪除失敗：{err.strip()[:160]}")
    after = scan_mine(user_id)
    if after:
        fail_(f"仍有 {len(after)} 筆殘留")
    else:
        pass_(f"已清掉 {len(left)} 筆測試資料")

    # 🔴 帳號也要自己收。第一版把它留給「security_regression.sh --cleanup-orphans
    #    或人工清理」—— 但那支認的 MARK 是 SECREG-DELETEME，掃不到 VCREG-DELETEME，
    #    所以那句話是假的：真正會發生的是每跑一輪就多一個永久帳號。
    #    ⚠️ 判準只認「本次這個 userId」，不做跨帳號孤兒清掃（沿用 security_regression.sh
    #    的規矩：那是資料修復不是測試清理，會靜默刪掉合法的 legacy 紀錄）。
    acct_left = 0
    for tbl, keys in (("Users", ["userId"]),
                      ("AuthIdentities", None), ("AuthTokens", None)):
        rc, out, err = ddb("scan", "--table-name", PREFIX + tbl, "--output", "json")
        if rc != 0:
            fail_(f"清帳號時掃 {tbl} 失敗：{err.strip()[:160]}")
            continue
        d = json.loads(out)
        if d.get("LastEvaluatedKey"):
            fail_(f"{tbl} 未分頁完 —— 不宣稱已清乾淨")
            continue
        rc2, kout, _ = ddb("describe-table", "--table-name", PREFIX + tbl,
                           "--query", "Table.KeySchema[].AttributeName", "--output", "json")
        kn = json.loads(kout) if rc2 == 0 else (keys or [])
        for it in d.get("Items", []):
            if user_id not in json.dumps(it, ensure_ascii=False):
                continue
            if not all(k in it for k in kn):
                continue
            rc3, _, err3 = ddb("delete-item", "--table-name", PREFIX + tbl,
                               "--key", json.dumps({k: it[k] for k in kn}))
            if rc3 != 0:
                fail_(f"刪 {tbl} 失敗：{err3.strip()[:160]}")
                acct_left += 1
            else:
                print(f"  刪 {tbl}")
    if acct_left == 0:
        pass_(f"測試帳號 {user_id} 已清（Users / AuthIdentities / AuthTokens）")

    print(f"\n══ 斷言：通過 {TOTAL - FAIL} / 共 {TOTAL}（失敗 {FAIL}）══")
    # ⚠️ TOTAL 是「跑到的斷言數」不是「應有的斷言數」——中途 exit 會讓它偏小。
    #    判斷有沒有被截斷，看它跟上一次成功執行的數字有沒有掉。
    print("══ 全部通過 ══" if FAIL == 0 else f"══ 有 {FAIL} 項失敗 ══")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
