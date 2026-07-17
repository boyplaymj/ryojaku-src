# API 使用情況完整報告

## 📊 總覽

本報告詳細列出 MahjongClub_App 中每個頁面使用的 API，以及 apiDoc 中 24 個 API 的實際應用情況。

---

## 🎯 頁面 API 使用情況

### 1. **Login.tsx** (登入頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_app_register` - 註冊新用戶
- ✅ `POST /mahjongclub_app_login` - Email/Password 登入
- ✅ `POST /mahjongclub_web_verify_user` - LINE ID 登入驗證

**觸發時機:**
- 用戶點擊「註冊」按鈕 → 呼叫 `registerUser()`
- 用戶使用 Email/Password 登入 → 呼叫 `loginUser()`
- 用戶使用 LINE ID 登入 → 呼叫 `verifyUser()`

---

### 2. **Home.tsx** (首頁)
**使用的 API:**
- ❌ 無直接 API 呼叫（僅顯示用戶資料）

**說明:**
- 首頁僅展示用戶資訊和統計數據
- 資料來自 localStorage 的用戶 session

---

### 3. **Search.tsx** (搜尋頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_web_search_games` - 搜尋團局

**觸發時機:**
- 頁面載入時 → 呼叫 `api.getEvents()` 取得所有團局
- 切換「全部」/「附近」標籤 → 重新呼叫搜尋 API
- 輸入關鍵字搜尋 → 前端過濾（不呼叫 API）

**參數:**
- `type`: "all" 或 "nearby"
- `latitude`, `longitude`: GPS 座標（附近搜尋時）
- `radius`: 搜尋半徑（預設 5 公里）

---

### 4. **CreateGroup.tsx** (創建團局頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_web_create_game` - 創建新團局

**觸發時機:**
- 用戶填寫表單並點擊「發起團局」→ 呼叫 `createGame()`

**傳送資料:**
```javascript
{
  gameType: "基本三將",
  placeName: "板橋滿雅",
  location: "完整地址",
  latitude: 25.033964,
  longitude: 121.565427,
  needPlayers: 1-3,
  stakes: "100/20",
  startTime: "2024-11-24T14:00:00.000Z",
  rules: "額外規則說明",
  features: "有冷氣, 有停車位",
  restrictions: "新手友善"
}
```

---

### 5. **MyEvents.tsx** (我的團局頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_web_my_games` - 取得我的團局

**觸發時機:**
- 頁面載入時 → 呼叫 `api.getMyGames()`
- 下拉刷新時 → 重新呼叫 API

**回傳資料:**
- `createdGames`: 我創建的團局
- `joinedGames`: 我參加的團局

---

### 6. **EventDetail.tsx** (團局詳情頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_web_game_detail` - 取得團局詳情
- ✅ `POST /mahjongclub_web_register` - 報名團局
- ✅ `POST /mahjongclub_web_accept_registration` - 接受報名
- ✅ `POST /mahjongclub_web_reject_registration` - 拒絕報名

**觸發時機:**
- 頁面載入時 → 呼叫 `getGameDetail(gameId)`
- 用戶點擊「立即報名」→ 呼叫 `registerGame()`
- 主辦人點擊「接受」→ 呼叫 `acceptRegistration()`
- 主辦人點擊「拒絕」→ 呼叫 `rejectRegistration()`

---

### 7. **ManageGame.tsx** (管理團局頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_web_game_detail` - 取得團局詳情
- ✅ `POST /mahjongclub_web_accept_registration` - 接受報名
- ✅ `POST /mahjongclub_web_reject_registration` - 拒絕報名
- ✅ `POST /mahjongclub_web_cancel_game` - 取消團局

**觸發時機:**
- 頁面載入時 → 呼叫 `getGameDetail()`
- 主辦人接受報名 → 呼叫 `acceptRegistration()`
- 主辦人拒絕報名 → 呼叫 `rejectRegistration()`
- 主辦人取消團局 → 呼叫 `cancelGame()`

---

### 8. **Notifications.tsx** (通知頁面)
**使用的 API:**
- ✅ `GET /mahjongclub_web_notifications` - 取得通知列表
- ✅ `POST /mahjongclub_web_notifications` - 標記通知為已讀

**觸發時機:**
- 頁面載入時 → 呼叫 `getNotifications(userId)`
- 每 30 秒輪詢 → 自動呼叫 API 檢查新通知
- 滾動到底部 → 呼叫 API 載入更多（分頁）
- 點擊「標記已讀」→ 呼叫 `markNotificationAsRead()`

**分頁參數:**
- `userId`: 用戶 ID
- `limit`: 每頁數量（預設 20）
- `lastKey`: 分頁游標

---

### 9. **Profile.tsx** (個人資料頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_web_user_profile` - 更新用戶資料
- ✅ `POST /mahjongclub_web_subscribe_push` - 訂閱推播
- ✅ `POST /mahjongclub_web_unsubscribe_push` - 取消訂閱
- ✅ `GET /mahjongclub_web_vapid_key` - 取得 VAPID 公鑰

