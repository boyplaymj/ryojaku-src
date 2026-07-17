# 部署快速參考

## 🚀 一鍵部署

```powershell
# 最快速的方式
.\QuickDeploy.ps1
```

---

## 📋 常用命令

### 日常開發
```powershell
.\QuickDeploy.ps1
```

### 正式發布
```powershell
.\DeployToS3.ps1 -ClearCache
```

### 只上傳不建置
```powershell
.\DeployToS3.ps1 -SkipBuild
```

### 只清除快取
```powershell
aws cloudfront create-invalidation --distribution-id E3I3J0SFSPTE2W --paths "/*"
```

---

## 🌐 訪問網址

### S3 (立即生效)
```
http://mahjongclub-app.s3-website-ap-southeast-1.amazonaws.com
```

### CloudFront (需清除快取)
```
https://d1wa3w4dmfwqc7.cloudfront.net
```

---

## 💡 快速提示

| 場景 | 命令 | 時間 |
|-----|------|------|
| 測試修改 | `.\QuickDeploy.ps1` | 30秒 |
| 正式發布 | `.\DeployToS3.ps1 -ClearCache` | 2分鐘 |
| 緊急修復 | `.\QuickDeploy.ps1` + 清除快取 | 1分鐘 |

---

## 🔧 AWS 資訊

- **Bucket**: mahjongclub-app
- **Region**: ap-southeast-1
- **CloudFront ID**: E3I3J0SFSPTE2W

---

**提示**: 日常開發使用 S3 URL，正式發布使用 CloudFront URL

