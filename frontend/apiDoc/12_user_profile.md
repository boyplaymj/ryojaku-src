# 用戶資料 API

## 基本資訊

- **API 名稱**: 用戶資料
- **Lambda 函數**: `Linebot_mahjongclub_web_user_profile_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_user_profile`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_profile`

---

## 功能說明

獲取或更新用戶的個人資料和偏好設定。支援 GET (查詢) 和 POST (更新) 兩種操作。

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

### Headers
```
Content-Type: application/json
```

### Request Body (更新資料時)

```json
{
  "displayName": "王小明",
  "gender": "男",
  "ageRange": "26-35",
  "mahjongExperience": "中級",
  "lineId": "U1234567890abcdef",
  "notifyNewGames": true
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 | 可選值 |
|------|------|------|------|--------|
| `displayName` | string | ❌ | 顯示名稱 | - |
| `gender` | string | ❌ | 性別 | "男", "女", "其他" |
| `ageRange` | string | ❌ | 年齡範圍 | "18-25", "26-35", "36-45", "46-55", "56+" |
| `mahjongExperience` | string | ❌ | 麻將經驗 | "新手", "初級", "中級", "高級", "專家" |
| `lineId` | string | ❌ | LINE ID | - |
| `notifyNewGames` | boolean | ❌ | 是否通知新團局 | true, false |

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
    "lineId": "U1234567890abcdef",
    "points": 1500,
    "rating": 4.8,
    "isVerified": true,
    "stats": {
      "gamesHosted": 5,
      "gamesJoined": 12,
      "ratingCount": 10,
      "averageRating": 4.8
    },
    "preferences": {
      "notifyNewGames": true,
      "notifyGameUpdates": true
    },
    "createdAt": "2025-11-01T10:00:00Z",
    "updatedAt": "2025-11-21T15:30:00Z"
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
  "error": "Failed to update user profile"
}
```

---

## 請求範例

### cURL - 查詢資料
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_profile?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json"
```

### cURL - 更新資料
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_profile?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "王小明",
    "gender": "男",
    "ageRange": "26-35",
    "mahjongExperience": "中級",
    "notifyNewGames": true
  }'
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx';
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

// 更新資料
const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_profile?${paramName}=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      displayName: '王小明',
      gender: '男',
      ageRange: '26-35',
      mahjongExperience: '中級',
      notifyNewGames: true
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log('資料更新成功！');
  console.log('用戶資料:', result.data);
}
```

---

## 業務邏輯

1. **驗證用戶**: 確認用戶存在
2. **檢查請求**: 如果有 body，執行更新；否則返回當前資料
3. **更新資料**: 更新提供的欄位
4. **更新時間戳**: 設定 `updatedAt` 為當前時間
5. **返回結果**: 包含完整的用戶資料

---

## 注意事項

1. **部分更新**: 只更新提供的欄位，未提供的欄位保持不變
2. **選項驗證**: 性別、年齡範圍、麻將經驗需使用指定的可選值
3. **通知設定**: `notifyNewGames` 影響是否接收新團局通知
4. **統計資料**: `stats` 欄位為只讀，由系統自動計算
5. **LINE ID**: 更新 LINE ID 可用於綁定 LINE 帳號

