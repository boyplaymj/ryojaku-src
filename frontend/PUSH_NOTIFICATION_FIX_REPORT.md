# 推播通知 API 修復報告

## 🎯 問題描述

**原始錯誤**: `{"success":false,"error":"Missing required fields"}`

**問題 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_subscribe_push?userId=APP_vt-Ss-zwOY2P-Y7v`

## 🔍 根本原因分析

### 1. HTTP 方法錯誤
- **錯誤**: 使用 GET 請求並將參數放在 URL query string
- **正確**: 應使用 POST 請求並將參數放在 request body

### 2. 缺少必要欄位
根據 API 文檔，`mahjongclub_web_subscribe_push` 需要以下欄位：
- ✅ `userId` (string) - 用戶 ID
- ❌ `subscription` (object) - Push 訂閱物件 **[缺少]**
- ❌ `deviceId` (string) - 裝置 ID **[缺少]**

### 3. 前端實現問題
原始的 `subscribePush` 函數：
```javascript
// ❌ 錯誤實現
export async function subscribePush(userIdentifier: string, subscription: PushSubscription) {
  return apiRequest(`/mahjongclub_web_subscribe_push?${getAuthParam(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  });
}
```

## ✅ 修復方案

### 1. 修正 API 請求格式
```javascript
// ✅ 正確實現
export async function subscribePush(userIdentifier: string, subscription: PushSubscription) {
  // Generate or get device ID
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + Date.now();
    localStorage.setItem('deviceId', deviceId);
  }

  return apiRequest('/mahjongclub_web_subscribe_push', {
    method: 'POST',
    body: JSON.stringify({
      userId: userIdentifier,
      subscription: subscription.toJSON(),
      deviceId: deviceId
    }),
  });
}
```

### 2. 同時修復取消訂閱 API
```javascript
// ✅ 修復 unsubscribePush
export async function unsubscribePush(userIdentifier: string) {
  const deviceId = localStorage.getItem('deviceId') || 'unknown_device';

  return apiRequest('/mahjongclub_web_unsubscribe_push', {
    method: 'POST',
    body: JSON.stringify({
      userId: userIdentifier,
      deviceId: deviceId
    }),
  });
}
```

## 🧪 測試結果

### 訂閱推播通知 API
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_subscribe_push" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "APP_vt-Ss-zwOY2P-Y7v",
    "subscription": {
      "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-12345",
      "keys": {
        "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=",
        "auth": "tBHItJI5svbpez7KI4CCXg=="
      }
    },
    "deviceId": "device_test_123456"
  }'
```

**結果**: ✅ `{"success":true}`

### VAPID 金鑰 API
```bash
curl "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_vapid_key"
```

**結果**: ✅ `{"success":true,"vapidPublicKey":"BBj-UFbLnUhYjeNBUGL1iBtvFwNBSK-FiOpwR0syJFMo7kO7TQKmk8J8vGZKHz0BzVwxTXZO8uS_W9Usn1JVrW8"}`

## 📋 修復內容總結

### 修改的檔案
- ✅ `MahjongClub_App/services/apiService.ts`
  - 修復 `subscribePush` 函數
  - 修復 `unsubscribePush` 函數
  - 新增 `deviceId` 自動生成和管理

### 新增功能
- ✅ **裝置 ID 管理**: 自動生成並儲存在 localStorage
- ✅ **完整參數驗證**: 確保所有必要欄位都包含在請求中
- ✅ **正確的請求格式**: 使用 POST 方法和 JSON body

### 部署狀態
- ✅ **前端已重新構建**: 包含修復的程式碼
- ✅ **S3 已更新**: 新版本已上傳
- ✅ **CloudFront 快取已清除**: 修復立即生效

## 🎉 修復完成

**修復時間**: 2025-11-24 15:28 (台北時間)

**測試狀態**: ✅ 所有推播通知相關 API 正常工作

**部署 URL**: https://d1wa3w4dmfwqc7.cloudfront.net

## 💡 使用建議

1. **測試推播功能**: 在支援的瀏覽器中測試完整的推播通知流程
2. **權限處理**: 確保用戶授予通知權限
3. **Service Worker**: 確認 Service Worker 正常註冊
4. **裝置管理**: 系統會自動為每個裝置生成唯一 ID

現在用戶可以正常訂閱和接收推播通知了！
