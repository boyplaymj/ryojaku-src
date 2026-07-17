# MahjongClub_App S3 + CloudFront 部署腳本
# 部署到 AWS 新加坡區域 (ap-southeast-1)

param(
    [string]$BucketName = "mahjongclub-app",
    [string]$Region = "ap-southeast-1",
    [switch]$SkipBuild = $false
)

Write-Host "=== MahjongClub_App 部署到 S3 + CloudFront ===" -ForegroundColor Green
Write-Host ""

# 設定 AWS 憑證
$env:AWS_ACCESS_KEY_ID = "<REDACTED_AWS_ACCESS_KEY_ID>"
$env:AWS_SECRET_ACCESS_KEY = "<REDACTED_AWS_SECRET_ACCESS_KEY>"
$env:AWS_DEFAULT_REGION = $Region

# 1. 建置專案
if (-not $SkipBuild) {
    Write-Host "📦 步驟 1: 建置專案..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 建置失敗！" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ 建置完成" -ForegroundColor Green
    Write-Host ""
}
else {
    Write-Host "⏭️  跳過建置步驟" -ForegroundColor Yellow
    Write-Host ""
}

# 2. 檢查 S3 Bucket 是否存在
Write-Host "🪣 步驟 2: 檢查 S3 Bucket..." -ForegroundColor Cyan
$bucketExists = aws s3api head-bucket --bucket $BucketName 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Bucket 不存在，正在創建..." -ForegroundColor Yellow
    
    # 創建 S3 Bucket
    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $BucketName --region $Region
    }
    else {
        aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration LocationConstraint=$Region
    }
    
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

# 3. 設定 Bucket 為靜態網站託管
Write-Host "🌐 步驟 3: 設定靜態網站託管..." -ForegroundColor Cyan
@'
{
    "IndexDocument": {
        "Suffix": "index.html"
    },
    "ErrorDocument": {
        "Key": "index.html"
    }
}
'@ | Out-File -FilePath "website-config.json" -Encoding utf8
aws s3api put-bucket-website --bucket $BucketName --website-configuration file://website-config.json
Remove-Item "website-config.json"
Write-Host "✅ 靜態網站託管設定完成" -ForegroundColor Green
Write-Host ""

# 4. 設定 Bucket 公開存取
Write-Host "🔓 步驟 4: 設定 Bucket 公開存取..." -ForegroundColor Cyan
aws s3api put-public-access-block --bucket $BucketName --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

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
} | ConvertTo-Json -Depth 10
$policyJson | Out-File -FilePath "bucket-policy.json" -Encoding utf8
aws s3api put-bucket-policy --bucket $BucketName --policy file://bucket-policy.json
Remove-Item "bucket-policy.json"
Write-Host "✅ Bucket 公開存取設定完成" -ForegroundColor Green
Write-Host ""

# 5. 上傳檔案到 S3
Write-Host "📤 步驟 5: 上傳檔案到 S3..." -ForegroundColor Cyan
aws s3 sync ./dist s3://$BucketName --delete --cache-control "public, max-age=31536000" --exclude "index.html" --exclude "*.html"
aws s3 sync ./dist s3://$BucketName --delete --cache-control "public, max-age=0, must-revalidate" --exclude "*" --include "index.html" --include "*.html"
Write-Host "✅ 檔案上傳完成" -ForegroundColor Green
Write-Host ""

# 6. 獲取 S3 網站 URL
$s3WebsiteUrl = "http://$BucketName.s3-website-$Region.amazonaws.com"
Write-Host "🌐 S3 網站 URL: $s3WebsiteUrl" -ForegroundColor Cyan
Write-Host ""

# 7. 清除 CloudFront 快取
Write-Host "☁️  步驟 6: 清除 CloudFront 快取..." -ForegroundColor Cyan

$DistributionId = "E3I3J0SFSPTE2W"
$CloudFrontUrl = "https://d1wa3w4dmfwqc7.cloudfront.net"

Write-Host "   正在為 $CloudFrontUrl (ID: $DistributionId) 建立失效請求..." -ForegroundColor Yellow

# 創建失效請求
$callerRef = Get-Date -Format 'yyyyMMddHHmmss'
$invalidationJson = @{
    Paths           = @{
        Quantity = 1
        Items    = @("/*")
    }
    CallerReference = $callerRef
} | ConvertTo-Json -Depth 10
$invalidationJson | Out-File -FilePath "invalidation.json" -Encoding utf8
aws cloudfront create-invalidation --distribution-id $DistributionId --invalidation-batch file://invalidation.json
Remove-Item "invalidation.json"

Write-Host "✅ 已建立失效請求" -ForegroundColor Green
Write-Host ""

Write-Host "=== 部署完成！===" -ForegroundColor Green
Write-Host ""
Write-Host "📋 部署資訊:" -ForegroundColor Cyan
Write-Host "   S3 Bucket: $BucketName" -ForegroundColor White
Write-Host "   區域: $Region" -ForegroundColor White
Write-Host "   S3 網站 URL: $s3WebsiteUrl" -ForegroundColor White
Write-Host "   CloudFront URL: $CloudFrontUrl" -ForegroundColor White
Write-Host ""

