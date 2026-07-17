# 兌換點數 API

## 基本資訊

- **API 名稱**: 兌換點數
- **Lambda 函數**: `Linebot_mahjongclub-redeem_Go-Local`
- **API Gateway**: `MahjongClub-Web-HTTP-API`
- **API ID**: `k10zeqldu6`
- **端點**: 多個兌換相關端點
- **完整 URL**: `https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/redeem/*`

---

## 功能說明

管理兌換碼系統，包括生成兌換碼、兌換點數、查詢兌換記錄等。

---

## API 端點

### 1. 生成兌換碼
- **端點**: `POST /redeem/generate`
- **說明**: 批量生成兌換碼

### 2. 兌換點數
- **端點**: `POST /redeem/use`
- **說明**: 使用兌換碼兌換點數

### 3. 查詢兌換碼
- **端點**: `GET /redeem/code/{codeId}`
- **說明**: 查詢兌換碼狀態

### 4. 查詢批次
- **端點**: `GET /redeem/batch/{batchId}`
- **說明**: 查詢批次資訊

### 5. 統計數據
- **端點**: `GET /redeem/stats`
- **說明**: 獲取兌換碼統計數據

### 6. 匯出兌換碼
- **端點**: `GET /redeem/export/{batchId}`
- **說明**: 匯出批次兌換碼為 CSV

---

## 1. 生成兌換碼

### HTTP Method
```
POST
```

### Request Body

```json
{
  "quantity": 100,
  "points": 500,
  "createdBy": "admin"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `quantity` | number | ✅ | 生成數量 (1-1000) |
| `points` | number | ✅ | 每個兌換碼的點數 |
| `createdBy` | string | ✅ | 創建者 |

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "batchId": "batch_xxxxxxxxxxxx",
    "quantity": 100,
    "points": 500,
    "codes": [
      {
        "codeId": "ABC123XYZ",
        "points": 500,
        "batchId": "batch_xxxxxxxxxxxx",
        "status": "unused",
        "createdAt": "2025-11-21T15:30:00Z"
      }
    ]
  }
}
```

---

## 2. 兌換點數

### HTTP Method
```
POST
```

### Request Body

```json
{
  "userId": "APP_xxxxxxxxxxxx",
  "codeId": "ABC123XYZ"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `userId` | string | ✅ | 用戶 ID |
| `codeId` | string | ✅ | 兌換碼 |

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "points": 500,
    "newBalance": 2000
  }
}
```

### 錯誤回應

#### 400 Bad Request - 兌換碼無效
```json
{
  "success": false,
  "error": "Invalid redeem code"
}
```

#### 400 Bad Request - 兌換碼已使用
```json
{
  "success": false,
  "error": "Code already used"
}
```

---

## 3. 統計數據

### HTTP Method
```
GET
```

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "totalCodes": 1000,
    "usedCodes": 350,
    "unusedCodes": 650,
    "totalPoints": 500000,
    "pointsDistribution": [
      {
        "points": 100,
        "count": 500
      },
      {
        "points": 500,
        "count": 500
      }
    ]
  }
}
```

---

## 請求範例

### JavaScript (Fetch) - 兌換點數
```javascript
async function redeemCode(userId, codeId) {
  const response = await fetch(
    'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com/redeem/use',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: userId,
        codeId: codeId
      })
    }
  );
  
  const result = await response.json();
  if (result.success) {
    console.log(`成功兌換 ${result.data.points} 點！`);
    console.log(`新餘額: ${result.data.newBalance} 點`);
  } else {
    console.error('兌換失敗:', result.error);
  }
}

// 使用範例
redeemCode('APP_xxxxxxxxxxxx', 'ABC123XYZ');
```

---

## 業務邏輯

### 生成兌換碼
1. **驗證參數**: 確認數量和點數有效
2. **生成批次**: 創建批次記錄
3. **生成兌換碼**: 生成唯一的兌換碼
4. **儲存記錄**: 儲存到 RedeemCodes 表

### 兌換點數
1. **驗證兌換碼**: 確認兌換碼存在且未使用
2. **檢查用戶**: 確認用戶存在
3. **更新點數**: 增加用戶點數
4. **標記已使用**: 更新兌換碼狀態
5. **記錄兌換**: 創建兌換記錄

---

## 注意事項

1. **一次性使用**: 每個兌換碼只能使用一次
2. **大小寫敏感**: 兌換碼區分大小寫
3. **批次管理**: 兌換碼按批次組織，方便管理
4. **統計追蹤**: 系統會追蹤兌換碼的使用情況
5. **管理員功能**: 生成兌換碼應該只對管理員開放

