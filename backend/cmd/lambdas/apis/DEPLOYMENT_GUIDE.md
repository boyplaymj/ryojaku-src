# APP APIs 部署指南

本指南說明如何部署新的 APP 版本 API（mahjongclub_app_register 和 mahjongclub_app_login）。

## 前置準備

### 1. 建立 DynamoDB GSI (Global Secondary Index)

新的 APP API 需要透過 Email 查詢用戶，因此需要在 `MahjongClub_Users` 表中建立 `email-index`。

#### 使用 AWS CLI 建立 GSI

```bash
aws dynamodb update-table \
  --table-name MahjongClub_Users \
  --attribute-definitions AttributeName=email,AttributeType=S \
  --global-secondary-index-updates \
    "[{\"Create\":{\"IndexName\":\"email-index\",\"KeySchema\":[{\"AttributeName\":\"email\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"ALL\"},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" \
  --region ap-southeast-1 \
  --profile default
```

#### 或使用 AWS Console

1. 登入 AWS Console
2. 前往 DynamoDB > Tables > MahjongClub_Users
3. 點擊 "Indexes" 標籤
4. 點擊 "Create index"
5. 設定：
   - Partition key: `email` (String)
   - Index name: `email-index`
   - Projected attributes: All
   - Read/Write capacity: 按需或預配置（建議 5/5）
6. 點擊 "Create index"

**注意**: GSI 建立需要幾分鐘時間，請等待狀態變為 "Active" 後再部署 Lambda。

### 2. 確認環境變數

確保 `environment-config.json` 中包含以下環境變數：

```json
{
  "common": {
    "TABLE_PREFIX": "MahjongClub_",
    "ENCRYPTION_KEY": "your-encryption-key-here"
  }
}
```

## 部署步驟

### 步驟 1: 更新 lambda-config.json

編輯 `LineBot/lambda-config.json`，將要部署的 API 的 `IsDeployTarget` 設為 `true`：

```json
{
  "functions": {
    "mahjongclub_app_register": {
      "IsDeployTarget": true
    },
    "mahjongclub_app_login": {
      "IsDeployTarget": true
    }
  }
}
```

**重要**: 確保其他不需要部署的函數的 `IsDeployTarget` 設為 `false`，以避免不必要的部署。

### 步驟 2: 執行部署腳本

在 `LineBot` 目錄下執行：

```powershell
# Windows PowerShell
.\DeployTo.ps1
```

或

```bash
# Linux/Mac
./DeployTo.sh
```

### 步驟 3: 設定 API Gateway

部署完成後，需要在 API Gateway 中建立新的路由。

#### 使用 AWS Console

1. 前往 API Gateway
2. 選擇您的 API (例如: mahjongclub-api)
3. 建立新的資源和方法：

**註冊 API**:
- Resource: `/mahjongclub_app_register`
- Method: `POST`
- Integration type: Lambda Function
- Lambda Function: `mahjongclub_app_register`
- Enable CORS: Yes

**登入 API**:
- Resource: `/mahjongclub_app_login`
- Method: `POST`
- Integration type: Lambda Function
- Lambda Function: `mahjongclub_app_login`
- Enable CORS: Yes

4. 部署 API 到 stage (例如: prod)

### 步驟 4: 測試 API

#### 測試註冊 API

```bash
curl -X POST https://your-api-gateway-url/mahjongclub_app_register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test1234",
    "displayName": "測試用戶"
  }'
```

預期回應：
```json
{
  "success": true,
  "data": {
    "userId": "APP_xxxxxxxxxxxx",
    "displayName": "測試用戶",
    "email": "test@example.com",
    "accountType": "app",
    "points": 0,
    "rating": 5.0
  }
}
```

#### 測試登入 API

```bash
curl -X POST https://your-api-gateway-url/mahjongclub_app_login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test1234"
  }'
```

預期回應：
```json
{
  "success": true,
  "user": {
    "userId": "APP_xxxxxxxxxxxx",
    "displayName": "測試用戶",
    "email": "test@example.com",
    "accountType": "app"
  }
}
```

## 更新前端配置

更新 `MahjongClub_App/.env` 檔案，確保 API Base URL 正確：

```env
VITE_API_BASE_URL=https://your-api-gateway-url
```

## 驗證部署

1. **檢查 Lambda 函數**: 在 AWS Console 中確認兩個 Lambda 函數已成功建立
2. **檢查 GSI**: 確認 `email-index` 狀態為 "Active"
3. **測試 API**: 使用上述 curl 命令測試註冊和登入功能
4. **檢查日誌**: 在 CloudWatch Logs 中查看 Lambda 執行日誌

## 常見問題

### Q: GSI 建立失敗
A: 確認表中沒有重複的 GSI 名稱，並且有足夠的權限建立 GSI。

### Q: Lambda 部署失敗
A: 檢查 `lambda-config.json` 配置是否正確，確認 AWS 憑證有效。

### Q: API Gateway 404 錯誤
A: 確認已在 API Gateway 中建立對應的路由，並且已部署到正確的 stage。

### Q: 登入時提示 "user not found"
A: 確認 GSI 已建立完成且狀態為 "Active"，並且用戶已成功註冊。

## 回滾步驟

如果需要回滾：

1. 在 `lambda-config.json` 中將 `IsDeployTarget` 設為 `false`
2. 在 API Gateway 中刪除對應的路由
3. 如果需要，可以刪除 Lambda 函數（但建議保留以便後續使用）

## 安全性檢查清單

- [ ] 確認 `ENCRYPTION_KEY` 已正確設定
- [ ] 確認 API Gateway 已啟用 CORS
- [ ] 確認 Lambda 函數有適當的 IAM 權限
- [ ] 確認密碼使用 bcrypt 加密
- [ ] 確認 Email 驗證邏輯正確
- [ ] 測試錯誤處理和邊界情況

