# 拒絕報名 API

## 基本資訊

- **API 名稱**: 拒絕報名
- **Lambda 函數**: `Linebot_mahjongclub_web_reject_registration_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_reject_registration`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_reject_registration`

---

## 功能說明

主辦人拒絕用戶的報名申請，將報名狀態從 "pending" 改為 "rejected"，並退還 20 點數給報名用戶。

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
  "registrationId": "REG_1732196400_def456",
  "reason": "抱歉，這次團局已經有其他人了"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `registrationId` | string | ✅ | 報名 ID |
| `reason` | string | ❌ | 拒絕原因 |

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "registrationId": "REG_1732196400_def456",
    "status": "rejected",
    "pointsRefunded": 20
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
  "error": "Only host can reject registrations"
}
```

#### 404 Not Found - 報名不存在
```json
{
  "success": false,
  "error": "Registration not found"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to reject registration"
}
```

---

## 請求範例

### cURL - APP 用戶
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_reject_registration?userId=APP_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "registrationId": "REG_1732196400_def456",
    "reason": "抱歉，這次團局已經有其他人了"
  }'
```

### JavaScript (Fetch)
```javascript
const userId = 'APP_xxxxxxxxxxxx'; // 主辦人 ID
const isAppUser = userId.startsWith('APP_');
const paramName = isAppUser ? 'userId' : 'lineID';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_reject_registration?${paramName}=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      registrationId: 'REG_1732196400_def456',
      reason: '抱歉，這次團局已經有其他人了'
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log('已拒絕報名');
  console.log('已退還點數:', result.data.pointsRefunded);
}
```

---

## 業務邏輯

1. **驗證主辦人**: 確認操作者是團局的主辦人
2. **檢查報名**: 確認報名存在且狀態為 "pending"
3. **更新報名**: 將報名狀態改為 "rejected"，記錄拒絕原因
4. **退還點數**: 將 20 點數退還給報名用戶
5. **發送通知**: 通知報名用戶已被拒絕（包含原因）
6. **返回結果**: 包含更新後的報名資訊和退還點數

---

## 注意事項

1. **權限檢查**: 只有主辦人可以拒絕報名
2. **狀態檢查**: 只能拒絕狀態為 "pending" 的報名
3. **點數退還**: 拒絕報名會自動退還 20 點數
4. **拒絕原因**: 建議提供拒絕原因，讓用戶了解情況
5. **推送通知**: 拒絕報名後會發送推送通知給報名用戶
6. **不可撤銷**: 拒絕後無法直接撤銷

