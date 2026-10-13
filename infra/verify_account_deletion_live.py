#!/usr/bin/env python3
# 帳號刪除（先停用、30 天後清除）在**線上 stg** 的端到端驗收。
#
# 用法：python3 verify_account_deletion_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# 為什麼存在：這一批改動（提出刪除、登入撤回、對別人隱藏、停掉推播）寫完時
# 全部只有假件測試，沒有任何一格碰過真的 DynamoDB 與 API Gateway。
#
# 做法同 verify_daily_bonus_live.py：合成 userId ＋ 自簽 token ＋ 跑完刪掉並 read-back。
# 不動任何真帳號。登入那幾格走真的 POST /app-login（合成帳號帶一組寫死的測試密碼，
# 帳號活不過這支腳本，那組密碼沒有保護價值）。
#
# 每一格旁邊的反控是承重的：
#   D0（刪除前 token 可用、別人查得到）撐著 D3／D4 —— 少了它，「被擋」與「本來就不通」分不開。
#   D1（不帶 token／壞 token ⇒ 401）撐著 D2 —— 少了它，200 可能是誰打都 200。
#   D2b／D2c 回頭讀 DDB —— 200 只證明回了 200。
#   D6 的對照是 D5 —— 同一個帳號、同一組密碼，只差 deleteRequestedAt 的值。
#
# ⚠️ 量不到的：Google／LINE 兩個登入入口（要真的第三方憑證）；到期清除（還沒寫）；
#    「剛好同一秒登入」那格（線上的時間不由這支控制，那格只在單元層）。
# ⚠️ 寫入面積：Users 一列、PushSubscriptions_MultiDevice 一列、AuthRateLimit 數列（有 TTL，不清）。

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
STACK = "ryojaku-app-stg"
PREFIX = "MahjongClubStg_"
USERS = PREFIX + "Users"
PUSH = PREFIX + "PushSubscriptions_MultiDevice"
MARK = "DELPROBE-DELETEME"
PASSWORD = "ryo-del-probe-Pw-1"
# bcrypt(PASSWORD)。合成帳號專用，見檔頭。
PASSWORD_HASH = "$2a$10$kASH3QWMc10E3GdqRq.AEe2dYNyr0cebqouqGytnON/n/T5n05vfy"
GRACE_DAYS = 30

TOTAL = 0
FAIL = 0
LAST_FP = ""


def pass_(msg):
    global TOTAL
    TOTAL += 1
    print(f"  ✅ {msg}")


def fail_(msg):
    global TOTAL, FAIL
    TOTAL += 1
    FAIL += 1
    print(f"  ❌ {msg}")
    if LAST_FP:
        print(f"      指紋：{LAST_FP}")


def check(desc, got, want):
    if got == want:
        pass_(f"{desc}（{got!r}）")
    else:
        fail_(f"{desc}：得到 {got!r}，期望 {want!r}")


def die(msg):
    """前置失敗 → rc=2。**不是** rc=1 —— 「沒測到」不可以跟「測了而失敗」同號。"""
    print(f"\n🔴 前置失敗（本輪什麼都沒驗到）：{msg}")
    sys.exit(2)


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def sign(payload: dict, secret: str) -> str:
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    mac = hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{b64(mac)}"


def sh(args):
    out = subprocess.run(args, capture_output=True, text=True)
    return out.returncode, out.stdout, out.stderr


def ssm(name: str) -> str:
    rc, out, err = sh(["aws", "ssm", "get-parameter", "--region", REGION, "--name", name,
                       "--with-decryption", "--query", "Parameter.Value", "--output", "text"])
    if rc != 0:
        die(f"讀不到 SSM {name}：{err.strip()[:200]}")
    return out.strip()


def ddb(*args):
    return sh(["aws", "dynamodb", *args, "--region", REGION])


def req(base, path, token=None, method="GET", payload=None):
    """回 (status, raw_text, errortype)。連不上一律回 (0, 錯誤字串, "")：
    絕不把「打不到」靜靜變成某個狀態碼。"""
    global LAST_FP
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(base + path, method=method, data=data)
    r.add_header("Content-Type", "application/json")
    if token:
        # 🔴 token 放在 header 物件裡，不進任何行程的 argv（CLAUDE.md「機密不進 argv」）。
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw, code, hdrs = resp.read().decode(), resp.status, resp.headers
    except urllib.error.HTTPError as e:
        raw, code, hdrs = e.read().decode(), e.code, e.headers
    except Exception as e:
        LAST_FP = f"connection error: {e}"
        return 0, f"connection error: {e}", ""
    et = hdrs.get("x-amzn-errortype", "")
    LAST_FP = f"x-amzn-errortype={et or '(無)'} body={raw[:160]!r}"
    return code, raw, et


def jbody(raw):
    try:
        return json.loads(raw)
    except Exception:
        return {}


