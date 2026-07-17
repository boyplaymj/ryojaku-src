# 報名團局 API

## 基本資訊

- **API 名稱**: 報名團局
- **Lambda 函數**: `Linebot_mahjongclub_web_register_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_register`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_register`

---

## 功能說明

報名參加麻將團局，需要扣除 20 點數作為報名費用。報名後需等待主辦人審核。

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
  "gameID": "GAME_1732195200_abc123",
  "message": "我想參加，希望能一起學習"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `gameID` | string | ✅ | 團局 ID |
| `message` | string | ❌ | 報名留言 |

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "registrationId": "REG_1732196400_def456",
    "status": "pending",
    "pointsDeducted": 20,
    "pointsRemaining": 1360
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
  "error": "Missing gameID"
}
```

#### 400 Bad Request - 點數不足
```json
{
  "success": false,
  "error": "Insufficient points. Required: 20, Available: 10"
}
```

#### 400 Bad Request - 團局已滿
```json
{
  "success": false,
  "error": "Game is full"
}
```

#### 400 Bad Request - 已報名
```json
{
  "success": false,
  "error": "Already registered for this game"
}
```

#### 400 Bad Request - 已加入
```json
{
  "success": false,
  "error": "Already joined this game"
}
```

#### 404 Not Found - 團局不存在
```json
{
  "success": false,
  "error": "Game not found"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to register for game"
}
```

---

## 請求範例

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_register?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "gameID": "GAME_1732195200_abc123",
    "message": "我想參加，希望能一起學習"
  }'
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx';
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_register?${paramName}=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      gameID: 'GAME_1732195200_abc123',
      message: '我想參加，希望能一起學習'
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log('報名成功！');
  console.log('報名 ID:', result.data.registrationId);
  console.log('剩餘點數:', result.data.pointsRemaining);
}
```

---

## 業務邏輯

1. **驗證用戶**: 檢查用戶是否存在
2. **檢查團局**: 確認團局存在且狀態為 "recruiting"
3. **檢查重複**: 確認用戶未報名或加入該團局
4. **檢查人數**: 確認團局未滿
5. **檢查點數**: 確認用戶有至少 20 點數
6. **扣除點數**: 從用戶帳戶扣除 20 點數
7. **創建報名**: 狀態設為 "pending"
8. **發送通知**: 通知主辦人有新報名
9. **返回結果**: 包含 registrationID 和剩餘點數

---

## 資料庫結構

### DynamoDB 表格
- **表格名稱**: `MahjongClub_Registrations`
- **主鍵**: `registrationId` (String)
- **GSI**: 
  - `gameId-index` (gameId 為分區鍵)
  - `userId-index` (userId 為分區鍵)

### 儲存的資料結構
```json
{
  "registrationId": "REG_1732196400_def456",
  "gameId": "GAME_1732195200_abc123",
  "userId": "APP_xxxxxxxxxxxx",
  "displayName": "王小明",
  "pictureUrl": "https://...",
  "status": "pending",
  "message": "我想參加，希望能一起學習",
  "createdAt": "2025-11-21T16:00:00Z",
  "updatedAt": "2025-11-21T16:00:00Z"
}
```

---

## 注意事項

1. **點數要求**: 報名需要 20 點數
2. **報名狀態**: 新報名的狀態為 "pending"，需等待主辦人審核
3. **重複檢查**: 同一用戶不能重複報名同一團局
4. **人數限制**: 團局滿員時無法報名
5. **推送通知**: 報名成功後會發送推送通知給主辦人
6. **點數退還**: 如果報名被拒絕，點數會退還

