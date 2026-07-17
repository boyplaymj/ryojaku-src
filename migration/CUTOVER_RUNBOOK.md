# 両雀 — S5 正式切換 Runbook

把 **13,416 真實用戶 + 真實點數**的線上服務，從工程師帳號（`228304098112`）搬到我們帳號（`380931373365`）。
**三大原則：零資料遺失、最短停機、隨時可回滾。** old prod 全程不動，切壞了就把 DNS 切回去。

> 對應 `tools/ryojaku-webapp/MIGRATION_PLAN.md` 的 S5；工具在本目錄（`migration/`），已用合成資料彩排通過。

---

## 0. 啟動前置閘門（全部綠燈才開始 T0）

| # | 項目 | 來源 | 狀態 |
|---|------|------|------|
| a | 工程師資料匯出可取得（S3 唯讀 or 檔案） | 工程師 | ⛔ 待 |
| b | `ENCRYPTION_KEY` **原值**到手 → `/ryojaku/prod/ENCRYPTION_KEY` | 工程師 | ⛔ 待 |
| c | `JWT_SECRET` / `VAPID` 決策（見 §7 機密策略） | 我方決策 | ⛔ 待 |
| d | `jiomj.com` 網域移交完成（路線 A 轉註冊 / B 改 NS，我方已能控 DNS） | 工程師 | ⛔ 待 |
| e | LINE channel 移交（secret / access token / console admin） | 工程師 | ⛔ 待 |
| f | **LineBot 表命名衝突已解**（見 §附錄 A） | 我方 | ⛔ 待 |
| g | 停機窗口 + 用戶公告時間敲定 | 雙方 | ⛔ 待 |
| h | prod 環境已建好並空跑驗證（§1） | 我方 | ⛔ 待 |

---

## 1. 建置 prod 環境（我方帳號 — 可提前做，不影響任何線上）

我們的 IaC 已參數化（`TablePrefix` + `Stage`），prod = 同一套換參數：

```bash
cd infra ; REGION=ap-southeast-1

# 1a) prod 機密進 SSM（⚠️ ENCRYPTION_KEY 必須是工程師原值,不可新生成)
aws ssm put-parameter --region $REGION --name /ryojaku/prod/ENCRYPTION_KEY   --type SecureString --value '<工程師原值>'
aws ssm put-parameter --region $REGION --name /ryojaku/prod/JWT_SECRET        --type SecureString --value '<見§7:沿用或新生成>'
aws ssm put-parameter --region $REGION --name /ryojaku/prod/VAPID_PUBLIC_KEY  --type SecureString --value '<見§7>'
aws ssm put-parameter --region $REGION --name /ryojaku/prod/VAPID_PRIVATE_KEY --type SecureString --value '<見§7>'
aws ssm put-parameter --region $REGION --name /ryojaku/prod/VAPID_SUBSCRIBER  --type SecureString --value 'mailto:...'

# 1b) 資料層(prod 前綴)
aws cloudformation deploy --region $REGION --template-file 01-tables.yaml \
  --stack-name ryojaku-tables-prod --parameter-overrides TablePrefix=MahjongClub_
#   ⚠️ 先解 LineBot 撞名(§附錄A),否則此步會與 staging 衝突

# 1c) 計算層(prod):複製 deploy_app.sh → 讀 /ryojaku/prod/* + Stage=prod + TablePrefix=MahjongClub_
#     產生 samconfig [prod.deploy.parameters] stack_name=ryojaku-app-prod
#     ASSETS_BUCKET/COMMUNITY_BUCKET 自動變 ryojaku-prod-assets/community(記得建桶)

# 1d) 空環境 smoke test(尚未對外)
curl https://<prod-rest-id>.execute-api.$REGION.amazonaws.com/prod/vapid-key   # 應回 200 + prod VAPID 公鑰
```
✅ 出口：prod 61 Lambda + 27 表 + 3 API 全 ACTIVE、空環境 smoke 通過。**此時 old prod 照常服務、無人受影響。**

---

## 2. T-1 天：前置與初次批量遷移

- **降 DNS TTL**：把 `jiomj.com` 相關記錄 TTL 調到 **60s**（切換傳播快、回滾也快）。需已完成 §0-d。
- **初次批量遷移**（提前灌，縮短正式窗口）：請工程師先給一份**近期 PITR export**，灌進 prod 表：
  ```bash
  cd migration
  python3 clear_tables.py --prefix MahjongClub_ --all      # prod 前綴(安全鎖需放行 prod,見附錄C)
  python3 import_export.py --root s3://<their-bucket>/<prefix>/AWSDynamoDB/<id-表> --table MahjongClub_<表>  # 逐表
  python3 reconcile.py --prefix MahjongClub_ --count Users,PointTransactions,Games,Registrations --check-points
  ```
- **prod 全量 E2E**：用測試帳號在 prod 環境跑核心流程（登入/開團/報名/記帳/推播/LINE 綁定解密），確認**原值 ENCRYPTION_KEY 能正確解 encryptedLineId**。
- 此時 prod 有一份「稍舊」資料、仍未對外。

---

## 3. T0 切換窗口（公告維護中）

1. **公告維護開始**（用戶端顯示維護頁）。
2. **凍結 old prod 寫入**：工程師把舊 App 設唯讀 / 維護模式（或關掉舊寫入 API）。此刻起 prod 資料不再變動。
3. **最終 PITR export**：工程師對凍結時間點做**最終完整 export**（point-in-time，一致快照）。
4. **匯入最終資料**（策略 A，見附錄 B）：
   ```bash
   python3 clear_tables.py --prefix MahjongClub_ --all
   python3 import_export.py ...（全 27 表，用最終 export）
   python3 reconcile.py --prefix MahjongClub_ --count <全表> --check-points \
     --sample "Users:s3://.../Users/...:100"
   ```