**觸發時機:**
- 用戶編輯資料並儲存 → 呼叫 `updateUserProfile()`
- 用戶開啟推播通知 → 呼叫 `getVapidKey()` + `subscribePush()`
- 用戶關閉推播通知 → 呼叫 `unsubscribePush()`

---

### 10. **RateGame.tsx** (評分團局頁面)
**使用的 API:**
- ✅ `POST /mahjongclub_web_game_detail` - 取得團局詳情
- ✅ `POST /mahjongclub_web_get_ratings` - 取得評分列表
- ✅ `POST /mahjongclub_web_submit_rating` - 提交評分

**觸發時機:**
- 頁面載入時 → 呼叫 `getGameDetail()` + `getRatings()`
- 用戶提交評分 → 呼叫 `submitRating()`

---

### 11. **RateUser.tsx** (評分用戶頁面)
**使用的 API:**
- ✅ `GET /mahjongclub_web_user_info` - 取得用戶資訊
- ✅ `POST /mahjongclub_web_game_detail` - 取得團局詳情
- ✅ `POST /mahjongclub_web_submit_rating` - 提交評分

**觸發時機:**
- 頁面載入時 → 呼叫 `getUserInfo(toUserId)` + `getGameDetail(gameId)`
- 用戶提交評分 → 呼叫 `submitRating()`

**URL 參數:**
- `gameId`: 團局 ID
- `toUserId`: 被評分的用戶 ID

---

### 12. **UserReviews.tsx** (用戶評價頁面)
**使用的 API:**
- ✅ `GET /mahjongclub_web_user_info` - 取得用戶資訊
- ✅ `GET /mahjongclub_web_user_comments` - 取得用戶評論

**觸發時機:**
- 頁面載入時 → 呼叫 `getUserInfo(userId)` + `getUserComments(userId)`

---

## 📋 apiDoc 中 24 個 API 的使用狀況

### ✅ **已使用的 API (17 個)**

| # | API 名稱 | 端點 | 使用頁面 | 觸發時機 |
|---|---------|------|---------|---------|
| 1 | APP 用戶註冊 | `POST /mahjongclub_app_register` | Login.tsx | 用戶註冊 |
| 2 | APP 用戶登入 | `POST /mahjongclub_app_login` | Login.tsx | Email/Password 登入 |
| 3 | 驗證用戶 | `POST /mahjongclub_web_verify_user` | Login.tsx | LINE ID 登入 |
| 4 | 創建團局 | `POST /mahjongclub_web_create_game` | CreateGroup.tsx | 發起新團局 |
| 5 | 搜尋團局 | `POST /mahjongclub_web_search_games` | Search.tsx | 搜尋/瀏覽團局 |
| 6 | 團局詳情 | `POST /mahjongclub_web_game_detail` | EventDetail.tsx, ManageGame.tsx, RateGame.tsx | 查看團局詳情 |
| 7 | 我的團局 | `POST /mahjongclub_web_my_games` | MyEvents.tsx | 查看我的團局 |
| 8 | 取消團局 | `POST /mahjongclub_web_cancel_game` | ManageGame.tsx | 主辦人取消團局 |
| 9 | 報名團局 | `POST /mahjongclub_web_register` | EventDetail.tsx | 用戶報名 |
| 10 | 接受報名 | `POST /mahjongclub_web_accept_registration` | EventDetail.tsx, ManageGame.tsx | 主辦人接受報名 |
| 11 | 拒絕報名 | `POST /mahjongclub_web_reject_registration` | EventDetail.tsx, ManageGame.tsx | 主辦人拒絕報名 |
| 12 | 用戶資料 | `POST /mahjongclub_web_user_profile` | Profile.tsx | 更新個人資料 |
| 13 | 用戶資訊 | `GET /mahjongclub_web_user_info` | UserReviews.tsx | 查看用戶資訊 |
| 14 | 獲取評分 | `POST /mahjongclub_web_get_ratings` | RateGame.tsx | 查看評分列表 |
| 15 | 提交評分 | `POST /mahjongclub_web_submit_rating` | RateGame.tsx, RateUser.tsx | 提交評分 |
| 16 | 用戶評論 | `GET /mahjongclub_web_user_comments` | UserReviews.tsx | 查看用戶評論 |
| 17 | 獲取通知 | `GET /mahjongclub_web_notifications` | Notifications.tsx | 查看通知列表 |
| 18 | 標記已讀 | `POST /mahjongclub_web_notifications` | Notifications.tsx | 標記通知為已讀 |
| 19 | 訂閱推播 | `POST /mahjongclub_web_subscribe_push` | Profile.tsx | 開啟推播通知 |
| 20 | 取消訂閱 | `POST /mahjongclub_web_unsubscribe_push` | Profile.tsx | 關閉推播通知 |
| 21 | VAPID 公鑰 | `GET /mahjongclub_web_vapid_key` | Profile.tsx | 訂閱推播前取得公鑰 |

---

### ❌ **未使用的 API (3 個)**

