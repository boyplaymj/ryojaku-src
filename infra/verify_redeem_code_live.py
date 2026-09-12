#!/usr/bin/env python3
"""`redeem-code` 的線上驗收 —— 設計冊「這支只讀了原始碼，沒有線上量過」那一格。

為什麼這支值得單獨量：它是 **Function URL ＋ `AuthType: NONE`**，也就是
**全網路任何人都打得到這顆 Lambda**，API Gateway 的 authorizer 掛不上去
⇒ 唯一的閘在 handler 裡（`shared.VerifyTokenWithUserPwGate`）。
handler 的註解寫著修補前的形狀：「帶 `?userId=<任何人>` 就能代其兌換序號（A 級金流）」。
⇒ 那條回歸必須真的打一次，不能只讀原始碼。

🔴 每一格「應該被擋」都配一個「應該過得去」的對照，否則
   「閘有效」與「這個端點壞了／永遠 401」在讀數上逐字相同。
   最關鍵的是 G/H：同一個使用者、同一把金鑰，**只差 `iat`** ——
   少了 H，G 的 401 與「那個使用者怎樣都過不了」分不出來。

⚠️ 副作用：全部用**不存在的序號**，兌換路徑走不到寫入（401/404 都在寫之前）。
   不要改成真的序號。
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

REGION = "ap-southeast-1"
FN = "ryojaku-stg-redeem-code"
USERS_TABLE = "MahjongClubStg_Users"

def sh(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("指令失敗 %s: %s" % (args[:3], r.stderr[:300]))
    return r.stdout.strip()

def ssm(name):
    return sh(["aws", "ssm", "get-parameter", "--region", REGION, "--name", name,
               "--with-decryption", "--query", "Parameter.Value", "--output", "text"])

def b64(raw): return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

def sign(payload, secret):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    b = b64(json.dumps(payload, separators=(",", ":")).encode())
    mac = hmac.new(secret.encode(), f"{h}.{b}".encode(), hashlib.sha256).digest()
    return f"{h}.{b}.{b64(mac)}"

def user_token(uid, secret, iat):
    # 形狀比照 shared.GenerateToken：userId/email/sub/iat/exp
    return sign({"userId": uid, "email": "probe@example.invalid", "sub": uid,
                 "iat": iat, "exp": int(time.time()) + 600}, secret)

def post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

def main():
    url = sh(["aws", "lambda", "get-function-url-config", "--region", REGION,
              "--function-name", FN, "--query", "FunctionUrl", "--output", "text"])
    auth = sh(["aws", "lambda", "get-function-url-config", "--region", REGION,
               "--function-name", FN, "--query", "AuthType", "--output", "text"])
    print("Function URL AuthType = %s" % auth)
    if auth != "NONE":
        print("⚠️ AuthType 不是 NONE —— 本腳本的前提變了，先去讀設計冊再改期望值")
    secret = ssm("/ryojaku/stg/JWT_SECRET")
    admin_secret = ssm("/ryojaku/stg/ADMIN_JWT_SECRET")

    # 撈一個「有 pwChangedAt」與一個「沒有」的真實使用者 —— 正控需要 DB 裡真的有這個人
    items = json.loads(sh(["aws", "dynamodb", "scan", "--region", REGION,
                           "--table-name", USERS_TABLE, "--projection-expression",
                           "userId, pwChangedAt", "--output", "json"]))["Items"]
    with_pw = next((i for i in items if i.get("pwChangedAt", {}).get("N")), None)
    plain = next((i for i in items if not i.get("pwChangedAt", {}).get("N")), None)
    if not with_pw or not plain:
        print("⚠️ stg Users 缺少所需的兩種使用者（有/無 pwChangedAt），G/H 那對控制做不成")
        return 2
    uid_pw, cut = with_pw["userId"]["S"], int(with_pw["pwChangedAt"]["N"])
    uid_plain = plain["userId"]["S"]
    print("正控使用者 = %s（無 pwChangedAt）／撤銷對照 = %s（cut=%d）" % (uid_plain, uid_pw, cut))

    CODE = {"code": "PROBE-NOT-A-REAL-CODE-%d" % int(time.time())}   # 刻意不存在
    now = int(time.time())
    fail = 0
    # 🔴 格數**現算**，不寫死。第一版結尾寫死「九格全過」，加了 J 之後就變成假話
    #    （而過期的方向固定是「說得比實際少」）。計數器讓它不可能再過期。
    tally = {"n": 0, "blocked": 0, "allowed": 0}
    def cell(name, headers, want, body=CODE, q=""):
        nonlocal fail
        tally["n"] += 1
        tally["blocked" if want == 401 else "allowed"] += 1
        code, txt = post(url + q, headers, body)
        ok = code == want
        print(("  ✅ " if ok else "  🔴 ") + "%-46s → %s（期望 %s） %s" % (name, code, want, txt[:70]))
        if not ok: fail = 1
        return code

    tok_ok    = user_token(uid_plain, secret, now)
    tok_old   = user_token(uid_pw, secret, cut - 3600)    # iat 早於 pwChangedAt
    tok_new   = user_token(uid_pw, secret, cut + 3600)    # 同一人，只差 iat
    tok_admin = user_token(uid_plain, admin_secret, now)  # 用 admin 金鑰簽

    print("\n── 應該被擋 ──")
    cell("A 完全不帶 Authorization", {}, 401)
    cell("B Bearer 亂碼", {"Authorization": "Bearer not.a.jwt"}, 401)
    cell("C 有 token 但沒有 Bearer 前綴", {"Authorization": tok_ok}, 401)
    cell("D 🔴舊洞回歸：?userId=<真人> 且不帶 token", {}, 401, q="?userId=" + uid_plain)
    cell("E 用 admin 金鑰簽的 user token（D5 金鑰分離）", {"Authorization": "Bearer " + tok_admin}, 401)
    cell("F 撤銷：iat 早於 pwChangedAt", {"Authorization": "Bearer " + tok_old}, 401)

    print("\n── 對照組：應該過得了閘（拿到 404『序號不存在』就代表閘放行了）──")
    cell("G 正控：真實使用者 + 有效 token", {"Authorization": "Bearer " + tok_ok}, 404)
    cell("H F 的對照：同一人、只把 iat 改到 cut 之後", {"Authorization": "Bearer " + tok_new}, 404)
    cell("I header 大小寫容錯（小寫 authorization）", {"authorization": "Bearer " + tok_ok}, 404)
    cell("J 有效 token + ?userId=<別人> → 與不帶該參數同結果",
         {"Authorization": "Bearer " + tok_ok}, 404, q="?userId=" + uid_pw)

    print("\n── 副作用檢查 ──")
    print("  送出的序號全部是不存在的（%s…）⇒ 兌換寫入路徑走不到" % CODE["code"][:22])

    print("\n── 這支答不出來的 ──")
    print("  🔴 J 只證明「那個 query param 不改變**認證**結果」，")
    print("     **沒有**證明「兌換會記在 token 的那個人頭上」—— 要看到歸屬就得真的兌換成功，")
    print("     那有寫入副作用。結構上的理由在原始碼：整支 handler 對 query string 是")
    print("     零次引用（grep `QueryString` 0 命中）⇒ 它讀不到那個參數。")
    print("  🔴 本支量的是 stg。prod 的 Function URL AuthType 另外量，兩者不可互推。")

    print()
    # 🔴 兩邊都要印：只有「擋下」那半的話，一個永遠 401 的壞端點也會全綠；
    #    只有「放行」那半的話，一個完全沒有閘的端點也會全綠。
    summary = "%d 格（應擋 %d ／應放行 %d）" % (tally["n"], tally["blocked"], tally["allowed"])
    if tally["blocked"] == 0 or tally["allowed"] == 0:
        print("⚠️ 這一輪缺了其中一側的對照，讀數不可信：" + summary)
        return 2
    print(("✅ " + summary + " 全過") if fail == 0 else ("🔴 " + summary + " 有格子沒過"))
    return fail

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("⚠️ 探針自己壞了（rc=2，不可讀成通過）：%r" % e)
        sys.exit(2)