5. **🚦 GO / NO-GO 閘門**：對帳必須**全綠**（筆數 == 匯出 itemCount、點數不變式一致、抽樣深比對相符）。
   - **NO-GO** → 立即**解凍 old prod**、放棄本次、擇期重來（**零損失**，用戶只經歷一次短維護）。

---

## 4. 切 DNS + LINE

- **DNS**：`jiomj.com`（及 `admin.jiomj.com` 等子網域）A/CNAME → 我方 CloudFront / API。低 TTL 已生效 → 數分鐘傳播。
- **LINE Messaging API**：webhook URL → 新後端端點。
- **LINE Login**：callback URL → 新網域。
- **ACM**：新網域憑證我方 DNS 驗證後掛上 CloudFront。

---

## 5. 上線驗證 + 監控

- **Smoke（真人）**：LINE 登入（驗證 encryptedLineId 解密）、積分/開團/報名/記帳/評分/推播、後台 admin 登入。
- **再對帳一次**（DNS 切換後、確認寫入落在新 prod）。
- **監控**：CloudWatch Lambda 錯誤率 / 延遲 / DynamoDB throttle，盯 **N 小時**（建議至少一個晚高峰）。

---

## 6. 回滾計畫

- **觸發條件**：核心流程失敗 / 錯誤率飆升 / 資料異常 / LINE 登入大量失敗。
- **動作**：① DNS 切回 old prod ② LINE webhook/callback 切回 ③ 工程師解凍 old prod。
- **成本**：因 old prod **全程未動** + 低 TTL → 回滾是**分鐘級**。切換後新 prod 產生的少量新資料需人工對帳補回 old（或接受該窗口重來）。

---

## 7. 機密策略（切換前決定）

| 機密 | 沿用工程師原值 | 換新值 |
|------|----------------|--------|
| `ENCRYPTION_KEY` | **必須沿用**（否則 LINE 綁定全壞） | 🚫 不可換 |
| `JWT_SECRET` | 所有人不被登出（平順） | 全用戶重新登入（要配合公告） |
| `VAPID` | 推播訂閱續用 | 訂閱失效、用戶要重新開通推播 |
| `Gemini` / `OpenAI` | 用工程師帳單 | 換我方帳單（見 COST_CONTROL 四件套） |

建議：切換當下**全部沿用原值**（最平順），日後低峰再排程輪換 `JWT_SECRET`（安全考量）。

---

## 8. 收尾

- old prod **保留 N 天觀察期**（可回滾）。確認無誤後請工程師停舊 stack。
- 兩套外部付費 AI（Gemini/OpenAI）接真流量前，補上 `COST_CONTROL.md` 的「帳本 + 月封頂 + 後台卡 + kill switch」四件套。
- 更新記憶 / 文件：prod 端點、回滾窗口截止日、已輪換機密。

---

## 附錄 A — 🔴 LineBot 表命名衝突（必解）
`LineBot-User-Profiles` / `LineBot-User-Profile-Sessions` 在程式碼裡是**寫死、無前綴**的名字。我們 staging stack 已建這兩張表 → **prod stack 在同帳號會撞名**（CloudFormation 無法在同帳號建兩張同名表）。
**三個解法擇一**：
1. **（推薦）把 LineBot 表名改成 env-driven**（`os.Getenv("LINEBOT_PROFILES_TABLE")`），stg/prod 各給不同名 → 徹底解耦。需改 `internal/services/user_profile.go` 幾處字面值 + template 加 env。
2. 把 LineBot 兩表**抽成獨立的共用 stack**（`ryojaku-linebot-shared`），stg/prod 都不在自己 stack 建、共用同一份。適合「stg/prod 共享 LINE profile」的情境。
3. prod 部署前先把 staging stack 的 LineBot 表移除（staging 不測 LINE）。最省事但 staging 就沒 LINE 表。

## 附錄 B — 資料遷移策略 A vs B
- **策略 A（簡單，推薦先用）**：凍結後**全量重 export + import + 對帳**。停機窗口 ≈ 匯出 + 匯入 + 對帳耗時。→ **前置動作：先用近期 export 量測全 27 表的匯入 + 對帳實際耗時**，據此抓窗口長度。13k 用戶規模通常數十分鐘內。
- **策略 B（近零停機，複雜）**：初次批量先灌好，凍結時只補 delta（DynamoDB Streams 收增量 / 二次 PITR export 比對）。複雜度高、要額外開發 delta 疊加邏輯。除非停機預算極緊，否則先用 A。

## 附錄 C — 工具安全鎖
`clear_tables.py` 目前只允許含 `Stg` 的前綴（防手滑清 prod）。prod 遷移時需**臨時放行 `MahjongClub_` 前綴**（改安全鎖或加 `--i-know-its-prod` 旗標），用完務必收回。

## 附錄 D — 表名對照
27 表：staging `MahjongClubStg_<X>` ↔ prod `MahjongClub_<X>`（X 見 `infra/01-tables.yaml`）+ `LineBot-User-Profiles`、`LineBot-User-Profile-Sessions`（見附錄 A）。

## 附錄 E — 成本
prod 27 表 PAY_PER_REQUEST + 61 Lambda + 3 API GW + WS + 2 S3 桶：閒置近乎零，按用量計。初次批量 import 會產生一次性寫入費（BatchWriteItem）；巨表評估改走 `ImportTable`（免寫入費，見 `migration/README.md`）。兩套外部 AI 為主要變動成本 → 四件套治理。
