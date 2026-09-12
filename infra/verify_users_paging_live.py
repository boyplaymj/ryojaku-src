#!/usr/bin/env python3
"""`admin-users` 的 LastEvaluatedKey 分頁分支 —— 線上驗收。

🔴 **兩個我先前寫錯、留著當訂正的宣稱**：
  ① 我說「要種到 scan 超過 1 MB」—— 錯。handler 設了 `Limit`，所以門檻是**筆數**。
  ② 我說「要種幾百筆」—— 錯。`limit := 20` 是**寫死的**（不吃 query param），
     所以只要總筆數 **> 20** 就會拿到 LastEvaluatedKey。現況 6 筆 ⇒ 種 15 筆就夠。
  ⇒ 兩次都是「我沒讀那段程式就估份量」，而估出來的份量**貴了一個數量級**，
     那會讓一件做得到的事看起來不值得做。

🔴 **`else` 那半結構上打不到**：表的 key schema 是 `userId` HASH、型別 `S`
   ⇒ DynamoDB 回的 `LastEvaluatedKey["userId"]` 永遠是 `AttributeValueMemberS`。
   本支**不宣稱**驗過它（同那 6 支 `validateToken` 的 `!ok`）。

⚠️ 副作用：對**共用的 stg `Users` 表**種 15 筆合成使用者（前綴 `probe-paging-`），
   跑完刪掉並讀回確認。⚠️ 那張表 `security_regression.sh` 也在用 —— 它的清理只認
   自己那次的 MARK/HOST/GID，不會碰我的；反之我只刪自己前綴的。
"""
import base64, hashlib, hmac, importlib.util, json, os, subprocess, sys, time
import urllib.error, urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("vg", os.path.join(_HERE, "verify_admin_role_gate.py"))
vg = importlib.util.module_from_spec(spec); spec.loader.exec_module(vg)

REGION, TABLE = "ap-southeast-1", "MahjongClubStg_Users"
PREFIX = "probe-paging-"
SEEDED = []


def ddb(op, payload):
    r = subprocess.run(["aws", "dynamodb", op, "--region", REGION, "--table-name", TABLE,
                        ("--item" if op == "put-item" else "--key"), "file:///dev/stdin"],
                       input=json.dumps(payload), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("aws %s 失敗: %s" % (op, r.stderr[:300]))


def count():
    out = subprocess.run(["aws", "dynamodb", "scan", "--region", REGION, "--table-name", TABLE,
                          "--select", "COUNT", "--query", "Count", "--output", "text"],
                         capture_output=True, text=True, check=True)
    return int(out.stdout.strip())


def residue():
    out = subprocess.run(["aws", "dynamodb", "scan", "--region", REGION, "--table-name", TABLE,
                          "--filter-expression", "begins_with(userId, :p)",
                          "--expression-attribute-values", '{":p":{"S":"%s"}}' % PREFIX,
                          "--select", "COUNT", "--query", "Count", "--output", "text"],
                         capture_output=True, text=True, check=True)
    return int(out.stdout.strip())


def hit(q=""):
    tok = vg.sign({"sub": "s2admin", "role": "super_admin",
                   "exp": int(time.time()) + 600}, vg.get_admin_secret())
    req = urllib.request.Request(vg.REST_BASE + "/admin/users" + q,
                                 headers={"Authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=40) as r:
        d = json.loads(r.read().decode())
    # 🔴 實測形狀：頂層 {data:[...], lastKey, meta, success}，而 user 物件的鍵是 `id`
    #    不是 `userId`。第一版我照慣例猜 `d["data"]["users"][*]["userId"]`，
    #    一跑就 AttributeError ⇒ **rc=2 正確地擋住了「探針壞掉卻宣稱通過」**。
    if not isinstance(d, dict) or "lastKey" not in d:
        raise RuntimeError("回應形狀不是預期的 {data,lastKey,...}：%r" % list(d)[:6])
    return d["lastKey"], [u.get("id") for u in (d.get("data") or [])]


def main():
    fail = 0
    tally = {"n": 0}

    def cell(name, got, want):
        nonlocal fail
        tally["n"] += 1
        ok = got == want
        print(("  ✅ " if ok else "  🔴 ") + "%-44s got=%s want=%s" % (name, got, want))
        if not ok: fail = 1

    n0 = count()
    print("開跑前 Users 筆數 = %d（handler 寫死 limit=20）" % n0)
    # 🔴 前提：現況必須 ≤ 20，否則「種之前沒有游標」這個基準本來就不成立。
    if n0 > 20:
        print("  ⚠️ rc=2 前提不成立：表裡已經超過 20 筆 ⇒ 『種之前不該有游標』這個基準不成立。")
        print("     先查是誰寫的（可能是別條線的測試殘留），再決定要不要跑。")
        return 2
    if residue() != 0:
        print("  ⚠️ rc=2 前提不成立：已經有 %s 前綴的殘留 ⇒ 上一輪沒清乾淨。" % PREFIX)
        return 2

    # A 基準：沒超過 20 ⇒ 不該有游標
    k0, page0 = hit()
    cell("A 種之前：lastKey 應為空（基準）", k0, "")

    need = 21 - n0
    print("種 %d 筆合成使用者讓總數超過 20 …" % need)
    ts = int(time.time())
    for i in range(need):
        uid = "%s%d-%02d" % (PREFIX, ts, i)
        SEEDED.append(uid)
        ddb("put-item", {"userId": {"S": uid}, "displayName": {"S": "paging-probe"},
                         "status": {"S": "active"}})
    time.sleep(2)

    # B 正控：超過 20 ⇒ 該分支被走到，游標非空
    k1, page1 = hit()
    cell("B 種之後：lastKey 非空（該分支被走到）", k1 != "", True)
    cell("B' 第一頁恰好 20 筆（limit 生效）", len(page1), 20)

    # C 那個游標是真的游標，不只是「一個非空字串」
    if k1:
        _, page2 = hit("?lastKey=" + urllib.request.quote(k1))
        overlap = set(page1) & set(page2)
        cell("C 第二頁與第一頁不重疊（證明它是游標不是任意字串）", len(overlap), 0)
        cell("C' 第二頁拿得到剩下的", len(page2) > 0, True)
    else:
        print("  ⚠️ B 沒拿到游標，C 跳過"); fail = 1
    return fail, tally


if __name__ == "__main__":
    rc = 2
    try:
        r = main()
        if r == 2:
            sys.exit(2)
        rc, tally = r
    except Exception as e:
        print("⚠️ 探針自己壞了（rc=2，不可讀成通過）：%r" % e); rc = 2
    finally:
        if SEEDED:
            print("清理 %d 筆 …" % len(SEEDED))
            for uid in SEEDED:
                try: ddb("delete-item", {"userId": {"S": uid}})
                except Exception as e: print("  ⚠️ 刪不掉 %s: %r" % (uid, e)); rc = 2
            time.sleep(2)
            left = residue()
            print(("  ✅ " if left == 0 else "  🔴 ") + "D 清理後殘留 = %d（期望 0）" % left)
            if left: rc = 1
            k2, _ = hit()
            print(("  ✅ " if k2 == "" else "  🔴 ") + "D' 清理後 lastKey 回到空 = %r" % k2)
            if k2 != "": rc = 1
    print()
    print("🔴 else 分支（LastEvaluatedKey 的 userId 非字串）**結構上打不到** —— "
          "表的 key schema 是 userId HASH/S。本支不宣稱驗過它。")
    print("✅ 全過" if rc == 0 else ("🔴 有格子沒過" if rc == 1 else "⚠️ 設備／前提問題，不可讀成通過"))
    sys.exit(rc)
