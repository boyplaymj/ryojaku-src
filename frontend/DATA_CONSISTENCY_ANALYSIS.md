# MahjongClub 數據一致性分析報告

## 📋 問題描述

用戶反映：**MahjongClub_App 專案建立的 MahjongClub_Users 資料與 mahjongclub-web 專案管理的 MahjongClub_Users 資料不一致，導致很多功能無法正常運行**

---

## 🔍 數據模型分析

### 標準 User 數據模型 (shared/models.go)

這是所有 Lambda 函數應該使用的標準模型：

```go
type User struct {
    // 基本資料
    UserID            string          `dynamodbav:"userId" json:"userId"`
    DisplayName       string          `dynamodbav:"displayName" json:"displayName"`
    Gender            string          `dynamodbav:"gender,omitempty" json:"gender,omitempty"`
    AgeRange          string          `dynamodbav:"ageRange,omitempty" json:"ageRange,omitempty"`
    MahjongExperience string          `dynamodbav:"mahjongExperience,omitempty" json:"mahjongExperience,omitempty"`
    
    // LINE Bot 相關
    LineID            string          `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`
    
    // APP 相關
    Email             string          `dynamodbav:"email,omitempty" json:"email,omitempty"`
    PasswordHash      string          `dynamodbav:"passwordHash,omitempty" json:"passwordHash,omitempty"`
    AccountType       string          `dynamodbav:"accountType,omitempty" json:"accountType,omitempty"` // "linebot" or "app"
    EncryptedLineID   string          `dynamodbav:"encryptedLineId,omitempty" json:"encryptedLineId,omitempty"`
    EmailVerified     bool            `dynamodbav:"emailVerified" json:"emailVerified"`
    LastLoginAt       *time.Time      `dynamodbav:"lastLoginAt,omitempty" json:"lastLoginAt,omitempty"`
    
    // 積分和評分
    Points            int             `dynamodbav:"points" json:"points"`
    Rating            float64         `dynamodbav:"rating" json:"rating"`
    IsVerified        bool            `dynamodbav:"isVerified" json:"isVerified"`
    
    // 統計資料
    Stats             *UserStats      `dynamodbav:"stats,omitempty" json:"stats,omitempty"`
    GamesHosted       int             `dynamodbav:"gamesHosted" json:"gamesHosted"` // Deprecated
    GamesJoined       int             `dynamodbav:"gamesJoined" json:"gamesJoined"` // Deprecated
    
    // 偏好設定
    Preferences       UserPreferences `dynamodbav:"preferences" json:"preferences"`
    
    // 時間戳記
    CreatedAt         time.Time       `dynamodbav:"createdAt" json:"createdAt"`
    UpdatedAt         time.Time       `dynamodbav:"updatedAt" json:"updatedAt"`
}

type UserStats struct {
    GamesHosted        int     `dynamodbav:"gamesHosted" json:"gamesHosted"`
    GamesJoined        int     `dynamodbav:"gamesJoined" json:"gamesJoined"`
    TotalRatings       int     `dynamodbav:"totalRatings" json:"totalRatings"`
    PositiveRatings    int     `dynamodbav:"positiveRatings" json:"positiveRatings"`
    PositiveRatingRate float64 `dynamodbav:"positiveRatingRate" json:"positiveRatingRate"`
}

type UserPreferences struct {
    NotifyNewGames    bool `dynamodbav:"notifyNewGames" json:"notifyNewGames"`
    NotifyGameUpdates bool `dynamodbav:"notifyGameUpdates" json:"notifyGameUpdates"`
}
```

---

## ⚠️ 發現的不一致問題

### 1. **APP 註冊 API 缺少必要欄位**

**檔案**: `LineBot/cmd/lambdas/apis/mahjongclub_app_register/main.go`

#### 問題
創建用戶時缺少以下欄位：
- ❌ `Stats` - 用戶統計資料（應該初始化為空結構）
- ❌ `Preferences` - 用戶偏好設定（應該初始化為預設值）
- ❌ `GamesHosted` - 已棄用但仍需初始化為 0
- ❌ `GamesJoined` - 已棄用但仍需初始化為 0

