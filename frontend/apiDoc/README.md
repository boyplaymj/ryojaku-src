# MahjongClub API 文檔

> 📚 **完整的 MahjongClub API 串接文檔**
> 包含所有 24 個 API 的詳細說明、範例代碼和資料結構

---

## 📖 快速導航

- [📋 所有 API 總覽](./ALL_APIS_SUMMARY.md) - 24 個 API 的基本資訊
- [⚡ API 快速參考](./API_QUICK_REFERENCE.md) - 快速查詢表和常用資訊
- [📊 文檔狀態](./DOCUMENTATION_STATUS.md) - 完成度追蹤和待辦事項
- [✅ 完成報告](./COMPLETION_REPORT.md) - 詳細的完成報告

---

## API Gateway 資訊

- **API 名稱**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **區域**: `ap-southeast-1` (新加坡)
- **Base URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com`

---

## API 列表

### 🔐 認證相關 (Authentication)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| APP 用戶註冊 | `/mahjongclub_app_register` | POST | 註冊新的 APP 用戶 | [📄](./01_app_register.md) |
| APP 用戶登入 | `/mahjongclub_app_login` | POST | APP 用戶登入 | [📄](./02_app_login.md) |
| 驗證用戶 | `/mahjongclub_web_verify_user` | POST | 驗證用戶身份 | [📄](./03_verify_user.md) |

### 🎮 團局管理 (Game Management)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 創建團局 | `/mahjongclub_web_create_game` | POST | 創建新的麻將團局 | [📄](./04_create_game.md) |
| 搜尋團局 | `/mahjongclub_web_search_games` | POST | 搜尋可用的團局 | [📄](./05_search_games.md) |
| 團局詳情 | `/mahjongclub_web_game_detail` | GET | 獲取團局詳細資訊 | [📄](./06_game_detail.md) |
| 我的團局 | `/mahjongclub_web_my_games` | POST | 獲取我創建和參加的團局 | [📄](./07_my_games.md) |
| 取消團局 | `/mahjongclub_web_cancel_game` | POST | 取消團局 | [📄](./08_cancel_game.md) |

### 👥 報名管理 (Registration Management)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 報名團局 | `/mahjongclub_web_register` | POST | 報名參加團局 | [📄](./09_register_game.md) |
| 接受報名 | `/mahjongclub_web_accept_registration` | POST | 接受報名申請 | [📄](./10_accept_registration.md) |
| 拒絕報名 | `/mahjongclub_web_reject_registration` | POST | 拒絕報名申請 | [📄](./11_reject_registration.md) |

### 👤 用戶資料 (User Profile)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 用戶資料 | `/mahjongclub_web_user_profile` | POST | 獲取/更新用戶資料 | [📄](./12_user_profile.md) |
| 用戶資訊 | `/mahjongclub_web_user_info` | POST | 獲取用戶公開資訊 | [📄](./13_user_info.md) |

### ⭐ 評分系統 (Rating System)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 獲取評分 | `/mahjongclub_web_get_ratings` | POST | 獲取用戶評分記錄 | [📄](./14_get_ratings.md) |
| 提交評分 | `/mahjongclub_web_submit_rating` | POST | 提交評分和評論 | [📄](./15_submit_rating.md) |
| 用戶評論 | `/mahjongclub_web_user_comments` | POST | 獲取用戶評論列表 | [📄](./16_user_comments.md) |

### 🔔 通知系統 (Notification System)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 獲取通知 | `/mahjongclub_web_notifications` | GET/POST | 獲取通知/標記已讀 | [📄](./17_notifications.md) |

### 📱 推送通知 (Push Notifications)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 訂閱推送 | `/mahjongclub_web_subscribe_push` | POST | 訂閱 Web Push 通知 | [📄](./18_subscribe_push.md) |
| 取消訂閱 | `/mahjongclub_web_unsubscribe_push` | POST | 取消推送訂閱 | [📄](./19_unsubscribe_push.md) |
| 訂閱狀態 | `/mahjongclub_web_subscription_status` | GET | 查詢訂閱狀態 | [📄](./20_subscription_status.md) |
| VAPID 金鑰 | `/mahjongclub_web_vapid_key` | GET | 獲取 VAPID 公鑰 | [📄](./21_vapid_key.md) |

### 📊 管理功能 (Admin Features)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 分析數據 | `/analytics/*` | GET | 系統分析數據 | [📄](./22_analytics.md) |
| 事件命令 | `/event-commands/*` | GET/POST/PUT/DELETE | 管理活動命令 | [📄](./23_event_commands.md) |
| 兌換點數 | `/redeem/*` | GET/POST | 兌換碼管理 | [📄](./24_redeem.md) |
| 接受報名 | `/mahjongclub_web_accept_registration` | POST | 主辦人接受報名 | [📄](./10_accept_registration.md) |
| 拒絕報名 | `/mahjongclub_web_reject_registration` | POST | 主辦人拒絕報名 | [📄](./11_reject_registration.md) |

### 👤 用戶資料 (User Profile)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 用戶資料 | `/mahjongclub_web_user_profile` | POST | 獲取/更新用戶資料 | [📄](./12_user_profile.md) |
| 用戶資訊 | `/mahjongclub_web_user_info` | GET | 獲取用戶基本資訊 | [📄](./13_user_info.md) |

### ⭐ 評分系統 (Rating System)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 獲取評分 | `/mahjongclub_web_get_ratings` | POST | 獲取用戶評分列表 | [📄](./14_get_ratings.md) |
| 提交評分 | `/mahjongclub_web_submit_rating` | POST | 提交用戶評分 | [📄](./15_submit_rating.md) |
| 用戶評論 | `/mahjongclub_web_user_comments` | GET | 獲取用戶評論 | [📄](./16_user_comments.md) |

### 🔔 通知系統 (Notification System)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 獲取通知 | `/mahjongclub_web_notifications` | GET | 獲取用戶通知列表 | [📄](./17_notifications.md) |
| 訂閱推送 | `/mahjongclub_web_subscribe_push` | POST | 訂閱推送通知 | [📄](./18_subscribe_push.md) |
| 取消訂閱 | `/mahjongclub_web_unsubscribe_push` | POST | 取消推送通知訂閱 | [📄](./19_unsubscribe_push.md) |
| 訂閱狀態 | `/mahjongclub_web_subscription_status` | GET | 查詢訂閱狀態 | [📄](./20_subscription_status.md) |
| VAPID 金鑰 | `/mahjongclub_web_vapid_key` | GET | 獲取 VAPID 公鑰 | [📄](./21_vapid_key.md) |

### 📊 其他功能 (Others)

| API | 端點 | 方法 | 說明 | 文檔 |
|-----|------|------|------|------|
| 分析數據 | `/mahjongclub_analytics` | POST | 獲取分析數據 | [📄](./22_analytics.md) |
| 事件命令 | `/mahjongclub_event_commands` | POST | 處理事件命令 | [📄](./23_event_commands.md) |
| 兌換點數 | `/mahjongclub-redeem` | POST | 兌換點數 | [📄](./24_redeem.md) |

---

## 認證方式

所有 API 支援兩種用戶認證方式：

### 1. APP 用戶
使用 `userId` 查詢參數：
```
POST /mahjongclub_web_xxx?userId=APP_xxxxxxxxxxxx
```

### 2. LINE Bot 用戶
使用 `lineID` 查詢參數（加密的 LINE ID）：
```
POST /mahjongclub_web_xxx?lineID=<encrypted_line_id>
```

---

## 通用回應格式

### 成功回應
```json
{
  "success": true,
  "data": { ... }
}
```

### 錯誤回應
```json
{
  "success": false,
  "error": "錯誤訊息"
}
```

---

## HTTP 狀態碼

| 狀態碼 | 說明 |
|--------|------|
| 200 | 請求成功 |
| 400 | 請求參數錯誤 |
| 401 | 未授權/認證失敗 |
| 403 | 禁止訪問 |
| 404 | 資源不存在 |
| 409 | 資源衝突 |
| 500 | 伺服器內部錯誤 |

---

## CORS 設定

所有 API 都已啟用 CORS，支援跨域請求：
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

---

## 資料庫表格

### DynamoDB 表格列表

| 表格名稱 | 主鍵 | GSI | 說明 |
|---------|------|-----|------|
| `MahjongClub_Users` | userId | email-index | 用戶資料 |
| `MahjongClub_Games` | gameId | status-createdAt-index | 團局資料 |
| `MahjongClub_Registrations` | registrationId | gameId-index, userId-index | 報名記錄 |
| `MahjongClub_Notifications` | notificationId | userId-createdAt-index | 通知記錄 |
| `MahjongClub_RatingComments` | commentId | targetUserId-index | 評分評論 |

---

## 選項欄位值

### 性別 (Gender)
- `男`
- `女`
- `其他`

### 年齡範圍 (Age Range)
- `18-25`
- `26-35`
- `36-45`
- `46-55`
- `56+`

### 麻將經驗 (Mahjong Experience)
- `新手`
- `初級`
- `中級`
- `高級`
- `專家`

### 團局類型 (Game Type)
- `臨時揪團` (固定值)

### 團局狀態 (Game Status)
- `recruiting` - 招募中
- `full` - 已滿
- `in_progress` - 進行中
- `completed` - 已完成
- `cancelled` - 已取消

### 報名狀態 (Registration Status)
- `pending` - 待審核
- `accepted` - 已接受
- `rejected` - 已拒絕
- `cancelled` - 已取消

---

## 測試工具

推薦使用以下工具測試 API：
- **Postman**: 圖形化 API 測試工具
- **cURL**: 命令列工具
- **瀏覽器開發者工具**: 查看網路請求

---

## 更新日誌

- **2025-11-21**: 初始版本，支援 APP 和 LINE Bot 雙平台用戶

