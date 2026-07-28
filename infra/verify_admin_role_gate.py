#!/usr/bin/env python3
# P0 驗收：admin 端點的 role 閘（設計冊 tools/ryojaku-admin-migration/DESIGN.md §3.1）。
#
# 為什麼自己簽 token 而不是走 /admin/login：
#   我們手上沒有 s2admin 的明文密碼，但有 SSM 的 JWT_SECRET（deploy_app.sh 也是這樣取）。
#   自簽反而更精準 —— 可以造出「完全沒有 role claim」的 user token，
#   那正是 P0 要擋、且原本會讓 Lambda panic 成 502 的那一種。
#   claims 形狀比照真貨：user = shared.GenerateToken（userId/email/sub/exp/iat，無 role）、
#   admin = mahjongclub_admin_login（sub/role/exp）。
#
# 兩條路都測：
#   HTTP  —— 攻擊者實際看得到的路徑（部分端點因 §3.2 路由不齊會是 404/403-Missing-Auth，屬預期）。
#   INVOKE —— 直接對 Lambda 丟合成事件，繞開路由，確保 12 支「每一支」的程式碼閘都驗到，
#            並且能分辨 502(panic) 與 403(擋下)：panic 會讓 invoke 回 FunctionError=Unhandled。
#
# 用法： python3 verify_admin_role_gate.py [--before|--after]

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
# HTTP API uses an explicit stg stage, not $default.
HTTP_BASE = "https://3pmmlmvr5a.execute-api.ap-southeast-1.amazonaws.com/stg"

# (Lambda 名, HTTP method, HTTP 路徑, 事件型別)
TARGETS = [
    ("ryojaku-stg-admin-activities",         "GET",  "/admin/activities",     "V2"),
    ("ryojaku-stg-admin-admins",             "GET",  "/admin/admins",         "V1"),
    ("ryojaku-stg-admin-analysis",           "GET",  "/admin/analysis",       "V1"),
    ("ryojaku-stg-admin-dashboard-get-stats", "GET",  "/admin/dashboard/stats", "V1"),
    ("ryojaku-stg-admin-logs",               "GET",  "/admin/logs",           "V1"),
    ("ryojaku-stg-admin-moderation",         "GET",  "/admin/moderation/reports", "V1"),
    ("ryojaku-stg-admin-point-history",      "GET",  "/admin/point-history",  "V1"),
    ("ryojaku-stg-admin-push-all",           "POST", "/admin/push-all",       "V1"),
    ("ryojaku-stg-admin-users",              "GET",  "/admin/users",          "V1"),
    ("ryojaku-stg-admin-versions",           "GET",  "/admin/versions",       "V1"),
    ("ryojaku-stg-admin-vouchers",           "GET",  "/admin/vouchers",       "V1"),
    ("ryojaku-stg-event-commands",           "GET",  "/event-commands",       "V1"),
]


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign(payload: dict, secret: str) -> str:
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    msg = f"{head}.{body}".encode()
    mac = hmac.new(secret.encode(), msg, hashlib.sha256).digest()
    return f"{head}.{body}.{b64(mac)}"


def get_secret() -> str:
    out = subprocess.run(
        ["aws", "ssm", "get-parameter", "--region", REGION,
         "--name", "/ryojaku/stg/JWT_SECRET", "--with-decryption",
         "--query", "Parameter.Value", "--output", "text"],
        capture_output=True, text=True, check=True)
    return out.stdout.strip()


def make_tokens(secret: str):
    now = int(time.time())
    exp = now + 3600
    user = sign({"userId": "p0-probe-user", "email": "p0probe@example.com",
                 "sub": "p0-probe-user", "iat": now, "exp": exp}, secret)
    admin = sign({"sub": "s2admin", "role": "super_admin", "exp": exp}, secret)
    return user, admin


def http_probe(method: str, path: str, kind: str, token: str):
    base = HTTP_BASE if kind == "V2" else REST_BASE
    data = b"{}" if method == "POST" else None
    req = urllib.request.Request(base + path, data=data, method=method)
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


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "--run"
    secret = get_secret()
    user_tok, admin_tok = make_tokens(secret)

    print(f"=== {label}  ({time.strftime('%Y-%m-%d %H:%M:%S')}) ===")
    print(f"{'function':38} {'H:user':>8} {'H:admin':>8} {'I:user':>8} {'I:admin':>8}")
    print("-" * 78)
    bad = []
    for fn, method, path, kind in TARGETS:
        hu, _ = http_probe(method, path, kind, user_tok)
        ha, _ = http_probe(method, path, kind, admin_tok)
        iu, iu_body = invoke_probe(fn, method, path, kind, user_tok)
        ia, _ = invoke_probe(fn, method, path, kind, admin_tok)
        print(f"{fn:38} {hu!s:>8} {ha!s:>8} {iu!s:>8} {ia!s:>8}")
        # 驗收條件只看 INVOKE 那兩欄（HTTP 受 §3.2 路由不齊影響，另階段處理）：
        #   user token 必須是 403；admin token 不得是 403/PANIC。
        if iu != 403:
            bad.append(f"{fn}: user token 得到 {iu} (want 403) {iu_body}")
        if ia in (403, "PANIC"):
            bad.append(f"{fn}: admin token 得到 {ia} (不該被擋)")

    print("-" * 78)
    if bad:
        print("❌ 未達 P0 驗收：")
        for b in bad:
            print("   " + b)
        return 1
    print("✅ 12/12：user token 一律 403、admin token 均未被擋、無 panic")
    return 0


if __name__ == "__main__":
    sys.exit(main())
