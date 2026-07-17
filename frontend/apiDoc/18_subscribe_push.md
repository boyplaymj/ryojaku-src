# 訂閱推送通知 API

## 基本資訊

- **API 名稱**: 訂閱推送通知
- **Lambda 函數**: `Linebot_mahjongclub_web_subscribe_push_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `POST /mahjongclub_web_subscribe_push`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_subscribe_push`

---

## 功能說明

訂閱 Web Push 通知。用於接收瀏覽器推送通知。

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
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=",
      "auth": "tBHItJI5svbpez7KI4CCXg=="
    }
  },
  "deviceId": "device_xxxxxxxxxxxx"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅ | 用戶 ID |
| `subscription` | object | ✅ | Push 訂閱物件 |
| `subscription.endpoint` | string | ✅ | Push 服務端點 |
| `subscription.keys` | object | ✅ | 加密金鑰 |
| `subscription.keys.p256dh` | string | ✅ | 公鑰 |
| `subscription.keys.auth` | string | ✅ | 認證密鑰 |
| `deviceId` | string | ✅ | 裝置 ID (用於區分不同裝置) |

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
  "error": "Missing required fields (userId, endpoint, deviceId)"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to save subscription"
}
```

---

## 請求範例

### JavaScript (Service Worker)
```javascript
// 在 Service Worker 中訂閱推送
async function subscribeToPush(userId) {
  // 1. 請求通知權限
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('通知權限被拒絕');
    return;
  }
  
  // 2. 獲取 Service Worker 註冊
  const registration = await navigator.serviceWorker.ready;
  
  // 3. 獲取 VAPID 公鑰
  const vapidKeyResponse = await fetch(
    'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_vapid_key'
  );
  const { publicKey } = await vapidKeyResponse.json();
  
  // 4. 訂閱推送
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });
  
  // 5. 生成裝置 ID
  const deviceId = localStorage.getItem('deviceId') || generateDeviceId();
  localStorage.setItem('deviceId', deviceId);
  
  // 6. 發送訂閱資訊到伺服器
  const response = await fetch(
    'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_subscribe_push',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: userId,
        subscription: subscription.toJSON(),
        deviceId: deviceId
      })
    }
  );
  
  const result = await response.json();
  if (result.success) {
    console.log('推送訂閱成功！');
  }
}

// 輔助函數：將 Base64 轉換為 Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// 生成裝置 ID
function generateDeviceId() {
  return 'device_' + Math.random().toString(36).substr(2, 9) + Date.now();
}
```

---

## 業務邏輯

1. **驗證參數**: 確認所有必填欄位都已提供
2. **儲存訂閱**: 將訂閱資訊儲存到 PushSubscriptions 表
3. **設定過期**: 訂閱有效期為 90 天
4. **裝置管理**: 同一用戶可以有多個裝置訂閱
5. **更新訂閱**: 如果同一裝置重複訂閱，會更新訂閱資訊

---

## 注意事項

1. **VAPID 金鑰**: 需要先獲取 VAPID 公鑰 (使用 vapid_key API)
2. **通知權限**: 需要用戶授予通知權限
3. **Service Worker**: 需要註冊 Service Worker
4. **裝置 ID**: 用於區分同一用戶的不同裝置
5. **訂閱過期**: 訂閱 90 天後自動過期，需要重新訂閱
6. **HTTPS 要求**: Web Push 只能在 HTTPS 環境下使用

