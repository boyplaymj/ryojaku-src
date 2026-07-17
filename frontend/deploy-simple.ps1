# 簡化版 S3 部署腳本
param(
    [string]$BucketName = "mahjongclub-app-web",
    [string]$Region = "ap-southeast-1"
)

Write-Host "=== MahjongClub_App 部署到 S3 ===" -ForegroundColor Green
Write-Host ""

# 設定 AWS 憑證
$env:AWS_ACCESS_KEY_ID = "<REDACTED_AWS_ACCESS_KEY_ID>"
$env:AWS_SECRET_ACCESS_KEY = "<REDACTED_AWS_SECRET_ACCESS_KEY>"
$env:AWS_DEFAULT_REGION = $Region

# 1. 建置專案
Write-Host "📦 步驟 1: 建置專案..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 建置失敗！" -ForegroundColor Red
    exit 1
}
Write-Host "✅ 建置完成" -ForegroundColor Green
Write-Host ""

# 2. 檢查並創建 S3 Bucket
Write-Host "🪣 步驟 2: 檢查 S3 Bucket..." -ForegroundColor Cyan
aws s3api head-bucket --bucket $BucketName 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Bucket 不存在，正在創建..." -ForegroundColor Yellow
    aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration LocationConstraint=$Region
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 創建 Bucket 失敗！" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Bucket 創建成功" -ForegroundColor Green
}
else {
    Write-Host "✅ Bucket 已存在" -ForegroundColor Green
}
Write-Host ""

# 3. 設定靜態網站託管
Write-Host "🌐 步驟 3: 設定靜態網站託管..." -ForegroundColor Cyan
$websiteConfig = '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"index.html"}}'
$websiteConfig | Out-File -FilePath "website-config.json" -Encoding utf8 -NoNewline
aws s3api put-bucket-website --bucket $BucketName --website-configuration file://website-config.json
Remove-Item "website-config.json" -ErrorAction SilentlyContinue
Write-Host "✅ 靜態網站託管設定完成" -ForegroundColor Green
Write-Host ""

# 4. 設定公開存取
Write-Host "🔓 步驟 4: 設定 Bucket 公開存取..." -ForegroundColor Cyan
aws s3api put-public-access-block --bucket $BucketName --public-access-block-configuration BlockPublicAcls=false, IgnorePublicAcls=false, BlockPublicPolicy=false, RestrictPublicBuckets=false

$policyJson = @{
    Version   = "2012-10-17"
    Statement = @(
        @{
            Sid       = "PublicReadGetObject"
            Effect    = "Allow"
            Principal = "*"
            Action    = "s3:GetObject"
            Resource  = "arn:aws:s3:::$BucketName/*"
        }
    )
} | ConvertTo-Json -Depth 10 -Compress
$policyJson | Out-File -FilePath "bucket-policy.json" -Encoding utf8 -NoNewline
aws s3api put-bucket-policy --bucket $BucketName --policy file://bucket-policy.json
Remove-Item "bucket-policy.json" -ErrorAction SilentlyContinue
Write-Host "✅ Bucket 公開存取設定完成" -ForegroundColor Green
Write-Host ""

# 5. 上傳檔案
Write-Host "📤 步驟 5: 上傳檔案到 S3..." -ForegroundColor Cyan
Write-Host "   上傳靜態資源 (長期快取)..." -ForegroundColor Yellow
aws s3 sync ./dist s3://$BucketName --delete --cache-control "public, max-age=31536000" --exclude "*.html" --exclude "*.json"

Write-Host "   上傳 HTML 檔案 (不快取)..." -ForegroundColor Yellow
aws s3 sync ./dist s3://$BucketName --cache-control "public, max-age=0, must-revalidate" --exclude "*" --include "*.html" --include "*.json"

Write-Host "✅ 檔案上傳完成" -ForegroundColor Green
Write-Host ""

# 6. 顯示結果
$s3WebsiteUrl = "http://$BucketName.s3-website-$Region.amazonaws.com"
Write-Host ""
Write-Host "=== 部署完成！===" -ForegroundColor Green
Write-Host ""
Write-Host "📋 部署資訊:" -ForegroundColor Cyan
Write-Host "   S3 Bucket: $BucketName" -ForegroundColor White
Write-Host "   區域: $Region" -ForegroundColor White
Write-Host "   S3 網站 URL: $s3WebsiteUrl" -ForegroundColor White
Write-Host ""
Write-Host "🌐 請在瀏覽器中訪問: $s3WebsiteUrl" -ForegroundColor Yellow
Write-Host ""
Write-Host "💡 下一步: 設定 CloudFront CDN" -ForegroundColor Cyan
Write-Host "   1. 前往 AWS CloudFront Console" -ForegroundColor White
Write-Host "   2. 點擊 Create Distribution" -ForegroundColor White
Write-Host "   3. Origin Domain: $BucketName.s3-website-$Region.amazonaws.com" -ForegroundColor White
Write-Host "   4. Viewer Protocol Policy: Redirect HTTP to HTTPS" -ForegroundColor White
Write-Host "   5. Default Root Object: index.html" -ForegroundColor White
Write-Host "   6. Custom Error Response: 404 to /index.html with 200 status" -ForegroundColor White
Write-Host ""

