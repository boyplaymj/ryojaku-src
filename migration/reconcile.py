#!/usr/bin/env python3
"""
遷移後對帳:證明資料完整落地且不變式成立。

檢查:
  1. 逐表筆數(Scan Select=COUNT 分頁)vs 期望值
  2. 點數餘額不變式:sum(Users.points) == sum(PointTransactions: CREDIT - DEBIT)
  3. 抽樣深比對:從 export 隨機取 N 筆,GetItem 目標表,逐屬性相等

用法:
  python3 reconcile.py --region ap-southeast-1 --prefix MahjongClubStg_ \
    [--count Users,PointTransactions,Games] \
    [--check-points] \
    [--sample Users:./_synthetic/Users/AWSDynamoDB/synUsers0001:20] \
    [--expected ./_synthetic/_expected.json]
"""
import argparse, json, random, sys
import import_export as ie  # 重用 iter_items

def count_table(client, table):
    total, ek = 0, None
    while True:
        kw = {"TableName": table, "Select": "COUNT"}
        if ek:
            kw["ExclusiveStartKey"] = ek
        r = client.scan(**kw)
        total += r["Count"]
        ek = r.get("LastEvaluatedKey")
        if not ek:
            return total

def scan_all(client, table, attrs=None):
    ek = None
    while True:
        kw = {"TableName": table}
        if attrs:
            kw["ProjectionExpression"] = attrs
        if ek:
            kw["ExclusiveStartKey"] = ek
        r = client.scan(**kw)
        for it in r["Items"]:
            yield it
        ek = r.get("LastEvaluatedKey")
        if not ek:
            return

def key_of(item, keyschema):
    return {k["AttributeName"]: item[k["AttributeName"]] for k in keyschema}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="ap-southeast-1")
    ap.add_argument("--prefix", default="MahjongClubStg_")
    ap.add_argument("--count", default="")
    ap.add_argument("--check-points", action="store_true")
    ap.add_argument("--sample", action="append", default=[],
                    help="Table:exportRoot:N")
    ap.add_argument("--expected", default="")
    args = ap.parse_args()

    import boto3
    client = boto3.client("dynamodb", region_name=args.region)
    expected = json.load(open(args.expected)) if args.expected else {}
    fails = 0

    if args.count:
        print("== 逐表筆數 ==")
        for short in args.count.split(","):
            short = short.strip()
            t = args.prefix + short
            c = count_table(client, t)
            exp = expected.get(short.lower()) or expected.get({"Users": "users",
                  "PointTransactions": "txns"}.get(short, short.lower()))
            ok = (exp is None) or (c == exp)
            fails += 0 if ok else 1
            print(f"  {t}: {c}" + (f"  期望={exp}  {'✓' if ok else '✗ MISMATCH'}" if exp is not None else ""))

    if args.check_points:
        print("== 點數餘額不變式 ==")
        users_t = args.prefix + "Users"
        tx_t = args.prefix + "PointTransactions"
        sum_users = 0
        for it in scan_all(client, users_t, "points"):
            if "points" in it:
                sum_users += int(it["points"]["N"])
        sum_tx = 0
        for it in scan_all(client, tx_t):  # 全屬性 scan(type 是保留字,免 projection 麻煩)
            amt = int(it["amount"]["N"])
            sum_tx += amt if it["type"]["S"] == "CREDIT" else -amt
        ok = sum_users == sum_tx
        fails += 0 if ok else 1
        print(f"  sum(Users.points)={sum_users}  sum(txn CREDIT-DEBIT)={sum_tx}  {'✓ 一致' if ok else '✗ 不一致'}")
        if args.expected and "sum_points" in expected:
            e = expected["sum_points"]
            print(f"  期望 sum_points={e}  {'✓' if sum_users == e else '✗'}")
            fails += 0 if sum_users == e else 1

    for spec in args.sample:
        table_short, root, n = spec.rsplit(":", 2)
        n = int(n)
        t = args.prefix + table_short
        ks = client.describe_table(TableName=t)["Table"]["KeySchema"]
        allitems = list(ie.iter_items(root))
        pick = random.sample(allitems, min(n, len(allitems)))
        print(f"== 抽樣深比對 {t}:{len(pick)} 筆 (共 {len(allitems)}) ==")
        miss = 0
        for src in pick:
            got = client.get_item(TableName=t, Key=key_of(src, ks)).get("Item")
            if got != src:
                miss += 1
                if miss <= 3:
                    print(f"  ✗ 不符 key={key_of(src, ks)}")
        fails += 1 if miss else 0
        print(f"  {'✓ 全部相符' if miss == 0 else f'✗ {miss} 筆不符'}")

    print(f"\n{'✅ 對帳全通過' if fails == 0 else f'❌ {fails} 項未通過'}")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
