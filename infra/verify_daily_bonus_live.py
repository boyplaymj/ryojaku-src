#!/usr/bin/env python3
# /daily-bonus 由 HTTP_V2 改判 REST_V1 之後的**線上**四格（正典 PATH_RECONCILE.md §「線上驗收」）
#
# 用法：python3 verify_daily_bonus_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# ── 這支為什麼存在 ────────────────────────────────────────────────
#
# 那四格 2026-09-10 是**手打 curl** 做的，結果只以表格形式寫在 PATH_RECONCILE.md 裡。
# 🔴 只寫在文件裡的驗收**永遠不會失敗** —— 跟同一份設計冊自己批評過的
#    「四發突變只活在 commit 訊息裡」是同一個形狀。這支把那四格變成可重跑的載體。
#
# ── 與原始四格的兩處差異，都是刻意的 ──────────────────────────────
#
# 1. **不用真的 stg 探針帳號 `APP_C1fARb3MMx0cp0j0`。**
#    原本那格會真的替一個真帳號領走一次每日獎勵，且**當天第二次就變 409** ⇒
#    那把尺一天只能用一次，而「今天已領」與「端點壞了」在重跑時分不開。
#    改成合成 userId ＋ 自簽 token ＋ 跑完刪掉並 read-back（同
#    verify_venue_privacy_live.py 的作法）⇒ 想跑幾次跑幾次，且不動真帳號的點數。
#
# 2. **多兩格（G1b／G1c），而它們撐著 G1。**
#    🔴 `200` 只證明「回了 200」，不證明「真的寫進去了」——
#    handler 若整段跳過 transaction 直接 successResponse，G1 照樣綠。
#      - G1b：回頭 GetItem `DailyClaims`，比對 points／consecutiveDays 與回應相符
#      - G1c：同一個身分**再打一次**必須 409（條件式寫入擋下來）
#    少了這兩格，「領到了」與「回了一個好看的 JSON」逐字相同。
#
# ── 為什麼這些反控不可省 ──────────────────────────────────────────
#
# 🔴 G3（壞掉的 token 要 401）撐著 G2（沒 token 要 401）：
#    少了 G3，G2 的 401 與「authorizer 根本沒掛、是別的東西回的」分不出來。
#    （這句是原始四格就寫下的，照抄，不是我新想的。）
# 🔴 G4（`GET /chat/rooms` 要 200）撐著 G2／G3 整組：
#    整支 API 掛掉時所有負控都會變綠。
# 🔴 G1 的 pointsEarned **不寫死 25**：改成自己去 `AdminConfigs` 讀
#    `Activity:DailyBonusBase` 再比。寫死的話，哪天後台把基礎點數改掉，
#    這格會紅，而它紅的理由與「端點壞了」逐字相同。
#
# ⚠️ 界線：本支驗的是「線上那份 Lambda 收得到身分、回得了 v1 形狀、寫得進三張表」。
#    連續天數 >7 的循環重置、交易失敗 ⇒ 409 那條路的**內部分支**不在這裡，
#    那些在 backend/mutation_daily_bonus.sh 的單元層。
#
# ⚠️ 寫入面積（跑完全部刪掉並 read-back 確認）：
#    Users 一列、DailyClaims 一列、PointTransactions 最多一列。
#    🔴 兩張表的 PK 名字**不一樣**（DailyClaims 是 `userID`、PointTransactions 是
#    `userId`）—— 抄錯一邊的話刪不掉而且不會報錯，殘留會靜靜留在 stg。
#    所以下面那兩個常數是從 `describe-table` 的 KeySchema 抄來的，不是從 Go struct。
#
# 🔴 影子帳本是 `go recordShadowLog(...)`（goroutine，在回應之後）⇒ Lambda 可能
#    在它跑完之前凍結。所以 PointTransactions 那筆**有沒有出現不當成斷言**，
#    只印出來當觀測值；清理則不管有沒有都掃一次。

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
CLAIMS = PREFIX + "DailyClaims"
TXNS = PREFIX + "PointTransactions"
CONFIGS = PREFIX + "AdminConfigs"
MARK = "DB4PROBE-DELETEME"

# 🔴 從 describe-table 的 KeySchema 抄來的，不是 Go struct（兩者大小寫不同）。
CLAIMS_PK, CLAIMS_SK = "userID", "claimDate"
TXNS_PK, TXNS_SK = "userId", "sortKey"

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


