# MahjongClub_App S3 部署報告

## ✅ 部署成功！

**部署時間**: 2024-11-22 22:48

---

## 📦 部署資訊

### S3 Bucket
- **Bucket 名稱**: `mahjongclub-app`
- **區域**: `ap-southeast-1` (新加坡)
- **S3 網站 URL**: http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com
- **靜態網站託管**: ✅ 已啟用
- **公開存取**: ✅ 已設定

### CloudFront CDN
- **Distribution ID**: `E3I3J0SFSPTE2W`
- **CloudFront URL**: https://d1wa3w4dmfwqc7.cloudfront.net
- **狀態**: `Deployed`
- **快取清除**: ✅ 已執行 (Invalidation ID: IC88UK8RQUI3DFEQUJL96A1QXJ)

---

## 📁 部署的檔案

```
s3://mahjongclub-app/
├── index.html                                  (4.56 KB)
├── manifest.webmanifest                        (0.38 KB)
├── icon.png
├── sw.js                                       (16.76 KB)
└── assets/
    ├── index-BaevGd-P.js                       (365.13 KB)
    ├── index-BSbjcym5.css                      (1.05 KB)
    └── workbox-window.prod.es5-BIl4cyR9.js     (5.76 KB)
```

**總大小**: ~393 KB (壓縮後 ~105 KB)

---

## 🔧 建置資訊

### Vite 建置
- **版本**: v6.4.1
- **模式**: production
- **建置時間**: 1.42s
- **模組數量**: 1721 modules

### PWA 配置
- **版本**: v1.1.0
- **模式**: injectManifest
- **格式**: es
- **預快取項目**: 6 entries (367.67 KB)
- **Service Worker**: sw.js

---

## 🌐 存取 URL

### 主要 URL (推薦)
**CloudFront CDN**: https://d1wa3w4dmfwqc7.cloudfront.net

**優點**:
- ✅ HTTPS 加密
- ✅ 全球 CDN 加速
- ✅ 自動快取管理
- ✅ 更好的效能

### 備用 URL
**S3 直接存取**: http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com

**注意**: 僅供測試使用，生產環境請使用 CloudFront URL

---

## 📊 快取策略

### 靜態資源 (JS/CSS/圖片)
- **Cache-Control**: `public, max-age=31536000` (1 年)
- **原因**: 檔名包含 hash，內容變更時檔名會改變

### HTML 檔案
- **Cache-Control**: `public, max-age=0, must-revalidate`
- **原因**: 確保用戶總是獲取最新版本

---

## 🔄 更新流程

### 1. 修改代碼後重新部署

```powershell
# 在 MahjongClub_App 目錄下執行
npm run build
aws s3 sync ./dist s3://mahjongclub-app --delete
```

### 2. 清除 CloudFront 快取

```powershell
# 創建 invalidation.json
@"
{
  "Paths": {
    "Quantity": 1,
    "Items": ["/*"]
  },
  "CallerReference": "$(Get-Date -Format 'yyyyMMddHHmmss')"
}
"@ | Out-File -FilePath invalidation.json -Encoding utf8

# 執行清除
aws cloudfront create-invalidation --distribution-id E3I3J0SFSPTE2W --invalidation-batch file://invalidation.json

# 清理
Remove-Item invalidation.json
```

### 3. 或使用部署腳本

```powershell
.\deploy-to-s3.ps1
```

---

## ⚙️ S3 Bucket 配置

### 靜態網站託管
```json
{
  "IndexDocument": {
    "Suffix": "index.html"
  },
  "ErrorDocument": {
    "Key": "index.html"
  }
}
```

### Bucket Policy (公開讀取)
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

---

## 🧪 測試建議

### 1. 功能測試
- [ ] 開啟 CloudFront URL
- [ ] 測試登入功能
- [ ] 測試創建團局功能
- [ ] 測試 GPS 定位功能
- [ ] 測試地址解析功能
- [ ] 測試通知功能

### 2. PWA 測試
- [ ] 檢查 Service Worker 是否正常運作
- [ ] 測試離線功能
- [ ] 測試安裝到主畫面

### 3. 效能測試
- [ ] 使用 Chrome DevTools Lighthouse 測試
- [ ] 檢查 Core Web Vitals
- [ ] 測試不同網路環境下的載入速度

---

## 📝 注意事項

### CloudFront 快取清除
- ⏱️ 快取清除通常需要 **5-10 分鐘** 才能完全生效
- 💰 每月前 1000 次清除免費，之後每次 $0.005
- 🔄 建議在重大更新時才清除快取

### S3 成本
- 💾 儲存: $0.023 per GB/月 (前 50 TB)
- 📤 傳輸: 前 1 GB 免費，之後 $0.09 per GB
- 🔍 請求: GET $0.0004 per 1000 requests

### CloudFront 成本
- 📤 傳輸: 前 1 TB $0.085 per GB
- 🔍 請求: $0.0075 per 10,000 HTTPS requests
- 🎁 AWS 免費方案: 每月 50 GB 傳輸 + 2,000,000 HTTPS 請求

---

## 🎯 後續優化建議

### 1. 自訂網域
- 購買網域 (例如: mahjongclub.app)
- 在 Route 53 設定 DNS
- 在 CloudFront 設定 CNAME
- 申請 SSL 憑證 (AWS Certificate Manager)

### 2. 效能優化
- 啟用 Brotli 壓縮
- 優化圖片 (WebP 格式)
- 實施程式碼分割 (Code Splitting)
- 使用 CDN 預載入 (Preload)

### 3. 監控和分析
- 設定 CloudWatch 監控
- 整合 Google Analytics
- 設定錯誤追蹤 (Sentry)

---

## ✅ 部署檢查清單

- [x] 建置專案成功
- [x] 上傳檔案到 S3
- [x] 設定靜態網站託管
- [x] 設定公開存取權限
- [x] CloudFront Distribution 已部署
- [x] 清除 CloudFront 快取
- [ ] 測試 CloudFront URL
- [ ] 測試所有功能
- [ ] 測試 PWA 功能

---

## 📞 支援資訊

### AWS 資源
- **S3 Console**: https://s3.console.aws.amazon.com/s3/buckets/mahjongclub-app
- **CloudFront Console**: https://console.aws.amazon.com/cloudfront/v3/home#/distributions/E3I3J0SFSPTE2W
- **區域**: ap-southeast-1 (新加坡)

### 相關文檔
- [AWS S3 靜態網站託管](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html)
- [CloudFront 開發者指南](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/)
- [Vite 部署指南](https://vitejs.dev/guide/static-deploy.html)

---

**部署完成！** 🎉

