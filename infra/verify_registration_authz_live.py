#!/usr/bin/env python3
# 授權層：拿到合法身分之後，能不能動**別人**的東西？（正典 PATH_RECONCILE.md）
#
# 用法：python3 verify_registration_authz_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# ── 這支答的是哪個問題 ────────────────────────────────────────────
#
# 先前那支 `verify_auth_inhandler_gate.py` 答的是「**有沒有驗身分**」。
# 它的界線寫著：不答「授權邏輯對不對」。這支補那一半。
#
# 🔴 `/auth/*` 那四支的答案是**結構性**的：`unbindRequest{Provider}`／
#    `changePasswordRequest{CurrentPassword,NewPassword}`／`bindRequest{IDToken}`／
#    logout-all 根本沒有 request struct ⇒ **沒有任何欄位可以指定別人**，
#    目標一律是 JWT 來的 `userID`。那比執行期檢查更強，不需要線上量。
#
# ⇒ 真正有 IDOR 面的是 §5 剛搬過來的兩條：`/registrations/{accept,reject}`
#    吃的 `registrationId` 屬於**某個人的局**。它們有一道
#    `game["hostUserId"].(string) != userID → 403`。這支去量那道閘。
#
# ── 承重的是「同一筆報名、兩個身分」那一對 ───────────────────────
#
# 🔴 只測「路人拿到 403」是不夠的：端點整支壞掉、或那條路由根本不存在時，
#    **每一個人都會拿到 403**。所以 Z3 讓**主揪**對**同一個 registrationId**
#    在同一輪裡拿到 200 —— 那一對才把「不是主揪」與「誰來都不行」分開。
#
# 🔴🔴 **403 一定要連 body 一起斷言。** 這套 API 上 403 有兩種來源：
#    ①擁有權檢查（body 是「只有主揪可以接受報名」）
#    ②**API Gateway 對不存在的路由把 Authorization 當 SigV4 解析**，回
#      403 `{"message":"Missing Authentication Token"}`
#    —— §5 搬遷前那五條路由的 403 就是②。只看狀態碼的話，
#    「授權閘擋住了」與「這條路由根本不在」**逐字相同**。
#
# ⚠️ 寫入面積（跑完全部刪掉並 read-back）：
#    Users 2、Games 1、Registrations 1、Notifications N（accept/reject 會發）。
#    四張表都是單一 HASH key（取自 `describe-table`，不是猜的）：
#    Games=gameId／Registrations=registrationId／Notifications=notificationId／Users=userId。
#    ⚠️ Notifications 的 key 是 notificationId ⇒ 要用 **Scan + userId 過濾**才找得到本次那幾筆。
#
# ⚠️ **不走 `/app-register` 建帳號**：那支限流是「每 IP 每小時 10 次」，
#    而本支要兩個帳號 ⇒ 走 app-register 的話一小時只能跑 5 次。
#    改成直接在 Users 放兩列合成身分＋自簽 token（同 verify_venue_privacy_live.py）。

import base64, hashlib, hmac, json, os, subprocess, sys, time
import urllib.error, urllib.request

REGION = "ap-southeast-1"
PREFIX = "MahjongClubStg_"
MARK = "AUTHZPROBE-DELETEME"
DEFAULT_BASE = "https://ryojaku-api.boyplaymj.com"
ENDPOINTS = ["/registrations/accept", "/registrations/reject"]
HIT = set()
OWNER_MSG = "只有主揪"          # 擁有權檢查的業務訊息（片段）
SIGV4_MSG = "Missing Authentication Token"   # API Gateway 對不存在路由的 403

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

def ddb(*a): return sh(["aws","dynamodb",*a,"--region",REGION])

def req(base, path, token=None, method="POST", payload=None):
    global LAST
    HIT.add(path.split("?")[0])
    data = json.dumps(payload).encode() if payload is not None else b"{}"
    r = urllib.request.Request(base + path, method=method, data=data)
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", "Bearer " + token)   # 不進 argv
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            c, b = resp.status, resp.read().decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        c, b = e.code, e.read().decode("utf-8","replace")
    except Exception as e:
        LAST = f"connection error: {e}"; return 0, str(e)
    LAST = f"{c} body={b[:160]!r}"
    return c, b

