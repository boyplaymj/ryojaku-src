# 團局詳情 API

## 基本資訊

- **API 名稱**: 團局詳情
- **Lambda 函數**: `Linebot_mahjongclub_web_game_detail_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_game_detail`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_game_detail`

---

## 功能說明

獲取指定團局的詳細資訊，包括團局資料、已加入玩家和待審核報名。

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
  "gameId": "GAME_1732195200_abc123",
  "lineID": "encrypted_line_id_here"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `gameId` | string | ✅ | 團局 ID |
| `lineID` | string | ❌ | 加密的 LINE ID (可選,用於 LINE Bot 用戶) |

> **⚠️ 注意**:
> - `gameId` 是必填欄位
> - `lineID` 是可選欄位,主要用於 LINE Bot 用戶
> - APP 用戶可以不傳 `lineID` 欄位

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "game": {
      "gameId": "GAME_1732195200_abc123",
      "hostUserId": "APP_xxxxxxxxxxxx",
      "hostDisplayName": "王小明",
      "hostPictureUrl": "https://...",
      "gameType": "臨時揪團",
      "status": "recruiting",
      "location": {
        "placeName": "台北麻將館",
        "address": "台北市信義區信義路五段7號",
        "latitude": 25.033964,
        "longitude": 121.565427
      },
      "gameInfo": {
        "stakes": "100/20",
        "startTime": "2025-11-22T19:00:00+08:00",
        "rules": "基本三將",
        "features": "有冷氣, 有停車位",
        "restrictions": "新手友善",
        "needPlayers": 3,
        "currentPlayers": 2
      },
      "joinedPlayers": [
        {
          "userId": "APP_xxxxxxxxxxxx",
          "displayName": "王小明",
          "pictureUrl": "https://...",
          "joinedAt": "2025-11-21T14:30:00Z"
        },
        {
          "userId": "APP_yyyyyyyyyyyy",
          "displayName": "李小華",
          "pictureUrl": "https://...",
          "joinedAt": "2025-11-21T15:00:00Z"
        }
      ],
      "createdAt": "2025-11-21T14:30:00Z",
      "updatedAt": "2025-11-21T15:00:00Z"
    },
    "registrations": [
      {
        "registrationId": "REG_1732195800_xyz789",
        "gameId": "GAME_1732195200_abc123",
        "userId": "APP_zzzzzzzzzzzz",
        "displayName": "張小美",
        "pictureUrl": "https://...",
        "status": "pending",
        "message": "我是新手，希望能一起學習",
        "createdAt": "2025-11-21T15:30:00Z",
        "userStats": {
          "gamesHosted": 2,
          "gamesJoined": 8,
          "totalRatings": 6,
          "positiveRatings": 5,
          "positiveRatingRate": 0.83
        }
      }
    ]
  }
}
```

### 錯誤回應

#### 400 Bad Request - 缺少團局 ID
```json
{
  "success": false,
  "error": "缺少團局 ID"
}
```

#### 404 Not Found - 團局不存在
```json
{
  "success": false,
  "error": "團局不存在"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "獲取團局詳情失敗"
}
```

---

## 回應欄位說明

### Game 物件
參考 [搜尋團局 API](./05_search_games.md) 的 Game 物件說明

### Registration 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `registrationId` | string | 報名 ID |
| `gameId` | string | 團局 ID |
| `userId` | string | 報名用戶 ID |
| `displayName` | string | 報名用戶名稱 |
| `pictureUrl` | string | 報名用戶頭像 |
| `status` | string | 報名狀態 ("pending", "accepted", "rejected") |
| `message` | string | 報名留言 |
| `createdAt` | string | 報名時間 |
| `userStats` | object | 用戶統計資料 |

### UserStats 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `gamesHosted` | number | 主辦的團局數 |
| `gamesJoined` | number | 參加的團局數 |
| `totalRatings` | number | 總評價數 |
| `positiveRatings` | number | 正面評價數 |
| `positiveRatingRate` | number | 好評率 (0-1) |

---

## 請求範例

### cURL
```bash
curl -X POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_game_detail \
  -H "Content-Type: application/json" \
  -d '{
    "gameId": "GAME_1732195200_abc123"
  }'
```

### JavaScript (Fetch)
```javascript
const gameId = 'GAME_1732195200_abc123';

const response = await fetch(
  'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_game_detail',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ gameId })
  }
);

const result = await response.json();
if (result.success) {
  console.log('團局資訊:', result.data.game);
  console.log('待審核報名:', result.data.registrations);
}
```

---

## 業務邏輯

1. **獲取團局**: 從 DynamoDB 查詢團局資料
2. **獲取報名**: 查詢該團局的所有報名記錄
3. **獲取用戶統計**: 為每個報名用戶獲取統計資料
4. **組合回應**: 將團局和報名資料組合返回

---

## 注意事項

1. **無需認證**: 此 API 不需要用戶認證，任何人都可以查看團局詳情
2. **報名列表**: 只返回狀態為 "pending" 的報名（待審核）
3. **用戶統計**: 為每個報名用戶提供統計資料，幫助主辦人決策
4. **已加入玩家**: 包含在 `game.joinedPlayers` 中
5. **待審核報名**: 包含在 `registrations` 陣列中

