# 用戶資訊 API

## 基本資訊

- **API 名稱**: 用戶資訊
- **Lambda 函數**: `Linebot_mahjongclub_web_user_info_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_user_info`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_info`

---

## 功能說明

獲取指定用戶的公開資訊，包含統計數據和評分資訊。用於查看其他用戶的個人資料頁面。

---

## 請求格式

### HTTP Method
```
POST
```

### Query Parameters

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅ | 要查詢的用戶 ID (APP_xxx 或 LINE ID) |

### Headers
```
Content-Type: application/json
```

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
    "points": 1500,
    "rating": 4.8,
    "isVerified": true,
    "stats": {
      "gamesHosted": 5,
      "gamesJoined": 12,
      "ratingCount": 10,
      "averageRating": 4.8
    },
    "createdAt": "2025-11-01T10:00:00Z"
  }
}
```

### 回應欄位說明

| 欄位 | 類型 | 說明 |
|------|------|------|
| `userId` | string | 用戶 ID |
| `displayName` | string | 顯示名稱 |
| `gender` | string | 性別 |
| `ageRange` | string | 年齡範圍 |
| `mahjongExperience` | string | 麻將經驗 |
| `points` | number | 積分 |
| `rating` | number | 評分 (0-5) |
| `isVerified` | boolean | 是否已驗證 |
| `stats` | object | 統計資料 |
| `stats.gamesHosted` | number | 主辦團局數 |
| `stats.gamesJoined` | number | 參加團局數 |
| `stats.ratingCount` | number | 收到評分數 |
| `stats.averageRating` | number | 平均評分 |
| `createdAt` | string | 註冊時間 |

### 錯誤回應

#### 400 Bad Request - 缺少用戶 ID
```json
{
  "success": false,
  "error": "缺少用戶 ID"
}
```

#### 404 Not Found - 用戶不存在
```json
{
  "success": false,
  "error": "找不到用戶"
}
```

---

## 請求範例

### cURL
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_info?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json"
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_info?userId=${userId}`,
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
  console.log('平均評分:', result.data.stats.averageRating);
  console.log('主辦團局:', result.data.stats.gamesHosted);
}
```

---

## 業務邏輯

1. **驗證參數**: 確認提供了 userId
2. **查詢用戶**: 從 Users 表獲取用戶資料
3. **計算統計**: 從 RatingComments 表即時計算評分統計
4. **返回資料**: 返回用戶的公開資訊

---

## 與 user_profile API 的差異

| 特性 | user_info | user_profile |
|------|-----------|--------------|
| 用途 | 查看他人資料 | 管理自己資料 |
| 權限 | 公開資訊 | 完整資訊 |
| 操作 | 只讀 | 讀寫 |
| 敏感資訊 | 不包含 | 包含 (LINE ID, 偏好設定) |
| 統計資料 | 即時計算 | 即時計算 |

---

## 注意事項

1. **隱私保護**: 不返回敏感資訊 (LINE ID, 聯絡方式, 偏好設定)
2. **即時統計**: 評分統計從 RatingComments 表即時計算
3. **公開資訊**: 所有用戶都可以查看其他用戶的公開資訊
4. **用途**: 主要用於顯示用戶個人資料頁面、團局主辦人資訊等

