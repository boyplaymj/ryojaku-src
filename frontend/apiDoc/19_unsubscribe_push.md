# 取消訂閱推送通知 API

## 基本資訊

- **API 名稱**: 取消訂閱推送通知
- **Lambda 函數**: `Linebot_mahjongclub_web_unsubscribe_push_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_unsubscribe_push`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_unsubscribe_push`

---

## 功能說明

取消 Web Push 通知訂閱。用於停止接收瀏覽器推送通知。

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
  "userId": "APP_xxxxxxxxxxxx",
  "deviceId": "device_xxxxxxxxxxxx"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅ | 用戶 ID |
| `deviceId` | string | ✅ | 裝置 ID |

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true
}
```

### 錯誤回應

#### 400 Bad Request
```json
{
  "success": false,
  "error": "Missing required fields (userId, deviceId)"
}
```

---

## 請求範例

### JavaScript
```javascript
async function unsubscribeFromPush(userId) {
  const deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    console.log('未找到裝置 ID');
    return;
  }
  
  const response = await fetch(
    'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_unsubscribe_push',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: userId,
        deviceId: deviceId
      })
    }
  );
  
  const result = await response.json();
  if (result.success) {
    console.log('已取消推送訂閱');
    localStorage.removeItem('deviceId');
  }
}
```

---

## 業務邏輯

1. **驗證參數**: 確認 userId 和 deviceId
2. **刪除訂閱**: 從 PushSubscriptions 表刪除訂閱記錄
3. **返回結果**: 確認操作成功

---

## 注意事項

1. **裝置特定**: 只會取消指定裝置的訂閱
2. **多裝置**: 如果用戶有多個裝置，其他裝置的訂閱不受影響
3. **本地清理**: 建議同時清除本地儲存的 deviceId

