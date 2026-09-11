#!/usr/bin/env python3
# §5 搬遷後的五條路由：**帶 token** 的線上驗收（正典 PATH_RECONCILE.md §「已部署」）
#
# 用法：python3 verify_migrated_routes_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# ── 這支補的是哪個洞 ──────────────────────────────────────────────
#
# 部署當下只驗到「不帶 token ⇒ 401」，而那只證明**路由在、匿名被擋**。
# `/registrations/{accept,reject}` 與 `/claim-push-bonus` 因為會寫資料，
# 當時沒有帶 token 打過 —— 覆驗者也把這一格列為未驗。
# 🔴 那個缺口很要命：v2→v1 沒轉乾淨的兩種症狀**都不會出現在匿名探測上** ——
#    ①回應端形狀不合 ⇒ REST proxy 判 malformed ⇒ **502**（Lambda 那邊零錯誤日誌）
#    ②請求端讀 v2 專屬欄位 ⇒ 取到零值 ⇒ **每個請求都被判成未授權**
#    而症狀②長得跟「authorizer 正常運作」一模一樣。
#
# ── 為什麼可以零寫入 ──────────────────────────────────────────────
#
# 讀過三支 handler 的早退路徑：
#   accept/reject + 不存在的 registrationId → getRegistration 失敗 → 404，一個字都沒寫
#   claim-push-bonus + 沒有推播訂閱的使用者 → 400「請先開啟推播通知權限唷！」，也是早退
# ⇒ 只建一列合成 Users（跑完刪掉並 read-back），三條路由本身不產生任何資料。
#
# ── 承重的那一格是 G3，不是 G1/G2 ─────────────────────────────────
#
# 🔴 **同一個 token、不同 body，必須得到不同的狀態碼**：
#      {}                                  → 400（缺 registrationId）
#      {"registrationId":"__nonexistent__"} → 404（查不到）
#    這一對才證明 handler **真的讀到了 v1 的 `request.Body`**。
#    少了它，「body 讀得到」與「body 永遠是空的、一律 400」分不出來 ——
#    而後者正是 v1/v2 欄位搞錯時的典型形狀。
#
# 🔴 **每一格都同時斷言「不是 401」與「不是 502」**，理由見上面那兩種症狀。
#    只斷言「等於預期碼」的話，502 會被寫成「不等於 404」，讀起來像業務邏輯變了。
#
# 🔴 **G0（/notifications 帶 token 要 200）撐著整組**：token 簽壞、SSM 讀錯、
#    authorizer 掛掉時，G1~G4 會全部變成 401 而**每一條都符合某個「應該被擋」的期望**。
#    少了 G0，一個全壞的系統可以讓這支全綠。

import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REGION = "ap-southeast-1"
PREFIX = "MahjongClubStg_"
USERS = PREFIX + "Users"
MARK = "MIGPROBE-DELETEME"
DEFAULT_BASE = "https://ryojaku-api.boyplaymj.com"   # App 實際烘進 bundle 的那一個

TOTAL = 0
FAIL = 0
LAST = ""


def pass_(m):
    global TOTAL
    TOTAL += 1
    print(f"  ✅ {m}")


def fail_(m):
    global TOTAL, FAIL
    TOTAL += 1
    FAIL += 1
    print(f"  ❌ {m}")
    if LAST:
        print(f"      指紋：{LAST}")


def die(m):
    print(f"\n🔴 前置失敗（本輪什麼都沒驗到）：{m}")
    sys.exit(2)


def b64(r):
    return base64.urlsafe_b64encode(r).decode().rstrip("=")


def sign(payload, secret):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    p = b64(json.dumps(payload, separators=(",", ":")).encode())
    return f"{h}.{p}.{b64(hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())}"


