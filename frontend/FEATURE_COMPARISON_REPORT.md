# MahjongClub_App vs mahjongclub-web 功能比對報告

## 比對日期: 2025-11-21

本報告比對 **MahjongClub_App** (新版 APP) 與 **LineBot/websites/mahjongclub-web** (舊版 Web) 的功能完整性。

---

## 📋 頁面結構比對

### mahjongclub-web 的頁面 (10 個)

#### 主要頁面 (6 個)
1. ✅ **HomePage** - 首頁
2. ✅ **SearchGamesPage** - 搜尋團局
3. ✅ **CreateGamePage** - 創建團局
4. ✅ **MyGamesPage** - 我的團局
5. ✅ **NotificationsPage** - 通知
6. ✅ **UserProfilePage** - 用戶資料

#### 獨立路由頁面 (4 個)
7. ❌ **RatePage** - 評分單一用戶 (`/rate`)
8. ❌ **RateGamePage** - 評分整場團局 (`/rate-game`)
9. ❌ **UserReviewsPage** - 查看用戶評價 (`/reviews`)
10. ❌ **ManageGamePage** - 管理團局 (`/manage-game`)

### MahjongClub_App 的頁面 (8 個)

1. ✅ **Home** - 首頁
2. ✅ **Search** - 搜尋
3. ✅ **CreateGroup** - 創建團局
4. ✅ **MyEvents** - 我的團局
5. ✅ **Notifications** - 通知
6. ✅ **Profile** - 個人資料
7. ✅ **Login** - 登入 (新增,APP 專用)
8. ✅ **EventDetail** - 團局詳情

---

## ⚠️ 缺少的功能頁面

### 1. ❌ 評分功能 (RatePage)
**用途**: 對單一用戶進行評分
**路由**: `/rate?lineID=xxx&gameId=xxx&toUserId=xxx`
**使用的 API**:
- `mahjongclub_web_verify_user` - 驗證用戶
- `mahjongclub_web_game_detail` - 獲取團局詳情
- `mahjongclub_web_user_info` - 獲取被評分用戶資訊
- `mahjongclub_web_submit_rating` - 提交評分

**功能描述**:
- 顯示被評分用戶的資訊
- 選擇好評/差評
- 輸入評論 (至少 5 個字)
- 提交評分

---

### 2. ❌ 團局評分頁面 (RateGamePage)
**用途**: 對整場團局的所有參與者進行評分
**路由**: `/rate-game?lineID=xxx&gameId=xxx`
**使用的 API**:
- `mahjongclub_web_verify_user` - 驗證用戶
- `mahjongclub_web_game_detail` - 獲取團局詳情
- `mahjongclub_web_get_ratings` - 獲取已有評分 (支援 gameId 參數)
- `mahjongclub_web_submit_rating` - 提交評分

**功能描述**:
- 顯示所有需要評分的玩家 (排除自己)
- 批量評分介面
- 顯示已評分的玩家
- 一次性提交所有評分

---

### 3. ❌ 用戶評價頁面 (UserReviewsPage)
**用途**: 查看用戶收到的所有評價
**路由**: `/reviews?userId=xxx`
**使用的 API**:
- `mahjongclub_web_user_info` - 獲取用戶資訊
- `mahjongclub_web_user_comments` - 獲取用戶評論

**功能描述**:
- 顯示用戶基本資訊
- 顯示正面/負面評價統計
- 列出所有評論
- 顯示評論者資訊和時間

---

### 4. ❌ 管理團局頁面 (ManageGamePage)
**用途**: 團主管理團局,處理報名申請
**路由**: `/manage-game?lineID=xxx&gameId=xxx`
**使用的 API**:
- `mahjongclub_web_verify_user` - 驗證用戶
- `mahjongclub_web_game_detail` - 獲取團局詳情
- `mahjongclub_web_accept_registration` - 接受報名
- `mahjongclub_web_reject_registration` - 拒絕報名
- `mahjongclub_web_cancel_game` - 取消團局

