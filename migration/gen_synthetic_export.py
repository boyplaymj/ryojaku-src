#!/usr/bin/env python3
"""
產生「假的」DynamoDB Export to S3 結構,用來端到端彩排匯入/對帳管線
(在真資料到手前先把流程趟平)。

產出兩張表的 export,且刻意讓資料一致以驗證不變式:
  - Users:每人 points = 該人 PointTransactions 的 (CREDIT 加總 - DEBIT 加總)
  - PointTransactions:PK userId + SK sortKey(TIME#<ts>#<uuid>)

輸出結構(每表一個 export root):
  <out>/<TableName>/AWSDynamoDB/<exportId>/manifest-summary.json
  <out>/<TableName>/AWSDynamoDB/<exportId>/manifest-files.json
  <out>/<TableName>/AWSDynamoDB/<exportId>/data/0001.json.gz

用法: python3 gen_synthetic_export.py --out ./_synthetic --users 50 --seed 42
"""
import argparse, gzip, hashlib, json, os, random

def ddb_export_root(out, table, export_id):
    return os.path.join(out, table, "AWSDynamoDB", export_id)

def write_export(out, table, items, export_id):
    root = ddb_export_root(out, table, export_id)
    data_dir = os.path.join(root, "data")
    os.makedirs(data_dir, exist_ok=True)
    # 一個 data 檔(彩排足夠;真 export 會切多檔,匯入器已支援多檔)
    ndjson = "".join(json.dumps({"Item": it}, ensure_ascii=False) + "\n" for it in items)
    raw = ndjson.encode("utf-8")
    data_rel = f"{table}/AWSDynamoDB/{export_id}/data/0001.json.gz"
    with gzip.open(os.path.join(data_dir, "0001.json.gz"), "wb") as f:
        f.write(raw)
    md5 = hashlib.md5(raw).hexdigest()
    with open(os.path.join(root, "manifest-files.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"itemCount": len(items), "md5Checksum": md5,
                            "etag": md5, "dataFileS3Key": data_rel}) + "\n")
    with open(os.path.join(root, "manifest-summary.json"), "w", encoding="utf-8") as f:
        json.dump({"version": "2020-06-30", "exportFormat": "DYNAMODB_JSON",
                   "tableArn": f"arn:aws:dynamodb:ap-southeast-1:000000000000:table/{table}",
                   "itemCount": len(items), "outputVersion": 1,
                   "billedSizeBytes": len(raw)}, f)
    print(f"  wrote {table}: {len(items)} items → {root}")
    return root

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./_synthetic")
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    users, txns = [], []
    total_balance = 0
    for i in range(args.users):
        uid = f"APP_syn{i:05d}"
        n_tx = rng.randint(0, 8)
        bal = 0
        for j in range(n_tx):
            amt = rng.randint(10, 500)
            is_credit = rng.random() < 0.6
            typ = "CREDIT" if is_credit else "DEBIT"
            bal += amt if is_credit else -amt
            ts = 1700000000 + i * 1000 + j
            txns.append({
                "userId": {"S": uid},
                "sortKey": {"S": f"TIME#{ts}#{rng.randint(1000,9999)}"},
                "type": {"S": typ},
                "amount": {"N": str(amt)},
                "reason": {"S": "合成測試"},
                "source": {"S": "synthetic"},
            })
        total_balance += bal
        users.append({
            "userId": {"S": uid},
            "displayName": {"S": f"合成用戶{i}"},
            "email": {"S": f"syn{i}@example.com"},
            "accountType": {"S": "app"},
            "points": {"N": str(bal)},
            "rating": {"N": "5"},
            "isVerified": {"BOOL": False},
        })

    os.makedirs(args.out, exist_ok=True)
    print(f"[gen] users={len(users)} txns={len(txns)} sum(points)={total_balance}")
    write_export(args.out, "Users", users, "synUsers0001")
    write_export(args.out, "PointTransactions", txns, "synTxns0001")
    # 記一份期望值供對帳器交叉檢查
    with open(os.path.join(args.out, "_expected.json"), "w") as f:
        json.dump({"users": len(users), "txns": len(txns),
                   "sum_points": total_balance}, f)
    print(f"[gen] expected summary → {os.path.join(args.out, '_expected.json')}")

if __name__ == "__main__":
    main()
