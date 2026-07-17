#!/usr/bin/env python3
"""
清空指定 staging 表(真匯入前用,確保乾淨基準)。只清 MahjongClubStg_ 前綴以策安全。

用法: python3 clear_tables.py --prefix MahjongClubStg_ --tables Users,PointTransactions
      python3 clear_tables.py --prefix MahjongClubStg_ --all   # 清全部已部署的該前綴表
"""
import argparse, boto3

def clear(client, table):
    ks = [k["AttributeName"] for k in client.describe_table(TableName=table)["Table"]["KeySchema"]]
    n, ek = 0, None
    while True:
        kw = {"TableName": table, "ProjectionExpression": ",".join(f"#{i}" for i in range(len(ks))),
              "ExpressionAttributeNames": {f"#{i}": k for i, k in enumerate(ks)}}
        if ek:
            kw["ExclusiveStartKey"] = ek
        r = client.scan(**kw)
        batch = [{"DeleteRequest": {"Key": {k: it[k] for k in ks}}} for it in r["Items"]]
        for i in range(0, len(batch), 25):
            client.batch_write_item(RequestItems={table: batch[i:i+25]})
        n += len(batch)
        ek = r.get("LastEvaluatedKey")
        if not ek:
            return n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="ap-southeast-1")
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--tables", default="")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    assert args.prefix.endswith("_") and "Stg" in args.prefix, "安全鎖:只允許含 Stg 的 staging 前綴"
    client = boto3.client("dynamodb", region_name=args.region)
    if args.all:
        names = [t for t in client.list_tables()["TableNames"] if t.startswith(args.prefix)]
    else:
        names = [args.prefix + s.strip() for s in args.tables.split(",") if s.strip()]
    for t in names:
        print(f"  cleared {t}: {clear(client, t)}")

if __name__ == "__main__":
    main()
