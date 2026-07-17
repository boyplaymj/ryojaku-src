# 用戶評論 API

## 基本資訊

- **API 名稱**: 用戶評論
- **Lambda 函數**: `Linebot_mahjongclub_web_user_comments_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_user_comments`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_comments`

---

## 功能說明

獲取指定用戶收到的所有評論。用於顯示用戶個人資料頁面的評價列表。

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
  "data": [
    {
      "commentId": "comment_xxxxxxxxxxxx",
      "ratingId": "rating_xxxxxxxxxxxx",
      "gameId": "game_xxxxxxxxxxxx",
      "fromUserId": "APP_yyyyyyyyyyyy",
      "fromDisplayName": "李小華",
      "toUserId": "APP_xxxxxxxxxxxx",
      "isPositive": true,
      "comment": "準時到場，牌品很好！",
      "createdAt": 1732185600000,
      "updatedAt": "2025-11-21T15:30:00Z"
    },
    {
      "commentId": "comment_yyyyyyyyyyyy",
      "ratingId": "rating_yyyyyyyyyyyy",
      "gameId": "game_yyyyyyyyyyyy",
      "fromUserId": "U1234567890abcdef",
      "fromDisplayName": "張三",
      "toUserId": "APP_xxxxxxxxxxxx",
      "isPositive": true,
      "comment": "很好的牌友，期待下次再一起打牌！",
      "createdAt": 1732099200000,
      "updatedAt": "2025-11-20T10:00:00Z"
    }
  ]
}
```

### 回應欄位說明

| 欄位 | 類型 | 說明 |
|------|------|------|
| `commentId` | string | 評論 ID |
| `ratingId` | string | 關聯的評分 ID |
| `gameId` | string | 團局 ID |
| `fromUserId` | string | 評論者 ID |
| `fromDisplayName` | string | 評論者顯示名稱 |
| `toUserId` | string | 被評論者 ID |
| `isPositive` | boolean | 是否為正面評價 |
| `comment` | string | 評論內容 |
| `createdAt` | number | 創建時間 (Unix timestamp 毫秒) |
| `updatedAt` | string | 更新時間 (ISO 8601) |

### 錯誤回應

#### 400 Bad Request - 缺少用戶 ID
```json
{
  "success": false,
  "error": "缺少用戶 ID"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "獲取評論失敗"
}
```

---

## 請求範例

### cURL
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_comments?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json"
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_user_comments?userId=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();
if (result.success) {
  const comments = result.data;
  console.log(`收到 ${comments.length} 條評論`);
  
  // 統計正負評
  const positiveCount = comments.filter(c => c.isPositive).length;
  const negativeCount = comments.length - positiveCount;
  console.log(`正面評價: ${positiveCount}, 負面評價: ${negativeCount}`);
  
  // 顯示最新的 5 條評論
  comments.slice(0, 5).forEach(comment => {
    console.log(`${comment.isPositive ? '👍' : '👎'} ${comment.fromDisplayName}: ${comment.comment}`);
  });
}
```

---

## 業務邏輯

1. **驗證參數**: 確認提供了 userId
2. **查詢評論**: 從 RatingComments 表查詢該用戶收到的所有評論
3. **使用索引**: 使用 `toUserId-createdAt-index` 索引查詢
4. **排序**: 按創建時間降序排列 (最新的在前)
5. **返回結果**: 包含評論者的顯示名稱

---

## 與 get_ratings API 的差異

| 特性 | user_comments | get_ratings |
|------|---------------|-------------|
| 資料來源 | RatingComments 表 | Ratings 表 |
| 包含評論者名稱 | ✅ | ❌ |
| 用途 | 顯示評論列表 | 統計評分數據 |
| 排序 | 按時間降序 | 按時間降序 |

---

## 注意事項

1. **公開資訊**: 評論是公開的，任何人都可以查看
2. **評論者名稱**: 包含評論者的顯示名稱，方便顯示
3. **時間格式**: `createdAt` 為 Unix timestamp (毫秒)，`updatedAt` 為 ISO 8601 格式
4. **排序**: 最新的評論在最前面
5. **用途**: 主要用於用戶個人資料頁面的評價展示

