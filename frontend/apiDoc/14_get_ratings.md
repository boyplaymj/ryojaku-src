# 獲取評分 API

## 基本資訊

- **API 名稱**: 獲取評分
- **Lambda 函數**: `Linebot_mahjongclub_web_get_ratings_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `GET /mahjongclub_web_get_ratings`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_get_ratings`

---

## 功能說明

獲取指定團局或用戶的所有評分記錄。用於顯示用戶的評價歷史或團局的評分。

---

## 請求格式

### HTTP Method
```
GET
```

### Query Parameters

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `gameId` | string | ❌ | 團局 ID (查詢特定團局的評分) |
| `userId` | string | ❌* | APP 用戶 ID (APP_xxx 格式) |
| `lineID` | string | ❌** | 加密的 LINE ID |

*APP 用戶使用
**LINE Bot 用戶使用

> **⚠️ 注意**:
> - 必須提供 `gameId` 或 (`userId`/`lineID`) 其中之一
> - 如果提供 `gameId`,則返回該團局的所有評分
> - 如果提供 `userId` 或 `lineID`,則返回該用戶收到的所有評分

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "ratings": [
      {
        "ratingId": "rating_xxxxxxxxxxxx",
        "gameId": "game_xxxxxxxxxxxx",
        "fromUserId": "APP_yyyyyyyyyyyy",
        "toUserId": "APP_xxxxxxxxxxxx",
        "isPositive": true,
        "comment": "準時到場，牌品很好！",
        "createdAt": 1732185600000
      },
      {
        "ratingId": "rating_yyyyyyyyyyyy",
        "gameId": "game_yyyyyyyyyyyy",
        "fromUserId": "U1234567890abcdef",
        "toUserId": "APP_xxxxxxxxxxxx",
        "isPositive": true,
        "comment": "很好的牌友",
        "createdAt": 1732099200000
      }
    ]
  }
}
```

### 回應欄位說明

| 欄位 | 類型 | 說明 |
|------|------|------|
| `ratings` | array | 評分列表 |
| `ratingId` | string | 評分 ID |
| `gameId` | string | 團局 ID |
| `fromUserId` | string | 評分者 ID |
| `toUserId` | string | 被評分者 ID |
| `isPositive` | boolean | 是否為正面評價 |
| `comment` | string | 評論內容 (可選) |
| `createdAt` | number | 創建時間 (Unix timestamp 毫秒) |

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

---

## 請求範例

### cURL - 查詢團局評分
```bash
curl -X GET "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_get_ratings?gameId=GAME_1732195200_abc123"
```

### cURL - 查詢用戶評分 (APP 用戶)
```bash
curl -X GET "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_get_ratings?userId=APP_xxxxxxxxxxxx"
```

### cURL - 查詢用戶評分 (LINE Bot 用戶)
```bash
curl -X GET "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_get_ratings?lineID=ENCRYPTED_LINE_ID"
```

### JavaScript (Fetch) - 查詢用戶評分
```javascript
const userId = 'APP_xxxxxxxxxxxx';
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_get_ratings?${paramName}=${userId}`,
  {
    method: 'GET'
  }
);

const result = await response.json();
if (result.success) {
  const ratings = result.data.ratings;
  console.log(`收到 ${ratings.length} 個評分`);

  const positiveCount = ratings.filter(r => r.isPositive).length;
  const negativeCount = ratings.length - positiveCount;
  console.log(`正面評價: ${positiveCount}, 負面評價: ${negativeCount}`);

  // 顯示評論
  ratings.forEach(rating => {
    if (rating.comment) {
      console.log(`${rating.isPositive ? '👍' : '👎'} ${rating.comment}`);
    }
  });
}
```

---

## 業務邏輯

1. **驗證用戶**: 確認用戶存在
2. **查詢評分**: 從 Ratings 表查詢該用戶收到的所有評分
3. **排序**: 按創建時間降序排列 (最新的在前)
4. **返回結果**: 包含所有評分記錄

---

## 注意事項

1. **隱私保護**: 只能查看自己收到的評分
2. **評分來源**: `fromUserId` 可能是 APP 用戶或 LINE 用戶
3. **時間格式**: `createdAt` 為 Unix timestamp (毫秒)
4. **評論可選**: `comment` 欄位可能為空字串
5. **正負評價**: `isPositive` 為 true 表示正面評價，false 表示負面評價

