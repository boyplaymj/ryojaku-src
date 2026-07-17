# 獲取通知 API

## 基本資訊

- **API 名稱**: 獲取通知
- **Lambda 函數**: `Linebot_mahjongclub_web_notifications_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: `GET /mahjongclub_web_notifications` (獲取通知)
- **端點**: `POST /mahjongclub_web_notifications` (標記已讀)
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_notifications`

---

## 功能說明

獲取用戶的通知列表，或標記通知為已讀。支援分頁查詢。

---

## 1. 獲取通知列表

### HTTP Method
```
GET
```

### Query Parameters

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅ | 用戶 ID (APP_xxx 或 LINE ID) |
| `lastKey` | string | ❌ | 分頁游標 (用於獲取下一頁) |

> **⚠️ 注意**:
> - 每頁固定返回 5 筆通知
> - 使用 `lastKey` 進行分頁查詢
> - 此 API 使用 APIGatewayV2HTTPRequest (HTTP API),不是 APIGatewayProxyRequest (REST API)

### 成功回應 (200 OK)

```json
{
  "success": true,
  "notifications": [
    {
      "notificationId": "notif_xxxxxxxxxxxx",
      "userId": "APP_xxxxxxxxxxxx",
      "type": "registration",
      "title": "新的報名申請",
      "message": "李小華 想要參加您的團局「週末麻將聚會」",
      "gameId": "game_xxxxxxxxxxxx",
      "gameName": "週末麻將聚會",
      "fromUserId": "APP_yyyyyyyyyyyy",
      "fromUserName": "李小華",
      "isRead": false,
      "createdAt": 1732185600000,
      "expiresAt": 1734777600000
    }
  ],
  "unreadCount": 5,
  "hasMore": true,
  "lastKey": "notif_yyyyyyyyyyyy"
}
```

### 通知類型 (type)

| 類型 | 說明 |
|------|------|
| `registration` | 新的報名申請 |
| `approval` | 報名已被接受 |
| `rejection` | 報名已被拒絕 |
| `cancellation` | 團局已被取消 |
| `new_game` | 新團局通知 |
| `game_update` | 團局資訊更新 |

---

## 2. 標記通知為已讀

### HTTP Method
```
POST
```

### Request Body

```json
{
  "notificationId": "notif_xxxxxxxxxxxx"
}
```

### 成功回應 (200 OK)

```json
{
  "success": true
}
```

---

## 請求範例

### cURL - 獲取通知
```bash
curl -X GET "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_notifications?userId=APP_xxxxxxxxxxxx&limit=20" \
  -H "Content-Type: application/json"
```

### cURL - 標記已讀
```bash
curl -X POST "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_notifications" \
  -H "Content-Type: application/json" \
  -d '{
    "notificationId": "notif_xxxxxxxxxxxx"
  }'
```

### JavaScript (Fetch) - 獲取通知
```javascript
const userId = 'APP_xxxxxxxxxxxx';

const response = await fetch(
  `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_notifications?userId=${userId}&limit=20`,
  {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();
if (result.success) {
  console.log(`未讀通知: ${result.unreadCount}`);
  console.log(`通知列表:`, result.notifications);
  
  // 顯示通知
  result.notifications.forEach(notif => {
    const icon = notif.isRead ? '📭' : '📬';
    console.log(`${icon} ${notif.title}: ${notif.message}`);
  });
  
  // 如果有更多通知
  if (result.hasMore) {
    console.log('還有更多通知，使用 lastKey 獲取下一頁');
  }
}
```

### JavaScript (Fetch) - 標記已讀
```javascript
const notificationId = 'notif_xxxxxxxxxxxx';

const response = await fetch(
  'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_notifications',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      notificationId: notificationId
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log('通知已標記為已讀');
}
```

---

## 業務邏輯

### 獲取通知
1. **驗證用戶**: 確認用戶 ID 有效
2. **查詢通知**: 從 Notifications 表查詢用戶的通知
3. **分頁處理**: 支援分頁查詢，返回指定數量的通知
4. **統計未讀**: 計算未讀通知數量
5. **排序**: 按創建時間降序排列 (最新的在前)

### 標記已讀
1. **驗證通知**: 確認通知存在
2. **更新狀態**: 將 `isRead` 設為 true
3. **返回結果**: 確認操作成功

---

## 注意事項

1. **自動過期**: 通知有過期時間 (expiresAt)，過期後會自動刪除
2. **分頁查詢**: 使用 `lastKey` 進行分頁，避免一次載入過多通知
3. **未讀計數**: `unreadCount` 為當前未讀通知總數
4. **通知類型**: 根據 `type` 欄位顯示不同的圖示和樣式
5. **關聯資訊**: 包含團局和用戶的相關資訊，方便顯示
6. **即時更新**: 建議定期輪詢或使用 WebSocket 獲取最新通知