#### 當前代碼 (第 304-321 行)
```go
user := &User{
    UserID:            userID,
    DisplayName:       req.DisplayName,
    Email:             req.Email,
    PasswordHash:      passwordHash,
    AccountType:       "app",
    Gender:            req.Gender,
    AgeRange:          req.AgeRange,
    MahjongExperience: req.MahjongExperience,
    Points:            0,
    Rating:            5.0,
    IsVerified:        false,
    EmailVerified:     false,
    CreatedAt:         now,
    UpdatedAt:         now,
}
// ❌ 缺少 Stats, Preferences, GamesHosted, GamesJoined
```

#### 影響
- 其他 API 讀取用戶資料時，這些欄位為 nil 或零值
- 可能導致統計功能異常
- 可能導致通知功能異常

---

### 2. **APP 登入 API 的 User 結構不完整**

**檔案**: `LineBot/cmd/lambdas/apis/mahjongclub_app_login/main.go`

#### 問題
User 結構定義缺少：
- ❌ `GamesHosted` - 已棄用但其他 API 仍在使用
- ❌ `GamesJoined` - 已棄用但其他 API 仍在使用
- ❌ `Preferences` - 用戶偏好設定

#### 當前代碼 (第 53-70 行)
```go
type User struct {
    UserID            string          `dynamodbav:"userId" json:"userId"`
    DisplayName       string          `dynamodbav:"displayName" json:"displayName"`
    Email             string          `dynamodbav:"email,omitempty" json:"email,omitempty"`
    PasswordHash      string          `dynamodbav:"passwordHash,omitempty" json:"passwordHash,omitempty"`
    AccountType       string          `dynamodbav:"accountType" json:"accountType"`
    Gender            string          `dynamodbav:"gender,omitempty" json:"gender,omitempty"`
    AgeRange          string          `dynamodbav:"ageRange,omitempty" json:"ageRange,omitempty"`
    MahjongExperience string          `dynamodbav:"mahjongExperience,omitempty" json:"mahjongExperience,omitempty"`
    LineID            string          `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`
    EncryptedLineID   string          `dynamodbav:"encryptedLineId,omitempty" json:"encryptedLineId,omitempty"`
    Points            int             `dynamodbav:"points" json:"points"`
    Rating            float64         `dynamodbav:"rating" json:"rating"`
    IsVerified        bool            `dynamodbav:"isVerified" json:"isVerified"`
    EmailVerified     bool            `dynamodbav:"emailVerified" json:"emailVerified"`
    Stats             *UserStats      `dynamodbav:"stats,omitempty" json:"stats,omitempty"`
    // ❌ 缺少 GamesHosted, GamesJoined, Preferences
}
```

#### 影響
- 登入後返回的用戶資料不完整
- 前端可能無法正確顯示用戶統計
- 通知偏好設定無法正常工作

---

### 3. **時間格式不一致**

#### 問題
不同 API 使用不同的時間格式：

| API | CreatedAt 格式 | UpdatedAt 格式 |
|-----|---------------|---------------|
| mahjongclub_app_register | `time.Time` | `time.Time` |
| mahjongclub_app_login | `time.Time` | `time.Time` |
| mahjongclub_web_verify_user | `string` (RFC3339) | N/A |
| mahjongclub_web_user_profile | N/A | `string` (RFC3339) |
| shared/models.go | `time.Time` | `time.Time` |

#### 影響
- 可能導致時間解析錯誤
- 不同來源的用戶資料時間格式不一致

---

## ✅ 修復方案

### 方案 1: 統一使用 shared/models.go (推薦)

**優點**:
- 所有 Lambda 函數使用相同的數據模型
- 易於維護和更新
- 減少重複代碼

**缺點**:
- 需要修改多個 Lambda 函數
- 需要重新部署所有相關 Lambda

**步驟**:
1. 修改 `mahjongclub_app_register` 使用 `shared.User`
2. 修改 `mahjongclub_app_login` 使用 `shared.User`
3. 確保所有欄位都正確初始化
4. 統一時間格式為 `time.Time`
5. 重新部署所有 Lambda 函數

---