def sh(a):
    r = subprocess.run(a, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def req(base, path, token=None, method="GET", raw_body=None):
    """回 (status, body_text)。連不上一律回 (0, …)：絕不把「打不到」變成某個狀態碼。"""
    global LAST
    data = raw_body.encode() if raw_body is not None else None
    r = urllib.request.Request(base + path, method=method, data=data)
    r.add_header("Content-Type", "application/json")
    if token:
        # token 放 header 物件裡，不進任何 argv（CLAUDE.md「機密不進 argv」）。
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            code, body = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, body = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        LAST = f"connection error: {e}"
        return 0, f"connection error: {e}"
    LAST = f"{code} body={body[:150]!r}"
    return code, body


def grid(label, code, body, want):
    """每一格都同時擋掉 401 與 502 —— 那是 v2→v1 沒轉乾淨的兩種症狀。"""
    if code == 502:
        fail_(f"{label}：**502** ⇒ 回應形狀不合 REST proxy（v1 轉換沒成功）")
        return
    if code == 401 and want != 401:
        fail_(f"{label}：**401** ⇒ 身分讀不到（請求端還在讀 v2 專屬欄位？）")
        return
    if code == want:
        pass_(f"{label}（{code}）{body[:70]!r}")
    else:
        fail_(f"{label}：得到 {code}，期望 {want}　body={body[:100]!r}")


def main():
    base = os.environ.get("RYOJAKU_API_BASE", DEFAULT_BASE).rstrip("/")
    uid = f"{MARK}-{int(time.time())}"
    print("══ 前置 ══")
    print(f"  API：{base}")

    rc, out, err = sh(["aws", "ssm", "get-parameter", "--region", REGION,
                       "--name", "/ryojaku/stg/JWT_SECRET", "--with-decryption",
                       "--query", "Parameter.Value", "--output", "text"])
    if rc != 0:
        die(f"讀不到 JWT_SECRET：{err.strip()[:200]}")
    secret = out.strip()

    rc, _, err = sh(["aws", "dynamodb", "put-item", "--region", REGION,
                     "--table-name", USERS, "--item",
                     json.dumps({"userId": {"S": uid}, "displayName": {"S": MARK},
                                 "points": {"N": "0"}})])
    if rc != 0:
        die(f"建不出測試使用者：{err.strip()[:200]}")
    print(f"  測試使用者：{uid}")

    exp = int(time.time()) + 3600
    good = sign({"userId": uid, "email": "mig@example.com", "exp": exp}, secret)
    bad = good[:-4] + ("AAAA" if not good.endswith("AAAA") else "BBBB")

    try:
        print("\n══ G0 撐整組·token 本身是好的（少了它，全壞的系統會讓下面全綠）══")
        c, b = req(base, f"/notifications?userId={uid}", token=good)
        grid("G0 GET /notifications + 合法 token", c, b, 200)

        print("\n══ G1 反控·完全不帶 token（三條寫入型路由）══")
        for m, p in [("POST", "/registrations/accept"), ("POST", "/registrations/reject"),
                     ("POST", "/claim-push-bonus")]:
            c, b = req(base, p, token=None, method=m, raw_body="{}")
            grid(f"G1 {m} {p} 無 token", c, b, 401)

        print("\n══ G2 反控·壞掉的 token（撐著 G1：證明擋下來的是簽章驗證）══")
        for m, p in [("POST", "/registrations/accept"), ("POST", "/claim-push-bonus")]:
            c, b = req(base, p, token=bad, method=m, raw_body="{}")
            grid(f"G2 {m} {p} 壞 token", c, b, 401)

        print("\n══ G3 承重·同一 token 不同 body ⇒ 不同狀態碼（證明真的讀到 v1 的 Body）══")
        for p in ["/registrations/accept", "/registrations/reject"]:
            c1, b1 = req(base, p, token=good, method="POST", raw_body="{}")
            grid(f"G3a POST {p} body={{}} ⇒ 缺 id", c1, b1, 400)
            c2, b2 = req(base, p, token=good, method="POST",
                         raw_body=json.dumps({"registrationId": "__MIGPROBE_NONEXISTENT__"}))
            grid(f"G3b POST {p} body 帶不存在的 id ⇒ 查不到", c2, b2, 404)
            if c1 != c2:
                pass_(f"G3c {p}：兩種 body 得到不同狀態碼（{c1} vs {c2}）⇒ Body 真的被讀了")
            else:
                fail_(f"G3c {p}：兩種 body 都回 {c1} ⇒ 分不出「讀到了」與「永遠是空的」")

        print("\n══ G4 承重·claim-push-bonus 走到業務邏輯（合成使用者沒有推播訂閱）══")
        c, b = req(base, "/claim-push-bonus", token=good, method="POST", raw_body="{}")
        grid("G4 POST /claim-push-bonus + 合法 token", c, b, 400)
        if "推播" in b:
            pass_("G4b 回的是推播權限的業務訊息 ⇒ 讀到了身分、也查了訂閱表")
        else:
            fail_(f"G4b 期望業務訊息含「推播」，得到 {b[:120]!r}")

    finally:
        print("\n══ 清理（read-back；有殘留 ⇒ rc=2）══")
        sh(["aws", "dynamodb", "delete-item", "--region", REGION, "--table-name", USERS,
            "--key", json.dumps({"userId": {"S": uid}})])
        rc, out, _ = sh(["aws", "dynamodb", "get-item", "--region", REGION,
                         "--table-name", USERS, "--key",
                         json.dumps({"userId": {"S": uid}}), "--consistent-read"])
        if rc != 0 or (out.strip() and json.loads(out).get("Item")):
            print(f"  🔴 {USERS}/{uid} 刪不掉")
            print(f"\n══ 結果 ══\n  {TOTAL - FAIL}/{TOTAL} 過，但清理沒歸零 ⇒ rc=2（本輪不可信）")
            sys.exit(2)
        print("  ✅ 1 筆刪掉且 read-back 確認不存在")

    print(f"\n══ 結果 ══\n  {TOTAL - FAIL}/{TOTAL} 過")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
