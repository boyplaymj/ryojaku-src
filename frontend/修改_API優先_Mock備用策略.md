# 🔄 修改：API 優先，Mock Data 備用策略

## 📋 修改需求

**原始行為：**
- 在 localhost 環境直接返回 Mock Data
- 不呼叫真實 API

**新行為：**
- ✅ **優先呼叫真實 API**
- ✅ **如果 API 返回有效資料 → 使用 API 資料**
- ✅ **如果 API 失敗或返回空資料 → 使用 Mock Data（僅 localhost）**

---

## 🔧 修改內容

### 修改的檔案
- `services/apiService.ts`

### 修改的函數（3 個）

1. ✅ `searchGames()` - 搜尋團局
2. ✅ `getNotifications()` - 取得通知
3. ✅ `getMyGames()` - 取得我的團局

---

## 📝 修改詳情

### 1. searchGames() - 搜尋團局

#### 修改前：
```typescript
export async function searchGames(params: SearchGamesParams = {}) {
  // ❌ 直接檢查 localhost，不呼叫 API
  if (isLocalhost()) {
    console.log('[MOCK] Returning mock games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      games: MOCK_GAMES
    };
  }

  // 只有非 localhost 才呼叫 API
  const queryParams = new URLSearchParams();
  // ...
  return apiRequest(`/mahjongclub_web_search_games?${queryParams.toString()}`, {
    method: 'POST',
  });
}
```

#### 修改後：
```typescript
export async function searchGames(params: SearchGamesParams = {}) {
  const queryParams = new URLSearchParams();
  if (params.type) queryParams.append('type', params.type);
  if (params.latitude) queryParams.append('latitude', params.latitude.toString());
  if (params.longitude) queryParams.append('longitude', params.longitude.toString());
  if (params.radius) queryParams.append('radius', params.radius.toString());

  // ✅ 1. 優先呼叫真實 API
  const response = await apiRequest(`/mahjongclub_web_search_games?${queryParams.toString()}`, {
    method: 'POST',
  });

  // ✅ 2. 如果 API 成功且有資料，使用 API 資料
  if (response.success && response.games && response.games.length > 0) {
    console.log('[API] Using real API data for searchGames');
    return response;
  }

  // ✅ 3. 如果 API 失敗或空資料，且在 localhost，使用 Mock Data
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      games: MOCK_GAMES
    };
  }

  // ✅ 4. 如果不是 localhost 且 API 失敗，返回失敗回應
  return response;
}
```

---

### 2. getNotifications() - 取得通知

#### 修改前：
```typescript
export async function getNotifications(userIdentifier: string, lastKey: string | null = null) {
  // ❌ 直接檢查 localhost，不呼叫 API
  if (isLocalhost()) {
    console.log('[MOCK] Returning mock notifications for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      notifications: MOCK_NOTIFICATIONS,
      unreadCount: MOCK_NOTIFICATIONS.filter(n => !n.isRead).length,
      hasMore: false,
      lastKey: null
    };
  }

  let url = `/mahjongclub_web_notifications?userId=${encodeURIComponent(userIdentifier)}`;
  if (lastKey) {
    url += `&lastKey=${encodeURIComponent(lastKey)}`;
  }
  return apiRequest(url, {
    method: 'GET',
  });
}
```

#### 修改後：
```typescript
export async function getNotifications(userIdentifier: string, lastKey: string | null = null) {
  let url = `/mahjongclub_web_notifications?userId=${encodeURIComponent(userIdentifier)}`;
  if (lastKey) {
    url += `&lastKey=${encodeURIComponent(lastKey)}`;
  }

  // ✅ 1. 優先呼叫真實 API
  const response = await apiRequest(url, {
    method: 'GET',
  });

  // ✅ 2. 如果 API 成功且有資料，使用 API 資料
  if (response.success && response.notifications) {
    console.log('[API] Using real API data for getNotifications');
    return response;
  }

  // ✅ 3. 如果 API 失敗或空資料，且在 localhost，使用 Mock Data
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock notifications for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      notifications: MOCK_NOTIFICATIONS,
      unreadCount: MOCK_NOTIFICATIONS.filter(n => !n.isRead).length,
      hasMore: false,
      lastKey: null
    };
  }

  // ✅ 4. 如果不是 localhost 且 API 失敗，返回失敗回應
  return response;
}
```

