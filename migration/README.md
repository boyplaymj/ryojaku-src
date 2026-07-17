# 両雀 — S3 資料遷移工具 & Runbook（S3 階段）

把工程師的 DynamoDB「Export to S3」匯入我們 staging、並對帳驗證。**已用合成資料端到端彩排通過**（本地 + s3:// 兩種來源）。真資料一到即可照下方 runbook 一鍵跑。

## 工具
- `import_export.py` — 讀 Export to S3 產物（manifest + `*.json.gz`）→ BatchWriteItem 進目標表。支援 `--root` 為 `s3://…` 或本地路徑；含限流重試、`--dry-run`、`--limit`。匯出的 Item 已是 attribute-value 形式，直接寫入不需轉換。
- `reconcile.py` — 對帳：逐表筆數、**點數餘額不變式**（`sum(Users.points) == sum(PointTransactions: CREDIT−DEBIT)`）、抽樣深比對（export vs 表）。
- `clear_tables.py` — 真匯入前清空 staging 表（安全鎖：只允許含 `Stg` 的前綴）。
- `gen_synthetic_export.py` — 產合成 export 供彩排（Users+PointTransactions，資料相互一致）。

## Runbook（真資料到手後）
```bash
cd migration
REGION=ap-southeast-1 ; PFX=MahjongClubStg_

# 0) 工程師的匯出在他 S3；請他開唯讀給我們帳號 380931373365,或把檔案給我們。
#    每張表一個 export root: s3://<their-bucket>/<prefix>/AWSDynamoDB/<exportId>/

# 1) （可選）先清空 staging 表,確保乾淨基準
python3 clear_tables.py --prefix $PFX --all

# 2) 逐表匯入（表名對照見 infra/01-tables.yaml；export 的表名去掉 MahjongClub_ 前綴接上 Stg 前綴）
python3 import_export.py --root s3://<bucket>/<prefix>/AWSDynamoDB/<id-Users> --table ${PFX}Users
python3 import_export.py --root s3://<bucket>/<prefix>/AWSDynamoDB/<id-PointTransactions> --table ${PFX}PointTransactions
#   ...其餘 25 張表同理（可寫個迴圈對照 exportId ↔ 表名）

# 3) 對帳
python3 reconcile.py --region $REGION --prefix $PFX \
  --count Users,PointTransactions,Games,Registrations \
  --check-points \
  --sample "Users:s3://<bucket>/<prefix>/AWSDynamoDB/<id-Users>:50"
```

## 注意 / 決策點
- **超大表**：BatchWriteItem 會吃寫入量（PAY_PER_REQUEST 下=費用）。單表數百萬筆時，改用 DynamoDB 原生 **Import from S3**（`ImportTable`）更省：它「建表＋灌資料」一次到位、不計寫入費，但**只能建新表、且不建 GSI**（匯入後再 `UpdateTable` 補 GSI）。流程變成：刪空表 → ImportTable 建表灌資料 → 補回 GSI。`import_export.py` 適合中小表與增量；巨表評估走 ImportTable。
- **點數不變式**：`--check-points` 是最強的完整性證明。若真資料加總對不上，優先查是否有匯出時間點的 in-flight 交易（見增量同步）。
- **增量同步（S5 切換窗口）**：Export 是「時間點快照」。凍結窗口時再做**第二次 PITR export**（或用 DynamoDB Streams 收 delta），把快照後的新資料補上，再切 DNS。此工具鏈可重跑第二份 export 做疊加。

## 彩排紀錄（2026-07-17）
合成 50 users / 196 txns → 匯入 0 失敗 → 對帳筆數吻合、點數不變式 10182==10182==期望、抽樣深比對全相符。s3:// 與本地來源皆通過。
