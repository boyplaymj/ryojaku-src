# 📊 MahjongClub_App API 使用情況總結

## 🎯 快速總覽

- **總 API 數量:** 24 個
- **已使用:** 21 個 (87.5%)
- **未使用:** 3 個 (12.5%)
- **總頁面數:** 12 個
- **有 API 呼叫的頁面:** 11 個

---

## ✅ 已使用的 API (21 個)

### 1️⃣ 認證相關 (3 個)
| API | 端點 | 頁面 | 觸發時機 |
|-----|------|------|---------|
| APP 用戶註冊 | `POST /mahjongclub_app_register` | Login.tsx | 用戶點擊註冊 |
| APP 用戶登入 | `POST /mahjongclub_app_login` | Login.tsx | Email/Password 登入 |
| 驗證用戶 | `POST /mahjongclub_web_verify_user` | Login.tsx | LINE ID 登入 |

### 2️⃣ 團局管理 (5 個)
| API | 端點 | 頁面 | 觸發時機 |
|-----|------|------|---------|
| 創建團局 | `POST /mahjongclub_web_create_game` | CreateGroup.tsx | 發起新團局 |
| 搜尋團局 | `POST /mahjongclub_web_search_games` | Search.tsx | 搜尋/瀏覽團局 |
| 團局詳情 | `POST /mahjongclub_web_game_detail` | EventDetail.tsx, ManageGame.tsx, RateGame.tsx, RateUser.tsx | 查看團局詳情 |
| 我的團局 | `POST /mahjongclub_web_my_games` | MyEvents.tsx | 查看我的團局 |
| 取消團局 | `POST /mahjongclub_web_cancel_game` | ManageGame.tsx | 主辦人取消團局 |

### 3️⃣ 報名管理 (3 個)
| API | 端點 | 頁面 | 觸發時機 |
|-----|------|------|---------|
| 報名團局 | `POST /mahjongclub_web_register` | EventDetail.tsx | 用戶報名 |
| 接受報名 | `POST /mahjongclub_web_accept_registration` | EventDetail.tsx, ManageGame.tsx | 主辦人接受報名 |
| 拒絕報名 | `POST /mahjongclub_web_reject_registration` | EventDetail.tsx, ManageGame.tsx | 主辦人拒絕報名 |

### 4️⃣ 用戶資料 (2 個)
| API | 端點 | 頁面 | 觸發時機 |
|-----|------|------|---------|
| 用戶資料 | `POST /mahjongclub_web_user_profile` | Profile.tsx | 更新個人資料 |
| 用戶資訊 | `GET /mahjongclub_web_user_info` | UserReviews.tsx, RateUser.tsx | 查看用戶資訊 |

### 5️⃣ 評分系統 (3 個)
| API | 端點 | 頁面 | 觸發時機 |
|-----|------|------|---------|
| 獲取評分 | `POST /mahjongclub_web_get_ratings` | RateGame.tsx | 查看評分列表 |
| 提交評分 | `POST /mahjongclub_web_submit_rating` | RateGame.tsx, RateUser.tsx | 提交評分 |
| 用戶評論 | `GET /mahjongclub_web_user_comments` | UserReviews.tsx | 查看用戶評論 |

### 6️⃣ 通知系統 (2 個)
| API | 端點 | 頁面 | 觸發時機 |
|-----|------|------|---------|
| 獲取通知 | `GET /mahjongclub_web_notifications` | Notifications.tsx | 查看通知列表 |
| 標記已讀 | `POST /mahjongclub_web_notifications` | Notifications.tsx | 標記通知為已讀 |

### 7️⃣ 推播通知 (3 個)
| API | 端點 | 頁面 | 觸發時機 |
|-----|------|------|---------|
| 訂閱推播 | `POST /mahjongclub_web_subscribe_push` | Profile.tsx | 開啟推播通知 |
| 取消訂閱 | `POST /mahjongclub_web_unsubscribe_push` | Profile.tsx | 關閉推播通知 |
| VAPID 公鑰 | `GET /mahjongclub_web_vapid_key` | Profile.tsx | 訂閱推播前取得公鑰 |

---

## ❌ 未使用的 API (3 個)

| # | API 名稱 | 端點 | 狀態 | 說明 |
|---|---------|------|------|------|
| 1 | 訂閱狀態 | `GET /mahjongclub_web_subscription_status` | ⚠️ 已實作但未使用 | 在 `notificationService.ts` 中有實作，但被註解掉 |
| 2 | 數據分析 | `GET /analytics/*` | ❌ 未實作 | 管理後台專用，用於查看系統統計數據 |
| 3 | 事件命令 | `POST /event-commands/*` | ❌ 未實作 | 管理後台專用，用於管理活動兌換碼 |

---

## 📱 各頁面 API 使用情況

| 頁面 | API 數量 | 主要功能 |
|------|---------|---------|
| Login.tsx | 3 | 註冊、Email登入、LINE登入 |
| Home.tsx | 0 | 僅顯示資料，無 API 呼叫 |
| Search.tsx | 1 | 搜尋團局 |
| CreateGroup.tsx | 1 | 創建團局 |
| MyEvents.tsx | 1 | 查看我的團局 |
| EventDetail.tsx | 4 | 查看詳情、報名、接受/拒絕報名 |
| ManageGame.tsx | 4 | 管理報名、取消團局 |
| Notifications.tsx | 2 | 查看通知、標記已讀 |
| Profile.tsx | 4 | 更新資料、推播訂閱管理 |
| RateGame.tsx | 3 | 查看團局、獲取評分、提交評分 |
| RateUser.tsx | 3 | 查看用戶、查看團局、提交評分 |
| UserReviews.tsx | 2 | 查看用戶資訊、查看評論 |

---

## ⚠️ 發現的問題

### 1. HTTP Method 不一致
**問題:**
- `apiDoc/05_search_games.md` 文檔顯示應使用 **GET** 方法
- `services/apiService.ts` 實際使用 **POST** 方法

**位置:** `services/apiService.ts:127-129`

**建議:** 確認後端實際接受的 HTTP 方法，統一文檔與程式碼

---

### 2. Localhost Mock Data
**說明:**
- 當應用在 localhost 運行時，部分 API 會返回 mock data
- 影響的 API: `searchGames()`, `getMyGames()`, `getNotifications()`

**建議:** 確保生產環境不使用 mock data，或使用環境變數控制

---

## 🔄 API 呼叫流程

### 用戶註冊/登入
```
Login.tsx
  ├─ 註冊 → POST /mahjongclub_app_register
  ├─ Email登入 → POST /mahjongclub_app_login
  └─ LINE登入 → POST /mahjongclub_web_verify_user
```

### 團局管理
```
Search.tsx → 搜尋團局
  ↓
EventDetail.tsx → 查看詳情、報名
  ↓
ManageGame.tsx → 管理報名、取消團局
```

### 評分流程
```
RateGame.tsx → 評分所有玩家
  ↓
RateUser.tsx → 評分單一玩家
  ↓
UserReviews.tsx → 查看用戶評價
```

---

## 📝 建議

1. ✅ **修正 HTTP Method 不一致問題**
2. ✅ **啟用訂閱狀態檢查功能**
3. ⚠️ **考慮實作數據分析** (管理後台需求)
4. ⚠️ **考慮實作事件命令** (活動管理需求)
5. ✅ **移除或控制 Mock Data** (生產環境)

---

**報告生成時間:** 2024-11-24  
**詳細報告:** 請參考 `API_USAGE_REPORT.md`