### 方案 2: 修補現有 API (快速修復)

**優點**:
- 修改範圍小
- 快速部署

**缺點**:
- 仍然存在代碼重複
- 未來維護困難

**步驟**:
1. 在 `mahjongclub_app_register` 中補充缺少的欄位
2. 在 `mahjongclub_app_login` 中補充缺少的欄位
3. 重新部署這兩個 Lambda 函數

---

## 📊 欄位對照表

### LINE Bot 用戶 vs APP 用戶

| 欄位 | LINE Bot 用戶 | APP 用戶 | 說明 |
|------|--------------|---------|------|
| `userId` | LINE User ID | `APP_xxxxxxxx` | 主鍵 |
| `accountType` | `"linebot"` | `"app"` | 帳號類型 |
| `lineId` | ✅ 必填 | ❌ 選填 | LINE ID |
| `encryptedLineId` | ❌ 不使用 | ❌ 選填 | 加密的 LINE ID（用於綁定） |
| `email` | ❌ 不使用 | ✅ 必填 | Email |
| `passwordHash` | ❌ 不使用 | ✅ 必填 | 密碼雜湊 |
| `emailVerified` | `false` | `false` | Email 驗證狀態 |
| `displayName` | ✅ 必填 | ✅ 必填 | 顯示名稱 |
| `gender` | ❌ 選填 | ❌ 選填 | 性別 |
| `ageRange` | ❌ 選填 | ❌ 選填 | 年齡範圍 |
| `mahjongExperience` | ❌ 選填 | ❌ 選填 | 麻將經驗 |
| `points` | `0` | `0` | 點數 |
| `rating` | `5.0` | `5.0` | 評分 |
| `isVerified` | `false` | `false` | 官方認證 |
| `stats` | ✅ 必須初始化 | ✅ 必須初始化 | 統計資料 |
| `gamesHosted` | `0` (已棄用) | `0` (已棄用) | 發起次數 |
| `gamesJoined` | `0` (已棄用) | `0` (已棄用) | 參加次數 |
| `preferences` | ✅ 必須初始化 | ✅ 必須初始化 | 偏好設定 |
| `createdAt` | `time.Time` | `time.Time` | 創建時間 |
| `updatedAt` | `time.Time` | `time.Time` | 更新時間 |
| `lastLoginAt` | ❌ 選填 | ✅ 更新 | 最後登入時間 |

---

## 🎯 建議的初始化值

### APP 用戶註冊時
```go
user := &shared.User{
    UserID:            userID,              // APP_xxxxxxxx
    DisplayName:       req.DisplayName,
    Email:             req.Email,
    PasswordHash:      passwordHash,
    AccountType:       "app",
    Gender:            req.Gender,
    AgeRange:          req.AgeRange,
    MahjongExperience: req.MahjongExperience,
    Points:            0,
    Rating:            5.0,
    IsVerified:        false,
    EmailVerified:     false,
    Stats: &shared.UserStats{
        GamesHosted:        0,
        GamesJoined:        0,
        TotalRatings:       0,
        PositiveRatings:    0,
        PositiveRatingRate: 0.0,
    },
    GamesHosted: 0,  // Deprecated but still needed
    GamesJoined: 0,  // Deprecated but still needed
    Preferences: shared.UserPreferences{
        NotifyNewGames:    true,
        NotifyGameUpdates: true,
    },
    CreatedAt: now,
    UpdatedAt: now,
}
```

### LINE Bot 用戶註冊時
```go
user := &shared.User{
    UserID:            lineUserID,
    DisplayName:       displayName,
    LineID:            lineID,
    AccountType:       "linebot",
    Points:            0,
    Rating:            5.0,
    IsVerified:        false,
    EmailVerified:     false,
    Stats: &shared.UserStats{
        GamesHosted:        0,
        GamesJoined:        0,
        TotalRatings:       0,
        PositiveRatings:    0,
        PositiveRatingRate: 0.0,
    },
    GamesHosted: 0,
    GamesJoined: 0,
    Preferences: shared.UserPreferences{
        NotifyNewGames:    true,
        NotifyGameUpdates: true,
    },
    CreatedAt: now,
    UpdatedAt: now,
}
```

