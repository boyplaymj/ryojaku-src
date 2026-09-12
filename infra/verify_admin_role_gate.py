#!/usr/bin/env python3
# P0 ＋ P1 驗收：admin 端點的 role 閘與 authorizer
# （設計冊 tools/ryojaku-admin-migration/DESIGN.md §3.1、§5.1、§5.2）。
#
# 為什麼自己簽 token 而不是走 /admin/login：
#   我們手上沒有 s2admin 的明文密碼，但有 SSM 的 JWT_SECRET（deploy_app.sh 也是這樣取）。
#   自簽反而更精準 —— 可以造出「完全沒有 role claim」的 user token，
#   那正是 P0 要擋、且原本會讓 Lambda panic 成 502 的那一種。
#   claims 形狀比照真貨：user = shared.GenerateToken（userId/email/sub/exp/iat，無 role）、
#   admin = mahjongclub_admin_login（sub/role/exp）。
#
# 兩條路都測，兩條都斷言：
#   HTTP  —— 攻擊者實際看得到的路徑，驗的是 P1 的 authorizer（擋在 Lambda 之前）。
#            三種身分都打：不帶 token／user token／admin token。
#   INVOKE —— 直接對 Lambda 丟合成事件，繞開路由，驗的是 P0 的程式碼閘（縱深防禦的第二層），
#            確保 12 支「每一支」都驗到，且能分辨 502(panic) 與 403(擋下)：
#            panic 會讓 invoke 回 FunctionError=Unhandled。
#
# ⚠️ 本檔的期望值是「釘住現況」而非「照理想寫」。下面兩個常數與 route-missing 標記
#    記錄的是 2026-07-28 的實測行為；當 authorizer 改回 Deny policy、或 P3 把 event-commands
#    搬進 REST API 時，本腳本會**主動 fail**，逼人回來更新期望值 —— 這是刻意的，不要改成
#    寬鬆比對放過去。
#
# 用法： python3 verify_admin_role_gate.py [任意標籤]

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
# HTTP API 已於 2026-09-11 §5 收斂時整個刪除（id 3pmmlmvr5a 永久消失）。
# TARGETS 現在全部是 "V1"，所以下面 kind=="V2" 的分支是死碼 —— 保留分支是為了
# 「哪天又有 V2 端點」時不必重寫，但 base 不可以再指向一個不存在的 host。
HTTP_BASE = None  # 沒有 HTTP API 了；kind=="V2" 會在下面明確炸掉而不是靜靜連線失敗

# authorizer 對「沒 token」與「有效 user token 但非 admin」都回 errors.New("Unauthorized")，
# API Gateway 兩者都映射成 401、不區分 —— 這是**已拍板的設計**，不是待修的 bug。
#
# 設計冊 §5 原訂 P1 驗收是「user token 403」，2026-07-28 以決策 D8 推翻，改為維持 401：
#   ① 401 不透露「你的 token 有效、只是不是 admin」，資訊洩漏較少。
#   ② 原本擔心的「Console 登入迴圈」經查不成立 —— Console 的 adminToken 只可能來自
#      /admin/login，而該支只發給 AdminUsers 裡的帳號，一般使用者的 token 進不到那個欄位。
#
# ⚠️ 若你看到這兩個常數相同、想把 HTTP_EXPECT_USER 改成 403「修好它」—— 別改，
#    先讀設計冊 D8 與 §5.2。要 403 得讓 authorizer 回明確的 Deny policy（回 error 一律 401），
#    那等於推翻 D8，是決策不是修 bug。
HTTP_EXPECT_NO_TOKEN = 401
HTTP_EXPECT_USER = 401

# 擋下＝401 或 403 都算；放行＝兩者皆非（有走到業務層，可能是 200 也可能是 400 缺參數）。
BLOCKED = (401, 403)

