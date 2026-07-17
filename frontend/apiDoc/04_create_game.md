# 創建團局 API

## 基本資訊

- **API 名稱**: 創建團局
- **Lambda 函數**: `Linebot_mahjongclub_web_create_game_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_create_game`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_create_game`

---

## 功能說明

創建新的麻將團局。需要扣除 120 點數作為創建費用。

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

### Request Body

```json
{
  "gameType": "臨時揪團",
  "placeName": "台北麻將館",
  "location": "台北市信義區信義路五段7號",
  "latitude": 25.033964,
  "longitude": 121.565427,
  "needPlayers": 3,
  "stakes": "100/20",
  "startTime": "2025-11-22T19:00:00+08:00",
  "rules": "基本三將",
  "features": "有冷氣, 有停車位",
  "restrictions": "新手友善"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 | 限制/選項 |
|------|------|------|------|----------|
| `gameType` | string | ✅ | 團局類型 | 固定值: "臨時揪團" |
| `placeName` | string | ✅ | 地點名稱 | - |
| `location` | string | ✅ | 完整地址 | - |
| `latitude` | number | ✅ | 緯度 | -90 到 90 |
| `longitude` | number | ✅ | 經度 | -180 到 180 |
| `needPlayers` | number | ✅ | 需要玩家數 | 1-3 (不含主辦人) |
| `stakes` | string | ✅ | 金額/籌碼 | 例: "100/20" |
| `startTime` | string | ✅ | 開始時間 | ISO 8601 格式 |
| `rules` | string | ❌ | 麻將規則 | ⚠️ **目前後端未使用此欄位** |
| `features` | string | ❌ | 場地特色 | ⚠️ **目前後端未使用此欄位** |
| `restrictions` | string | ❌ | 玩家限制 | ⚠️ **目前後端未使用此欄位** |

> **⚠️ 重要提示**:
> - `rules`, `features`, `restrictions` 欄位在後端代碼中接收但**目前未實際使用**
> - 團局創建時這些欄位會被設為空陣列 `[]`
> - 前端可以傳送這些欄位,但不會影響團局的實際創建結果

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "gameID": "GAME_1732195200_abc123",
    "pointsDeducted": 120,
    "pointsRemaining": 1380
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

#### 400 Bad Request - 缺少必填欄位
```json
{
  "success": false,
  "error": "Missing required fields"
}
```

#### 400 Bad Request - 點數不足
```json
{
  "success": false,
  "error": "Insufficient points. Required: 120, Available: 50"
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
  "error": "Failed to create game"
}
```

---

## 請求範例

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_create_game?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "gameType": "臨時揪團",
    "placeName": "台北麻將館",
    "location": "台北市信義區信義路五段7號",
    "latitude": 25.033964,
    "longitude": 121.565427,
    "needPlayers": 3,
    "stakes": "100/20",
    "startTime": "2025-11-22T19:00:00+08:00",
    "rules": "基本三將",
    "features": "有冷氣, 有停車位",
    "restrictions": "新手友善"
  }'
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx'; // 或使用加密的 LINE ID

const gameData = {
  gameType: '臨時揪團',
  placeName: '台北麻將館',
  location: '台北市信義區信義路五段7號',
  latitude: 25.033964,
  longitude: 121.565427,
  needPlayers: 3,
  stakes: '100/20',
  startTime: '2025-11-22T19:00:00+08:00',
  rules: '基本三將',
  features: '有冷氣, 有停車位',
  restrictions: '新手友善'
};

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_create_game?userId=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(gameData)
  }
);

const result = await response.json();
console.log(result);
```

---

## 業務邏輯

1. **驗證用戶**: 檢查用戶是否存在
2. **檢查點數**: 確認用戶有至少 120 點數
3. **扣除點數**: 從用戶帳戶扣除 120 點數
4. **生成 GameID**: 格式為 `GAME_{timestamp}_{random}`
5. **創建團局**: 狀態設為 "recruiting"
6. **加入主辦人**: 自動將主辦人加入為第一位玩家
7. **返回結果**: 包含 gameID 和剩餘點數

---

## 注意事項

1. **點數要求**: 創建團局需要 120 點數
2. **時間格式**: 必須使用 ISO 8601 格式 (RFC3339)
3. **玩家數量**: needPlayers 不包含主辦人，總人數 = needPlayers + 1
4. **座標驗證**: 緯度範圍 -90~90，經度範圍 -180~180
5. **自動加入**: 主辦人會自動成為第一位已加入的玩家
6. **團局狀態**: 新創建的團局狀態為 "recruiting"