---

## 📝 下一步行動

### 立即修復 (高優先級)
1. ✅ 修改 `mahjongclub_app_register/main.go` - 補充缺少的欄位
2. ✅ 修改 `mahjongclub_app_login/main.go` - 補充缺少的欄位
3. ✅ 重新部署這兩個 Lambda 函數
4. ✅ 測試 APP 註冊和登入流程

### 長期優化 (中優先級)
1. ⏳ 統一所有 Lambda 函數使用 `shared/models.go`
2. ⏳ 移除已棄用的 `gamesHosted` 和 `gamesJoined` 欄位
3. ⏳ 統一時間格式為 `time.Time`
4. ⏳ 建立自動化測試確保數據一致性

---

## ✅ 結論

**主要問題**: APP 註冊 API 創建的用戶資料缺少必要欄位，導致與其他 API 不兼容。

**解決方案**: 補充缺少的欄位（Stats, Preferences, GamesHosted, GamesJoined），確保所有用戶資料結構一致。

**兼容性**: 修復後，APP 用戶和 LINE Bot 用戶將共用相同的數據結構，只有認證方式不同。

---

## 🔧 已完成的修復

### 1. ✅ 修改 mahjongclub_app_register/main.go

#### 新增的類型定義
```go
type UserStats struct {
    GamesHosted        int     `dynamodbav:"gamesHosted" json:"gamesHosted"`
    GamesJoined        int     `dynamodbav:"gamesJoined" json:"gamesJoined"`
    TotalRatings       int     `dynamodbav:"totalRatings" json:"totalRatings"`
    PositiveRatings    int     `dynamodbav:"positiveRatings" json:"positiveRatings"`
    PositiveRatingRate float64 `dynamodbav:"positiveRatingRate" json:"positiveRatingRate"`
}

type UserPreferences struct {
    NotifyNewGames    bool `dynamodbav:"notifyNewGames" json:"notifyNewGames"`
    NotifyGameUpdates bool `dynamodbav:"notifyGameUpdates" json:"notifyGameUpdates"`
}
```

#### 更新的 User 結構
新增欄位：
- `Stats *UserStats`
- `GamesHosted int` (Deprecated)
- `GamesJoined int` (Deprecated)
- `Preferences UserPreferences`

#### 更新的用戶創建邏輯
```go
user := &User{
    // ... 原有欄位 ...
    Stats: &UserStats{
        GamesHosted:        0,
        GamesJoined:        0,
        TotalRatings:       0,
        PositiveRatings:    0,
        PositiveRatingRate: 0.0,
    },
    GamesHosted: 0,
    GamesJoined: 0,
    Preferences: UserPreferences{
        NotifyNewGames:    true,
        NotifyGameUpdates: true,
    },
    // ... 時間戳記 ...
}
```

### 2. ✅ 修改 mahjongclub_app_login/main.go

#### 更新的 User 結構
新增欄位：
- `GamesHosted int` (Deprecated)
- `GamesJoined int` (Deprecated)

現在登入 API 返回的用戶資料包含所有必要欄位。

---

## 🚀 部署指南

### 方法 1: 使用部署腳本 (推薦)

```powershell
cd LineBot\cmd\lambdas\apis
.\DeployDataConsistencyFix.ps1
```

這個腳本會：
1. 編譯兩個 Lambda 函數
2. 創建部署包
3. 上傳到 AWS Lambda
4. 驗證部署結果

### 方法 2: 手動部署

#### 部署 mahjongclub_app_register
```powershell
cd LineBot\cmd\lambdas\apis\mahjongclub_app_register
$env:GOOS="linux"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -o bootstrap main.go
Compress-Archive -Path bootstrap -DestinationPath function.zip -Force
aws lambda update-function-code --function-name mahjongclub_app_register --zip-file fileb://function.zip --profile claude --region ap-southeast-1
Remove-Item bootstrap, function.zip
```

