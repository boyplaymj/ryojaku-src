# MahjongClub_App 部署指南

## 🚀 快速部署

### 方法 1: 超快速部署 (推薦日常使用)
```powershell
.\QuickDeploy.ps1
```
- ✅ 自動建置
- ✅ 自動上傳到 S3
- ✅ 最簡單快速

---

### 方法 2: 完整部署 (推薦正式發布)
```powershell
.\DeployToS3.ps1
```
- ✅ 完整建置
- ✅ 優化快取策略
- ✅ 詳細部署資訊

**進階選項:**
```powershell
# 跳過建置 (已經建置過)
.\DeployToS3.ps1 -SkipBuild

# 清除 CloudFront 快取 (立即生效)
.\DeployToS3.ps1 -ClearCache

# 組合使用
.\DeployToS3.ps1 -SkipBuild -ClearCache
```

---

## 📋 部署腳本說明

### QuickDeploy.ps1
**用途**: 日常開發快速部署  
**特點**: 
- 極簡設計，一鍵部署
- 自動建置和上傳
- 無額外輸出，快速完成

**適用場景**:
- 開發測試
- 快速修復
- 頻繁更新

---

### DeployToS3.ps1
**用途**: 正式發布部署  
**特點**:
- 完整的部署流程
- 優化的快取策略
- 詳細的部署資訊
- 支援清除 CDN 快取

**快取策略**:
- **JS/CSS/圖片**: 1 年快取 (immutable)
- **Service Worker**: 不快取 (即時更新)
- **HTML/JSON**: 不快取 (即時更新)

**適用場景**:
- 正式發布
- 重要更新
- 需要立即生效的變更

---

## 🌐 部署目標

### S3 Bucket
- **名稱**: mahjongclub-app
- **區域**: ap-southeast-1 (新加坡)
- **URL**: http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com

### CloudFront CDN
- **Distribution ID**: E3I3J0SFSPTE2W
- **URL**: https://d1wa3w4dmfwqc7.cloudfront.net
- **特點**: HTTPS、全球加速、自動壓縮

---

## 🔄 常見部署場景

### 場景 1: 修改了程式碼，想快速測試
```powershell
.\QuickDeploy.ps1
```
等待 30 秒，訪問 S3 URL 查看變更。

---

### 場景 2: 正式發布新版本
```powershell
.\DeployToS3.ps1 -ClearCache
```
等待 1-5 分鐘，CloudFront 快取清除後全球用戶都能看到新版本。

---

### 場景 3: 只修改了靜態檔案 (圖片、文字)
```powershell
# 不需要重新建置
.\DeployToS3.ps1 -SkipBuild
```

---

### 場景 4: 緊急修復 Bug
```powershell
# 1. 快速部署
.\QuickDeploy.ps1

# 2. 清除 CDN 快取 (如果需要立即生效)
aws cloudfront create-invalidation --distribution-id E3I3J0SFSPTE2W --paths "/*"
```

---

## 🛠️ 手動部署步驟

如果腳本無法使用，可以手動執行：

### 1. 設定 AWS 憑證
```powershell
$env:AWS_ACCESS_KEY_ID = "<REDACTED_AWS_ACCESS_KEY_ID>"
$env:AWS_SECRET_ACCESS_KEY = "<REDACTED_AWS_SECRET_ACCESS_KEY>"
$env:AWS_DEFAULT_REGION = "ap-southeast-1"
```

### 2. 建置專案
```powershell
npm run build
```

### 3. 上傳到 S3
```powershell
aws s3 sync ./dist s3://mahjongclub-app --delete
```

### 4. 清除 CloudFront 快取 (可選)
```powershell
aws cloudfront create-invalidation --distribution-id E3I3J0SFSPTE2W --paths "/*"
```

---

## 📊 部署檢查清單

部署前檢查:
- [ ] 程式碼已提交到 Git
- [ ] 本地測試通過
- [ ] 已更新版本號 (如適用)

部署後檢查:
- [ ] S3 URL 可以訪問
- [ ] CloudFront URL 可以訪問 (如有清除快取)
- [ ] 所有功能正常運作
- [ ] 手機版顯示正常
- [ ] GPS 定位功能正常

---

## ⚠️ 注意事項

### 快取問題
- **S3 直接訪問**: 立即生效
- **CloudFront 訪問**: 需要清除快取或等待快取過期

### 清除快取的時機
- ✅ 正式發布新版本
- ✅ 修改了 HTML 或 API 端點
- ✅ 緊急修復需要立即生效
- ❌ 日常開發測試 (使用 S3 URL 即可)

### 成本考量
- S3 上傳: 免費
- CloudFront 快取清除: 前 1000 次/月免費
- 建議: 日常開發不清除快取，正式發布才清除

---

## 🔍 故障排除

### 問題 1: 上傳失敗
**原因**: AWS 憑證過期或錯誤  
**解決**: 檢查 AWS 憑證是否正確

### 問題 2: 看不到最新變更
**原因**: CloudFront 快取未清除  
**解決**: 使用 `-ClearCache` 參數或訪問 S3 URL

### 問題 3: 建置失敗
**原因**: 程式碼錯誤或依賴問題  
**解決**: 檢查錯誤訊息，修復後重新部署

---

## 📞 相關資源

- **完整部署資訊**: [DEPLOYMENT_INFO.md](./DEPLOYMENT_INFO.md)
- **API 文檔**: [apiDoc/README.md](./apiDoc/README.md)
- **AWS Console**: https://console.aws.amazon.com/

---

**最後更新**: 2025-11-21