# http 欄位：
#   "gated"        —— 掛在 API Gateway 上、authorizer 生效。無 token 與 user 應被擋、admin 應通過。
#   "route-missing" —— 路由根本不存在，API Gateway 對所有人回 403 Missing Authentication Token，
#                      連 admin 也進不去。這是已知缺口，不是 authorizer 的功勞，故獨立標記。
#                      **P3 之後已無此類端點**（event-commands 與 redeem-points 都已搬進 REST API），
#                      機制保留供日後再出現缺口時使用。
# ⚠️ 路徑欄自 P2 起一律填「Console (`admin_frontend/src/services/api.ts`) 實際呼叫的路徑」，
#    不是我方 IaC 曾經發明的路徑。這樣本腳本同時也是 §3.2 路由對齊的回歸網：任何一條被改回
#    IaC 自創路徑，這裡就會變成 403 Missing Authentication Token 而 fail。
# (Lambda 名, HTTP method, HTTP 路徑, 事件型別, http 模式)
TARGETS = [
    # P5：本支原本掛在 HTTP API(V2)。Console 只有一個 BASE_URL 指向 REST API，
    # 掛在另一座 API 上等於 Console 永遠打不到 —— 只有真瀏覽器點測會現形，故搬來 REST。
    ("ryojaku-stg-admin-activities",         "GET",  "/admin/activities",     "V1", "gated"),
    ("ryojaku-stg-admin-admins",             "GET",  "/admin/admins",         "V1", "gated"),
    ("ryojaku-stg-admin-analysis",           "GET",  "/admin/analysis/users", "V1", "gated"),
    ("ryojaku-stg-admin-dashboard-get-stats", "GET",  "/admin/stats",         "V1", "gated"),
    ("ryojaku-stg-admin-logs",               "GET",  "/admin/logs",           "V1", "gated"),
    ("ryojaku-stg-admin-moderation",         "GET",  "/admin/moderation/reports", "V1", "gated"),
    ("ryojaku-stg-admin-point-history",      "GET",  "/admin/users/points/history", "V1", "gated"),
    ("ryojaku-stg-admin-push-all",           "POST", "/admin/push-all",       "V1", "gated"),
    ("ryojaku-stg-admin-users",              "GET",  "/admin/users",          "V1", "gated"),
    ("ryojaku-stg-admin-versions",           "GET",  "/admin/config/version", "V1", "gated"),
    ("ryojaku-stg-admin-vouchers",           "GET",  "/admin/vouchers",       "V1", "gated"),
    # vouchers 的 bare 與子路徑都要活（bare GET 列表、子路徑 POST update/delete），故多測一條。
    ("ryojaku-stg-admin-vouchers",           "POST", "/admin/vouchers/update", "V1", "gated"),
    # P3：以下兩支原本是 Lambda URL(AuthType=NONE)，已搬進主 REST API 並掛上 authorizer。
    # redeem-points 尤其關鍵 —— /redeem-codes/generate 會產生可兌換點數的序號，
    # 本支若哪天回到「無 token 也能通」，這裡就會 fail。（探測固定打唯讀的 /stats，不印序號。）
    ("ryojaku-stg-event-commands",           "GET",  "/event-commands",       "V1", "gated"),
    ("ryojaku-stg-event-commands",           "GET",  "/event-commands/stats", "V1", "gated"),
    ("ryojaku-stg-redeem-points",            "GET",  "/redeem-codes/stats",   "V1", "gated"),
]


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign(payload: dict, secret: str) -> str:
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    msg = f"{head}.{body}".encode()
    mac = hmac.new(secret.encode(), msg, hashlib.sha256).digest()
    return f"{head}.{body}.{b64(mac)}"


def _ssm(name: str) -> str:
    out = subprocess.run(
        ["aws", "ssm", "get-parameter", "--region", REGION,
         "--name", name, "--with-decryption",
         "--query", "Parameter.Value", "--output", "text"],
        capture_output=True, text=True, check=True)
    return out.stdout.strip()


def get_secret() -> str:
    """user 端簽章金鑰。app 使用者的 token 用這把簽。"""
    return _ssm("/ryojaku/stg/JWT_SECRET")


def get_admin_secret() -> str:
    """D5：admin 端專用簽章金鑰。與 user 那把分離後，兩者互不通用。"""
    return _ssm("/ryojaku/stg/ADMIN_JWT_SECRET")