def want_forbidden(label, code, body):
    """403 不夠 —— 必須是**擁有權檢查**那個 403，不是 gateway 的 SigV4 403。

    🔴 **承重的是「必須出現 OWNER_MSG」這個正向要求，不是 SIGV4_MSG 那份黑名單。**
    實測（2026-09-11）：打一條不存在的路由 ＋ 一個不是 SigV4 形狀的 Authorization，
    gateway 回的是 403 `Invalid key=value pair (missing equal-sign) in Authorization header`
    —— **不是** `Missing Authentication Token`。
    ⇒ gateway 的 403 措辭不只一種，而「列出已知的壞訊息」是一份手挑清單，
      漏掉的那種會靜靜通過。正向要求沒有這個問題：
      不管 gateway 怎麼措辭，它都不會說「只有主揪」。
    ⇒ SIGV4_MSG 那一支**只是為了印出更精確的失敗訊息**，不是判準本身。
    """
    if code != 403:
        fail_(f"{label}：得到 {code}，期望 403　body={body[:110]!r}"); return
    if SIGV4_MSG in body:
        fail_(f"{label}：403 但 body 是 gateway 的 {SIGV4_MSG!r} ⇒ 這條路由根本不在，不是授權閘擋的")
        return
    if OWNER_MSG in body:
        pass_(f"{label}（403 · 擁有權檢查）{body[:70]!r}")
    else:
        fail_(f"{label}：403 但 body 不是擁有權訊息 ⇒ 分不出是哪一層擋的　body={body[:110]!r}")

