# 分析數據 API

## 基本資訊

- **API 名稱**: 分析數據
- **Lambda 函數**: `Linebot_mahjongclub_analytics_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: 多個分析端點
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/analytics/*`

---

## 功能說明

提供系統分析數據，包括用戶統計、團局統計、增長趨勢等。主要用於管理後台。

---

## API 端點

### 1. 總覽數據
- **端點**: `GET /analytics/overview`
- **說明**: 獲取系統總覽數據

### 2. 用戶增長
- **端點**: `GET /analytics/users/growth`
- **說明**: 獲取用戶增長趨勢

### 3. 用戶統計
- **端點**: `GET /analytics/users/stats`
- **說明**: 獲取用戶統計數據

### 4. 團局統計
- **端點**: `GET /analytics/games/stats`
- **說明**: 獲取團局統計數據

---

## 請求格式

### HTTP Method
```
GET
```

### Query Parameters (用戶增長)

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `period` | string | ❌ | 時間週期 ("day", "week", "month") |
| `limit` | number | ❌ | 返回數量 (預設 30) |

---

## 回應格式

### 總覽數據 (200 OK)

```json
{
  "success": true,
  "data": {
    "totalUsers": 1250,
    "totalGames": 450,
    "activeUsers": 320,
    "completedGames": 380,
    "averageRating": 4.6
  }
}
```

### 用戶增長 (200 OK)

```json
{
  "success": true,
  "data": {
    "growth": [
      {
        "date": "2025-11-01",
        "newUsers": 15,
        "totalUsers": 1200
      },
      {
        "date": "2025-11-02",
        "newUsers": 20,
        "totalUsers": 1220
      }
    ]
  }
}
```

---

## 請求範例

### JavaScript (Fetch)
```javascript
// 獲取總覽數據
async function getOverview() {
  const response = await fetch(
    'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/analytics/overview',
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
  
  const result = await response.json();
  if (result.success) {
    console.log('總用戶數:', result.data.totalUsers);
    console.log('總團局數:', result.data.totalGames);
    console.log('平均評分:', result.data.averageRating);
  }
}

// 獲取用戶增長
async function getUserGrowth() {
  const response = await fetch(
    'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/analytics/users/growth?period=day&limit=30',
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
  
  const result = await response.json();
  if (result.success) {
    console.log('用戶增長趨勢:', result.data.growth);
  }
}
```

---

## 注意事項

1. **權限控制**: 此 API 應該只對管理員開放
2. **效能考量**: 統計數據可能需要較長時間計算
3. **快取建議**: 建議快取分析數據，避免頻繁查詢
4. **用途**: 主要用於管理後台的數據展示