def make_tokens(secret: str, admin_secret: str = None):
    """回 (user, admin, forged) 三種 token。

    D5 之前 user 與 admin 共用同一把金鑰，只靠 role claim 區分 —— 那代表「任何能拿到
    JWT_SECRET 的地方（或任何 user token 簽發路徑上的疏漏）都可能被拿去簽出 admin token」。
    分離之後，第三種 token（forged）就是這道防線的探針：

        forged = 用 **user 的金鑰** 簽一個 role=super_admin 的 token

    D5 之前它會被完全接受（簽章對、role 對）；D5 之後必須在驗簽階段就被打掉。
    這是本腳本唯一能證明「金鑰真的分離了」的斷言 —— 只看 admin token 能通過是不夠的，
    那在共用金鑰時也會通過。
    """
    if admin_secret is None:
        admin_secret = secret
    now = int(time.time())
    exp = now + 3600
    user = sign({"userId": "p0-probe-user", "email": "p0probe@example.com",
                 "sub": "p0-probe-user", "iat": now, "exp": exp}, secret)
    admin = sign({"sub": "s2admin", "role": "super_admin", "exp": exp}, admin_secret)
    forged = sign({"sub": "s2admin", "role": "super_admin", "exp": exp}, secret)
    # norole：用 **admin 金鑰** 簽、但沒有 role claim。
    # D5 之後 user token 在驗簽就被打掉（401），再也走不到 P0 的 role 閘 ——
    # 若不補這一種，P0 那道「缺 role claim 不可 panic、要回 403」的回歸網會被 D5 悄悄退休。
    # 這正是 P0 當初修的形狀（裸斷言 claims["role"].(string) 會 panic 成 502）。
    norole = sign({"sub": "s2admin", "exp": exp}, admin_secret)
    return user, admin, forged, norole


def http_probe(method: str, path: str, kind: str, token):
    """token=None 代表完全不帶 Authorization header。"""
    if kind == "V2":
        # fail-loud：連線失敗會被讀成「端點壞了」，而真因是這裡指著一個已刪除的 API。
        raise SystemExit("kind='V2' 但 HTTP API 已刪除（2026-09-11 §5）—— 請改成 V1")
    base = REST_BASE
    data = b"{}" if method == "POST" else None
    req = urllib.request.Request(base + path, data=data, method=method)
    if token is not None:
        req.add_header("Authorization", "Bearer " + token)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read()[:120].decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:120].decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 — 網路層例外照實回報，不吞
        return 0, repr(e)[:120]


