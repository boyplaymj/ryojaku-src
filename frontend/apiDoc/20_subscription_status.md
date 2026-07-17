# 訂閱狀態 API

## 基本資訊

- **API 名稱**: 訂閱狀態
- **Lambda 函數**: `Linebot_mahjongclub_web_subscription_status_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `GET /mahjongclub_web_subscription_status`
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_subscription_status`

---

## 功能說明

檢查用戶的推送通知訂閱狀態。

---

## 請求格式

### HTTP Method
```
GET
```

### Query Parameters

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅ | 用戶 ID |
| `deviceId` | string | ✅ | 裝置 ID |

---

## 回應格式

### 成功回應 (200 OK) - 已訂閱

```json
{
  "success": true,
  "subscribed": true,
  "subscription": {
    "userId": "APP_xxxxxxxxxxxx",
    "deviceId": "device_xxxxxxxxxxxx",
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "createdAt": 1732185600000,
    "updatedAt": 1732185600000,
    "expiresAt": 1739961600000
  }
}
```

### 成功回應 (200 OK) - 未訂閱

```json
{
  "success": true,
  "subscribed": false
}
```

---

## 請求範例

### JavaScript
```javascript
async function checkSubscriptionStatus(userId) {
  const deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    console.log('未找到裝置 ID');
    return false;
  }
  
  const response = await fetch(
    `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_subscription_status?userId=${userId}&deviceId=${deviceId}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
  
  const result = await response.json();
  if (result.success) {
    if (result.subscribed) {
      console.log('已訂閱推送通知');
      console.log('訂閱到期時間:', new Date(result.subscription.expiresAt));
    } else {
      console.log('未訂閱推送通知');
    }
    return result.subscribed;
  }
  return false;
}
```

---

## 業務邏輯

1. **驗證參數**: 確認 userId 和 deviceId
2. **查詢訂閱**: 從 PushSubscriptions 表查詢訂閱記錄
3. **檢查過期**: 確認訂閱是否已過期
4. **返回狀態**: 返回訂閱狀態和詳細資訊

---

## 注意事項

1. **過期檢查**: 會自動檢查訂閱是否過期
2. **裝置特定**: 查詢特定裝置的訂閱狀態
3. **用途**: 用於判斷是否需要重新訂閱