| # | API 名稱 | 端點 | 狀態 | 說明 |
|---|---------|------|------|------|
| 22 | 訂閱狀態 | `GET /mahjongclub_web_subscription_status` | ⚠️ 已實作但未使用 | 在 `notificationService.ts` 中有實作，但被註解掉 |
| 23 | 數據分析 | `POST /mahjongclub_web_analytics` | ❌ 未實作 | apiDoc 中有文檔，但程式碼中未使用 |
| 24 | 兌換功能 | `POST /mahjongclub_web_redeem` | ❌ 未實作 | apiDoc 中有文檔，但程式碼中未使用 |

---

## ⚠️ 發現的問題

### 1. **HTTP Method 不一致**
**問題:**
- `apiDoc/05_search_games.md` 文檔顯示應使用 **GET** 方法
- `services/apiService.ts` 第 127-129 行實際使用 **POST** 方法

**位置:**
```typescript
// services/apiService.ts:127-129
export const searchGames = async (params: SearchGamesParams = {}): Promise<SearchGamesResponse> => {
    return apiRequest<SearchGamesResponse>('/mahjongclub_web_search_games', 'POST', params);
};
```

**建議:**
- 確認後端實際接受的 HTTP 方法
- 統一文檔與程式碼的實作

---

### 2. **Localhost Mock Data**
**說明:**
- 當應用在 localhost 運行時，部分 API 會返回 mock data
- 影響的 API:
  - `searchGames()` - 返回 `MOCK_GAMES`
  - `getMyGames()` - 返回 `MOCK_MY_GAMES`
  - `getNotifications()` - 返回 `MOCK_NOTIFICATIONS`

**位置:**
```typescript
// services/apiService.ts
const isLocalhost = () => {
    return window.location.hostname === 'localhost' ||
           window.location.hostname === '127.0.0.1';
};
```

---

### 3. **未使用的 API 功能**

#### 3.1 訂閱狀態檢查 (subscription_status)
- **狀態:** 已實作但被註解
- **位置:** `services/notificationService.ts`
- **建議:** 可以啟用此功能來檢查用戶的推播訂閱狀態

#### 3.2 數據分析 (analytics)
- **狀態:** 未實作
- **用途:** 記錄用戶行為、頁面瀏覽等數據
- **建議:** 如需追蹤用戶行為，可實作此 API

#### 3.3 兌換功能 (redeem)
- **狀態:** 未實作
- **用途:** 積分兌換、優惠券等功能
- **建議:** 如需積分系統，可實作此 API

---

## 📊 統計摘要

- **總 API 數量:** 24 個
- **已使用:** 21 個 (87.5%)
- **未使用:** 3 個 (12.5%)
- **總頁面數:** 12 個
- **有 API 呼叫的頁面:** 11 個

---

## 🔍 API 呼叫流程圖

### 用戶註冊/登入流程
```
Login.tsx
  ├─ 註冊 → POST /mahjongclub_app_register
  ├─ Email登入 → POST /mahjongclub_app_login
  └─ LINE登入 → POST /mahjongclub_web_verify_user
```

### 團局管理流程
```
Search.tsx → POST /mahjongclub_web_search_games
  ↓
EventDetail.tsx
  ├─ 查看詳情 → POST /mahjongclub_web_game_detail
  ├─ 報名 → POST /mahjongclub_web_register
  ├─ 接受報名 → POST /mahjongclub_web_accept_registration
  └─ 拒絕報名 → POST /mahjongclub_web_reject_registration
  ↓
ManageGame.tsx
  ├─ 管理報名 → POST /mahjongclub_web_accept_registration
  │            → POST /mahjongclub_web_reject_registration
  └─ 取消團局 → POST /mahjongclub_web_cancel_game
```

### 評分流程
```
RateGame.tsx
  ├─ 取得團局 → POST /mahjongclub_web_game_detail
  ├─ 取得評分 → POST /mahjongclub_web_get_ratings
  └─ 提交評分 → POST /mahjongclub_web_submit_rating
  ↓
UserReviews.tsx
  ├─ 用戶資訊 → GET /mahjongclub_web_user_info
  └─ 用戶評論 → GET /mahjongclub_web_user_comments
```

---

## ✅ 結論

1. **API 覆蓋率良好:** 87.5% 的 API 已被使用
2. **頁面功能完整:** 所有主要功能頁面都有正確的 API 呼叫
3. **需要修正:** HTTP Method 不一致問題需要確認
4. **可選功能:** 3 個未使用的 API 可視需求實作

---

## 📝 建議

1. **修正 HTTP Method 不一致問題**
   - 確認 `search_games` API 的正確 HTTP 方法
   - 統一文檔與程式碼

2. **啟用訂閱狀態檢查**
   - 取消 `notificationService.ts` 中的註解
   - 在 Profile 頁面顯示訂閱狀態

3. **考慮實作數據分析**
   - 追蹤用戶行為
   - 優化產品體驗

4. **移除 Mock Data (生產環境)**
   - 確保生產環境不使用 mock data
   - 或使用環境變數控制

---

**報告生成時間:** 2024-11-24
**版本:** 1.0