def get_user(uid):
    rc, out, _ = ddb("get-item", "--table-name", USERS, "--key",
                     json.dumps({"userId": {"S": uid}}), "--consistent-read")
    if rc != 0:
        return None
    return json.loads(out).get("Item") if out.strip() else {}


def main():
    tag = int(time.time())
    uid = f"{MARK}-{tag}"
    email = f"delprobe-{tag}@example.invalid"
    device = "probe-device-1"

    print("══ 前置 ══")
    override = os.environ.get("RYOJAKU_API_BASE", "").strip()
    if override:
        api = override.rstrip("/")
    else:
        rc, out, err = sh(["aws", "cloudformation", "describe-stacks", "--stack-name", STACK,
                           "--region", REGION, "--query",
                           "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue",
                           "--output", "text"])
        api = out.strip().rstrip("/")
        if rc != 0 or not api or api == "None":
            die(f"拿不到 RestApiUrl（stack={STACK}）：{err.strip()[:200]}")
    print(f"  API：{api}")
    secret = ssm("/ryojaku/stg/JWT_SECRET")

    rc, _, err = ddb("put-item", "--table-name", USERS, "--item", json.dumps({
        "userId": {"S": uid}, "displayName": {"S": MARK}, "email": {"S": email},
        "passwordHash": {"S": PASSWORD_HASH}, "accountType": {"S": "app"}, "points": {"N": "0"}}))
    if rc != 0:
        die(f"建不出測試使用者 {uid}：{err.strip()[:200]}")
    rc, _, err = ddb("put-item", "--table-name", PUSH, "--item", json.dumps({
        "userId": {"S": uid}, "deviceId": {"S": device}, "isActive": {"BOOL": True}}))
    if rc != 0:
        ddb("delete-item", "--table-name", USERS, "--key", json.dumps({"userId": {"S": uid}}))
        die(f"建不出測試推播訂閱：{err.strip()[:200]}")
    print(f"  測試使用者：{uid}／{email}，推播訂閱 1 台（isActive=true）")
    # 第二個合成帳號當「別人」：/community-get-user-posts 要登入才看得到（實測不帶 token 回 401），
    # 而被刪的那個人自己的 token 在 D2 之後就作廢了。
    viewer = f"{MARK}-VIEWER-{tag}"
    rc, _, err = ddb("put-item", "--table-name", USERS, "--item", json.dumps({
        "userId": {"S": viewer}, "displayName": {"S": MARK}, "points": {"N": "0"}}))
    if rc != 0:
        ddb("delete-item", "--table-name", USERS, "--key", json.dumps({"userId": {"S": uid}}))
        ddb("delete-item", "--table-name", PUSH, "--key",
            json.dumps({"userId": {"S": uid}, "deviceId": {"S": device}}))
        die(f"建不出旁觀者帳號：{err.strip()[:200]}")

    # iat 往前放 5 秒：提出刪除會把 pwChangedAt 寫成「那一刻」，token 必須明確早於它，
    # D3 才是在量「被撤銷」而不是「同秒邊界」。
    now = int(time.time())
    tk = sign({"userId": uid, "email": email, "iat": now - 5, "exp": now + 3600}, secret)
    viewer_tk = sign({"userId": viewer, "email": "", "iat": now - 5, "exp": now + 3600}, secret)
    bad_tk = tk[:-4] + ("AAAA" if not tk.endswith("AAAA") else "BBBB")
    q = "?userId=" + uid

    try:
        print("\n══ D0 對照·刪除之前 ══")
        code, _, _ = req(api, "/chat/rooms", token=tk)
        check("D0a 這張 token 打需登入的端點", code, 200)
        code, _, _ = req(api, "/user-comments" + q + "&limit=1")
        check("D0b 別人查這個人的評語", code, 200)
        code, _, _ = req(api, "/ratings" + q)
        check("D0c 別人查這個人收到的評價", code, 200)
        code, _, _ = req(api, "/community-get-user-posts?targetUserId=" + uid, token=viewer_tk)
        check("D0d 別人查這個人的貼文", code, 200)

        print("\n══ D1 反控·沒有身分不可以提出刪除 ══")
        code, _, _ = req(api, "/auth/delete-account", method="POST", payload={})
        check("D1a 不帶 token", code, 401)
        code, _, _ = req(api, "/auth/delete-account", token=bad_tk, method="POST", payload={})
        check("D1b 壞掉的 token", code, 401)
        item = get_user(uid) or {}
        check("D1c 兩次被拒之後 Users 沒有被寫上 deleteRequestedAt", "deleteRequestedAt" in item, False)

        print("\n══ D2 提出刪除 ══")
        t0 = int(time.time())
        code, raw, _ = req(api, "/auth/delete-account", token=tk, method="POST", payload={})
        t1 = int(time.time())
        check("D2 狀態碼", code, 200)
        check("D2 回應的 graceDays", jbody(raw).get("graceDays"), GRACE_DAYS)
        item = get_user(uid) or {}
        dra = int(item.get("deleteRequestedAt", {}).get("N", "0"))
        pwc = int(item.get("pwChangedAt", {}).get("N", "0"))
        if t0 - 2 <= dra <= t1 + 2:
            pass_(f"D2b Users.deleteRequestedAt 是 Number 且落在這次請求的時間（{dra}）")
        else:
            fail_(f"D2b Users.deleteRequestedAt = {item.get('deleteRequestedAt')!r}，請求時間 {t0}..{t1}")
        check("D2b pwChangedAt 與 deleteRequestedAt 同值", pwc, dra)
        rc, out, _ = ddb("get-item", "--table-name", PUSH, "--key",
                         json.dumps({"userId": {"S": uid}, "deviceId": {"S": device}}), "--consistent-read")
        pitem = json.loads(out).get("Item", {}) if rc == 0 and out.strip() else {}
        check("D2c 推播訂閱被停掉（isActive）", pitem.get("isActive", {}).get("BOOL"), False)

        print("\n══ D3 提出之後原本的 token 作廢 ══")
        code, _, _ = req(api, "/chat/rooms", token=tk)
        check("D3 同一張 token 再打需登入的端點", code, 401)

        print("\n══ D4 停用期間別人查不到 ══")
        code, _, _ = req(api, "/user-comments" + q + "&limit=1")
        check("D4a 評語", code, 404)
        code, _, _ = req(api, "/ratings" + q)
        check("D4b 收到的評價", code, 404)
        code, _, _ = req(api, "/community-get-user-posts?targetUserId=" + uid, token=viewer_tk)
        check("D4c 貼文", code, 404)

        print("\n══ D5 停用期內登入 ＝ 撤回 ══")
        time.sleep(2)  # 跨過「提出的同一秒」；那一格在單元層，這裡量的是正常情形
        code, raw, _ = req(api, "/app-login", method="POST", payload={"email": email, "password": PASSWORD})
        check("D5 登入狀態碼", code, 200)
        new_tk = jbody(raw).get("token") or ""
        check("D5 有發 token", bool(new_tk), True)
        item = get_user(uid) or {}
        check("D5b Users.deleteRequestedAt 已移除", "deleteRequestedAt" in item, False)
        if new_tk:
            code, _, _ = req(api, "/chat/rooms", token=new_tk)
            check("D5c 新 token 可用", code, 200)
        code, _, _ = req(api, "/user-comments" + q + "&limit=1")
        check("D5d 別人又查得到評語", code, 200)

        print("\n══ D6 停用期已滿 ⇒ 密碼對也不可登入 ══")
        expired = int(time.time()) - (GRACE_DAYS + 1) * 86400
        rc, _, err = ddb("update-item", "--table-name", USERS, "--key", json.dumps({"userId": {"S": uid}}),
                         "--update-expression", "SET deleteRequestedAt = :t",
                         "--expression-attribute-values", json.dumps({":t": {"N": str(expired)}}))
        if rc != 0:
            fail_(f"D6 寫不進過期的 deleteRequestedAt（本格未測到）：{err.strip()[:160]}")
        else:
            code, raw, _ = req(api, "/app-login", method="POST", payload={"email": email, "password": PASSWORD})
            check("D6 登入狀態碼", code, 410)
            check("D6 error", jbody(raw).get("error"), "account_deleted")
            check("D6 沒有發 token", "token" in jbody(raw), False)
            item = get_user(uid) or {}
            check("D6b deleteRequestedAt 沒有被這次登入撤掉",
                  item.get("deleteRequestedAt", {}).get("N"), str(expired))
            code, _, _ = req(api, "/user-comments" + q + "&limit=1")
            check("D6c 過期而還沒清除的帳號，別人仍然查不到", code, 404)
    finally:
        print("\n══ 清理 ══")
        ddb("delete-item", "--table-name", USERS, "--key", json.dumps({"userId": {"S": uid}}))
        ddb("delete-item", "--table-name", USERS, "--key", json.dumps({"userId": {"S": viewer}}))
        ddb("delete-item", "--table-name", PUSH, "--key",
            json.dumps({"userId": {"S": uid}, "deviceId": {"S": device}}))
        left = []
        if get_user(uid) or get_user(viewer):
            left.append(USERS)
        rc, out, _ = ddb("get-item", "--table-name", PUSH, "--key",
                         json.dumps({"userId": {"S": uid}, "deviceId": {"S": device}}), "--consistent-read")
        if rc != 0 or (out.strip() and json.loads(out).get("Item")):
            left.append(PUSH)
        if left:
            print(f"🔴 清理失敗，殘留在 {left}（userId={uid}）")
            sys.exit(2)
        print("  測試資料已刪除並讀回確認")

    print(f"\n結果：{TOTAL - FAIL}/{TOTAL} 通過")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
