# 提交評分 API

## 基本資訊

- **API 名稱**: 提交評分
- **Lambda 函數**: `Linebot_mahjongclub_web_submit_rating_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_submit_rating`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_submit_rating`

---

## 功能說明

提交對其他用戶的評分和評論。用於團局結束後對參與者進行評價。

---

## 請求格式

### HTTP Method
```
POST
```

### Query Parameters (APP 用戶)

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅* | APP 用戶 ID (APP_xxx 格式) |

*APP 用戶使用

### Headers
```
Content-Type: application/json
```

### Request Body

```json
{
  "lineID": "ENCRYPTED_LINE_ID",
  "gameId": "game_xxxxxxxxxxxx",
  "toUserId": "APP_yyyyyyyyyyyy",
  "isPositive": true,
  "comment": "準時到場，牌品很好！"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `lineID` | string | ✅* | 評分者的加密 LINE ID (LINE Bot 用戶使用) |
| `gameId` | string | ✅ | 團局 ID |
| `toUserId` | string | ✅ | 被評分者的用戶 ID |
| `isPositive` | boolean | ✅ | 是否為正面評價 |
| `comment` | string | ❌ | 評論內容 (最多 500 字) |

*LINE Bot 用戶使用

> **⚠️ 注意**:
> - APP 用戶: 使用 Query Parameter `userId`
> - LINE Bot 用戶: 使用 Request Body `lineID`

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true
}
```

### 錯誤回應

#### 400 Bad Request - 缺少必填欄位
```json
{
  "success": false,
  "error": "Missing required fields"
}
```

#### 400 Bad Request - 不能評分自己
```json
{
  "success": false,
  "error": "Cannot rate yourself"
}
```

#### 400 Bad Request - 已經評分過
```json
{
  "success": false,
  "error": "Already rated this user for this game"
}
```

#### 403 Forbidden - 不是團局參與者
```json
{
  "success": false,
  "error": "You are not a participant of this game"
}
```

#### 404 Not Found - 團局不存在
```json
{
  "success": false,
  "error": "Game not found"
}
```

---

## 請求範例

### cURL - LINE Bot 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_submit_rating" \
  -H "Content-Type: application/json" \
  -d '{
    "lineID": "ENCRYPTED_LINE_ID",
    "gameId": "game_xxxxxxxxxxxx",
    "toUserId": "APP_yyyyyyyyyyyy",
    "isPositive": true,
    "comment": "準時到場，牌品很好！"
  }'
```

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_submit_rating" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "APP_xxxxxxxxxxxx",
    "gameId": "game_xxxxxxxxxxxx",
    "toUserId": "APP_yyyyyyyyyyyy",
    "isPositive": true,
    "comment": "準時到場，牌品很好！"
  }'
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx';
const isAppUser = userId.startsWith('APP_');

const response = await fetch(
  'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_submit_rating',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      [isAppUser ? 'userId' : 'lineID']: userId,
      gameId: 'game_xxxxxxxxxxxx',
      toUserId: 'APP_yyyyyyyyyyyy',
      isPositive: true,
      comment: '準時到場，牌品很好！'
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log('評分提交成功！');
}
```

---

## 業務邏輯

1. **驗證用戶**: 確認評分者存在
2. **驗證團局**: 確認團局存在且已結束
3. **驗證參與**: 確認評分者是團局參與者
4. **防止重複**: 檢查是否已經評分過
5. **防止自評**: 不能評分自己
6. **創建評分**: 在 Ratings 表創建評分記錄
7. **創建評論**: 在 RatingComments 表創建評論記錄
8. **更新統計**: 更新被評分者的評分統計

---

## 注意事項

1. **評分時機**: 只能在團局結束後評分
2. **一次評分**: 每個團局中，每個用戶只能對另一個用戶評分一次
3. **不能自評**: 不能評分自己
4. **評論長度**: 評論最多 500 字
5. **評分影響**: 評分會影響被評分者的信用評分和統計數據
6. **雙向評分**: 評分是單向的，A 評 B 和 B 評 A 是獨立的