def synth_event(method: str, path: str, kind: str, token: str) -> dict:
    if kind == "V2":
        return {
            "version": "2.0", "rawPath": path, "rawQueryString": "",
            "headers": {"authorization": "Bearer " + token, "content-type": "application/json"},
            "requestContext": {"http": {"method": method, "path": path}},
            "body": "{}" if method == "POST" else "", "isBase64Encoded": False,
        }
    return {
        "resource": path, "path": path, "httpMethod": method,
        "headers": {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        "queryStringParameters": None, "pathParameters": None,
        "requestContext": {"path": path, "httpMethod": method},
        "body": "{}" if method == "POST" else None, "isBase64Encoded": False,
    }


def invoke_probe(fn: str, method: str, path: str, kind: str, token: str):
    ev = json.dumps(synth_event(method, path, kind, token))
    payload_b64 = base64.b64encode(ev.encode()).decode()
    out = subprocess.run(
        ["aws", "lambda", "invoke", "--region", REGION, "--function-name", fn,
         "--payload", payload_b64, "--cli-read-timeout", "60", "/dev/stdout"],
        capture_output=True, text=True)
    if out.returncode != 0:
        return "ERR", out.stderr.strip()[:120]
    raw = out.stdout
    # invoke 把回應 body 與 CLI 的 JSON 結果一起寫到 stdout，取第一段 JSON。
    try:
        dec = json.JSONDecoder()
        resp, idx = dec.raw_decode(raw)
        meta, _ = dec.raw_decode(raw[idx:].lstrip())
    except ValueError:
        return "ERR", raw[:120]
    if meta.get("FunctionError"):
        # panic 走這條：errorType 通常是 interface conversion 之類。
        return "PANIC", str(resp.get("errorMessage", resp))[:120]
    return resp.get("statusCode", "?"), str(resp.get("body", ""))[:100]


# 🔴 「我量不到」不是「它退步了」（2026-09-12 補）。
#    http_probe() 網路層例外回 **0**、invoke_probe() 的 aws CLI 失敗回 **"ERR"** ——
#    舊版把這兩個哨兵值直接拿去跟 401/403/200 比，比不過就進 `bad` ⇒ rc=1「未通過」。
#    ⇒ 網路斷一下、AWS 憑證過期、被 throttle，讀起來全都像「授權閘回歸了」。
#    而 rc=1 的處置是「去看程式」，rc=2 的處置是「去看基礎設施」，兩者相反。
#    ⚠️ 這支是我部署前後拿來當迴歸尺的那一支 —— 當時 rc=0 所以結論沒受影響，
#    但只要那兩次有一次網路抖動，我就會回報一個不存在的授權回歸。
EQUIP_SENTINELS = (0, "ERR")


def equip_hit(*codes):
    """任何一格落在哨兵值 ⇒ 這一輪有「沒量到」的格子。"""
    return [c for c in codes if c in EQUIP_SENTINELS]


def check_http(fn: str, mode: str, none_code, user_code, admin_code, bad: list, equip: list):
    """P1：authorizer 層。gated 者無 token/user 被擋、admin 通過；route-missing 者三者皆 403。"""
    hit = equip_hit(none_code, user_code, admin_code)
    if hit:
        equip.append(f"[HTTP] {fn}: 有格子沒量到（{hit}）—— 網路／端點不可達，不是回歸")
        return
    if mode == "route-missing":
        # 這裡刻意連 admin 也斷言 403：等 P3 把 route-missing 端點搬進 REST API，本行會 fail，
        # 提醒把該支從 route-missing 改回 gated，而不是讓已修好的缺口悄悄留著標記。
        for who, code in (("無 token", none_code), ("user", user_code), ("admin", admin_code)):
            if code != 403:
                bad.append(f"[HTTP] {fn}: {who} 得到 {code}，"
                           f"但此支標記為 route-missing(預期三者皆 403)。路由若已補好請改標記為 gated")
        return
    if none_code != HTTP_EXPECT_NO_TOKEN:
        bad.append(f"[HTTP] {fn}: 無 token 得到 {none_code} (want {HTTP_EXPECT_NO_TOKEN})")
    if user_code != HTTP_EXPECT_USER:
        bad.append(f"[HTTP] {fn}: user token 得到 {user_code} (want {HTTP_EXPECT_USER})"
                   f"{' —— authorizer 若已刻意改回 Deny policy(推翻設計冊 D8)，才把 HTTP_EXPECT_USER 改 403' if user_code == 403 else ''}")
    if admin_code in BLOCKED:
        bad.append(f"[HTTP] {fn}: admin token 被擋下 ({admin_code})，authorizer 應放行")


def check_invoke(fn: str, user_code, admin_code, user_body: str, bad: list, equip: list):
    """P0：Lambda 內的程式碼閘。繞開路由，每支都要擋住 user token 且不 panic。

    ⚠️ D5 之後期望值由「403」放寬為「401 或 403」：兩把金鑰分離後，user token 在**驗簽階段**
    就被打掉（401），根本走不到 role 閘（403）。兩者都是「擋下且沒 panic」，都算通過。
    真正還在驗 role 閘的是 check_norole —— 那支用 admin 金鑰簽但缺 role claim，
    是 D5 之後唯一打得到程式碼閘的形狀。
    """
    hit = equip_hit(user_code, admin_code)
    if hit:
        equip.append(f"[INVOKE] {fn}: invoke 失敗（{hit}）{user_body} —— 沒量到，不是回歸")
        return
    if user_code not in BLOCKED:
        bad.append(f"[INVOKE] {fn}: user token 得到 {user_code} (want 401/403) {user_body}")
    if user_code == "PANIC":
        bad.append(f"[INVOKE] {fn}: user token 造成 panic {user_body}")
    if admin_code in (403, "PANIC"):
        bad.append(f"[INVOKE] {fn}: admin token 得到 {admin_code} (不該被擋)")


def check_norole(fn: str, code, body: str, bad: list, equip: list):
    """P0 的真正回歸網（D5 後）：admin 金鑰簽、但缺 role claim → 必須 403，且絕不 panic。"""
    if equip_hit(code):
        equip.append(f"[NOROLE] {fn}: invoke 失敗（{code}）{body} —— 沒量到，不是回歸")
        return
    if code == "PANIC":
        bad.append(f"[NOROLE] {fn}: 缺 role claim 造成 panic（P0 的 502 回歸了）{body}")
    elif code != 403:
        bad.append(f"[NOROLE] {fn}: 缺 role claim 得到 {code} (want 403) {body}")


def check_forged(fn: str, http_code, invoke_code, invoke_body: str, bad: list, equip: list):
    """D5：用 **user 金鑰** 簽的 role=super_admin token 必須在驗簽階段就被打掉。

    這是整份腳本裡唯一能證明「兩把金鑰真的分離」的斷言。只驗「admin token 能通過」
    是不夠的 —— 共用同一把金鑰時它一樣會通過。若哪天有人把 admin 支改回讀 JWT_SECRET，
    或誤把兩個 SSM 參數設成同一個值，這裡就會 fail。
    """
    hit = equip_hit(http_code, invoke_code)
    if hit:
        equip.append(f"[FORGED] {fn}: 有格子沒量到（{hit}）{invoke_body} —— 不是回歸")
        return
    if http_code not in BLOCKED:
        bad.append(f"[FORGED/HTTP] {fn}: 用 user 金鑰簽的 super_admin token 得到 {http_code}，"
                   f"應被擋（D5 金鑰分離失效？檢查該支是否還在讀 JWT_SECRET）")
    if invoke_code not in (401, 403):
        bad.append(f"[FORGED/INVOKE] {fn}: 同上，程式碼閘得到 {invoke_code} {invoke_body}")


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "--run"
    secret = get_secret()
    admin_secret = get_admin_secret()
    if secret == admin_secret:
        print("❌ D5 未成立：JWT_SECRET 與 ADMIN_JWT_SECRET 相同，金鑰並未分離")
        return 1
    user_tok, admin_tok, forged_tok, norole_tok = make_tokens(secret, admin_secret)

    print(f"=== {label}  ({time.strftime('%Y-%m-%d %H:%M:%S')}) ===")
    print(f"{'function':38} {'H:none':>7} {'H:user':>7} {'H:admin':>7} {'H:forge':>7} "
          f"{'I:user':>7} {'I:admin':>7} {'I:forge':>7} {'I:norole':>8}  mode")
    print("-" * 122)
    bad = []
    equip = []   # 沒量到的格子（rc=2），與 bad（rc=1）刻意分開
    for fn, method, path, kind, mode in TARGETS:
        hn, _ = http_probe(method, path, kind, None)
        hu, _ = http_probe(method, path, kind, user_tok)
        ha, _ = http_probe(method, path, kind, admin_tok)
        hf, _ = http_probe(method, path, kind, forged_tok)
        iu, iu_body = invoke_probe(fn, method, path, kind, user_tok)
        ia, _ = invoke_probe(fn, method, path, kind, admin_tok)
        if_, if_body = invoke_probe(fn, method, path, kind, forged_tok)
        inr, inr_body = invoke_probe(fn, method, path, kind, norole_tok)
        print(f"{fn:38} {hn!s:>7} {hu!s:>7} {ha!s:>7} {hf!s:>7} {iu!s:>7} {ia!s:>7} {if_!s:>7} {inr!s:>7}  {mode}")
        check_http(fn, mode, hn, hu, ha, bad, equip)
        check_invoke(fn, iu, ia, iu_body, bad, equip)
        check_forged(fn, hf, if_, if_body, bad, equip)
        check_norole(fn, inr, inr_body, bad, equip)

    print("-" * 122)
    # P0 是「每支 lambda 的程式碼閘」，P1 是「每條路由的 authorizer」——
    # vouchers 有兩條路由但只有一支 lambda，故兩者分別以「相異函式數」與「路由數」計。
    fns = len({t[0] for t in TARGETS})
    gated = sum(1 for t in TARGETS if t[4] == "gated")
    missing = len(TARGETS) - gated
    # 🔴 equip 優先於 bad：有格子沒量到時，這一輪整體**不是一個判定**。
    #    仍然把 bad 印出來（不要弄丟已經量到的失敗），但 exit code 是 2。
    if equip:
        print(f"⚠️ 沒量到（{len(equip)} 項）—— rc=2，去看基礎設施，不要讀成回歸：")
        for e in equip:
            print("   " + e)
        if bad:
            print(f"   （另有 {len(bad)} 項比對失敗，但本輪不完整，先解決上面那些再重跑）")
            for b in bad:
                print("   " + b)
        return 2
    if bad:
        print(f"❌ 未通過（{len(bad)} 項）：")
        for b in bad:
            print("   " + b)
        return 1
    print(f"✅ P0 程式碼閘 {fns}/{fns} 支：缺 role claim 一律 403、無 panic、admin 未被擋")
    print(f"✅ D5 金鑰分離 {len(TARGETS)}/{len(TARGETS)} 條：用 user 金鑰簽的 super_admin token 一律擋下")
    print(f"✅ P1 authorizer {gated}/{gated} 條路由：無 token 與 user token 皆擋下、admin 通過")
    if missing:
        names = ", ".join(t[0].replace("ryojaku-stg-", "") for t in TARGETS if t[4] == "route-missing")
        print(f"⚠️  另有 {missing} 支路由不存在、authorizer 掛不上（{names}）—— "
              f"目前只靠 P0 程式碼閘防守，待 P3 處理（設計冊 §5.2）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
