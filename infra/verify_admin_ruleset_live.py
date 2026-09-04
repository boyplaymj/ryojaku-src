#!/usr/bin/env python3
# D5-e 驗收：後台唯讀端點的線上迴歸網
#   GET /admin/voice-tai/ruleset  (auth=admin, RyojakuAdminAuth)
# 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c「D5-e(E1)」
#
# 用法：python3 verify_admin_ruleset_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置失敗（**沒測到**，不可讀成通過）
#
# ── 為什麼是這些斷言 ──────────────────────────────────────────────
#
# 🔴 **正控先講**：這條路由沒部署時，API Gateway 對它與對任何不存在的路徑
#    回的是同一種 403 ⇒ **所有負控（A1／A2／A3）會一起變綠**。
#    A4（真 admin token → 200）是整份的地基；它紅掉時本腳本會印一整段
#    「以下負控本輪無鑑別力」，不讓 4 個 ✅ 讀起來像驗過了。
#
# 🔴 **A6 是「我到底打到了什麼」的反控。** 一個對所有路徑都回同樣東西的閘門
#    會讓 A1～A3 全綠。A6 打一條明擺著不存在的姊妹路徑，兩者的指紋要能分開。
#
# 🔴 **金鑰分離（A2）是這支端點存在的理由本身。** §5a 拍板玩家端與後台端不同金鑰；
#    用 user 金鑰簽一個 admin 形狀的 token 打進來，必須是 401。
#    這條綠了才能說「後台這條路不能被玩家端的金鑰打開」。
#
# 🔴 **A7 量不到 handler 的 405。** 模板只佈了 `Method: get`（02-app.generated.yaml），
#    POST 在 Gateway 就被擋掉、根本到不了 handler ⇒ 線上讀數是 403 不是 405。
#    handler 那個 405（紀律 1：唯一寫入入口是 seed_ruleset.py）只在 go test 量得到。
#    ⚠️ 這個區別要寫出來：把 A7 標成「405 已驗」會是假的。
#
# 🔴 **本探針零寫入。** admin token 用 ADMIN_JWT_SECRET 自簽，authorizer 不查 Users
#    ⇒ 不需要合成使用者（姊妹探針 verify_ruleset_live.py 要，是因為 user 那條路
#    走 pwGate 會查 Users）。DDB 只 get-item，一列都不動。
#
# ── 界線（不要把這份讀成比它更多）──────────────────────────────
#
# ⚠️ 它**不打 GET /ruleset** ⇒ 量不到「兩支端點是不是同一份表／同一版」。
#    那把尺是 verify_ruleset_live.py（R7/R9）。只部署一半時本支照樣全綠。
# ⚠️ 它**不比對 repo 正典**（那是 check_ruleset_seeded.py 的職責，D5-c2）——
#    真值來源取 DDB 直讀那一列，問的問題是「端點回的東西＝表裡那一列嗎」。
# ⚠️ 它**不開瀏覽器** ⇒ 對「後台頁面畫得出來嗎」零鑑別力。
# ⚠️ not-seeded／malformed／502 三種狀態**線上量不到**（要去動真表才做得出來），
#    它們的證據在 go test 那 26 條子測試。本支只驗 seeded 這一條路。
#
# ── 反控（證明它紅得起來）────────────────────────────────────────
#   EXPECT_SHA=deadbeef python3 verify_admin_ruleset_live.py   ⇒ A11 轉紅、rc=1
#   少了這一發，「全綠」與「這支沒有鑑別力」在讀數上逐字相同。

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
# 後台 console 實際打的那一個（admin_frontend/deploy.sh 烘進 bundle 的 VITE_API_BASE_URL）
API_BASE = "https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg"
PATH = "/admin/voice-tai/ruleset"
PREFIX = "MahjongClubStg_"
CONFIGS = PREFIX + "AdminConfigs"
INFO_KEY = "VoiceTai:Ruleset"

# 契約就是這九鍵（backend/cmd/lambdas/apis/mahjongclub_admin_ruleset/main.go 的 View）
CONTRACT_KEYS = {"success", "state", "table", "infoKey",
                 "version", "sha256", "bytes", "raw", "reason"}