def data_of(raw):
    try:
        d = json.loads(raw)
    except Exception:
        return None
    return d.get("data") if isinstance(d, dict) else None


def config_int(key, default):
    """去 AdminConfigs 讀一個整數設定；讀不到就用 handler 自己的預設值。"""
    rc, out, _ = ddb("get-item", "--table-name", CONFIGS, "--key",
                     json.dumps({"info_key": {"S": key}}), "--consistent-read")
    if rc != 0 or not out.strip():
        return default, "讀不到（用 handler 預設）"
    try:
        v = json.loads(out)["Item"]["info_value"]["S"]
        return int(v), f"AdminConfigs {key}={v}"
    except Exception:
        return default, "格式不符（用 handler 預設）"


def main():
    tag = int(time.time())
    uid = f"{MARK}-{tag}"
    residue = []

    print("══ 前置 ══")
    override = os.environ.get("RYOJAKU_API_BASE", "").strip()
    if override:
        api = override.rstrip("/")
        print(f"  API：{api}（RYOJAKU_API_BASE 覆寫）")
    else:
        rc, out, err = sh(["aws", "cloudformation", "describe-stacks", "--stack-name", STACK,
                           "--region", REGION, "--query",
                           "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue",
                           "--output", "text"])
        api = out.strip()
        if rc != 0 or not api or api == "None":
            die(f"拿不到 RestApiUrl（stack={STACK}）：{err.strip()[:200]}")
        api = api.rstrip("/")
        print(f"  API：{api}（SAM 部署的 REST，即 /daily-bonus 改判後該落的那一份）")

    secret = ssm("/ryojaku/stg/JWT_SECRET")
    base_pts, src = config_int("Activity:DailyBonusBase", 10)
    print(f"  基礎點數：{base_pts}（{src}）")

    rc, _, err = ddb("put-item", "--table-name", USERS, "--item",
                     json.dumps({"userId": {"S": uid}, "displayName": {"S": MARK},
                                 "points": {"N": "0"}}))
    if rc != 0:
        die(f"建不出測試使用者 {uid}：{err.strip()[:200]}")
    print(f"  測試使用者：{uid}（points 起始 0）")

    exp = int(time.time()) + 3600
    good_tk = sign({"userId": uid, "email": "probe-db4@example.com", "exp": exp}, secret)
    bad_tk = good_tk[:-4] + ("AAAA" if not good_tk.endswith("AAAA") else "BBBB")

    try:
        print("\n══ G1 正控·合法 token POST /daily-bonus ══")
        code, raw, _ = req(api, "/daily-bonus", token=good_tk, method="POST", payload={})
        check("G1 狀態碼", code, 200)
        d = data_of(raw)
        if not isinstance(d, dict):
            fail_(f"G1 回應不是 {{success,data}} 形狀 —— v1 契約可能沒轉成功：{raw[:200]!r}")
            d = {}
        check("G1 consecutiveDays（全新身分 ⇒ 第 1 天）", d.get("consecutiveDays"), 1)
        check("G1 pointsEarned 等於線上設定的基礎點數", d.get("pointsEarned"), base_pts)
        check("G1 isStreakBonus（第 1 天不該有加碼）", d.get("isStreakBonus"), False)

        print("\n══ G1b 正控·回頭讀 DailyClaims（證明真的寫進去了，不只是回了 200）══")
        today = d.get("today")
        if not today:
            fail_("G1b 沒拿到 today ⇒ 無法定位那一列（本格未測到）")
        else:
            rc, out, _ = ddb("get-item", "--table-name", CLAIMS, "--key",
                             json.dumps({CLAIMS_PK: {"S": uid}, CLAIMS_SK: {"S": today}}),
                             "--consistent-read")
            item = (json.loads(out).get("Item") if rc == 0 and out.strip() else None)
            if not item:
                fail_(f"G1b DailyClaims 讀不回來（{uid}/{today}）⇒ 200 是空的")
            else:
                residue.append(("claims", today))
                check("G1b 落地的 points 與回應相符", int(item["points"]["N"]), d.get("pointsEarned"))
                check("G1b 落地的 consecutiveDays 與回應相符",
                      int(item["consecutiveDays"]["N"]), d.get("consecutiveDays"))

        print("\n══ G1c 正控·同一身分再打一次必須 409（條件式寫入擋得住）══")
        code2, raw2, _ = req(api, "/daily-bonus", token=good_tk, method="POST", payload={})
        check("G1c 第二次的狀態碼", code2, 409)

        print("\n══ G2 反控 A·完全沒有 token ══")
        code, raw, et = req(api, "/daily-bonus", token=None, method="POST", payload={})
        check("G2 狀態碼", code, 401)
        if "Unauthorized" in et:
            pass_(f"G2 x-amzn-errortype={et!r} ⇒ 是 authorizer 擋的，不是 SigV4（那會是 403）")
        else:
            fail_(f"G2 x-amzn-errortype={et!r}，期望含 'Unauthorized'")

        print("\n══ G3 反控 B·壞掉的 token（撐著 G2）══")
        code, raw, et = req(api, "/daily-bonus", token=bad_tk, method="POST", payload={})
        check("G3 狀態碼", code, 401)

        print("\n══ G4 迴歸·GET /chat/rooms（撐著 G2／G3 整組）══")
        code, raw, _ = req(api, "/chat/rooms", token=good_tk)
        check("G4 狀態碼", code, 200)

        print("\n══ 觀測（不計入斷言）：影子帳本 ══")
        time.sleep(3)
        rc, out, _ = ddb("query", "--table-name", TXNS,
                         "--key-condition-expression", f"#p = :u",
                         "--expression-attribute-names", json.dumps({"#p": TXNS_PK}),
                         "--expression-attribute-values", json.dumps({":u": {"S": uid}}),
                         "--consistent-read")
        n = 0
        if rc == 0 and out.strip():
            items = json.loads(out).get("Items", [])
            n = len(items)
            for it in items:
                residue.append(("txn", it[TXNS_SK]["S"]))
        print(f"  ℹ️  PointTransactions 有 {n} 列。")
        print("     這是 `go recordShadowLog(...)` 的產物，在回應之後才跑 ⇒")
        print("     Lambda 可能先凍結。0 列**不算失敗**，但也不可讀成「它有在記」。")

    finally:
        print("\n══ 清理（每一筆都 read-back；有殘留 ⇒ rc=2）══")
        left = []
        for kind, key in residue:
            if kind == "claims":
                ddb("delete-item", "--table-name", CLAIMS, "--key",
                    json.dumps({CLAIMS_PK: {"S": uid}, CLAIMS_SK: {"S": key}}))
                rc, out, _ = ddb("get-item", "--table-name", CLAIMS, "--key",
                                 json.dumps({CLAIMS_PK: {"S": uid}, CLAIMS_SK: {"S": key}}),
                                 "--consistent-read")
                if rc != 0 or (out.strip() and json.loads(out).get("Item")):
                    left.append(f"{CLAIMS}/{key}")
            else:
                ddb("delete-item", "--table-name", TXNS, "--key",
                    json.dumps({TXNS_PK: {"S": uid}, TXNS_SK: {"S": key}}))
                rc, out, _ = ddb("get-item", "--table-name", TXNS, "--key",
                                 json.dumps({TXNS_PK: {"S": uid}, TXNS_SK: {"S": key}}),
                                 "--consistent-read")
                if rc != 0 or (out.strip() and json.loads(out).get("Item")):
                    left.append(f"{TXNS}/{key}")
        ddb("delete-item", "--table-name", USERS, "--key", json.dumps({"userId": {"S": uid}}))
        rc, out, _ = ddb("get-item", "--table-name", USERS, "--key",
                         json.dumps({"userId": {"S": uid}}), "--consistent-read")
        if rc != 0 or (out.strip() and json.loads(out).get("Item")):
            left.append(f"{USERS}/{uid}")
        if left:
            print("  🔴 有殘留刪不掉：" + "、".join(left))
            print(f"\n══ 結果 ══\n  {TOTAL - FAIL}/{TOTAL} 過，但清理沒歸零 ⇒ rc=2（本輪不可信）")
            sys.exit(2)
        print(f"  ✅ {len(residue) + 1} 筆全部刪掉且 read-back 確認不存在")

    print(f"\n══ 結果 ══\n  {TOTAL - FAIL}/{TOTAL} 過")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
