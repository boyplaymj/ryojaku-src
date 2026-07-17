# MahjongClub API 快速參考

## Base URL
```
https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com
```

---

## 認證方式

所有需要認證的 API 支援兩種方式：

### APP 用戶
```
?userId=APP_xxxxxxxxxxxx
```

### LINE Bot 用戶
```
?lineID=<encrypted_line_id>
```

---

## API 端點列表

### 🔐 認證相關

| 端點 | 方法 | 認證 | 說明 |
|------|------|------|------|
| `/mahjongclub_app_register` | POST | ❌ | 註冊 APP 用戶 |
| `/mahjongclub_app_login` | POST | ❌ | APP 用戶登入 |
| `/mahjongclub_web_verify_user` | POST | ✅ | 驗證用戶身份 |

### 🎮 團局管理

| 端點 | 方法 | 認證 | 點數 | 說明 |
|------|------|------|------|------|
| `/mahjongclub_web_create_game` | POST | ✅ | -120 | 創建團局 |
| `/mahjongclub_web_search_games` | POST | ❌ | 0 | 搜尋團局 |
| `/mahjongclub_web_game_detail` | POST | ❌ | 0 | 團局詳情 |
| `/mahjongclub_web_my_games` | POST | ✅ | 0 | 我的團局 |
| `/mahjongclub_web_cancel_game` | POST | ✅ | 0 | 取消團局 |

### 👥 報名管理

| 端點 | 方法 | 認證 | 點數 | 說明 |
|------|------|------|------|------|
| `/mahjongclub_web_register` | POST | ✅ | -20 | 報名團局 |
| `/mahjongclub_web_accept_registration` | POST | ✅ | 0 | 接受報名 |
| `/mahjongclub_web_reject_registration` | POST | ✅ | 0 | 拒絕報名 |

### 👤 用戶資料

| 端點 | 方法 | 認證 | 說明 |
|------|------|------|------|
| `/mahjongclub_web_user_profile` | POST | ✅ | 獲取/更新用戶資料 |
| `/mahjongclub_web_user_info` | GET | ❌ | 獲取用戶基本資訊 |

### ⭐ 評分系統

| 端點 | 方法 | 認證 | 說明 |
|------|------|------|------|
| `/mahjongclub_web_get_ratings` | POST | ✅ | 獲取評分列表 |
| `/mahjongclub_web_submit_rating` | POST | ✅ | 提交評分 |
| `/mahjongclub_web_user_comments` | GET | ❌ | 獲取用戶評論 |

### 🔔 通知系統

| 端點 | 方法 | 認證 | 說明 |
|------|------|------|------|
| `/mahjongclub_web_notifications` | GET | ✅ | 獲取通知列表 |
| `/mahjongclub_web_subscribe_push` | POST | ✅ | 訂閱推送通知 |
| `/mahjongclub_web_unsubscribe_push` | POST | ✅ | 取消訂閱 |
| `/mahjongclub_web_subscription_status` | GET | ✅ | 查詢訂閱狀態 |
| `/mahjongclub_web_vapid_key` | GET | ❌ | 獲取 VAPID 公鑰 |

---

## 點數系統

| 操作 | 點數變化 | 說明 |
|------|---------|------|
| 註冊 | +0 | 新用戶初始點數為 0 |
| 創建團局 | -120 | 創建團局扣除 120 點 |
| 報名團局 | -20 | 報名扣除 20 點 |
| 報名被拒絕 | +20 | 退還報名費 |
| 取消團局 | +120 | 退還創建費 |
| 兌換點數 | +N | 使用兌換碼增加點數 |

---

## 團局狀態

| 狀態 | 說明 |
|------|------|
| `recruiting` | 招募中 |
| `full` | 已滿 |
| `in_progress` | 進行中 |
| `completed` | 已完成 |
| `cancelled` | 已取消 |

---

## 報名狀態

| 狀態 | 說明 |
|------|------|
| `pending` | 待審核 |
| `accepted` | 已接受 |
| `rejected` | 已拒絕 |
| `cancelled` | 已取消 |

---

## 選項欄位值

### 性別 (gender)
```
"男", "女", "其他"
```

### 年齡範圍 (ageRange)
```
"18-25", "26-35", "36-45", "46-55", "56+"
```

### 麻將經驗 (mahjongExperience)
```
"新手", "初級", "中級", "高級", "專家"
```

### 麻將規則 (rules)
```
"基本三將", "台麻", "港式", "日麻", "見花", "其他"
```

### 場地特色 (features)
```
"有冷氣", "有停車位", "近捷運", "可吸菸", "提供餐點", "安靜環境"
```

### 玩家限制 (restrictions)
```
"新手友善", "中級以上", "高手限定", "女性優先", "學生限定", "無限制"
```

---

## 錯誤碼

| HTTP 狀態碼 | 說明 |
|------------|------|
| 200 | 成功 |
| 400 | 請求參數錯誤 |
| 401 | 未授權/認證失敗 |
| 403 | 禁止訪問 |
| 404 | 資源不存在 |
| 409 | 資源衝突 |
| 500 | 伺服器內部錯誤 |

---

## 常見錯誤訊息

| 錯誤訊息 | 原因 | 解決方法 |
|---------|------|---------|
| `Missing userId or lineID parameter` | 缺少用戶識別參數 | 提供 userId 或 lineID |
| `Failed to decrypt LINE ID` | LINE ID 解密失敗 | 檢查 LINE ID 是否正確加密 |
| `User not found` | 用戶不存在 | 確認用戶已註冊 |
| `Insufficient points` | 點數不足 | 充值或兌換點數 |
| `Game is full` | 團局已滿 | 選擇其他團局 |
| `Already registered` | 已報名 | 無需重複報名 |

---

## 測試範例

### JavaScript 通用請求函數
```javascript
async function apiRequest(endpoint, options = {}) {
  const baseUrl = 'https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com';
  const url = `${baseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  
  return await response.json();
}

// 使用範例
const result = await apiRequest('/mahjongclub_web_search_games?type=all');
console.log(result);
```

