# 部署腳本說明

## 📦 可用的部署腳本

MahjongClub_App 提供了多個部署腳本，適用於不同的使用場景：

---

## 🚀 QuickDeploy.ps1 - 超快速部署

**最簡單、最快速的部署方式**

### 使用方式
```powershell
.\QuickDeploy.ps1
```

### 特點
- ✅ 一鍵部署
- ✅ 自動建置
- ✅ 自動上傳
- ✅ 極簡輸出
- ✅ 30 秒完成

### 適用場景
- 日常開發測試
- 快速修復
- 頻繁更新

### 輸出範例
```
🚀 快速部署中...
📦 建置...
📤 上傳...
✅ 完成！
🌐 http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com
```

---

## 📋 DeployToS3.ps1 - 完整部署

**功能完整、可自訂的部署方式**

### 使用方式
```powershell
# 基本部署
.\DeployToS3.ps1

# 跳過建置
.\DeployToS3.ps1 -SkipBuild

# 清除 CDN 快取
.\DeployToS3.ps1 -ClearCache

# 組合使用
.\DeployToS3.ps1 -SkipBuild -ClearCache
```

### 特點
- ✅ 完整的部署流程
- ✅ 優化的快取策略
- ✅ 詳細的進度顯示
- ✅ 支援清除 CDN 快取
- ✅ 部署統計資訊

### 快取策略
| 檔案類型 | 快取時間 | 說明 |
|---------|---------|------|
| JS/CSS/圖片 | 1 年 | 長期快取，使用 immutable |
| Service Worker | 不快取 | 即時更新 |
| HTML/JSON | 不快取 | 即時更新 |

### 適用場景
- 正式發布
- 重要更新
- 需要立即生效的變更

### 輸出範例
```
========================================
  MahjongClub_App 快速部署到 S3
========================================

📦 [1/3] 建置專案...
✅ 建置完成

📤 [2/3] 上傳檔案到 S3...
   → 上傳 JS/CSS/圖片 (長期快取)...
   → 上傳 Service Worker (短期快取)...
   → 上傳 HTML/JSON (不快取)...
✅ 檔案上傳完成

🔄 [3/3] 清除 CloudFront 快取...
   → Invalidation ID: I2EXAMPLE
✅ 快取清除請求已提交 (需要 1-5 分鐘生效)

========================================
  ✅ 部署完成！
========================================

🌐 訪問網址:
   S3 直接訪問:
   http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com
   
   CloudFront CDN (推薦):
   https://d1wa3w4dmfwqc7.cloudfront.net

📊 部署統計:
   檔案大小: 0.54 MB
   部署時間: 2025-11-21 23:53:00
```

---

## 🔧 deploy-simple.ps1 - 簡化部署 (舊版)

**保留用於參考，建議使用上述兩個腳本**

### 使用方式
```powershell
.\deploy-simple.ps1
```

---

## 📊 腳本比較

| 特性 | QuickDeploy | DeployToS3 | deploy-simple |
|-----|------------|-----------|--------------|
| 建置專案 | ✅ | ✅ | ✅ |
| 上傳 S3 | ✅ | ✅ | ✅ |
| 優化快取 | ❌ | ✅ | ❌ |
| 清除 CDN | ❌ | ✅ (選項) | ❌ |
| 詳細輸出 | ❌ | ✅ | ✅ |
| 執行速度 | ⚡ 最快 | 🐢 較慢 | 🚀 快 |
| 推薦使用 | 日常開發 | 正式發布 | 不推薦 |

---

## 🎯 使用建議

### 日常開發流程
```powershell
# 1. 修改程式碼
# 2. 快速部署
.\QuickDeploy.ps1
# 3. 訪問 S3 URL 測試
```

### 正式發布流程
```powershell
# 1. 確認程式碼無誤
# 2. 完整部署並清除快取
.\DeployToS3.ps1 -ClearCache
# 3. 訪問 CloudFront URL 驗證
# 4. 通知用戶更新
```

### 緊急修復流程
```powershell
# 1. 修復 Bug
# 2. 快速部署
.\QuickDeploy.ps1
# 3. 手動清除 CDN 快取
aws cloudfront create-invalidation --distribution-id E3I3J0SFSPTE2W --paths "/*"
```

---

## 🌐 部署目標

### S3 Bucket
- **名稱**: mahjongclub-app
- **區域**: ap-southeast-1 (新加坡)
- **URL**: http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com
- **特點**: 立即生效，無快取問題

### CloudFront CDN
- **Distribution ID**: E3I3J0SFSPTE2W
- **URL**: https://d1wa3w4dmfwqc7.cloudfront.net
- **特點**: HTTPS、全球加速、需清除快取

---

## 💡 最佳實踐

### 1. 選擇合適的腳本
- **開發測試**: 使用 `QuickDeploy.ps1`
- **正式發布**: 使用 `DeployToS3.ps1 -ClearCache`

### 2. 快取管理
- 日常開發不清除快取，使用 S3 URL 測試
- 正式發布才清除快取，確保用戶看到最新版本

### 3. 成本控制
- CloudFront 快取清除前 1000 次/月免費
- 避免頻繁清除快取

### 4. 測試流程
- 先在 S3 URL 測試
- 確認無誤後再清除 CDN 快取

---

## 📚 相關文檔

- **部署指南**: [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md)
- **完整部署資訊**: [DEPLOYMENT_INFO.md](./DEPLOYMENT_INFO.md)
- **API 文檔**: [apiDoc/README.md](./apiDoc/README.md)

---

**建立時間**: 2025-11-21  
**最後更新**: 2025-11-21

