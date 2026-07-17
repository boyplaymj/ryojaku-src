# 事件命令 API

## 基本資訊

- **API 名稱**: 事件命令
- **Lambda 函數**: `Linebot_mahjongclub_event_commands_Go-Local`
- **API Gateway**: Lambda Function URL
- **端點**: 多個事件命令端點
- **完整 URL**: `https://[function-url]/event-commands/*`

---

## 功能說明

管理活動兌換碼命令，包括創建、查詢、更新和刪除活動命令。用於管理限時活動和兌換碼發放。

---

## API 端點

### 1. 創建命令
- **端點**: `POST /event-commands`
- **說明**: 創建新的活動命令

### 2. 獲取所有命令
- **端點**: `GET /event-commands`
- **說明**: 獲取所有活動命令列表

### 3. 獲取單個命令
- **端點**: `GET /event-commands/{commandId}`
- **說明**: 獲取指定命令的詳細資訊

### 4. 更新命令
- **端點**: `PUT /event-commands/{commandId}`
- **說明**: 更新命令狀態或兌換碼數量

### 5. 刪除命令
- **端點**: `DELETE /event-commands/{commandId}`
- **說明**: 刪除命令

### 6. 獲取兌換記錄
- **端點**: `GET /event-commands/{commandId}/redemptions`
- **說明**: 獲取命令的兌換記錄

---

## 1. 創建命令

### Request Body

```json
{
  "command": "WELCOME2025",
  "codeCount": 100,
  "points": 500,
  "startTime": "2025-01-01T00:00:00Z",
  "endTime": "2025-01-31T23:59:59Z",
  "createdBy": "admin"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `command` | string | ✅ | 命令名稱 (唯一) |
| `codeCount` | number | ✅ | 兌換碼數量 |
| `points` | number | ✅ | 每個兌換碼的點數 |
| `startTime` | string | ✅ | 開始時間 (ISO 8601) |
| `endTime` | string | ✅ | 結束時間 (ISO 8601) |
| `createdBy` | string | ✅ | 創建者 |

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": {
    "commandId": "cmd_xxxxxxxxxxxx",
    "command": "WELCOME2025",
    "codeCount": 100,
    "points": 500,
    "usedCount": 0,
    "startTime": "2025-01-01T00:00:00Z",
    "endTime": "2025-01-31T23:59:59Z",
    "isActive": "true",
    "createdBy": "admin",
    "createdAt": "2025-11-21T15:30:00Z"
  }
}
```

---

## 2. 獲取所有命令

### 成功回應 (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "commandId": "cmd_xxxxxxxxxxxx",
      "command": "WELCOME2025",
      "codeCount": 100,
      "points": 500,
      "usedCount": 25,
      "startTime": "2025-01-01T00:00:00Z",
      "endTime": "2025-01-31T23:59:59Z",
      "isActive": "true"
    }
  ]
}
```

---

## 3. 更新命令

### Request Body

```json
{
  "commandId": "cmd_xxxxxxxxxxxx",
  "isActive": false,
  "codeCount": 150
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `commandId` | string | ✅ | 命令 ID |
| `isActive` | boolean | ❌ | 是否啟用 |
| `codeCount` | number | ❌ | 更新兌換碼數量 |

---

## 請求範例

### JavaScript (Fetch) - 創建命令
```javascript
async function createEventCommand() {
  const response = await fetch(
    'https://[function-url]/event-commands',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        command: 'WELCOME2025',
        codeCount: 100,
        points: 500,
        startTime: '2025-01-01T00:00:00Z',
        endTime: '2025-01-31T23:59:59Z',
        createdBy: 'admin'
      })
    }
  );
  
  const result = await response.json();
  if (result.success) {
    console.log('命令創建成功:', result.data);
  }
}
```

---

## 業務邏輯

1. **命令唯一性**: 命令名稱必須唯一
2. **時間驗證**: 開始時間必須早於結束時間
3. **兌換碼生成**: 創建命令時自動生成指定數量的兌換碼
4. **狀態管理**: 可以啟用/停用命令
5. **使用追蹤**: 記錄已使用的兌換碼數量

---

## 注意事項

1. **管理員專用**: 此 API 應該只對管理員開放
2. **命令格式**: 建議使用大寫字母和數字
3. **時間範圍**: 確保活動時間合理
4. **兌換碼數量**: 根據活動規模設定合適的數量

