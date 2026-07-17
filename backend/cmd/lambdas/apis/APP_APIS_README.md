# Mahjong Club APP APIs

這些 API 是專為新的 APP 版本設計的，提供獨立的用戶註冊和登入功能。

## 架構說明

### 用戶類型
- **LINE Bot 用戶** (`accountType: "linebot"`): 透過 LINE Bot 註冊，使用加密的 LINE ID 作為主鍵
- **APP 用戶** (`accountType: "app"`): 透過 APP 註冊，使用 Email + Password 登入

### 資料共用
- 所有用戶共用相同的 `MahjongClub_Users` 表
- 團局相關的 API (search_games, my_games, register, etc.) 對兩種用戶類型都適用
- 用戶資料結構一致，只有登入方式不同

## API 端點

### 1. mahjongclub_app_register
**用途**: APP 用戶註冊

**請求方法**: POST

**請求 Body**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "使用者名稱",
  "gender": "male",  // optional: "male", "female", "other"
  "ageRange": "23-27",  // optional
  "mahjongExperience": "intermediate"  // optional: "beginner", "intermediate", "advanced", "expert"
}
```

**回應**:
```json
{
  "success": true,
  "data": {
    "userId": "APP_xxxxxxxxxxxx",
    "displayName": "使用者名稱",
    "email": "user@example.com",
    "accountType": "app",
    "points": 0,
    "rating": 5.0,
    "isVerified": false,
    "emailVerified": false,
    "createdAt": "2025-01-01T00:00:00Z"
  }
}
```

**驗證規則**:
- Email 必須是有效的 Email 格式
- 密碼長度至少 8 個字元，最多 128 個字元
- Email 不能重複註冊
- 密碼使用 bcrypt 加密儲存

### 2. mahjongclub_app_login
**用途**: APP 用戶登入

**請求方法**: POST

**登入方式 1: Email + Password**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**登入方式 2: 加密的 LINE ID (備援)**
```json
{
  "encryptedLineId": "encrypted_line_id_string"
}
```

**回應**:
```json
{
  "success": true,
  "user": {
    "userId": "APP_xxxxxxxxxxxx",
    "displayName": "使用者名稱",
    "email": "user@example.com",
    "accountType": "app",
    "gender": "male",
    "ageRange": "23-27",
    "mahjongExperience": "intermediate",
    "points": 100,
    "rating": 5.0,
    "isVerified": false,
    "emailVerified": false,
    "stats": {
      "gamesHosted": 5,
      "gamesJoined": 10,
      "totalRatings": 8,
      "positiveRatings": 7,
      "positiveRatingRate": 0.875
    },
    "preferences": {
      "notifyNewGames": true,
      "notifyGameUpdates": true
    },
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-02T00:00:00Z"
  }
}
```

## 資料庫結構

### MahjongClub_Users 表新增欄位
- `email` (String, GSI): APP 用戶的 Email
- `passwordHash` (String): bcrypt 加密的密碼
- `accountType` (String): "linebot" 或 "app"
- `encryptedLineId` (String): APP 用戶綁定 LINE 帳號時使用
- `emailVerified` (Boolean): Email 驗證狀態
- `lastLoginAt` (String): 最後登入時間

### 需要建立的 GSI (Global Secondary Index)
- **email-index**: 以 `email` 為 Partition Key，用於快速查詢 APP 用戶

## 部署

### 1. 更新 DynamoDB 表
需要在 `MahjongClub_Users` 表中建立 `email-index` GSI：
```bash
aws dynamodb update-table \
  --table-name MahjongClub_Users \
  --attribute-definitions AttributeName=email,AttributeType=S \
  --global-secondary-index-updates \
    "[{\"Create\":{\"IndexName\":\"email-index\",\"KeySchema\":[{\"AttributeName\":\"email\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"ALL\"},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]"
```

### 2. 部署 Lambda 函數
在 `lambda-config.json` 中將需要部署的 API 的 `IsDeployTarget` 設為 `true`：
```json
{
  "mahjongclub_app_register": {
    "IsDeployTarget": true
  },
  "mahjongclub_app_login": {
    "IsDeployTarget": true
  }
}
```

然後執行部署腳本：
```powershell
.\DeployTo.ps1
```

### 3. 設定 API Gateway
需要在 API Gateway 中建立新的路由：
- POST `/mahjongclub_app_register`
- POST `/mahjongclub_app_login`

## 安全性考量

1. **密碼安全**: 使用 bcrypt 加密，成本因子為 10
2. **CORS**: 已啟用 CORS 支援
3. **錯誤訊息**: 登入失敗時不透露具體原因（Email 或密碼錯誤）
4. **加密 KEY**: LINE ID 加密使用環境變數 `ENCRYPTION_KEY`

## 測試

### 註冊測試
```bash
curl -X POST https://your-api-gateway-url/mahjongclub_app_register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test1234",
    "displayName": "測試用戶"
  }'
```

### 登入測試
```bash
curl -X POST https://your-api-gateway-url/mahjongclub_app_login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test1234"
  }'
```

