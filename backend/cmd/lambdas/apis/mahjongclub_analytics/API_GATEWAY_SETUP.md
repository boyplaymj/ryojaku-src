# API Gateway 設置指南

本文檔說明如何為 mahjongclub_analytics Lambda 函數設置 API Gateway。

## 📋 前置需求

- Lambda 函數 `Linebot_mahjongclub_analytics_Go-Local` 已部署
- AWS Console 訪問權限
- 基本的 API Gateway 知識

## 🚀 設置步驟

### 1. 創建 REST API

1. 登入 AWS Console
2. 前往 **API Gateway** 服務
3. 點擊 **Create API**
4. 選擇 **REST API** (不是 Private)
5. 點擊 **Build**
6. 配置：
   - **API name**: `MahjongClubAnalyticsAPI`
   - **Description**: `Analytics API for Mahjong Club Dashboard`
   - **Endpoint Type**: `Regional`
7. 點擊 **Create API**

### 2. 創建資源和方法

#### 2.1 創建 /analytics 資源

1. 在 Resources 頁面，點擊 **Actions** → **Create Resource**
2. 配置：
   - **Resource Name**: `analytics`
   - **Resource Path**: `analytics`
   - 勾選 **Enable API Gateway CORS**
3. 點擊 **Create Resource**

#### 2.2 創建子資源

重複以下步驟創建所有子資源：

**在 /analytics 下創建：**
- `/analytics/overview`
- `/analytics/users`
- `/analytics/games`
- `/analytics/registrations`
- `/analytics/ratings`
- `/analytics/realtime`

**在 /analytics/users 下創建：**
- `/analytics/users/growth`
- `/analytics/users/stats`

**在 /analytics/games 下創建：**
- `/analytics/games/stats`
- `/analytics/games/status`

**在 /analytics/registrations 下創建：**
- `/analytics/registrations/stats`

**在 /analytics/ratings 下創建：**
- `/analytics/ratings/stats`

### 3. 為每個端點創建 GET 方法

對每個端點（例如 `/analytics/overview`）：

1. 選擇資源
2. 點擊 **Actions** → **Create Method**
3. 選擇 **GET**
4. 點擊勾選圖示
5. 配置：
   - **Integration type**: `Lambda Function`
   - **Use Lambda Proxy integration**: 勾選
   - **Lambda Region**: `ap-southeast-1`
   - **Lambda Function**: `Linebot_mahjongclub_analytics_Go-Local`
6. 點擊 **Save**
7. 在彈出的權限對話框中點擊 **OK**

### 4. 啟用 CORS

對每個資源：

1. 選擇資源
2. 點擊 **Actions** → **Enable CORS**
3. 保持預設設置：
   - **Access-Control-Allow-Methods**: `GET,OPTIONS`
   - **Access-Control-Allow-Headers**: `Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token`
   - **Access-Control-Allow-Origin**: `*`
4. 點擊 **Enable CORS and replace existing CORS headers**
5. 點擊 **Yes, replace existing values**

### 5. 部署 API

1. 點擊 **Actions** → **Deploy API**
2. 配置：
   - **Deployment stage**: `[New Stage]`
   - **Stage name**: `prod`
   - **Stage description**: `Production`
   - **Deployment description**: `Initial deployment`
3. 點擊 **Deploy**

### 6. 獲取 API URL

部署完成後：

1. 在左側選擇 **Stages**
2. 展開 `prod` stage
3. 複製 **Invoke URL**，格式類似：
   ```
   https://xxxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com/prod
   ```

### 7. 測試 API

使用瀏覽器或 curl 測試：

```bash
# 測試 overview 端點
curl https://YOUR_API_URL/prod/analytics/overview

# 測試 user growth 端點
curl "https://YOUR_API_URL/prod/analytics/users/growth?days=7"
```

## 📝 完整的 API 端點列表

| 端點 | 方法 | 說明 | 參數 |
|------|------|------|------|
| `/analytics/overview` | GET | 總覽數據 | - |
| `/analytics/users/growth` | GET | 用戶成長數據 | `days` (可選) |
| `/analytics/users/stats` | GET | 用戶統計 | - |
| `/analytics/games/stats` | GET | 團局統計 | `days` (可選) |
| `/analytics/games/status` | GET | 團局狀態分布 | - |
| `/analytics/registrations/stats` | GET | 報名統計 | `days` (可選) |
| `/analytics/ratings/stats` | GET | 評分統計 | - |
| `/analytics/realtime` | GET | 即時數據 | - |

## 🔧 進階配置（可選）

### 設置 API Key

1. 在左側選擇 **API Keys**
2. 點擊 **Actions** → **Create API Key**
3. 配置 API Key
4. 在 **Usage Plans** 中創建使用計劃
5. 將 API Key 關聯到使用計劃
6. 在方法請求中啟用 **API Key Required**

### 設置請求限流

1. 在左側選擇 **Usage Plans**
2. 創建新的使用計劃
3. 設置：
   - **Throttle**: 每秒請求數限制
   - **Quota**: 每日/每月請求數限制

### 設置自定義域名

1. 在左側選擇 **Custom Domain Names**
2. 創建自定義域名
3. 配置 SSL 證書（使用 ACM）
4. 設置 Base Path Mapping
5. 在 Route 53 中創建 CNAME 記錄

## 🐛 故障排除

### CORS 錯誤

如果遇到 CORS 錯誤：

1. 確認已為所有資源啟用 CORS
2. 確認 Lambda 函數返回正確的 CORS headers
3. 檢查瀏覽器控制台的詳細錯誤訊息

### Lambda 權限錯誤

如果 API Gateway 無法調用 Lambda：

1. 前往 Lambda 函數的 **Configuration** → **Permissions**
2. 檢查 **Resource-based policy**
3. 確認有 API Gateway 的調用權限
4. 如果沒有，重新在 API Gateway 中設置方法

### 502 Bad Gateway

如果返回 502 錯誤：

1. 檢查 Lambda 函數是否正常運行
2. 查看 CloudWatch Logs 中的錯誤訊息
3. 確認 Lambda 函數返回正確的格式

## 📊 監控和日誌

### CloudWatch Logs

Lambda 函數的日誌位於：
- Log Group: `/aws/lambda/Linebot_mahjongclub_analytics_Go-Local`

API Gateway 的日誌：
1. 在 Stage 設置中啟用 **CloudWatch Logs**
2. 設置 **Log Level** 為 `INFO` 或 `ERROR`

### CloudWatch Metrics

監控以下指標：
- **Count**: 請求總數
- **Latency**: 請求延遲
- **4XXError**: 客戶端錯誤
- **5XXError**: 伺服器錯誤

## 🔐 安全建議

1. **啟用 API Key**: 防止未授權訪問
2. **設置請求限流**: 防止 DDoS 攻擊
3. **使用 HTTPS**: 確保數據傳輸安全
4. **定期審查日誌**: 檢測異常活動
5. **最小權限原則**: Lambda 執行角色只授予必要權限

## 📝 更新 API

當 Lambda 函數更新後：

1. API Gateway 會自動使用最新版本的 Lambda
2. 不需要重新部署 API
3. 如果修改了 API 結構，需要重新部署

## 🔄 下一步

完成 API Gateway 設置後：

1. 複製 Invoke URL
2. 更新前端 `js/config.js` 中的 `API_CONFIG.baseURL`
3. 部署前端網站
4. 測試所有功能

## 📞 支援

如有問題，請檢查：
- AWS API Gateway 文檔
- CloudWatch Logs
- Lambda 函數日誌

