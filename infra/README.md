# 両雀 Ryōjaku — 基建 IaC (S1)

把工程師既有服務重建到**我們 AWS 帳號 380931373365 / ap-southeast-1**。分兩層獨立部署（資料層與計算層生命週期不同）。

## 檔案
- `01-tables.yaml` — DynamoDB 25 表（PAY_PER_REQUEST，keys 取自工程師 setup 腳本、GSI 名取自 Go 源碼）。可獨立 `aws cloudformation deploy`。
- `functions.manifest.json` — 61 Lambda 路由清單（name/apiType/method/path/auth/tables）。**正典**，改路由改這裡。
- `gen_app_template.py` — 讀 manifest → 產 `02-app.generated.yaml`（勿手改生成檔）。
- `02-app.generated.yaml` — SAM 計算層：61 function + REST API + HTTP API + WebSocket API。
- `Makefile` — SAM `BuildMethod: makefile` 的 61 個 `build-Fn*` 目標（Go→bootstrap arm64）。
- `samconfig.toml` — staging 部署參數。

## 部署順序（staging，空表，先不碰 prod）
```bash
# 0) 機密進 SSM（值取自 /opt/sml/ryojaku-secrets，絕不進 git）
aws ssm put-parameter --name /ryojaku/stg/ENCRYPTION_KEY   --type SecureString --value '<原值>'
aws ssm put-parameter --name /ryojaku/stg/JWT_SECRET       --type SecureString --value '<可新生成>'
aws ssm put-parameter --name /ryojaku/stg/VAPID_PUBLIC_KEY --type SecureString --value '<原值>'
aws ssm put-parameter --name /ryojaku/stg/VAPID_PRIVATE_KEY --type SecureString --value '<原值>'
aws ssm put-parameter --name /ryojaku/stg/VAPID_SUBSCRIBER --type SecureString --value '<原值>'

# 1) 資料層
aws cloudformation deploy --template-file 01-tables.yaml \
  --stack-name ryojaku-tables-stg --parameter-overrides TablePrefix=MahjongClubStg_

# 2) 計算層（會 sam build 61 顆 Go bootstrap）
python3 gen_app_template.py
sam build -t 02-app.generated.yaml
sam deploy --config-env stg -t 02-app.generated.yaml
```

## 💰 成本控管
遵 `../../repo/tools/COST_CONTROL.md`：DDB 全 PAY_PER_REQUEST；staging 空表近乎零成本（只在有請求時計費）。
⚠️ 兩套 AI（前端 Gemini / 後端 OpenAI）為外部付費 API，接手正式流量前需納入帳本＋月封頂。

## 待完成（S1→S2）
- [ ] `redeem-code`/`event-commands`/`redeem-points` 是 Lambda URL，manifest 已標；確認前端呼叫路徑。
- [ ] `chat-archiver` STREAM 需 01-tables 開 ChatMessages Stream 並填 ARN（README 已註）。
- [ ] path 帶 `?` 者為推斷，S2 影子測試時用真前端請求校正。
- [ ] 授權：admin 端點目前僅靠 Lambda 內部驗 JWT role；未加 API Gateway authorizer（與工程師現況一致）。
- [ ] 容器 vs zip：工程師原用 ECR image；此處改 zip(provided.al2023) 較簡，行為相同。