**功能描述**:
- 顯示團局詳情
- 顯示待審核的報名列表
- 接受/拒絕報名
- 取消團局

---

## 📊 API 使用情況比對

### mahjongclub-web 使用的 API (19 個)

#### 認證相關 (1 個)
1. ✅ `mahjongclub_web_verify_user` - 驗證 LINE 用戶

#### 團局管理 (6 個)
2. ✅ `mahjongclub_web_search_games` - 搜尋團局
3. ✅ `mahjongclub_web_create_game` - 創建團局
4. ✅ `mahjongclub_web_my_games` - 我的團局
5. ✅ `mahjongclub_web_game_detail` - 團局詳情
6. ✅ `mahjongclub_web_cancel_game` - 取消團局
7. ✅ `mahjongclub_web_register` - 報名團局

#### 報名管理 (2 個)
8. ✅ `mahjongclub_web_accept_registration` - 接受報名
9. ✅ `mahjongclub_web_reject_registration` - 拒絕報名

#### 用戶資料 (3 個)
10. ✅ `mahjongclub_web_user_profile` - 用戶資料 (GET/POST)
11. ✅ `mahjongclub_web_user_info` - 用戶資訊
12. ✅ `mahjongclub_web_user_comments` - 用戶評論

#### 評分系統 (2 個)
13. ⚠️ `mahjongclub_web_get_ratings` - 獲取評分
14. ⚠️ `mahjongclub_web_submit_rating` - 提交評分

#### 通知系統 (2 個)
15. ✅ `mahjongclub_web_notifications` - 獲取通知/標記已讀

#### 推送通知 (4 個)
16. ✅ `mahjongclub_web_vapid_key` - 獲取 VAPID 公鑰
17. ✅ `mahjongclub_web_subscribe_push` - 訂閱推送
18. ✅ `mahjongclub_web_unsubscribe_push` - 取消訂閱
19. ✅ `mahjongclub_web_subscription_status` - 訂閱狀態

### MahjongClub_App 使用的 API (21 個)

#### APP 認證 (2 個) - 新增
1. ✅ `mahjongclub_app_register` - APP 用戶註冊
2. ✅ `mahjongclub_app_login` - APP 用戶登入

#### WEB 認證 (1 個)
3. ✅ `mahjongclub_web_verify_user` - 驗證 LINE 用戶

#### 團局管理 (6 個)
4. ✅ `mahjongclub_web_search_games` - 搜尋團局
5. ✅ `mahjongclub_web_create_game` - 創建團局
6. ✅ `mahjongclub_web_my_games` - 我的團局
7. ✅ `mahjongclub_web_game_detail` - 團局詳情
8. ✅ `mahjongclub_web_cancel_game` - 取消團局
9. ✅ `mahjongclub_web_register` - 報名團局

#### 報名管理 (2 個)
10. ✅ `mahjongclub_web_accept_registration` - 接受報名
11. ✅ `mahjongclub_web_reject_registration` - 拒絕報名

#### 用戶資料 (2 個)
12. ✅ `mahjongclub_web_user_profile` - 用戶資料
13. ✅ `mahjongclub_web_user_comments` - 用戶評論

#### 評分系統 (2 個)
14. ✅ `mahjongclub_web_get_ratings` - 獲取評分
15. ✅ `mahjongclub_web_submit_rating` - 提交評分

#### 通知系統 (2 個)
16. ✅ `mahjongclub_web_notifications` - 獲取通知
17. ✅ `markNotificationAsRead` - 標記已讀

#### 推送通知 (4 個)
18. ✅ `mahjongclub_web_vapid_key` - 獲取 VAPID 公鑰
19. ✅ `mahjongclub_web_subscribe_push` - 訂閱推送
20. ✅ `mahjongclub_web_unsubscribe_push` - 取消訂閱
21. ✅ `mahjongclub_web_subscription_status` - 訂閱狀態

---

## ⚠️ API 已定義但未使用

MahjongClub_App 的 `apiService.ts` 中已經定義了評分相關的 API:
- ✅ `getRatings()` - 已定義
- ✅ `submitRating()` - 已定義
- ✅ `getUserComments()` - 已定義

