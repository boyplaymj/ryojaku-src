# API 文檔驗證完整報告

## 檢查日期: 2025-11-21

本文檔列出所有 24 個 MahjongClub API 的驗證結果,基於實際程式碼檢查。

---

## ✅ 驗證完成 - 所有 24 個 API 已檢查

### 認證相關 (3個)
1. ✅ **API 01 (app_register)** - 已驗證正確
2. ✅ **API 02 (app_login)** - 已驗證正確
3. ✅ **API 03 (verify_user)** - 已驗證正確

### 團局管理 (5個)
4. ⚠️ **API 04 (create_game)** - 需要修正
5. ⚠️ **API 05 (search_games)** - 需要修正
6. ⚠️ **API 06 (game_detail)** - 需要修正
7. ✅ **API 07 (my_games)** - 已驗證正確
8. ✅ **API 08 (cancel_game)** - 已驗證正確

### 報名管理 (3個)
9. ✅ **API 09 (register_game)** - 已驗證正確
10. ✅ **API 10 (accept_registration)** - 已驗證正確
11. ✅ **API 11 (reject_registration)** - 已驗證正確

### 用戶資料 (2個)
12. ✅ **API 12 (user_profile)** - 已驗證正確
13. ✅ **API 13 (user_info)** - 已驗證正確

### 評分系統 (3個)
14. ⚠️ **API 14 (get_ratings)** - 需要修正
15. ⚠️ **API 15 (submit_rating)** - 需要修正
16. ✅ **API 16 (user_comments)** - 已驗證正確

### 通知系統 (1個)
17. ⚠️ **API 17 (notifications)** - 需要修正

### 推送通知 (4個)
18. ✅ **API 18 (subscribe_push)** - 已驗證正確
19. ✅ **API 19 (unsubscribe_push)** - 已驗證正確
20. ✅ **API 20 (subscription_status)** - 已驗證正確
21. ✅ **API 21 (vapid_key)** - 已驗證正確

### 管理功能 (3個)
22. ⚠️ **API 22 (analytics)** - 需要修正
23. ⚠️ **API 23 (event_commands)** - 需要修正
24. ⚠️ **API 24 (redeem)** - 需要修正

---

## ⚠️ 需要修正的 API 詳細說明

### API 04 (create_game)
**問題**:
- `rules`, `features`, `restrictions` 參數在代碼中接收為 string 類型,但文檔中標示為陣列
- 實際代碼: `Rules string`, `Features string`, `Restrictions string`

### API 05 (search_games)
**問題**:
- HTTP Method 應為 GET,不是 POST
- 使用 Query Parameters,不是 Request Body
- 參數: `type`, `latitude`, `longitude`, `radius`

### API 06 (game_detail)
**問題**:
- HTTP Method 應為 POST,不是 GET
- Request Body 包含: `lineID` (可選), `gameId` (必填)

### API 14 (get_ratings)
**問題**:
- HTTP Method 應為 GET,不是 POST
- Query Parameters: `gameId`, `userId` 或 `lineID`

### API 15 (submit_rating)
**問題**:
- Request Body 中 `lineID` 欄位在 APP 用戶中不需要
- 應該支援 Query Parameter `userId` 或 Request Body `lineID`

### API 17 (notifications)
**問題**:
- 使用 APIGatewayV2HTTPRequest,不是 APIGatewayProxyRequest
- GET 請求支援分頁: `userId`, `lastKey` (可選)
- POST 請求用於標記已讀: `notificationId`

### API 22 (analytics)
**問題**:
- 這是一個多端點 API,有多個子路徑
- 需要列出所有子端點

### API 23 (event_commands)
**問題**:
- 這是一個多端點 API,有多個子路徑
- 需要列出所有子端點

### API 24 (redeem)
**問題**:
- 這是一個多端點 API,有多個子路徑
- 需要列出所有子端點

---

## 📊 統計摘要

- **總 API 數**: 24
- **已驗證正確**: 15 (62.5%)
- **需要修正**: 9 (37.5%)

---

## 🔍 驗證方法

所有驗證都基於實際 Lambda 函數源代碼:
1. 查看 Request 結構體定義
2. 查看 Response 結構體定義
3. 查看實際的業務邏輯
4. 確認 HTTP Method 和參數位置
5. 不添加任何猜測或假設的內容

---

## ⚠️ 重要原則

- ✅ 只記錄實際存在於代碼中的參數
- ✅ 只記錄實際返回的欄位
- ❌ 不添加任何猜測的內容
- ❌ 不添加任何假設的欄位
- ❌ 不修改程式邏輯

