# 驗證用戶 API

## 基本資訊

- **API 名稱**: 驗證用戶
- **Lambda 函數**: `Linebot_mahjongclub_web_verify_user_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_verify_user`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_verify_user`

---

## 功能說明

驗證用戶身份並獲取用戶基本資訊，用於檢查用戶是否存在以及獲取用戶狀態。

---

## 請求格式

### HTTP Method
```
POST
```

### Query Parameters

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅* | APP 用戶 ID (APP_xxx 格式) |
| `lineID` | string | ✅** | 加密的 LINE ID |

*APP 用戶使用  
**LINE Bot 用戶使用

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "userId": "APP_xxxxxxxxxxxx",
    "displayName": "王小明",
    "gender": "男",
    "ageRange": "26-35",
    "mahjongExperience": "中級",
    "lineId": "",
    "points": 1500,
    "rating": 4.8,
    "stats": {
      "gamesHosted": 5,
      "gamesJoined": 12,
      "totalRatings": 10,
      "positiveRatings": 9,
      "positiveRatingRate": 0.9
    },
    "isVerified": true,
    "preferences": {
      "notifyNewGames": true,
      "notifyGameUpdates": true
    },
    "createdAt": "2025-11-21T14:30:00Z"
  }
}
```

### 錯誤回應

#### 400 Bad Request - 缺少用戶識別
```json
{
  "success": false,
  "error": "Missing userId or lineID parameter"
}
```

#### 401 Unauthorized - 解密失敗
```json
{
  "success": false,
  "error": "Failed to decrypt LINE ID"
}
```

#### 404 Not Found - 用戶不存在
```json
{
  "success": false,
  "error": "User not found"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to verify user"
}
```

---

## 回應欄位說明

| 欄位 | 類型 | 說明 |
|------|------|------|
| `userId` | string | 用戶 ID |
| `displayName` | string | 顯示名稱 |
| `gender` | string | 性別 ("男", "女", "其他") |
| `ageRange` | string | 年齡範圍 |
| `mahjongExperience` | string | 麻將經驗 |
| `lineId` | string | LINE ID (如果有綁定) |
| `points` | number | 點數 |
| `rating` | number | 評分 (0-5) |
| `stats` | object | 用戶統計資料 |
| `isVerified` | boolean | 是否已驗證 |
| `preferences` | object | 用戶偏好設定 |
| `createdAt` | string | 建立時間 |

---

## 請求範例

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_verify_user?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json"
```

### cURL - LINE Bot 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_verify_user?lineID=<encrypted_line_id>" \
  -H "Content-Type: application/json"
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx';
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_verify_user?${paramName}=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();
if (result.success) {
  console.log('用戶資訊:', result.data);
  console.log('點數:', result.data.points);
  console.log('評分:', result.data.rating);
}
```

---

## 使用場景

1. **登入後驗證**: 用戶登入後驗證身份並獲取最新資訊
2. **頁面載入**: 載入頁面時檢查用戶狀態
3. **權限檢查**: 執行操作前檢查用戶是否存在
4. **資料同步**: 同步用戶最新的點數和評分

---

## 注意事項

1. **需要認證**: 必須提供 `userId` 或 `lineID` 參數
2. **安全性**: 回應中不包含密碼或敏感資訊
3. **即時資料**: 返回的是資料庫中的最新資料
4. **統計資料**: 包含用戶的完整統計資訊