TOTAL = 0
FAIL = 0
LAST_FP = ""
A4_OK = None  # 正控結果；None = 還沒跑到


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
    if got == want:
        pass_(desc if isinstance(got, str) and len(str(got)) >= 60 else f"{desc}（{got!r}）")
        return True
    fail_(f"{desc}：得到 {got!r}，期望 {want!r}")
    # 🔴 只記狀態碼對「這是哪一種 403」零鑑別力，而三種的處置完全不同：
    #    Missing Authentication Token（路由沒佈上／stage 還在傳播）
    #    explicit deny（維護模式 kill switch）
    #    UnauthorizedException（authorizer 判定失敗）
    if fp and LAST_FP:
        print(f"      指紋：{LAST_FP}")
    return False


def die(msg):
    """前置失敗 → rc=2。**不是** rc=1 —— 「沒測到」不可以跟「測了而失敗」同號。"""
    print(f"\n🔴 前置失敗（本輪什麼都沒驗到）：{msg}")
    sys.exit(2)


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


def ddb(*args):
    out = subprocess.run(["aws", "dynamodb", *args, "--region", REGION],
                         capture_output=True, text=True)
    return out.returncode, out.stdout, out.stderr


def req(path, token=None, method="GET"):
    """回 (status, raw_text)。**回原始文字**，parse 由呼叫端決定 ——
    A13 要比對 byte，先 parse 過就再也拿不回原文了。
    連不上一律回 (0, 錯誤字串)：絕不把「打不到」靜靜變成某個狀態碼。"""
    global LAST_FP
    r = urllib.request.Request(API_BASE + path, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw, code, hdrs = resp.read().decode(), resp.status, resp.headers
    except urllib.error.HTTPError as e:
        raw, code, hdrs = e.read().decode(), e.code, e.headers
    except Exception as e:
        LAST_FP = f"connection error: {e}"
        return 0, f"connection error: {e}"
    LAST_FP = (f"x-amzn-errortype={hdrs.get('x-amzn-errortype', '(無)')} "
               f"body={raw[:120]!r}")
    return code, raw


def main():
    global A4_OK
    tag = int(time.time())

    print("══ 前置：金鑰、DDB 真值來源 ══")
    admin_secret = ssm("/ryojaku/stg/ADMIN_JWT_SECRET")
    user_secret = ssm("/ryojaku/stg/JWT_SECRET")
    if admin_secret == user_secret:
        die("JWT_SECRET 與 ADMIN_JWT_SECRET 相同 —— §5a 的金鑰分離未成立，A2 會失去意義")

    rc, out, err = ddb("get-item", "--table-name", CONFIGS, "--key",
                       json.dumps({"info_key": {"S": INFO_KEY}}), "--output", "json")
    if rc != 0:
        die(f"讀不到 {CONFIGS}：{err.strip()[:200]}")
    item = json.loads(out).get("Item")
    if not item:
        die(f"{CONFIGS} 沒有 {INFO_KEY} 那一列 —— 還沒播種。"
            "本支只驗 seeded 那一條路，無事可驗（not-seeded 的證據在 go test）")
    ddb_raw = item["info_value"]["S"]
    ddb_bytes = len(ddb_raw.encode())
    ddb_sha = hashlib.sha256(ddb_raw.encode()).hexdigest()
    # 🔴 版本住在**頂層** `version`，不是 `meta.version`。下發那份是 seed_ruleset.py
    #    序列化出來的五鍵（version/fans/combos/ignores/config），repo 正典那份才有
    #    meta 這一層。第一版寫 meta.version ⇒ 真值來源印出 None，而 A14 會拿 None
    #    去比對，部署後轉紅時看起來像「lambda 的 version 欄壞了」。**跑過才發現**。
    ddb_version = json.loads(ddb_raw).get("version")
    # ⚠️ 印 UTF-8 位元組數 **與** 字元數，兩個都標清楚 —— 同一個量兩把尺而版面上
    #    都叫 bytes 的話，9237 與 6452 會被讀成矛盾（姊妹探針踩過）。
    print(f"  DDB 那一列：{ddb_bytes} bytes（{len(ddb_raw)} 字元）"
          f"  sha256={ddb_sha[:16]}  version={ddb_version}")

    expect_sha = os.environ.get("EXPECT_SHA")
    if expect_sha:
        print(f"  ⚠️ EXPECT_SHA 覆寫真值來源（反控模式）：{expect_sha}")
    else:
        expect_sha = ddb_sha

    exp = int(time.time()) + 3600
    tok_super = sign({"sub": f"ADMINRULESETPROBE-{tag}", "role": "super_admin", "exp": exp}, admin_secret)
    tok_admin = sign({"sub": f"ADMINRULESETPROBE-{tag}", "role": "admin", "exp": exp}, admin_secret)
    tok_mod = sign({"sub": f"ADMINRULESETPROBE-{tag}", "role": "moderator", "exp": exp}, admin_secret)
    tok_crosskey = sign({"sub": f"ADMINRULESETPROBE-{tag}", "role": "super_admin", "exp": exp}, user_secret)

    print("\n══ A. 權限 ══")
    code, _ = req(PATH)
    check("A1 不帶 token → 401（gateway RyojakuAdminAuth 生效）", code, 401, fp=True)

    code, _ = req(PATH, token=tok_crosskey)
    check("A2 user 金鑰簽的 admin 形狀 token → 401（§5a 金鑰分離）", code, 401, fp=True)

    code, _ = req(PATH, token=tok_mod)
    check("A3 role=moderator → 403（handler 的 adminrole.Allows 守衛）", code, 403, fp=True)

    code, body_super = req(PATH, token=tok_super)
    A4_OK = check("A4【正控】role=super_admin → 200（端點真的活著，"
                  "否則以上負控全是假綠）", code, 200, fp=True)

    code, _ = req(PATH, token=tok_admin)
    check("A5 role=admin 也放行 → 200（Allows(Admin, SuperAdmin) 兩個都收）", code, 200, fp=True)

    print("\n══ B. 我到底打到了什麼（反控）══")
    code, _ = req(PATH + "-no-such-route", token=tok_super)
    check("A6 明擺著不存在的姊妹路徑 → 403（403 不是對所有路徑的常數回應）", code, 403, fp=True)

    code, _ = req(PATH, token=tok_super, method="POST")
    # ⚠️ 這裡量到的是 Gateway 的 403，**不是** handler 那個 405。見檔頭。
    check("A7 POST 同一路徑 → 403（模板只佈 GET；⚠️ handler 的 405 線上到不了）",
          code, 403, fp=True)

    if not A4_OK:
        print("\n" + "═" * 66)
        print("🔴 正控 A4 沒過 ⇒ **本輪 A1／A2／A3／A6／A7 全部無鑑別力**。")
        print("   端點沒部署時 Gateway 對它與對任何不存在的路徑回同一種 403／401，")
        print("   那些 ✅ 只是「這條路由不在」的另一種寫法，不是「權限設對了」。")
        print("   ⇒ 先部署（infra/deploy_app.sh），再回來看這份讀數。")
        print("═" * 66)
        print(f"\n結果：{TOTAL - FAIL}/{TOTAL} 通過（正控紅 ⇒ 契約組整組跳過）")
        sys.exit(1)

    print("\n══ C. 契約（九鍵，一個不多一個不少）══")
    try:
        view = json.loads(body_super)
    except Exception as e:
        die(f"A4 回的不是 JSON：{e}；前 200 字={body_super[:200]!r}")
    got_keys = set(view.keys())
    check("A8 回應鍵集合＝契約九鍵", sorted(got_keys), sorted(CONTRACT_KEYS))
    check("A9 success", view.get("success"), True)
    check("A10 state", view.get("state"), "seeded")
    check("A11 sha256＝DDB 那一列的 sha256", view.get("sha256"), expect_sha)
    check("A12 bytes＝UTF-8 位元組數（Go 的 len() 是位元組，不是字元）",
          view.get("bytes"), ddb_bytes)
    # 🔴 A13 是唯一驗「原封不動」的那一條。A11 比的是摘要、A12 比的是長度，
    #    兩者都成立而內容不同在數學上可能（碰撞）雖不現實 —— 但更實際的是：
    #    lambda 若把 raw 重新序列化過一次，A11/A12 會**一起**變，而這條會直接指出來。
    check("A13 raw 逐字＝DDB 那一列原文（原封不動下發）",
          view.get("raw") == ddb_raw, True)
    check("A14 version＝DDB 那一列的頂層 version", view.get("version"), ddb_version)
    check("A15 seeded 時 reason 為空（有理由代表判定走到別的分支）",
          view.get("reason"), "")

    print("\n══ D. 頁面拿去推環境的那兩個欄位 ══")
    # 🔴 這一頁刻意用「端點回報的表名」推環境，不用 build 常數：打錯環境的那一刻，
    #    build 常數會顯示成正確的（設計冊 §5c E2 ②）。⇒ 這兩欄是頁面的地基。
    check("A16 table＝stg 那張表", view.get("table"), CONFIGS)
    check("A17 infoKey", view.get("infoKey"), INFO_KEY)

    print(f"\n結果：{TOTAL - FAIL}/{TOTAL} 通過")
    if FAIL:
        sys.exit(1)
    print("✅ 全過")


if __name__ == "__main__":
    main()
