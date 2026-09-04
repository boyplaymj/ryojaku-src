#!/usr/bin/env python3
# D5 驗收：家規台數表下發端點的線上迴歸網
#   GET /ruleset  (auth=user, RyojakuUserAuth)
# 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5a／§5c（A 案四條紀律）
#
# 用法：python3 verify_ruleset_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置失敗（**沒測到**，不可讀成通過）
#
# ── 為什麼是這些斷言 ──────────────────────────────────────────────
#
# 🔴 每個「應該被擋」都配一個「應該要通」。端點沒部署時 API Gateway 對所有人回
#    403／401，於是**所有負控都會變綠** —— R4（真 token 拿得到表）是整份的地基。
#
# 🔴 R10／R11 是「我到底打到了什麼」的反控。少了它們，一個對所有路徑都回同樣
#    東西的閘門會讓 R1～R3 全綠，而我會把它讀成「/ruleset 的權限設對了」。
#
# 🔴 **兩個 base 都要打**。App 實際用的是自訂網域（frontend 的
#    VITE_API_BASE_URL＝https://ryojaku-api.boyplaymj.com），而 SAM 部署的是
#    execute-api 那個。只驗後者的話，「自訂網域沒有把 /ruleset 對應過去」
#    會讓探針全綠而玩家拿到 403 —— 生產端執行時讀的是哪一份，就要量哪一份。
#
# 🔴 **不註冊帳號、不冒用真帳號。** 直接在 Users 表放一列合成 userId，
#    自簽 token，跑完刪掉並 read-back 確認。理由三個：
#      ① app-register 每 IP 每小時 10 次，姊妹探針已經在吃這個額度
#      ② 註冊會在 Users／AuthIdentities／AuthTokens 三張表留東西，清理面積大三倍
#      ③ 借用現成帳號等於冒用身分，而且那筆讀取會混進真使用者的行為資料
#    authorizer 走 shared.VerifyTokenWithUserPwGate：只要 Users 有那一列、
#    且沒有 pwChangedAt（本列刻意不寫），閘就會放行。
#
# ⚠️ 這支**只讀**下發端點，唯一的寫入是那一列測試用 Users（跑完刪）。
#    它不碰 AdminConfigs 的 VoiceTai:Ruleset（那一列只有 seed_ruleset.py 寫得）。

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
# SAM 部署出來的那一個
API_BASE = "https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg"
# App 實際會打的那一個（frontend/deploy-stg.sh 烘進 bundle 的 VITE_API_BASE_URL）
APP_BASE = "https://ryojaku-api.boyplaymj.com"
PREFIX = "MahjongClubStg_"
USERS = PREFIX + "Users"
CONFIGS = PREFIX + "AdminConfigs"
INFO_KEY = "VoiceTai:Ruleset"
# 出貨那一份（不是 repo 正典）—— 取樣點由問題決定：玩家手上的 bundle 是這一份。
SHIP_TABLE = os.environ.get(
    "SHIP_TABLE", "/opt/sml/ryojaku-src/frontend/engine/mahjong-tai/fan_table.json")

# 契約就是這五鍵（backend/cmd/lambdas/apis/mahjongclub_ruleset/main.go）
CONTRACT_KEYS = {"version", "fans", "combos", "ignores", "config"}
SCORING_KEYS = ("fans", "combos", "ignores", "config")

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


def check(desc, got, want, fp=False):
    if got == want:
        pass_(f"{desc}（{got!r}）" if not isinstance(got, str) or len(str(got)) < 60
              else f"{desc}")
    else:
        fail_(f"{desc}：得到 {got!r}，期望 {want!r}")
        # 🔴 只記狀態碼對「這是哪一種 403」零鑑別力，而三種的處置完全不同：
        #    Missing Authentication Token（路由沒佈上／stage 還在傳播）
        #    explicit deny（維護模式 kill switch）
        #    UnauthorizedException（authorizer 判定失敗）
        if fp and LAST_FP:
            print(f"      指紋：{LAST_FP}")


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


def req(base, path, token=None, method="GET"):
    """回 (status, raw_text)。**回原始文字**，parse 由呼叫端決定 ——
    R9 要比對 byte，先 parse 過就再也拿不回原文了。
    連不上一律回 (0, 錯誤字串)：絕不把「打不到」靜靜變成某個狀態碼。"""
    global LAST_FP
    r = urllib.request.Request(base + path, method=method)
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