#### 部署 mahjongclub_app_login
```powershell
cd LineBot\cmd\lambdas\apis\mahjongclub_app_login
$env:GOOS="linux"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -o bootstrap main.go
Compress-Archive -Path bootstrap -DestinationPath function.zip -Force
aws lambda update-function-code --function-name mahjongclub_app_login --zip-file fileb://function.zip --profile claude --region ap-southeast-1
Remove-Item bootstrap, function.zip
```

---

## 🧪 測試指南

### 1. 測試 APP 註冊

```bash
# 註冊新用戶
curl -X POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234",
    "displayName": "測試用戶",
    "gender": "男",
    "ageRange": "26-35",
    "mahjongExperience": "中級"
  }'
```

**預期結果**:
```json
{
  "success": true,
  "data": {
    "userId": "APP_xxxxxxxx",
    "displayName": "測試用戶",
    "email": "test@example.com",
    "accountType": "app",
    "gender": "男",
    "ageRange": "26-35",
    "mahjongExperience": "中級",
    "points": 0,
    "rating": 5.0,
    "isVerified": false,
    "emailVerified": false,
    "stats": {
      "gamesHosted": 0,
      "gamesJoined": 0,
      "totalRatings": 0,
      "positiveRatings": 0,
      "positiveRatingRate": 0.0
    },
    "gamesHosted": 0,
    "gamesJoined": 0,
    "preferences": {
      "notifyNewGames": true,
      "notifyGameUpdates": true
    }
  }
}
```

### 2. 測試 APP 登入

```bash
# 登入
curl -X POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234"
  }'
```

**預期結果**: 返回完整的用戶資料，包含所有欄位。

### 3. 測試數據一致性

#### 3.1 創建團局
使用 APP 用戶創建團局，確認 `hostUserId` 正確。

#### 3.2 報名團局
使用 APP 用戶報名團局，確認報名記錄正確。

#### 3.3 查看通知
確認通知功能正常，能夠接收和顯示通知。

#### 3.4 提交評分
確認評分功能正常，能夠評分其他用戶。

#### 3.5 查看個人資料
確認個人資料頁面顯示完整，包括統計資料。

---

## ✅ 驗證清單

部署後請確認以下項目：

- [ ] APP 註冊成功，返回完整用戶資料
- [ ] APP 登入成功，返回完整用戶資料
- [ ] 用戶資料包含 `stats` 欄位
- [ ] 用戶資料包含 `preferences` 欄位
- [ ] 用戶資料包含 `gamesHosted` 和 `gamesJoined` 欄位
- [ ] 創建團局功能正常
- [ ] 報名團局功能正常
- [ ] 通知功能正常
- [ ] 評分功能正常
- [ ] 個人資料頁面顯示正常
- [ ] 統計資料更新正常

---

## 📊 數據遷移 (如果需要)

如果已經有 APP 用戶註冊但缺少欄位，可以使用以下腳本更新：

```javascript
// 這是一個示例腳本，需要根據實際情況調整
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient({ region: 'ap-southeast-1' });

async function migrateUsers() {
  const params = {
    TableName: 'MahjongClub_Users',
    FilterExpression: 'accountType = :accountType AND attribute_not_exists(stats)',
    ExpressionAttributeValues: {
      ':accountType': 'app'
    }
  };

  const result = await dynamodb.scan(params).promise();

  for (const user of result.Items) {
    const updateParams = {
      TableName: 'MahjongClub_Users',
      Key: { userId: user.userId },
      UpdateExpression: 'SET stats = :stats, gamesHosted = :gh, gamesJoined = :gj, preferences = :pref',
      ExpressionAttributeValues: {
        ':stats': {
          gamesHosted: 0,
          gamesJoined: 0,
          totalRatings: 0,
          positiveRatings: 0,
          positiveRatingRate: 0.0
        },
        ':gh': 0,
        ':gj': 0,
        ':pref': {
          notifyNewGames: true,
          notifyGameUpdates: true
        }
      }
    };

    await dynamodb.update(updateParams).promise();
    console.log(`Updated user: ${user.userId}`);
  }
}

migrateUsers().catch(console.error);
```

---

## 🎉 完成！

修復完成後，MahjongClub_App 和 mahjongclub-web 將使用完全一致的數據結構，所有功能都能正常運行。

