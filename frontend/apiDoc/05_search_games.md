# 搜尋團局 API

## 基本資訊

- **API 名稱**: 搜尋團局
- **Lambda 函數**: `Linebot_mahjongclub_web_search_games_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `GET /mahjongclub_web_search_games`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games`

---

## 功能說明

搜尋可用的麻將團局，支援全部搜尋和附近搜尋兩種模式。

---

## 請求格式

### HTTP Method
```
GET
```

### Query Parameters

| 參數 | 類型 | 必填 | 說明 | 預設值 |
|------|------|------|------|--------|
| `type` | string | ❌ | 搜尋類型 | "all" |
| `latitude` | number | ❌* | 用戶緯度 | - |
| `longitude` | number | ❌* | 用戶經度 | - |
| `radius` | number | ❌ | 搜尋半徑 (公里) | 5 |

*當 type="nearby" 時必填

> **⚠️ 注意**: 此 API 使用 **GET** 方法,所有參數都通過 Query Parameters 傳遞,不使用 Request Body。

### 搜尋類型選項

| 值 | 說明 |
|----|------|
| `all` | 搜尋所有招募中的團局 |
| `nearby` | 搜尋附近的團局（需提供座標） |

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "games": [
      {
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
          "currentPlayers": 1
        },
        "joinedPlayers": [
          {
            "userId": "APP_xxxxxxxxxxxx",
            "displayName": "王小明",
            "pictureUrl": "https://...",
            "joinedAt": "2025-11-21T14:30:00Z"
          }
        ],
        "createdAt": "2025-11-21T14:30:00Z",
        "updatedAt": "2025-11-21T14:30:00Z"
      }
    ],
    "count": 1
  }
}
```

### 回應欄位說明

#### Game 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `gameId` | string | 團局 ID |
| `hostUserId` | string | 主辦人 ID |
| `hostDisplayName` | string | 主辦人名稱 |
| `hostPictureUrl` | string | 主辦人頭像 |
| `gameType` | string | 團局類型 |
| `status` | string | 團局狀態 |
| `location` | object | 地點資訊 |
| `gameInfo` | object | 團局資訊 |
| `joinedPlayers` | array | 已加入玩家列表 |
| `createdAt` | string | 創建時間 |
| `updatedAt` | string | 更新時間 |

#### Location 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `placeName` | string | 地點名稱 |
| `address` | string | 完整地址 |
| `latitude` | number | 緯度 |
| `longitude` | number | 經度 |

#### GameInfo 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `stakes` | string | 金額/籌碼 |
| `startTime` | string | 開始時間 |
| `rules` | string | 麻將規則 |
| `features` | string | 場地特色 |
| `restrictions` | string | 玩家限制 |
| `needPlayers` | number | 需要玩家數 |
| `currentPlayers` | number | 目前玩家數 |

#### Player 物件

| 欄位 | 類型 | 說明 |
|------|------|------|
| `userId` | string | 玩家 ID |
| `displayName` | string | 玩家名稱 |
| `pictureUrl` | string | 玩家頭像 |
| `joinedAt` | string | 加入時間 |

---

## 請求範例

### cURL - 搜尋全部
```bash
curl -X GET "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games?type=all"
```

### cURL - 搜尋附近
```bash
curl -X GET "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games?type=nearby&latitude=25.033964&longitude=121.565427&radius=10"
```

### JavaScript (Fetch) - 搜尋全部
```javascript
const response = await fetch(
  'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games?type=all',
  {
    method: 'GET'
  }
);

const result = await response.json();
console.log(`找到 ${result.data.count} 個團局`);
console.log(result.data.games);
```

### JavaScript (Fetch) - 搜尋附近
```javascript
// 獲取用戶位置
navigator.geolocation.getCurrentPosition(async (position) => {
  const { latitude, longitude } = position.coords;

  const response = await fetch(
    `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games?type=nearby&latitude=${latitude}&longitude=${longitude}&radius=5`,
    {
      method: 'GET'
    }
  );

  const result = await response.json();
  console.log(`附近 5 公里內找到 ${result.data.count} 個團局`);
});
```

---

## 業務邏輯

1. **查詢團局**: 使用 GSI `status-createdAt-index` 查詢狀態為 "recruiting" 的團局
2. **過濾過期**: 移除開始時間已過的團局
3. **距離計算**: 如果是附近搜尋，使用 Haversine 公式計算距離
4. **排序**: 按創建時間降序排列（最新的在前）
5. **限制數量**: 最多返回 50 個團局

---

## 注意事項

1. **狀態過濾**: 只返回狀態為 "recruiting" 的團局
2. **時間過濾**: 自動過濾掉開始時間已過的團局
3. **距離計算**: 使用 Haversine 公式計算球面距離
4. **預設半徑**: 附近搜尋預設半徑為 5 公里
5. **結果限制**: 最多返回 50 個團局
6. **排序方式**: 按創建時間降序（最新的在前）
7. **無需認證**: 此 API 不需要用戶認證