def canon(obj) -> str:
    """決定式序列化。與 seed_ruleset.py 的 serialize() 同一組參數。"""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def main():
    tag = int(time.time())
    probe_uid = f"RULESETPROBE-DELETEME-{tag}"

    print("══ 前置 ══")
    secret = ssm("/ryojaku/stg/JWT_SECRET")

    # DDB 那一列（真值來源）
    rc, out, err = ddb("get-item", "--table-name", CONFIGS, "--key",
                       json.dumps({"info_key": {"S": INFO_KEY}}), "--output", "json")
    if rc != 0:
        die(f"讀不到 {CONFIGS}：{err.strip()[:200]}")
    item = json.loads(out).get("Item")
    if not item:
        die(f"{CONFIGS} 沒有 {INFO_KEY} 那一列 —— 還沒播種，本探針無事可驗")
    ddb_raw = item["info_value"]["S"]
    ddb_obj = json.loads(ddb_raw)
    # ⚠️ 印 **UTF-8 位元組數** 不是 len(str)。第一版寫 len(ddb_raw) 又標成 "bytes"，
    #    讀數 6452 與 seed_ruleset.py／check_ruleset_seeded.py 記的 9237 對不上 ——
    #    表裡一千多個中文字每個多兩個位元組。同一個量兩把尺，而版面上都叫 bytes。
    #    順便印 sha256：那是其他三支工具共同的錨，能直接對得起來的才叫讀數。
    print(f"  DDB 那一列：{len(ddb_raw.encode())} bytes（{len(ddb_raw)} 字元）"
          f"  sha256={hashlib.sha256(ddb_raw.encode()).hexdigest()[:16]}"
          f"  version={ddb_obj.get('version')}")

    # 出貨那一份
    try:
        with open(SHIP_TABLE, encoding="utf-8") as f:
            ship = json.load(f)
    except Exception as e:
        die(f"讀不到出貨那份台數表 {SHIP_TABLE}：{e}")
    ship_version = (ship.get("meta") or {}).get("version")
    print(f"  出貨那份：version={ship_version}")

    # 合成測試使用者（刻意不寫 pwChangedAt ⇒ pw 閘直接放行）
    rc, _, err = ddb("put-item", "--table-name", USERS, "--item",
                     json.dumps({"userId": {"S": probe_uid},
                                 "displayName": {"S": "RULESETPROBE-DELETEME"}}))
    if rc != 0:
        die(f"建不出測試使用者：{err.strip()[:200]}")
    print(f"  測試使用者 {probe_uid}")

    exp = int(time.time()) + 3600
    good = sign({"userId": probe_uid, "email": "probe@example.com", "exp": exp}, secret)
    bogus = sign({"userId": probe_uid, "email": "probe@example.com", "exp": exp},
                 "not-the-real-secret")
    ghost = sign({"userId": f"NO-SUCH-USER-{tag}", "email": "x@example.com", "exp": exp}, secret)

    try:
        print("\n══ 權限（每個負控都配一個正控）══")
        code, _ = req(API_BASE, "/ruleset")
        check("R1 不帶 token → 401（gateway RyojakuUserAuth 生效）", code, 401, fp=True)

        code, _ = req(API_BASE, "/ruleset", token=bogus)
        check("R2 錯金鑰簽的 token → 401", code, 401, fp=True)

        code, _ = req(API_BASE, "/ruleset", token=ghost)
        # 🔴 這條驗的是 pwGate 真的去查了 Users ——
        #    少了它，「簽名對就放行」與「簽名對且使用者存在才放行」讀數逐字相同。
        check("R3 簽名對但使用者不存在 → 401（pwGate 真的查了 Users）", code, 401, fp=True)

        code, raw = req(API_BASE, "/ruleset", token=good)
        check("R4【正控】真 token → 200（端點真的活著，否則上面三條全是假綠）", code, 200, fp=True)
        if code != 200:
            fail_("R5～R9 未測到（正控沒回 200）")
            body = None
        else:
            try:
                body = json.loads(raw)
            except Exception as e:
                fail_(f"R5～R9 未測到（回應不是 JSON：{e}）")
                body = None

        print("\n══ 我到底打到了什麼（反控）══")
        code, _ = req(API_BASE, "/ruleset-no-such-route", token=good)
        check("R10 沒佈的路徑 → 403（證明我不是在讀一個對所有路徑都通的東西）",
              code, 403, fp=True)
        code, _ = req(API_BASE, "/ruleset", token=good, method="POST")
        check("R11 POST /ruleset → 403（只佈了 GET）", code, 403, fp=True)

        print("\n══ 契約（下發的是不是那五鍵）══")
        if body is not None:
            keys = set(body.keys()) - {"success"}
            check("R5 五個契約鍵齊全", CONTRACT_KEYS - keys, set())
            # ⛔ meta／categories 不在契約裡。多送了不是「順便給」——
            #    App 端的混合表（計分來自遠端、分組借 bundle）就是為了它們不在而設計的，
            #    契約悄悄變寬會讓那段邏輯與現實脫節而完全沒有徵兆。
            check("R6 沒有多送 meta／categories", keys - CONTRACT_KEYS, set())
        else:
            fail_("R5／R6 未測到")

        print("\n══ 內容（線上下發的與 DDB、與出貨那份對不對得起來）══")
        if body is not None:
            check("R7a 回應 version == DDB 那一列的 version",
                  body.get("version"), ddb_obj.get("version"))
            check("R7b DDB 那一列的 version == 出貨那份的 meta.version",
                  ddb_obj.get("version"), ship_version)

            same = all(canon(body.get(k)) == canon(ddb_obj.get(k)) for k in SCORING_KEYS)
            check("R8 計分四鍵與 DDB 那一列語意相同（決定式序列化後比對）", same, True)
            if not same:
                for k in SCORING_KEYS:
                    if canon(body.get(k)) != canon(ddb_obj.get(k)):
                        print(f"      不同的是 {k}：http {len(canon(body.get(k)))} bytes "
                              f"vs ddb {len(canon(ddb_obj.get(k)))} bytes")

            # ⚠️ R8 是「語意相同」不是「逐 byte」——兩邊各自被序列化過一次。
            #    R9 才是逐 byte 那一維：lambda 用 json.RawMessage 承接，
            #    理論上四鍵是**原封**轉出去的 ⇒ DDB 那串裡的片段應該逐字出現在回應裡。
            #    它成立才能說「原封不動下發」；不成立就是有人重塑形了，
            #    而重塑形本身不一定錯，但**不可以再說是原封不動**。
            frag = '"fans":' + canon(ddb_obj.get("fans"))
            check("R9 DDB 那一段 fans 原文逐字出現在回應裡（原封不動下發）",
                  frag in raw, True)
            if frag not in raw:
                print(f"      片段開頭 {frag[:80]!r}")
                print(f"      回應開頭 {raw[:120]!r}")
        else:
            fail_("R7～R9 未測到")

        print("\n══ App 實際會打的那個 base ══")
        # 🔴 SAM 部署的是 execute-api，玩家的 bundle 打的是自訂網域。
        #    只驗前者的話，「自訂網域沒把 /ruleset 對應過去」會讓上面全綠而玩家 403。
        code, _ = req(APP_BASE, "/ruleset")
        check("R12 自訂網域不帶 token → 401（路由有對應過去）", code, 401, fp=True)
        code, raw2 = req(APP_BASE, "/ruleset", token=good)
        check("R13【正控】自訂網域帶真 token → 200", code, 200, fp=True)
        if code == 200 and body is not None:
            try:
                check("R14 兩個 base 拿到同一份（version 相同）",
                      json.loads(raw2).get("version"), body.get("version"))
            except Exception as e:
                fail_(f"R14 未測到（自訂網域回應不是 JSON：{e}）")
        else:
            fail_("R14 未測到（自訂網域正控沒回 200）")

    finally:
        # ── 清理：只刪本次這一列，read-back 確認 ──────────────────
        print("\n── 清理 ──")
        rc, _, err = ddb("delete-item", "--table-name", USERS, "--key",
                         json.dumps({"userId": {"S": probe_uid}}))
        if rc != 0:
            fail_(f"刪不掉測試使用者 {probe_uid}：{err.strip()[:160]}")
        else:
            rc2, out2, _ = ddb("get-item", "--table-name", USERS, "--key",
                               json.dumps({"userId": {"S": probe_uid}}),
                               "--consistent-read", "--output", "json")
            # 🔴 read-back 才算清掉。「delete 回 0」與「真的不在了」是兩件事，
            #    而殘留的測試帳號會累積成沒有人認得的孤兒列。
            if rc2 == 0 and not json.loads(out2 or "{}").get("Item"):
                pass_(f"測試使用者 {probe_uid} 已清（read-back 確認）")
            else:
                fail_(f"測試使用者 {probe_uid} 可能仍在 —— 請人工確認")

    print(f"\n══ 斷言：通過 {TOTAL - FAIL} / 共 {TOTAL}（失敗 {FAIL}）══")
    # ⚠️ TOTAL 是「跑到的斷言數」不是「應有的斷言數」——中途 exit 會讓它偏小。
    print("══ 全部通過 ══" if FAIL == 0 else f"══ 有 {FAIL} 項失敗 ══")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
