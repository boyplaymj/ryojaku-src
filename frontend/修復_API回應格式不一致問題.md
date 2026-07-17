# 🐛 修復：API 回應格式不一致問題

## 📋 問題描述

**症狀：**
- API 有返回資料（`count: 1`）
- 但畫面顯示的是 Mock Data（假資料）

**原因：**
- API 實際回應格式：`response.data.games`
- 程式檢查的格式：`response.games`
- 格式不匹配導致程式誤判為「API 返回空資料」，進而使用 Mock Data

---

## 🔍 問題分析

### API 實際回應格式（從 Network 截圖）

```json
{
  "success": true,
  "data": {
    "count": 1,
    "games": [
      {
        "gameId": "GAME_20251124_5db31f9f",
        "hostUserId": "APP_vt-Ss-zw0Y2P-Y7v",
        // ... 其他欄位
      }
    ]
  }
}
```

### 程式原本的檢查邏輯（錯誤）

```typescript
// ❌ 檢查 response.games（不存在）
if (response.success && response.games && response.games.length > 0) {
  console.log('[API] Using real API data for searchGames');
  return response;
}

// 因為 response.games 是 undefined，所以條件失敗
// 程式誤判為「API 返回空資料」，使用 Mock Data
```

### API 文檔定義（apiDoc/05_search_games.md）

```json
{
  "success": true,
  "data": {
    "games": [...],
    "count": 1
  }
}
```

**結論：** API 回應格式是 `response.data.games`，不是 `response.games`

---

## 🔧 修復方案

### 修改檔案
- `services/apiService.ts`

### 修改內容

#### 修改前（第 110-140 行）

```typescript
export async function searchGames(params: SearchGamesParams = {}) {
  const queryParams = new URLSearchParams();
  if (params.type) queryParams.append('type', params.type);
  if (params.latitude) queryParams.append('latitude', params.latitude.toString());
  if (params.longitude) queryParams.append('longitude', params.longitude.toString());
  if (params.radius) queryParams.append('radius', params.radius.toString());

  // Always try to call real API first
  const response = await apiRequest(`/mahjongclub_web_search_games?${queryParams.toString()}`, {
    method: 'POST',
  });

  // ❌ 只檢查 response.games
  if (response.success && response.games && response.games.length > 0) {
    console.log('[API] Using real API data for searchGames');
    return response;
  }

  // 因為檢查失敗，誤用 Mock Data
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      games: MOCK_GAMES
    };
  }

  return response;
}
```

#### 修改後（第 110-146 行）

```typescript
export async function searchGames(params: SearchGamesParams = {}) {
  const queryParams = new URLSearchParams();
  if (params.type) queryParams.append('type', params.type);
  if (params.latitude) queryParams.append('latitude', params.latitude.toString());
  if (params.longitude) queryParams.append('longitude', params.longitude.toString());
  if (params.radius) queryParams.append('radius', params.radius.toString());

  // Always try to call real API first
  const response = await apiRequest(`/mahjongclub_web_search_games?${queryParams.toString()}`, {
    method: 'POST',
  });

  // ✅ 檢查兩種格式：response.games（舊格式）和 response.data.games（新格式）
  const games = response.games || response.data?.games;
  if (response.success && games && games.length > 0) {
    console.log('[API] Using real API data for searchGames, count:', games.length);
    // ✅ 標準化回應格式，確保 games 在頂層
    return {
      ...response,
      games: games
    };
  }

  // 只有真的失敗或空資料才使用 Mock Data
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      games: MOCK_GAMES
    };
  }

  return response;
}
```

---

## ✅ 修復重點

### 1. 相容兩種格式
```typescript
const games = response.games || response.data?.games;
```
- 支援舊格式：`response.games`
- 支援新格式：`response.data.games`
- 使用可選鏈 `?.` 避免錯誤

### 2. 標準化回應格式
```typescript
return {
  ...response,
  games: games
};
```
- 確保返回的資料結構中 `games` 在頂層
- `dataService.ts` 期望 `response.games` 格式
- 保留原始回應的其他欄位（如 `success`、`data`）

### 3. 增強日誌
```typescript
console.log('[API] Using real API data for searchGames, count:', games.length);
```
- 顯示實際使用的團局數量
- 方便除錯

---

## 🧪 測試驗證

### 測試步驟

1. **清除快取並重新載入**
   ```bash
   # 在瀏覽器按 Ctrl+Shift+R (Windows) 或 Cmd+Shift+R (Mac)
   ```

2. **打開開發者工具**
   - 按 F12
   - 切換到 Console 標籤

3. **下拉刷新搜尋頁面**

4. **檢查 Console 日誌**
   - ✅ 應該看到：`[API] Using real API data for searchGames, count: 1`
   - ❌ 不應該看到：`[MOCK] API returned empty/failed...`

5. **檢查畫面顯示**
   - ✅ 應該顯示真實的團局資料
   - ❌ 不應該顯示 Mock Data

### 預期結果

**Console 輸出：**
```
[API] Using real API data for searchGames, count: 1
```

**畫面顯示：**
- 團局 ID: `GAME_20251124_5db31f9f`
- 主辦人: `Justin`
- 地點: 真實的地點資訊
- 時間: `12/24 14:25`

---

## 📊 相關檔案

### 資料流程

```
Search.tsx
  ↓ fetchEvents()
dataService.ts: api.getEvents()
  ↓ searchGames()
apiService.ts: searchGames()
  ↓ apiRequest()
API: POST /mahjongclub_web_search_games
  ↓ 返回
{
  success: true,
  data: {
    count: 1,
    games: [...]
  }
}
  ↓ 標準化格式
{
  success: true,
  data: {...},
  games: [...]  ← 新增到頂層
}
  ↓
dataService.ts: response.games ✅ 可以正確讀取
  ↓
Search.tsx: 顯示真實資料 ✅
```

---

## 📝 總結

### 問題根源
- API 回應格式是 `response.data.games`
- 程式檢查的是 `response.games`
- 格式不匹配導致誤判

### 解決方案
- 相容兩種格式：`response.games || response.data?.games`
- 標準化回應：確保 `games` 在頂層
- 增強日誌：顯示實際資料數量

### 修復狀態
- ✅ 已修復
- ✅ 無語法錯誤
- ⏳ 待測試驗證

---

**修復時間：** 2024-11-24  
**修改檔案：** `services/apiService.ts`  
**修改行數：** 110-146

