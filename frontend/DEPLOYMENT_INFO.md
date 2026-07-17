# MahjongClub_App 部署資訊

## 🎉 部署完成！

MahjongClub_App 已成功部署到 AWS S3 + CloudFront CDN

---

## 📋 部署資訊

### S3 Bucket
- **Bucket 名稱**: `mahjongclub-app`
- **區域**: `ap-southeast-1` (新加坡)
- **S3 網站 URL**: http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com
- **配置**: 靜態網站託管已啟用

### CloudFront CDN
- **Distribution ID**: `E3I3J0SFSPTE2W`
- **CloudFront URL**: https://d1wa3w4dmfwqc7.cloudfront.net
- **狀態**: 部署中 (需要 15-20 分鐘完成)
- **配置**:
  - ✅ HTTPS 自動重定向
  - ✅ Gzip 壓縮已啟用
  - ✅ 404 錯誤重定向到 index.html (SPA 支援)
  - ✅ 預設根物件: index.html

---

## 🌐 訪問網址

### 立即可用 (S3)
```
http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com
```

### 推薦使用 (CloudFront - 需等待部署完成)
```
https://d1wa3w4dmfwqc7.cloudfront.net
```

---

## 📊 部署內容

### 已上傳的檔案
- ✅ `index.html` - 主頁面
- ✅ `manifest.webmanifest` - PWA 配置
- ✅ `registerSW.js` - Service Worker 註冊
- ✅ `sw.js` - Service Worker
- ✅ `assets/index-hmHbv6af.js` - 主要 JavaScript Bundle (543 KB)

### 快取策略
- **靜態資源** (JS, CSS, 圖片): 1 年快取 (`max-age=31536000`)
- **HTML 檔案**: 不快取 (`max-age=0, must-revalidate`)

---

## 🔄 更新部署

### 方法 1: 使用部署腳本
```powershell
cd MahjongClub_App
.\deploy-simple.ps1 -BucketName mahjongclub-app
```

### 方法 2: 手動更新
```powershell
# 1. 建置專案
npm run build

# 2. 上傳到 S3
aws s3 sync ./dist s3://mahjongclub-app --delete

# 3. 清除 CloudFront 快取
aws cloudfront create-invalidation --distribution-id E3I3J0SFSPTE2W --paths "/*"
```

---

## 🛠️ CloudFront 管理

### 查看部署狀態
```powershell
aws cloudfront get-distribution --id E3I3J0SFSPTE2W --query "Distribution.Status"
```

### 清除快取
```powershell
aws cloudfront create-invalidation --distribution-id E3I3J0SFSPTE2W --paths "/*"
```

### 停用 Distribution
```powershell
# 先獲取當前配置
aws cloudfront get-distribution-config --id E3I3J0SFSPTE2W > dist-config.json

# 修改 Enabled 為 false，然後更新
aws cloudfront update-distribution --id E3I3J0SFSPTE2W --if-match <ETag> --distribution-config file://dist-config.json
```

---

## 💰 成本估算

### S3 儲存
- **儲存空間**: ~0.5 MB
- **預估成本**: < $0.01/月

### CloudFront
- **免費額度**: 每月 1 TB 流量 (AWS 免費方案)
- **超出後**: $0.085/GB (亞太區域)

### 總計
- **預估月成本**: < $1 (低流量情況)

---

## 🔒 安全設定

### S3 Bucket Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::mahjongclub-app/*"
    }
  ]
}
```

### CloudFront 設定
- ✅ 強制 HTTPS
- ✅ 僅允許 GET/HEAD 請求
- ✅ Gzip 壓縮
- ✅ 自訂錯誤頁面

---

## 📝 注意事項

1. **CloudFront 部署時間**: 首次部署需要 15-20 分鐘才能完全生效
2. **快取更新**: 更新檔案後需要清除 CloudFront 快取才能看到變更
3. **SPA 路由**: 已設定 404 錯誤重定向到 index.html，支援前端路由
4. **HTTPS**: CloudFront 自動提供 HTTPS，無需額外設定 SSL 憑證

---

## 🎯 下一步建議

### 1. 設定自訂網域 (可選)
- 在 Route 53 或其他 DNS 服務商設定 CNAME
- 指向: `d1wa3w4dmfwqc7.cloudfront.net`
- 在 CloudFront 中添加自訂網域和 SSL 憑證

### 2. 監控和分析
- 啟用 CloudFront 存取日誌
- 設定 CloudWatch 警報
- 監控流量和成本

### 3. 效能優化
- 考慮使用 CloudFront Functions 進行邊緣運算
- 啟用 HTTP/2 和 HTTP/3
- 設定更細緻的快取策略

---

**部署時間**: 2025-11-21  
**部署區域**: ap-southeast-1 (新加坡)  
**部署狀態**: ✅ 成功

