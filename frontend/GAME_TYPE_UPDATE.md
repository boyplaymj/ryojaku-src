# 團局類型更新說明

## 📋 更新內容

### gameType 固定為 "臨時揪團"

根據需求，所有創建的麻將團局的 `gameType` 都固定為 **"臨時揪團"**。

---

## 🔄 修改內容

### 1. 移除前端的團局類型選擇器

**之前**：用戶可以選擇麻將類型（基本三將、台麻、港式等）作為 gameType

**現在**：gameType 固定為 "臨時揪團"，麻將規則改為獨立欄位

### 2. 新增麻將規則選擇器

用戶現在可以選擇麻將規則：
- 基本三將
- 台麻
- 港式
- 日麻
- 見花
- 其他（可自訂輸入）

### 3. 資料映射更新

```typescript
// dataService.ts
const gameData: CreateMahjongGamePayload = {
    gameType: '臨時揪團',  // ✅ 固定值
    placeName: payload.location,
    location: payload.address,
    latitude: payload.latitude || 0,
    longitude: payload.longitude || 0,
    needPlayers: payload.maxMembers - 1,
    stakes: payload.stakes,
    startTime: new Date(payload.date).toISOString(),
    rules: payload.rules || payload.description || '',  // ✅ 麻將規則
    features: payload.features || '',
    restrictions: payload.restrictions || '',
};
```

---

## 📊 API 請求範例

### 請求格式

```json
POST /mahjongclub_web_create_game?userId=APP_xxxxxxxxxxxx

{
  "gameType": "臨時揪團",
  "placeName": "台北麻將館",
  "location": "台北市信義區信義路五段7號",
  "latitude": 25.0330,
  "longitude": 121.5654,
  "needPlayers": 3,
  "stakes": "100/20",
  "startTime": "2025-11-22T19:00:00.000Z",
  "rules": "基本三將",
  "features": "有冷氣, 有停車位",
  "restrictions": "新手友善"
}
```

### 回應格式

```json
{
  "success": true,
  "data": {
    "gameID": "GAME_xxxxxxxxxxxx",
    "pointsDeducted": 120,
    "pointsRemaining": 35620
  }
}
```

---

## 🎨 UI 變更

### 表單欄位順序

1. **團局標題** - 自訂標題
2. **開始時間** - 日期時間選擇器
3. **總人數** - 2-4 人
4. **金額/籌碼** - 例如 100/20
5. **麻將規則** - 基本三將、台麻、港式、日麻、見花、其他 ✨ 新增
6. **地點資訊** - 地點名稱、詳細地址、GPS 座標
7. **場地特色** - 多選標籤
8. **玩家限制** - 多選標籤
9. **活動說明** - 詳細描述

### 麻將規則選擇器

- 按鈕式選擇，點擊切換
- 選中的規則會高亮顯示（青色發光效果）
- 選擇「其他」時會出現文字輸入框供自訂

---

## 📝 參數對應表

| 前端欄位 | API 參數 | 值 | 說明 |
|---------|---------|-----|------|
| (固定) | `gameType` | "臨時揪團" | 固定值 |
| `rules` | `rules` | "基本三將" 等 | 麻將規則 |
| `title` | `placeName` | 用戶輸入 | 地點名稱 |
| `location` | `placeName` | 用戶輸入 | 地點名稱 |
| `address` | `location` | 用戶輸入 | 完整地址 |
| `maxMembers` | `needPlayers` | maxMembers - 1 | 需要玩家數 |
| `date` | `startTime` | ISO 8601 | 開始時間 |
| `stakes` | `stakes` | 用戶輸入 | 金額/籌碼 |
| `latitude` | `latitude` | GPS 座標 | 緯度 |
| `longitude` | `longitude` | GPS 座標 | 經度 |
| `features` | `features` | 多選組合 | 場地特色 |
| `restrictions` | `restrictions` | 多選組合 | 玩家限制 |
| `description` | `rules` | 用戶輸入 | 備用規則說明 |

---

## ✅ 測試檢查清單

- [ ] gameType 固定為 "臨時揪團"
- [ ] 麻將規則選擇器正常運作
- [ ] 選擇「其他」時可以自訂輸入
- [ ] API 請求包含正確的 gameType
- [ ] API 請求包含正確的 rules
- [ ] 創建的團局顯示正確的規則資訊

---

## 🔍 驗證方式

### 1. 檢查前端表單
- 確認沒有「團局類型」選擇器
- 確認有「麻將規則」選擇器
- 測試選擇不同規則

### 2. 檢查 API 請求
打開瀏覽器開發者工具 → Network 標籤：
```json
// 確認請求 body 包含
{
  "gameType": "臨時揪團",  // ✅ 固定值
  "rules": "基本三將"      // ✅ 用戶選擇的規則
}
```

### 3. 檢查創建結果
- 團局成功創建
- 團局詳情顯示正確的規則
- 團局列表顯示正確的資訊

