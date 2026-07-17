# 我的團局 API

## 基本資訊

- **API 名稱**: 我的團局
- **Lambda 函數**: `Linebot_mahjongclub_web_my_games_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_my_games`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_my_games`

---

## 功能說明

獲取用戶創建和參加的所有團局，包括招募中、進行中和已完成的團局。

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
    "hostedGames": [
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
          "currentPlayers": 2
        },
        "joinedPlayers": [...],
        "createdAt": "2025-11-21T14:30:00Z",
        "updatedAt": "2025-11-21T15:00:00Z"
      }
    ],
    "joinedGames": [
      {
        "gameId": "GAME_1732195800_xyz789",
        "hostUserId": "APP_yyyyyyyyyyyy",
        "hostDisplayName": "李小華",
        "status": "recruiting",
        ...
      }
    ],
    "pendingRegistrations": [
      {
        "registrationId": "REG_1732196400_def456",
        "gameId": "GAME_1732196000_ghi789",
        "userId": "APP_xxxxxxxxxxxx",
        "displayName": "王小明",
        "status": "pending",
        "message": "我想參加",
        "createdAt": "2025-11-21T16:00:00Z",
        "game": {
          "gameId": "GAME_1732196000_ghi789",
          "hostDisplayName": "張小美",
          "location": {...},
          "gameInfo": {...}
        }
      }
    ]
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

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to get games"
}
```

---

## 回應欄位說明

### hostedGames (我主辦的團局)
包含用戶作為主辦人創建的所有團局，按創建時間降序排列。

### joinedGames (我參加的團局)
包含用戶已加入的所有團局（不包括自己主辦的），按加入時間降序排列。

### pendingRegistrations (待審核的報名)
包含用戶報名但尚未被接受的團局，按報名時間降序排列。

---

## 請求範例

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_my_games?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json"
```

### cURL - LINE Bot 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_my_games?lineID=<encrypted_line_id>" \
  -H "Content-Type: application/json"
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx'; // 或使用加密的 LINE ID
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_my_games?${paramName}=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();
if (result.success) {
  console.log('我主辦的團局:', result.data.hostedGames);
  console.log('我參加的團局:', result.data.joinedGames);
  console.log('待審核的報名:', result.data.pendingRegistrations);
}
```

---

## 業務邏輯

1. **獲取主辦團局**: 查詢 `hostUserId` 等於用戶 ID 的所有團局
2. **獲取參加團局**: 查詢用戶在 `joinedPlayers` 中的所有團局
3. **獲取待審核報名**: 查詢用戶狀態為 "pending" 的所有報名記錄
4. **組合回應**: 將三類資料組合返回

---

## 注意事項

1. **需要認證**: 必須提供 `userId` 或 `lineID` 參數
2. **排序方式**: 
   - 主辦團局: 按創建時間降序
   - 參加團局: 按加入時間降序
   - 待審核報名: 按報名時間降序
3. **狀態過濾**: 包含所有狀態的團局（recruiting, full, in_progress, completed, cancelled）
4. **自動過濾**: 參加團局列表不包含自己主辦的團局

