# 超快速部署腳本 - 建置並上傳到 S3
# 使用方式: .\QuickDeploy.ps1

$BucketName = "mahjongclub-app"
$Region = "ap-southeast-1"

# AWS 憑證
$env:AWS_ACCESS_KEY_ID = "<REDACTED_AWS_ACCESS_KEY_ID>"
$env:AWS_SECRET_ACCESS_KEY = "<REDACTED_AWS_SECRET_ACCESS_KEY>"
$env:AWS_DEFAULT_REGION = $Region

Write-Host "🚀 快速部署中..." -ForegroundColor Cyan

# 建置
Write-Host "📦 建置..." -ForegroundColor Yellow
npm run build | Out-Null

# 上傳
Write-Host "📤 上傳..." -ForegroundColor Yellow
aws s3 sync ./dist s3://$BucketName --delete --quiet

Write-Host "✅ 完成！" -ForegroundColor Green
Write-Host "🌐 http://$BucketName.s3-website-$Region.amazonaws.com" -ForegroundColor Cyan

