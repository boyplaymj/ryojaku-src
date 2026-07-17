#!/bin/bash

# MahjongClub_App S3 + CloudFront 部署腳本
# 部署到 AWS 新加坡區域 (ap-southeast-1)

set -e

BUCKET_NAME="mahjongclub-app"
REGION="ap-southeast-1"
SKIP_BUILD=false

# 解析命令行參數
while [[ $# -gt 0 ]]; do
    case $1 in
        --bucket)
            BUCKET_NAME="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        *)
            echo "未知參數: $1"
            exit 1
            ;;
    esac
done

echo "=== MahjongClub_App 部署到 S3 + CloudFront ==="
echo ""

# 確認使用正確的 AWS 金鑰 (ClaudeRead)
echo "🔑 確認 AWS 賬號..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ "$ACCOUNT_ID" != "228304098112" ]; then
    echo "❌ 錯誤: 當前 AWS 賬號 ($ACCOUNT_ID) 不是預期的賬號 (228304098112)"
    echo "請確認使用正確的 AWS 認證"
    exit 1
fi
echo "✅ AWS 賬號確認: $ACCOUNT_ID"
echo ""

# 1. 建置專案
if [ "$SKIP_BUILD" = false ]; then
    echo "📦 步驟 1: 建置專案..."
    npm run build
    echo "✅ 建置完成"
    echo ""
else
    echo "⏭️  跳過建置步驟"
    echo ""
fi

# 2. 檢查 S3 Bucket 是否存在
echo "🪣 步驟 2: 檢查 S3 Bucket..."
if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    echo "✅ Bucket 已存在"
else
    echo "   Bucket 不存在，正在創建..."
    
    # 創建 S3 Bucket
    if [ "$REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION"
    else
        aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION"
    fi
    
    echo "✅ Bucket 創建成功"
fi
echo ""

# 3. 設定 Bucket 為靜態網站託管
echo "🌐 步驟 3: 設定靜態網站託管..."
cat > website-config.json << EOF
{
    "IndexDocument": {
        "Suffix": "index.html"
    },
    "ErrorDocument": {
        "Key": "index.html"
    }
}
EOF

aws s3api put-bucket-website --bucket "$BUCKET_NAME" --website-configuration file://website-config.json
rm website-config.json
echo "✅ 靜態網站託管設定完成"
echo ""

# 4. 設定 Bucket 公開存取
echo "🔓 步驟 4: 設定 Bucket 公開存取..."
aws s3api put-public-access-block --bucket "$BUCKET_NAME" \
    --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

cat > bucket-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
        }
    ]
}
EOF

aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy file://bucket-policy.json
rm bucket-policy.json
echo "✅ Bucket 公開存取設定完成"
echo ""

# 5. 上傳檔案到 S3
echo "📤 步驟 5: 上傳檔案到 S3..."
# 上傳非 HTML 檔案 (長期快取)
aws s3 sync ./dist s3://"$BUCKET_NAME" --delete \
    --cache-control "public, max-age=31536000" \
    --exclude "index.html" --exclude "*.html"

# 上傳 HTML 檔案 (不快取)
aws s3 sync ./dist s3://"$BUCKET_NAME" --delete \
    --cache-control "public, max-age=0, must-revalidate" \
    --exclude "*" --include "index.html" --include "*.html"

echo "✅ 檔案上傳完成"
echo ""

# 6. 獲取 S3 網站 URL
S3_WEBSITE_URL="http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com"
echo "🌐 S3 網站 URL: $S3_WEBSITE_URL"
echo ""

# 7. CloudFront 快取清除
echo "☁️ 步驟 6: 清除 CloudFront 快取..."
DISTRIBUTION_ID="E3I3J0SFSPTE2W"
CLOUDFRONT_URL="https://d1wa3w4dmfwqc7.cloudfront.net"

echo "   正在為 $CLOUDFRONT_URL (ID: $DISTRIBUTION_ID) 建立失效請求..."
INVALIDATION_ID=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --query "Invalidation.Id" --output text)
echo "✅ 已建立失效請求: $INVALIDATION_ID"
echo ""

echo "=== 部署完成！==="
echo ""
echo "📋 部署資訊:"
echo "   S3 Bucket: $BUCKET_NAME"
echo "   區域: $REGION"
echo "   S3 網站 URL: $S3_WEBSITE_URL"
echo "   CloudFront URL: $CLOUDFRONT_URL"
echo ""
echo "💡 提示:"
echo "   - CloudFront 快取清除可能需要幾分鐘生效"
echo ""
