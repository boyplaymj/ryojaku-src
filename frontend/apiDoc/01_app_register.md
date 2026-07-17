# APP 用戶註冊 API

## 基本資訊

- **API 名稱**: APP 用戶註冊
- **Lambda 函數**: `Linebot_mahjongclub_app_register_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_app_register`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_register`

---

## 功能說明

註冊新的 APP 用戶帳號，使用 Email 和密碼進行註冊。

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

```json
{
  "email": "string (必填)",
  "password": "string (必填)",
  "displayName": "string (必填)",
  "gender": "string (選填)",
  "ageRange": "string (選填)",
  "mahjongExperience": "string (選填)"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 | 限制 |
|------|------|------|------|------|
| `email` | string | ✅ | 電子郵件地址 | 必須符合 Email 格式 |
| `password` | string | ✅ | 密碼 | 8-128 字元 |
| `displayName` | string | ✅ | 顯示名稱 | - |
| `gender` | string | ❌ | 性別 | 選項: "男", "女", "其他" |
| `ageRange` | string | ❌ | 年齡範圍 | 選項: "18-25", "26-35", "36-45", "46-55", "56+" |
| `mahjongExperience` | string | ❌ | 麻將經驗 | 選項: "新手", "初級", "中級", "高級", "專家" |

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "userId": "APP_xxxxxxxxxxxx",
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
    "createdAt": "2025-11-21T14:30:00Z"
  }
}
```

### 錯誤回應

#### 400 Bad Request - 缺少必填欄位
```json
{
  "success": false,
  "error": "Email, password, and display name are required"
}
```

#### 400 Bad Request - Email 格式錯誤
```json
{
  "success": false,
  "error": "Invalid email format"
}
```

#### 400 Bad Request - 密碼不符合要求
```json
{
  "success": false,
  "error": "密碼長度至少需要 8 個字元"
}
```

#### 409 Conflict - Email 已被註冊
```json
{
  "success": false,
  "error": "Email already registered"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Internal server error"
}
```

---

## 請求範例

### cURL
```bash
curl -X POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123",
    "displayName": "王小明",
    "gender": "男",
    "ageRange": "26-35",
    "mahjongExperience": "中級"
  }'
```

### JavaScript (Fetch)
```javascript
const response = await fetch('https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_app_register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePass123',
    displayName: '王小明',
    gender: '男',
    ageRange: '26-35',
    mahjongExperience: '中級'
  })
});

const data = await response.json();
console.log(data);
```

---

## 資料庫結構

### DynamoDB 表格
- **表格名稱**: `MahjongClub_Users`
- **主鍵**: `userId` (String)
- **GSI**: `email-index` (email 為分區鍵)

### 儲存的資料結構
```json
{
  "userId": "APP_xxxxxxxxxxxx",
  "displayName": "王小明",
  "email": "user@example.com",
  "passwordHash": "$2a$10$...",
  "accountType": "app",
  "gender": "男",
  "ageRange": "26-35",
  "mahjongExperience": "中級",
  "points": 0,
  "rating": 5.0,
  "isVerified": false,
  "emailVerified": false,
  "createdAt": "2025-11-21T14:30:00Z",
  "updatedAt": "2025-11-21T14:30:00Z"
}
```

---

## 注意事項

1. **密碼安全**: 密碼使用 bcrypt 加密儲存，不會以明文儲存
2. **Email 唯一性**: 每個 Email 只能註冊一次
3. **UserID 格式**: 自動生成，格式為 `APP_` + 16 位隨機字串
4. **初始點數**: 新用戶初始點數為 0
5. **初始評分**: 新用戶初始評分為 5.0
6. **帳號類型**: 固定為 "app"

