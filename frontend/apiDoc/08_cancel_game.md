# 取消團局 API

## 基本資訊

- **API 名稱**: 取消團局
- **Lambda 函數**: `Linebot_mahjongclub_web_cancel_game_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_cancel_game`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_cancel_game`

---

## 功能說明

主辦人取消團局，退還 120 點數，並通知所有已加入和報名的用戶。

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
  "gameId": "GAME_1732195200_abc123",
  "reason": "臨時有事，抱歉取消"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `gameId` | string | ✅ | 團局 ID |
| `reason` | string | ❌ | 取消原因 |

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "gameId": "GAME_1732195200_abc123",
    "status": "cancelled",
    "pointsRefunded": 120,
    "pointsRemaining": 1500,
    "notifiedUsers": 3
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

#### 400 Bad Request - 缺少團局 ID
```json
{
  "success": false,
  "error": "Missing gameId"
}
```

#### 403 Forbidden - 非主辦人
```json
{
  "success": false,
  "error": "Only host can cancel the game"
}
```

#### 404 Not Found - 團局不存在
```json
{
  "success": false,
  "error": "Game not found"
}
```

#### 400 Bad Request - 團局已開始
```json
{
  "success": false,
  "error": "Cannot cancel game that has already started"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to cancel game"
}
```

---

## 請求範例

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_cancel_game?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "gameId": "GAME_1732195200_abc123",
    "reason": "臨時有事，抱歉取消"
  }'
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx'; // 主辦人 ID
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_cancel_game?${paramName}=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      gameId: 'GAME_1732195200_abc123',
      reason: '臨時有事，抱歉取消'
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log('團局已取消');
  console.log('退還點數:', result.data.pointsRefunded);
  console.log('通知用戶數:', result.data.notifiedUsers);
}
```

---

## 業務邏輯

1. **驗證主辦人**: 確認操作者是團局的主辦人
2. **檢查團局**: 確認團局存在且未開始
3. **更新狀態**: 將團局狀態改為 "cancelled"
4. **退還點數**: 將 120 點數退還給主辦人
5. **處理報名**: 將所有待審核報名改為 "cancelled"，退還報名費
6. **發送通知**: 通知所有已加入和報名的用戶
7. **返回結果**: 包含取消資訊和退還點數

---

## 注意事項

1. **權限檢查**: 只有主辦人可以取消團局
2. **時間限制**: 只能取消尚未開始的團局
3. **點數退還**: 
   - 主辦人退還 120 點數
   - 所有待審核報名退還 20 點數
4. **取消原因**: 建議提供取消原因，讓參與者了解情況
5. **推送通知**: 取消後會發送推送通知給所有相關用戶
6. **不可撤銷**: 取消後無法恢復團局