---

### 3. getMyGames() - 取得我的團局

#### 修改後：
```typescript
export async function getMyGames(userIdentifier: string) {
  // ✅ 1. 優先呼叫真實 API
  const response = await apiRequest(`/mahjongclub_web_my_games?${getAuthParam(userIdentifier)}`, {
    method: 'POST',
  });

  // ✅ 2. 如果 API 成功且有資料，使用 API 資料
  if (response.success && response.data && (response.data.createdGames || response.data.joinedGames)) {
    console.log('[API] Using real API data for getMyGames');
    return response;
  }

  // ✅ 3. 如果 API 失敗或空資料，且在 localhost，使用 Mock Data
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock my-games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      data: MOCK_MY_GAMES
    };
  }

  // ✅ 4. 如果不是 localhost 且 API 失敗，返回失敗回應
  return response;
}
```

---

## 🎯 新的執行流程

```
用戶觸發操作（例如：下拉刷新）
  ↓
呼叫 API 函數（例如：searchGames()）
  ↓
1️⃣ 嘗試呼叫真實 API
  ↓
2️⃣ 檢查 API 回應
  ├─ ✅ 成功且有資料 → 使用 API 資料
  └─ ❌ 失敗或空資料
      ↓
      檢查環境
      ├─ 🏠 localhost → 使用 Mock Data
      └─ 🌐 線上環境 → 返回失敗回應
```

---

## 📊 Console 日誌說明

### 情況 1：API 成功返回資料
```
[API] Using real API data for searchGames
```

### 情況 2：API 失敗，使用 Mock Data（localhost）
```
[MOCK] API returned empty/failed, using mock games for localhost
```

### 情況 3：API 失敗，無 Mock Data（線上環境）
```
（返回 API 的錯誤回應）
```

---

## ✅ 優點

1. **開發環境更真實**
   - 即使在 localhost 也會嘗試呼叫真實 API
   - 可以測試真實的 API 行為

2. **自動降級機制**
   - API 失敗時自動使用 Mock Data（僅 localhost）
   - 不會因為 API 問題導致開發中斷

3. **生產環境安全**
   - 線上環境不會使用 Mock Data
   - API 失敗時正確返回錯誤

4. **易於除錯**
   - Console 清楚顯示使用的是 API 還是 Mock Data
   - 可以在 Network 標籤看到真實的 API 呼叫

---

## 🧪 測試方式

### 測試 1：API 正常運作
1. 確保後端 API 正常運作
2. 在 localhost 開啟應用
3. 下拉刷新搜尋頁面
4. 檢查 Console：應該看到 `[API] Using real API data for searchGames`
5. 檢查 Network：應該看到 `POST /mahjongclub_web_search_games`

### 測試 2：API 失敗降級
1. 暫時關閉後端 API 或修改 API URL
2. 在 localhost 開啟應用
3. 下拉刷新搜尋頁面
4. 檢查 Console：應該看到 `[MOCK] API returned empty/failed, using mock games for localhost`
5. 應該顯示 Mock Data 的團局列表

### 測試 3：線上環境
1. 部署到 CloudFront
2. 訪問線上 URL
3. 下拉刷新
4. 應該只使用真實 API，不會有 Mock Data

---

## 📝 注意事項

1. **Mock Data 僅在 localhost**
   - 只有在 `localhost` 或 `127.0.0.1` 才會使用 Mock Data
   - 線上環境永遠不會使用 Mock Data

2. **API 優先原則**
   - 所有環境都會先嘗試呼叫真實 API
   - Mock Data 只是備用方案

3. **資料驗證**
   - 檢查 `response.success` 確保 API 成功
   - 檢查資料是否存在且不為空

---

**修改時間：** 2024-11-24  
**修改檔案：** `services/apiService.ts`  
**狀態：** ✅ 已完成並測試

