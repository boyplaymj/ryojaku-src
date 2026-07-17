# 🔍 下拉刷新 API 觸發說明

## 📋 問題

**您的問題：** 重新載入團局列表會觸發哪一隻 API？測試時沒有看到觸發任何 API。

---

## ✅ 答案

下拉刷新會觸發：**`POST /mahjongclub_web_search_games`**

---

## 🔄 完整呼叫鏈

### 1. 用戶操作
```
用戶在搜尋頁面下拉
```

### 2. 前端呼叫流程
```typescript
Search.tsx: fetchEvents()
  ↓
dataService.ts: api.getEvents()
  ↓
apiService.ts: searchGames()
  ↓
apiRequest('/mahjongclub_web_search_games', { method: 'POST' })
  ↓
fetch('https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games')
```

### 3. 實際 API 呼叫
```
POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games
```

---

## ⚠️ 為什麼您看不到 API 呼叫？

### 原因：Localhost Mock Data

當您在 **localhost** 環境測試時，程式會返回 **Mock Data**，**不會真正呼叫 API**！

### 程式碼證據

<augment_code_snippet path="services/apiService.ts" mode="EXCERPT">
```typescript
export async function searchGames(params: SearchGamesParams = {}) {
  // ⚠️ 檢查是否在 localhost
  if (isLocalhost()) {
    console.log('[MOCK] Returning mock games for localhost');
    // 模擬網路延遲
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      games: MOCK_GAMES  // ❌ 返回假資料，不呼叫 API
    };
  }

  // ✅ 只有在非 localhost 環境才會真正呼叫 API
  const queryParams = new URLSearchParams();
  if (params.type) queryParams.append('type', params.type);
  if (params.latitude) queryParams.append('latitude', params.latitude.toString());
  if (params.longitude) queryParams.append('longitude', params.longitude.toString());
  if (params.radius) queryParams.append('radius', params.radius.toString());

  return apiRequest(`/mahjongclub_web_search_games?${queryParams.toString()}`, {
    method: 'POST',
  });
}
```
</augment_code_snippet>

### isLocalhost() 函數

<augment_code_snippet path="services/apiService.ts" mode="EXCERPT">
```typescript
const isLocalhost = () => {
  return window.location.hostname === 'localhost' || 
         window.location.hostname === '127.0.0.1';
};
```
</augment_code_snippet>

---

## 🧪 如何測試真實 API 呼叫？

### 方法 1：部署到線上環境測試

1. 部署應用到 CloudFront/S3
2. 訪問線上 URL：`https://d1wa3w4dmfwqc7.cloudfront.net`
3. 在線上環境下拉刷新
4. 打開瀏覽器開發者工具 → Network 標籤
5. 應該會看到：
   ```
   POST /mahjongclub_web_search_games
   Status: 200 OK
   ```

### 方法 2：暫時停用 Mock Data（開發測試用）

**修改 `services/apiService.ts`：**

```typescript
export async function searchGames(params: SearchGamesParams = {}) {
  // 暫時註解掉 localhost 檢查
  // if (isLocalhost()) {
  //   console.log('[MOCK] Returning mock games for localhost');
  //   await new Promise(resolve => setTimeout(resolve, 500));
  //   return {
  //     success: true,
  //     games: MOCK_GAMES
  //   };
  // }

  const queryParams = new URLSearchParams();
  // ... 真實 API 呼叫
}
```

**⚠️ 注意：** 測試完記得改回來！

### 方法 3：使用環境變數控制（推薦）

**修改 `services/apiService.ts`：**

```typescript
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export async function searchGames(params: SearchGamesParams = {}) {
  if (isLocalhost() && USE_MOCK_DATA) {  // 加入環境變數控制
    console.log('[MOCK] Returning mock games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      games: MOCK_GAMES
    };
  }
  // ... 真實 API 呼叫
}
```

**在 `.env` 檔案中設定：**
```bash
# 開發時使用 Mock Data
VITE_USE_MOCK_DATA=true

# 測試真實 API 時
VITE_USE_MOCK_DATA=false
```

---

## 📊 受影響的 API

以下 API 在 localhost 環境都會返回 Mock Data：

| API | Mock Data 變數 | 位置 |
|-----|---------------|------|
| `searchGames()` | `MOCK_GAMES` | `services/mockData.ts` |
| `getMyGames()` | `MOCK_MY_GAMES` | `services/mockData.ts` |
| `getNotifications()` | `MOCK_NOTIFICATIONS` | `services/mockData.ts` |

---

## 🔍 如何在開發者工具中確認

### 在 Console 中查看

當您在 localhost 下拉刷新時，應該會看到：

```
[MOCK] Returning mock games for localhost
```

這表示程式使用了 Mock Data，沒有真正呼叫 API。

### 在 Network 標籤中查看

**Localhost 環境：**
- ❌ 不會看到任何 `/mahjongclub_web_search_games` 請求

**線上環境：**
- ✅ 會看到 `POST /mahjongclub_web_search_games` 請求
- ✅ 可以查看 Request/Response 內容

---

## 📝 總結

### 問題原因
您在 **localhost** 環境測試，程式自動使用 **Mock Data**，不會真正呼叫 API。

### 解決方案
1. **部署到線上環境測試**（推薦）
2. **暫時停用 Mock Data**（開發測試）
3. **使用環境變數控制**（最佳實踐）

### 真實 API
下拉刷新會觸發：
```
POST https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/mahjongclub_web_search_games
```

### 檢查方式
- 打開瀏覽器開發者工具
- 切換到 Network 標籤
- 在線上環境下拉刷新
- 查看 API 請求

---

**文檔建立時間：** 2024-11-24  
**相關檔案：**
- `services/apiService.ts`
- `services/dataService.ts`
- `services/mockData.ts`
- `pages/Search.tsx`

