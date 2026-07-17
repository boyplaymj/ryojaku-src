# 接受報名 API

## 基本資訊

- **API 名稱**: 接受報名
- **Lambda 函數**: `Linebot_mahjongclub_web_accept_registration_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_accept_registration`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_accept_registration`

---

## 功能說明

主辦人接受用戶的報名申請，將報名狀態從 "pending" 改為 "accepted"，並將用戶加入團局。

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
  "registrationId": "REG_1732196400_def456"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `registrationId` | string | ✅ | 報名 ID |

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "registrationId": "REG_1732196400_def456",
    "status": "accepted",
    "gameId": "GAME_1732195200_abc123",
    "userId": "APP_yyyyyyyyyyyy",
    "displayName": "李小華"
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

#### 400 Bad Request - 缺少報名 ID
```json
{
  "success": false,
  "error": "Missing registrationId"
}
```

#### 403 Forbidden - 非主辦人
```json
{
  "success": false,
  "error": "Only host can accept registrations"
}
```

#### 404 Not Found - 報名不存在
```json
{
  "success": false,
  "error": "Registration not found"
}
```

#### 400 Bad Request - 團局已滿
```json
{
  "success": false,
  "error": "Game is full"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to accept registration"
}
```

---

## 請求範例

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_accept_registration?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "registrationId": "REG_1732196400_def456"
  }'
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx'; // 主辦人 ID
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_accept_registration?${paramName}=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      registrationId: 'REG_1732196400_def456'
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log('已接受報名！');
  console.log('用戶:', result.data.displayName);
}
```

---

## 業務邏輯

1. **驗證主辦人**: 確認操作者是團局的主辦人
2. **檢查報名**: 確認報名存在且狀態為 "pending"
3. **檢查人數**: 確認團局未滿
4. **更新報名**: 將報名狀態改為 "accepted"
5. **加入團局**: 將用戶加入 `joinedPlayers` 列表
6. **更新人數**: 增加 `currentPlayers` 計數
7. **檢查滿員**: 如果達到人數上限，將團局狀態改為 "full"
8. **發送通知**: 通知報名用戶已被接受
9. **返回結果**: 包含更新後的報名資訊

---

## 注意事項

1. **權限檢查**: 只有主辦人可以接受報名
2. **狀態檢查**: 只能接受狀態為 "pending" 的報名
3. **人數限制**: 團局滿員時無法接受更多報名
4. **自動更新**: 達到人數上限時自動將團局狀態改為 "full"
5. **推送通知**: 接受報名後會發送推送通知給報名用戶
6. **不可撤銷**: 接受後無法直接撤銷，需要移除玩家

