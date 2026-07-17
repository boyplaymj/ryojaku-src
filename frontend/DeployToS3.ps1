# MahjongClub_App 快速部署到 S3 腳本
# 使用方式: .\DeployToS3.ps1 [-SkipBuild] [-ClearCache]

param(
    [switch]$SkipBuild = $false,
    [switch]$ClearCache = $false
)

# 設定
$BucketName = "mahjongclub-app"
$Region = "ap-southeast-1"
$CloudFrontDistributionId = "E3I3J0SFSPTE2W"

# AWS 憑證
$env:AWS_ACCESS_KEY_ID = "<REDACTED_AWS_ACCESS_KEY_ID>"
$env:AWS_SECRET_ACCESS_KEY = "<REDACTED_AWS_SECRET_ACCESS_KEY>"
$env:AWS_DEFAULT_REGION = $Region

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MahjongClub_App 快速部署到 S3" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 步驟 1: 建置專案
if (-not $SkipBuild) {
    Write-Host "📦 [1/3] 建置專案..." -ForegroundColor Green
    Write-Host ""
    
    npm run build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "❌ 建置失敗！" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "✅ 建置完成" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "⏭️  [1/3] 跳過建置步驟" -ForegroundColor Yellow
    Write-Host ""
}

# 步驟 2: 上傳到 S3
Write-Host "📤 [2/3] 上傳檔案到 S3..." -ForegroundColor Green
Write-Host ""

# 上傳靜態資源 (長期快取)
Write-Host "   → 上傳 JS/CSS/圖片 (長期快取)..." -ForegroundColor Cyan
aws s3 sync ./dist s3://$BucketName `
    --delete `
    --cache-control "public, max-age=31536000, immutable" `
    --exclude "*.html" `
    --exclude "*.json" `
    --exclude "sw.js" `
    --exclude "registerSW.js"

# 上傳 Service Worker (短期快取)
Write-Host "   → 上傳 Service Worker (短期快取)..." -ForegroundColor Cyan
aws s3 sync ./dist s3://$BucketName `
    --cache-control "public, max-age=0, must-revalidate" `
    --exclude "*" `
    --include "sw.js" `
    --include "registerSW.js"

# 上傳 HTML 和 JSON (不快取)
Write-Host "   → 上傳 HTML/JSON (不快取)..." -ForegroundColor Cyan
aws s3 sync ./dist s3://$BucketName `
    --cache-control "public, max-age=0, must-revalidate" `
    --exclude "*" `
    --include "*.html" `
    --include "*.json"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ 上傳失敗！" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ 檔案上傳完成" -ForegroundColor Green
Write-Host ""

# 步驟 3: 清除 CloudFront 快取
if ($ClearCache) {
    Write-Host "🔄 [3/3] 清除 CloudFront 快取..." -ForegroundColor Green
    Write-Host ""
    
    $callerRef = Get-Date -Format 'yyyyMMddHHmmss'
    $invalidationJson = @{
        Paths = @{
            Quantity = 1
            Items = @("/*")
        }
        CallerReference = $callerRef
    } | ConvertTo-Json -Depth 10 -Compress
    
    [System.IO.File]::WriteAllText("invalidation.json", $invalidationJson)
    
    $invalidation = aws cloudfront create-invalidation `
        --distribution-id $CloudFrontDistributionId `
        --invalidation-batch file://invalidation.json `
        --output json | ConvertFrom-Json
    
    Remove-Item "invalidation.json" -ErrorAction SilentlyContinue
    
    $invalidationId = $invalidation.Invalidation.Id
    
    Write-Host "   → Invalidation ID: $invalidationId" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "✅ 快取清除請求已提交 (需要 1-5 分鐘生效)" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "⏭️  [3/3] 跳過清除快取 (使用 -ClearCache 參數啟用)" -ForegroundColor Yellow
    Write-Host ""
}

# 顯示結果
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ 部署完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 訪問網址:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   S3 直接訪問:" -ForegroundColor White
Write-Host "   http://$BucketName.s3-website-$Region.amazonaws.com" -ForegroundColor Yellow
Write-Host ""
Write-Host "   CloudFront CDN (推薦):" -ForegroundColor White
Write-Host "   https://d1wa3w4dmfwqc7.cloudfront.net" -ForegroundColor Yellow
Write-Host ""

if ($ClearCache) {
    Write-Host "💡 提示: CloudFront 快取清除需要 1-5 分鐘生效" -ForegroundColor Cyan
} else {
    Write-Host "💡 提示: 如需立即看到變更，請使用 -ClearCache 參數" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "📊 部署統計:" -ForegroundColor Cyan
$distSize = (Get-ChildItem -Path ./dist -Recurse | Measure-Object -Property Length -Sum).Sum
$distSizeMB = [math]::Round($distSize / 1MB, 2)
Write-Host "   檔案大小: $distSizeMB MB" -ForegroundColor White
Write-Host "   部署時間: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host ""

