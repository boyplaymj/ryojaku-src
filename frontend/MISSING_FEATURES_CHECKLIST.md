# MahjongClub_App 缺少功能清單

## 快速檢查表

### ❌ 缺少的頁面 (4 個)

- [ ] **ManageGamePage** - 管理團局
  - 路由: `/manage-game`
  - 功能: 處理報名申請、取消團局
  - 優先級: ⭐⭐⭐⭐⭐ (最高)

- [ ] **RateGamePage** - 評分整場團局
  - 路由: `/rate-game`
  - 功能: 批量評分所有參與者
  - 優先級: ⭐⭐⭐⭐⭐ (最高)

- [ ] **UserReviewsPage** - 查看用戶評價
  - 路由: `/reviews`
  - 功能: 顯示用戶收到的所有評價
  - 優先級: ⭐⭐⭐⭐ (高)

- [ ] **RatePage** - 評分單一用戶
  - 路由: `/rate`
  - 功能: 對單一用戶進行評分
  - 優先級: ⭐⭐⭐ (中)

---

### ❌ 缺少的 API (1 個)

- [ ] **getUserInfo** - 獲取用戶公開資訊
  - 端點: `GET /mahjongclub_web_user_info?userId=xxx`
  - 用途: RatePage, UserReviewsPage

---

## 詳細實現清單

### 1. ManageGamePage (管理團局)

#### 需要的 API (已存在)
- ✅ `getGameDetail()` - 獲取團局詳情
- ✅ `acceptRegistration()` - 接受報名
- ✅ `rejectRegistration()` - 拒絕報名
- ✅ `cancelGame()` - 取消團局

#### 需要實現的功能
- [ ] 創建 `pages/ManageGame.tsx`
- [ ] 顯示團局基本資訊
- [ ] 顯示待審核報名列表
- [ ] 接受報名按鈕
- [ ] 拒絕報名按鈕
- [ ] 取消團局按鈕
- [ ] 確認對話框
- [ ] 從 EventDetail 導航到此頁面

#### UI 組件
- [ ] 報名申請卡片
- [ ] 接受/拒絕按鈕
- [ ] 取消團局確認對話框

---

### 2. RateGamePage (評分整場團局)

#### 需要的 API (已存在)
- ✅ `getGameDetail()` - 獲取團局詳情
- ✅ `getRatings()` - 獲取已有評分
- ✅ `submitRating()` - 提交評分

#### 需要實現的功能
- [ ] 創建 `pages/RateGame.tsx`
- [ ] 顯示團局資訊
- [ ] 列出所有需要評分的玩家 (排除自己)
- [ ] 每個玩家的評分介面 (好評/差評)
- [ ] 評論輸入框 (至少 5 個字)
- [ ] 顯示已評分/未評分狀態
- [ ] 批量提交所有評分
- [ ] 驗證所有玩家都已評分
- [ ] 從 MyEvents 或 EventDetail 導航到此頁面

#### UI 組件
- [ ] 玩家評分卡片
- [ ] 好評/差評切換按鈕
- [ ] 評論輸入框
- [ ] 已評分標記
- [ ] 提交按鈕

---

### 3. UserReviewsPage (查看用戶評價)

#### 需要的 API
- ❌ `getUserInfo()` - 獲取用戶資訊 (需要補充)
- ✅ `getUserComments()` - 獲取用戶評論

#### 需要實現的功能
- [ ] 補充 `getUserInfo()` API 到 `apiService.ts`
- [ ] 創建 `pages/UserReviews.tsx`
- [ ] 顯示用戶基本資訊
- [ ] 顯示評價統計 (正面/負面)
- [ ] 列出所有評論
- [ ] 顯示評論者資訊
- [ ] 顯示評論時間
- [ ] 從 Profile 或 EventDetail 導航到此頁面

#### UI 組件
- [ ] 用戶資訊卡片
- [ ] 評價統計圖表
- [ ] 評論列表
- [ ] 評論卡片

---

### 4. RatePage (評分單一用戶)

#### 需要的 API
- ❌ `getUserInfo()` - 獲取用戶資訊 (需要補充)
- ✅ `getGameDetail()` - 獲取團局詳情
- ✅ `submitRating()` - 提交評分

#### 需要實現的功能
- [ ] 補充 `getUserInfo()` API 到 `apiService.ts`
- [ ] 創建 `pages/RateUser.tsx`
- [ ] 顯示被評分用戶資訊
- [ ] 顯示團局資訊
- [ ] 好評/差評選擇
- [ ] 評論輸入框 (至少 5 個字)
- [ ] 提交評分
- [ ] 從通知或其他地方導航到此頁面

#### UI 組件
- [ ] 用戶資訊卡片
- [ ] 團局資訊卡片
- [ ] 好評/差評切換按鈕
- [ ] 評論輸入框
- [ ] 提交按鈕

---

## 實現順序建議

### 階段 1: 核心功能 (優先級最高)

1. **ManageGamePage** (1-2 天)
   - 團主必須能夠管理報名
   - 這是核心功能,沒有這個功能團局無法正常運作

2. **RateGamePage** (2-3 天)
   - 評分系統是信用體系的基礎
   - 批量評分比單一評分更重要

### 階段 2: 重要功能 (優先級高)

3. **UserReviewsPage** (1-2 天)
   - 用戶需要查看評價來決定是否參加
   - 需要先補充 `getUserInfo()` API

### 階段 3: 補充功能 (優先級中)

4. **RatePage** (1 天)
   - 補充單一用戶評分功能
   - 可以從通知等地方快速評分

---

## 總工時估計

- **ManageGamePage**: 1-2 天
- **RateGamePage**: 2-3 天
- **UserReviewsPage**: 1-2 天
- **RatePage**: 1 天
- **測試和調整**: 1-2 天

**總計**: 6-10 天

---

## 相關文檔

- **FEATURE_COMPARISON_REPORT.md** - 完整的功能比對報告
- **apiDoc/** - API 文檔目錄
- **LineBot/websites/mahjongclub-web/src/pages/** - 參考實現

