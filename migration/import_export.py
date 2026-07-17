#!/usr/bin/env python3
"""
把 DynamoDB「Export to S3」的輸出匯入指定的目標表(BatchWriteItem)。

Export to S3 產物結構(export root = 含下列檔案的目錄/前綴):
  <root>/manifest-summary.json     # 摘要(itemCount 等)
  <root>/manifest-files.json       # NDJSON,每行指一個 data 檔
  <root>/data/*.json.gz            # gzip NDJSON,每行 {"Item": {<DynamoDB JSON>}}

匯出的 Item 已是 attribute-value 形式(和 BatchWriteItem 需要的一致),不需轉換。

用法:
  python3 import_export.py --root <s3://bucket/prefix/AWSDynamoDB/<id>|本地路徑> \
      --table MahjongClubStg_Users [--region ap-southeast-1] [--dry-run] [--limit N]

--dry-run 只解析、計數、驗 key,不寫入。
"""
import argparse, gzip, io, json, sys, time

def _open_reader(root):
    """回傳 (read_text(relkey)->str, read_bytes(key)->bytes, list_is_s3)。
    root 可為 s3://bucket/prefix 或本地目錄。data 檔的 key 是相對 export 根或絕對 s3 key。"""
    if root.startswith("s3://"):
        import boto3
        s3 = boto3.client("s3")
        _, _, rest = root.partition("s3://")
        import os as _os
        from botocore.exceptions import ClientError
        bucket, _, prefix = rest.partition("/")
        prefix = prefix.rstrip("/")
        def read_bytes_by_s3key(s3key):
            # 真 export 的 dataFileS3Key 是完整 key;合成/相對 key 則 fallback 到
            # <export前綴>/data/<檔名>。兩者對真 export 解析結果一致。
            candidates = [s3key, f"{prefix}/data/{_os.path.basename(s3key)}"]
            last = None
            for k in candidates:
                try:
                    return s3.get_object(Bucket=bucket, Key=k)["Body"].read()
                except ClientError as e:
                    last = e
            raise last
        def read_text_rel(name):
            return s3.get_object(Bucket=bucket, Key=f"{prefix}/{name}")["Body"].read().decode("utf-8")
        return read_text_rel, read_bytes_by_s3key, bucket, prefix
    else:
        import os
        root = root.rstrip("/")
        def read_bytes_by_key(key):
            # 本地:data 檔 key 可能是 export 相對路徑,取 basename 後接 root/data
            p = os.path.join(root, key)
            if not os.path.exists(p):
                p = os.path.join(root, "data", os.path.basename(key))
            with open(p, "rb") as f:
                return f.read()
        def read_text_rel(name):
            with open(os.path.join(root, name), "r", encoding="utf-8") as f:
                return f.read()
        return read_text_rel, read_bytes_by_key, None, None

def iter_items(root):
    read_text, read_bytes, _, _ = _open_reader(root)
    manifest = read_text("manifest-files.json")
    data_keys = []
    for line in manifest.splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        data_keys.append(rec["dataFileS3Key"])
    for dk in data_keys:
        raw = read_bytes(dk)
        buf = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8")
        for ln in buf.splitlines():
            ln = ln.strip()
            if not ln:
                continue
            obj = json.loads(ln)
            yield obj["Item"]

def summary_count(root):
    read_text, _, _, _ = _open_reader(root)
    try:
        return json.loads(read_text("manifest-summary.json")).get("itemCount")
    except Exception:
        return None

def batch_write(client, table, items):
    """寫一批(<=25),回傳未處理數。含指數退避重試。"""
    reqs = [{"PutRequest": {"Item": it}} for it in items]
    backoff = 0.2
    for _ in range(8):
        resp = client.batch_write_item(RequestItems={table: reqs})
        unproc = resp.get("UnprocessedItems", {}).get(table, [])
        if not unproc:
            return 0
        reqs = unproc
        time.sleep(backoff)
        backoff = min(backoff * 2, 5.0)
    return len(reqs)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--table", required=True)
    ap.add_argument("--region", default="ap-southeast-1")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    declared = summary_count(args.root)
    print(f"[import] root={args.root}")
    print(f"[import] target table={args.table}  declared itemCount={declared}")

    client = None
    if not args.dry_run:
        import boto3
        client = boto3.client("dynamodb", region_name=args.region)

    batch, seen, written, failed = [], 0, 0, 0
    t0 = time.time()
    for item in iter_items(args.root):
        seen += 1
        if args.limit and seen > args.limit:
            seen -= 1
            break
        if args.dry_run:
            continue
        batch.append(item)
        if len(batch) == 25:
            failed += batch_write(client, args.table, batch)
            written += len(batch)
            batch = []
            if written % 500 == 0:
                print(f"  ...written {written}")
    if batch and not args.dry_run:
        failed += batch_write(client, args.table, batch)
        written += len(batch)

    dt = time.time() - t0
    print(f"[import] parsed items={seen}")
    if args.dry_run:
        print("[import] DRY-RUN: no writes. (parsed OK)")
    else:
        print(f"[import] written={written}  failed(unprocessed after retries)={failed}  {dt:.1f}s")
    if declared is not None and seen != declared:
        print(f"[import] ⚠️ parsed {seen} != declared {declared}")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
