# VAPID 金鑰 API

## 基本資訊

- **API 名稱**: VAPID 金鑰
- **Lambda 函數**: `Linebot_mahjongclub_web_vapid_key_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `GET /mahjongclub_web_vapid_key`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_vapid_key`

---

## 功能說明

獲取 VAPID 公鑰，用於訂閱 Web Push 通知。

---

## 請求格式

### HTTP Method
```
GET
```

### Headers
```
Content-Type: application/json
```

---

## 回應格式

### 成功回應 (200 OK)

```json
{
  "success": true,
  "publicKey": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM="
}
```

### 回應欄位說明

| 欄位 | 類型 | 說明 |
|------|------|------|
| `publicKey` | string | VAPID 公鑰 (Base64 編碼) |

---

## 請求範例

### cURL
```bash
curl -X GET "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_vapid_key" \
  -H "Content-Type: application/json"
```

### JavaScript (Fetch)
```javascript
async function getVapidPublicKey() {
  const response = await fetch(
    'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_vapid_key',
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
  
  const result = await response.json();
  if (result.success) {
    console.log('VAPID 公鑰:', result.publicKey);
    return result.publicKey;
  }
  return null;
}

// 使用範例：訂閱推送通知
async function subscribeToPush() {
  // 1. 獲取 VAPID 公鑰
  const publicKey = await getVapidPublicKey();
  if (!publicKey) {
    console.error('無法獲取 VAPID 公鑰');
    return;
  }
  
  // 2. 轉換為 Uint8Array
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  
  // 3. 訂閱推送
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey
  });
  
  console.log('推送訂閱成功:', subscription);
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
```

---

## 業務邏輯

1. **讀取環境變數**: 從環境變數讀取 VAPID 公鑰
2. **返回公鑰**: 返回 Base64 編碼的公鑰

---

## 注意事項

1. **公開資訊**: VAPID 公鑰是公開的，可以安全地暴露給客戶端
2. **必要步驟**: 訂閱 Web Push 前必須先獲取 VAPID 公鑰
3. **格式轉換**: 需要將 Base64 字串轉換為 Uint8Array 才能使用
4. **快取建議**: 可以快取公鑰，避免重複請求
5. **用途**: 僅用於 Web Push 訂閱，不用於其他用途