**但是沒有對應的頁面使用這些 API!**

---

## 🔍 缺少的 API

MahjongClub_App 缺少 1 個 API:
- ❌ `mahjongclub_web_user_info` - 獲取用戶公開資訊

此 API 在 mahjongclub-web 中用於:
- RatePage: 獲取被評分用戶的資訊
- UserReviewsPage: 獲取用戶基本資訊

---

## 📝 功能完整性總結

### ✅ 已實現的功能 (6/10)

1. ✅ **首頁** - 顯示團局列表
2. ✅ **搜尋團局** - 搜尋附近或全部團局
3. ✅ **創建團局** - 創建新團局
4. ✅ **我的團局** - 查看自己的團局
5. ✅ **通知** - 查看通知
6. ✅ **個人資料** - 查看和編輯個人資料

### ❌ 缺少的功能 (4/10)

7. ❌ **評分單一用戶** - 對單一用戶進行評分
8. ❌ **評分整場團局** - 對整場團局的所有參與者進行評分
9. ❌ **查看用戶評價** - 查看用戶收到的所有評價
10. ❌ **管理團局** - 團主管理團局,處理報名申請

---

## 🎯 建議補充的功能

### 優先級 1 (高) - 核心功能

#### 1. 管理團局頁面 (ManageGamePage)
**重要性**: ⭐⭐⭐⭐⭐
**原因**: 團主需要管理報名申請,這是核心功能
**需要實現**:
- 創建 `ManageGame.tsx` 頁面
- 顯示待審核報名列表
- 接受/拒絕報名按鈕
- 取消團局功能
- 從 EventDetail 頁面導航到此頁面

#### 2. 評分整場團局頁面 (RateGamePage)
**重要性**: ⭐⭐⭐⭐⭐
**原因**: 團局結束後需要評分,建立信用系統
**需要實現**:
- 創建 `RateGame.tsx` 頁面
- 批量評分介面
- 顯示已評分/未評分狀態
- 一次性提交所有評分

### 優先級 2 (中) - 重要功能

#### 3. 查看用戶評價頁面 (UserReviewsPage)
**重要性**: ⭐⭐⭐⭐
**原因**: 用戶需要查看其他人的評價,決定是否參加
**需要實現**:
- 創建 `UserReviews.tsx` 頁面
- 顯示用戶評價統計
- 列出所有評論
- 從 Profile 或 EventDetail 導航到此頁面

#### 4. 評分單一用戶頁面 (RatePage)
**重要性**: ⭐⭐⭐
**原因**: 補充評分功能,但優先級低於批量評分
**需要實現**:
- 創建 `RateUser.tsx` 頁面
- 單一用戶評分介面
- 可從通知或其他地方導航

---

## 🔧 需要補充的 API

在 `apiService.ts` 中補充:
```typescript
// Get user info by userId
export async function getUserInfo(userId: string) {
  return apiRequest(`/mahjongclub_web_user_info?userId=${encodeURIComponent(userId)}`, {
    method: 'GET',
  });
}
```

---

## 📊 完成度統計

| 類別 | 完成度 | 說明 |
|------|--------|------|
| **頁面** | 60% (6/10) | 缺少 4 個評分和管理相關頁面 |
| **API** | 95% (19/20) | 缺少 1 個 getUserInfo API |
| **核心功能** | 60% | 缺少評分系統和團局管理 |

---

## ✅ 結論

**MahjongClub_App 目前缺少以下關鍵功能:**

1. ❌ **管理團局功能** - 團主無法處理報名申請
2. ❌ **評分系統** - 無法對參與者進行評分
3. ❌ **查看評價** - 無法查看用戶的信用評價

**建議優先實現:**
1. **ManageGamePage** - 讓團主可以管理報名
2. **RateGamePage** - 讓用戶可以評分
3. **UserReviewsPage** - 讓用戶可以查看評價

這些功能對於建立信用系統和完整的團局管理流程至關重要!