def main():
    base = os.environ.get("RYOJAKU_API_BASE", DEFAULT_BASE).rstrip("/")
    ts = int(time.time())
    host_id, out_id = f"{MARK}-HOST-{ts}", f"{MARK}-OUTSIDER-{ts}"
    gid = rid = None
    print("══ 前置 ══"); print(f"  API：{base}")

    rc, out, err = sh(["aws","ssm","get-parameter","--region",REGION,
                       "--name","/ryojaku/stg/JWT_SECRET","--with-decryption",
                       "--query","Parameter.Value","--output","text"])
    if rc != 0: die(f"讀不到 JWT_SECRET：{err.strip()[:200]}")
    secret = out.strip()

    for uid in (host_id, out_id):
        rc, _, err = ddb("put-item","--table-name",PREFIX+"Users","--item",
                         json.dumps({"userId":{"S":uid},"displayName":{"S":MARK},
                                     "emailVerified":{"BOOL":True},"points":{"N":"500"}}))
        if rc != 0: die(f"建不出 {uid}：{err.strip()[:200]}")
    exp = ts + 3600
    ht = sign({"userId":host_id,"email":f"h{ts}@example.com","exp":exp}, secret)
    ot = sign({"userId":out_id, "email":f"o{ts}@example.com","exp":exp}, secret)
    print(f"  主揪 {host_id}\n  路人 {out_id}")

    try:
        print("\n══ Z0 撐整組·兩把 token 都是好的（否則下面每個 403 都可能只是身分問題）══")
        for who, tk in (("主揪", ht), ("路人", ot)):
            c, b = req(base, f"/notifications?userId=x", token=tk, method="GET")
            if c == 200: pass_(f"Z0 {who} 的 token 可用（GET /notifications 200）")
            else: fail_(f"Z0 {who} 的 token 不可用：{c} {b[:90]!r}")

        print("\n══ 前置·主揪開一局，路人報名 ══")
        c, b = req(base, f"/create-game?userId={host_id}", token=ht, payload={
            "type":"one-time","gameType":"基本三將","placeName":MARK,"location":"authz-probe",
            "latitude":25.03,"longitude":121.56,"needPlayers":3,"stakes":"t",
            "startTime":"2026-12-31T10:00:00Z","rules":[],"features":[],"restrictions":[]})
        try: gid = (json.loads(b).get("data") or {}).get("gameID") or (json.loads(b).get("data") or {}).get("gameId")
        except Exception: gid = None
        if not gid: die(f"建團失敗（{c}）：{b[:200]}")
        print(f"  團局 {gid}")
        c, b = req(base, "/game-register", token=ot, payload={"gameId":gid})
        try:
            d = json.loads(b).get("data") or {}
            rid = d.get("registrationId") or d.get("registrationID")
        except Exception: rid = None
        if not rid: die(f"報名失敗（{c}）：{b[:200]}")
        print(f"  報名 {rid}（報名者＝路人）")

        print("\n══ Z1/Z2 承重·**路人**對主揪的局動手（同一筆 registrationId）══")
        for ep in ENDPOINTS:
            c, b = req(base, ep, token=ot, payload={"registrationId": rid, "gameId": gid})
            want_forbidden(f"Z1 路人 POST {ep}", c, b)

        print("\n══ Z3 承重的另一半·**主揪**對同一筆報名 ⇒ 必須不是 403 ══")
        print("     （少了這格，「不是主揪」與「誰來都不行／端點壞了」分不出來）")
        c, b = req(base, "/registrations/accept", token=ht, payload={"registrationId": rid, "gameId": gid})
        if c == 403:
            fail_(f"Z3 主揪也拿到 403 ⇒ 上面那兩格的綠燈沒有意義　body={b[:110]!r}")
        elif c == 200:
            pass_(f"Z3 主揪 POST /registrations/accept（200）{b[:70]!r}")
        else:
            fail_(f"Z3 主揪得到 {c}，期望 200　body={b[:110]!r}")

        print("\n══ Z4·狀態已改為 accepted 之後，路人仍應 403（證明擁有權檢查排在狀態檢查之前）══")
        c, b = req(base, "/registrations/accept", token=ot, payload={"registrationId": rid, "gameId": gid})
        want_forbidden("Z4 路人再試一次 POST /registrations/accept", c, b)

        print("\n══ Z5 涵蓋率閘·宣告要打的端點必須每一支都真的被打過 ══")
        missing = set(ENDPOINTS) - HIT
        if missing: fail_(f"Z5 這幾支一次都沒被打過：{sorted(missing)}")
        else: pass_(f"Z5 宣告的 {len(ENDPOINTS)} 支**都有發出請求**（本格不保證打得到）：{sorted(ENDPOINTS)}")

    finally:
        print("\n══ 清理（每一筆都 read-back；有殘留 ⇒ rc=2）══")
        left = []
        def drop(table, key, label):
            ddb("delete-item","--table-name",PREFIX+table,"--key",json.dumps(key))
            rc, out, _ = ddb("get-item","--table-name",PREFIX+table,"--key",
                             json.dumps(key),"--consistent-read")
            if rc != 0 or (out.strip() and json.loads(out).get("Item")): left.append(label)
        if rid: drop("Registrations", {"registrationId":{"S":rid}}, f"Registrations/{rid}")
        if gid: drop("Games", {"gameId":{"S":gid}}, f"Games/{gid}")
        # Notifications 的 key 是 notificationId ⇒ 只能 Scan + userId 過濾
        rc, out, _ = ddb("scan","--table-name",PREFIX+"Notifications",
                         "--filter-expression","#u = :a OR #u = :b",
                         "--expression-attribute-names",json.dumps({"#u":"userId"}),
                         "--expression-attribute-values",
                         json.dumps({":a":{"S":host_id},":b":{"S":out_id}}),
                         "--projection-expression","notificationId")
        n_notif = 0
        if rc == 0 and out.strip():
            for it in json.loads(out).get("Items", []):
                n_notif += 1
                drop("Notifications", {"notificationId":{"S":it["notificationId"]["S"]}},
                     f"Notifications/{it['notificationId']['S']}")
        for uid in (host_id, out_id):
            drop("Users", {"userId":{"S":uid}}, f"Users/{uid}")
        print(f"  Notifications 掃到 {n_notif} 筆")
        if left:
            print("  🔴 有殘留刪不掉：" + "、".join(left))
            print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過，但清理沒歸零 ⇒ rc=2（本輪不可信）")
            sys.exit(2)
        print(f"  ✅ 全部刪掉且 read-back 確認不存在（Users 2／Games {1 if gid else 0}／"
              f"Registrations {1 if rid else 0}／Notifications {n_notif}）")

    print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過")
    sys.exit(1 if FAIL else 0)

if __name__ == "__main__":
    main()
