# APP 用戶登入 API

## 基本資訊

- **API 名稱**: APP 用戶登入
- **Lambda 函數**: `Linebot_mahjongclub_app_login_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_app_login`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_login`

---

## 功能說明

APP 用戶登入，支援兩種登入方式：
1. **Email + Password** (主要方式)
2. **Encrypted LINE ID** (備援方式，用於已綁定 LINE 的用戶)

---

## 請求格式

### HTTP Method
```
POST
```

### Headers
```
Content-Type: application/json
```

### Request Body

#### 方式 1: Email + Password 登入
```json
{
  "email": "string (必填)",
  "password": "string (必填)"
}
```

#### 方式 2: Encrypted LINE ID 登入
```json
{
  "encryptedLineId": "string (必填)"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `email` | string | ✅* | 電子郵件地址 |
| `password` | string | ✅* | 密碼 |
| `encryptedLineId` | string | ✅** | 加密的 LINE ID |

*方式 1 必填  
**方式 2 必填

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "user": {
    "userId": "APP_xxxxxxxxxxxx",
    "displayName": "王小明",
    "email": "user@example.com",
    "accountType": "app",
    "gender": "男",
    "ageRange": "26-35",
    "mahjongExperience": "中級",
    "lineId": "",
    "points": 1500,
    "rating": 4.8,
    "isVerified": true,
    "emailVerified": true,
    "stats": {
      "gamesHosted": 5,
      "gamesJoined": 12,
      "totalRatings": 10,
      "positiveRatings": 9,
      "positiveRatingRate": 0.9
    },
    "preferences": {
      "notifyNewGames": true,
      "notifyGameUpdates": true
    },
    "createdAt": "2025-11-21T14:30:00Z",
    "updatedAt": "2025-11-21T22:15:00Z"
  }
}
```

### 錯誤回應

#### 400 Bad Request - 缺少登入資訊
```json
{
  "success": false,
  "error": "Email and password, or encrypted LINE ID required"
}
```

#### 401 Unauthorized - Email 或密碼錯誤
```json
{
  "success": false,
  "error": "Invalid email or password"
}
```

#### 401 Unauthorized - LINE ID 無效
```json
{
  "success": false,
  "error": "Invalid LINE ID"
}
```

#### 401 Unauthorized - 用戶不存在
```json
{
  "success": false,
  "error": "User not found"
}
```

---

## 請求範例

### cURL - Email 登入
```bash
curl -X POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123"
  }'
```

### cURL - LINE ID 登入
```bash
curl -X POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_login \
  -H "Content-Type: application/json" \
  -d '{
    "encryptedLineId": "encrypted_line_id_here"
  }'
```

### JavaScript (Fetch)
```javascript
// Email 登入
const response = await fetch('https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePass123'
  })
});

const data = await response.json();
if (data.success) {
  // 儲存用戶資訊
  localStorage.setItem('user', JSON.stringify(data.user));
  console.log('登入成功:', data.user);
}
```

---

## 回應欄位說明

### User 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `userId` | string | 用戶 ID (APP_xxx 格式) |
| `displayName` | string | 顯示名稱 |
| `email` | string | 電子郵件 |
| `accountType` | string | 帳號類型 ("app" 或 "linebot") |
| `gender` | string | 性別 |
| `ageRange` | string | 年齡範圍 |
| `mahjongExperience` | string | 麻將經驗 |
| `lineId` | string | LINE ID (如果有綁定) |
| `points` | number | 點數 |
| `rating` | number | 評分 (0-5) |
| `isVerified` | boolean | 是否已驗證 |
| `emailVerified` | boolean | Email 是否已驗證 |
| `stats` | object | 用戶統計資料 |
| `preferences` | object | 用戶偏好設定 |
| `createdAt` | string | 建立時間 (ISO 8601) |
| `updatedAt` | string | 更新時間 (ISO 8601) |

### Stats 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `gamesHosted` | number | 主辦的團局數 |
| `gamesJoined` | number | 參加的團局數 |
| `totalRatings` | number | 總評價數 |
| `positiveRatings` | number | 正面評價數 |
| `positiveRatingRate` | number | 好評率 (0-1) |

### Preferences 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `notifyNewGames` | boolean | 是否通知新團局 |
| `notifyGameUpdates` | boolean | 是否通知團局更新 |

---

## 注意事項

1. **密碼驗證**: 使用 bcrypt 進行密碼驗證
2. **登入記錄**: 成功登入後會更新 `lastLoginAt` 時間戳
3. **安全性**: 回應中不包含密碼或密碼雜湊
4. **SESSION 管理**: 前端需自行管理登入狀態（建議使用 localStorage 或 sessionStorage）
5. **LINE ID 加密**: 使用 AES 加密，需要正確的加密金鑰

