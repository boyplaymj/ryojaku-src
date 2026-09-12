#!/usr/bin/env python3
"""真瀏覽器 CORS 回歸驗收（S7 回歸腳本的一部分）。

為什麼需要這支：**curl 不執行 CORS**。所有 S1~S5 的 curl 煙霧測試都只驗到 API 層，
驗不到 preflight 少了 Access-Control-Allow-Headers 這種洞 —— 那種洞只有真瀏覽器會爆，
而且症狀是整個前端每一個 API 呼叫都失敗。2026-07-26 就是這樣挖出 staging 的 CORS
從一開始就是壞的（REST 只設 AllowOrigin、HTTP API 完全沒設）。

用法：
    python3 infra/verify_cors_browser.py              # 用自鑄 token（需 AWS 憑證讀 SSM）
    TOKEN=<jwt> python3 infra/verify_cors_browser.py  # 指定 token

判定：CORS 不通時 fetch 會 throw TypeError（"Failed to fetch"），不會回任何狀態碼。
所有探測皆為非破壞性（不存在的 ID／只讀欄位驗證）。
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ORIGIN = "https://d1wa3w4dmfwqc7.cloudfront.net"
REST = "https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg"
# HTTP API 已於 2026-09-11 §5 收斂時整個刪除（見 PATH_RECONCILE）。常數一併移除，
# 留著的話下一個人會拿它去打一個不存在的 host，而那個失敗讀起來像 CORS 壞了。
PROBE_USER = "APP_1keifs5e846ao6pD"


def mint_token():
    """從 SSM 取 JWT_SECRET 自鑄測試 token。exp 給足 6 小時 —— 給太短會在測到一半過期，
    回 authorizer 格式的 {"message":"Unauthorized"}，容易被誤判成程式壞掉。"""
    secret = subprocess.check_output([
        "aws", "ssm", "get-parameter", "--region", "ap-southeast-1",
        "--name", "/ryojaku/stg/JWT_SECRET", "--with-decryption",
        "--query", "Parameter.Value", "--output", "text",
    ], text=True).strip().encode()

    def seg(d):
        return base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=")

    now = int(time.time())
    head = seg({"alg": "HS256", "typ": "JWT"})
    payload = seg({"userId": PROBE_USER, "email": "probe@example.com",
                   "exp": now + 21600, "iat": now, "sub": PROBE_USER})
    sig = base64.urlsafe_b64encode(
        hmac.new(secret, head + b"." + payload, hashlib.sha256).digest()).rstrip(b"=")
    return (head + b"." + payload + b"." + sig).decode()


# (標籤, 網址, body, 是否加白名單外的 header)
CASES = [
    ("REST /get-upload-url", f"{REST}/get-upload-url", {"fileName": "probe.png"}, False),
    ("REST /cancel-game", f"{REST}/cancel-game", {"gameId": "__nonexistent_probe__"}, False),
    # 2026-09-11：本條原本打 HTTP API。§5 收斂後該路由已搬到 REST，
    # 而 HttpApi 資源已被 CFN 刪除（id 3pmmlmvr5a 永久消失）⇒ 不改的話這格會變成連線錯誤。
    ("REST /registrations/accept", f"{REST}/registrations/accept",
     {"registrationId": "__nonexistent_probe__"}, False),
    # 對照組：白名單外的 header 必須被擋，藉此證明瀏覽器確實在執行 allow-headers 檢查，
    # 而不是寬容放行（否則上面三項通過也說明不了什麼）。
    ("對照組：白名單外的 header 應被擋", f"{REST}/get-upload-url", {"fileName": "probe.png"}, True),
]

JS = """
async ([url, body, token, extra]) => {
  const h = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'X-App-Version': '1.0.0',
    'X-Platform': 'Web',
  };
  if (extra) h['X-Definitely-Not-Allowed'] = '1';
  try {
    const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const t = await r.text();
    return { ok: true, status: r.status, body: t.slice(0, 110) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
"""



# 🔴 這支有一個**假綠**方向，比 exit code 那件事更嚴重（2026-09-12 補）。
#    瀏覽器裡「CORS 被擋」與「網路根本不通」**都是 TypeError: Failed to fetch**，
#    形狀逐字相同。於是對「預期被擋」那幾格（`extra` 為真），端點掛掉時
#    fetch 一樣 reject ⇒ 判成 ✅「如預期被擋」—— **端點根本沒回應，而報告是綠的**。
#    而「預期通過」那幾格會失敗 ⇒ 舊版算 rc=1「CORS 壞了」，把不可達講成回歸。
#
#    ⇒ 出路是**不能在瀏覽器裡分**，要一道 out-of-band 的可達性前提：
#    先用 Python 直接打 REST（不經瀏覽器、不受 CORS 管），確認它活著。
#    活著 ⇒ 瀏覽器端的失敗才可以歸因給 CORS（rc=1）。
#    不活 ⇒ rc=2，而且**必須明講「預期被擋那幾格的綠燈這一輪不可信」**。
def reachability_precheck():
    """回 (ok, 說明)。刻意不經瀏覽器 —— CORS 是瀏覽器施加的，伺服器端不受它管。"""
    import urllib.request, urllib.error
    url = REST + "/venues"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=20) as r:
            return True, "GET %s → HTTP %d" % (url, r.status)
    except urllib.error.HTTPError as e:
        # 401/403 也算「活著」—— 我們要的是「有沒有回應」，不是「有沒有權限」
        return True, "GET %s → HTTP %d（有回應即可）" % (url, e.code)
    except Exception as e:
        return False, "GET %s 打不通：%r" % (url, e)


def main():
    ok, why = reachability_precheck()
    print("可達性前提：%s %s" % ("✅" if ok else "⚠️", why))
    if not ok:
        print("⚠️ rc=2 —— 端點不可達，這一輪不是判定。")
        print("   🔴 特別注意：『預期被擋』那幾格在端點掛掉時**也會印 ✅**")
        print("      （瀏覽器對 CORS 拒絕與網路不通都丟 TypeError），所以不要讀那些綠燈。")
        return 2
    token = os.environ.get("TOKEN") or mint_token()
    failed = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(ORIGIN, wait_until="domcontentloaded", timeout=60000)
        print(f"瀏覽器來源 = {page.evaluate('location.origin')}\n")
        for label, url, body, extra in CASES:
            res = page.evaluate(JS, [url, body, token, extra])
            passed = (not res.get("ok")) if extra else res.get("ok")
            if passed and not extra:
                print(f"  ✅ {label}\n       CORS 通過 → HTTP {res['status']} | {res['body']}")
            elif passed:
                print(f"  ✅ {label}\n       如預期被擋 → {res['error']}")
            else:
                failed.append(label)
                detail = f"HTTP {res['status']}" if res.get("ok") else res.get("error")
                print(f"  ❌ {label}\n       非預期結果 → {detail}")
        browser.close()

    print("\n判定:", "全數通過" if not failed else f"{len(failed)} 項失敗 → {failed}")
    # 走到這裡代表可達性前提成立 ⇒ 瀏覽器端的失敗可以歸因給 CORS（rc=1），
    # 而不是「我量不到」。前提不成立的那條路在上面就 return 2 了。
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
