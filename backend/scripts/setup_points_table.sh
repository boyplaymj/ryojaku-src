#!/bin/bash
set -e

# Configuration
REGION="ap-southeast-1"
TABLE_PREFIX="MahjongClub_"
TABLE_NAME="${TABLE_PREFIX}PointTransactions"

echo "Checking AWS Identity..."
aws sts get-caller-identity

if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "Table $TABLE_NAME already exists."
else
    echo "Creating table $TABLE_NAME..."
    aws dynamodb create-table \
        --table-name "$TABLE_NAME" \
        --attribute-definitions \
            AttributeName=userId,AttributeType=S \
            AttributeName=sortKey,AttributeType=S \
        --key-schema \
            AttributeName=userId,KeyType=HASH \
            AttributeName=sortKey,KeyType=RANGE \
        --billing-mode PAY_PER_REQUEST \
        --region "$REGION"
    
    echo "Waiting for table creation..."
    aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
    echo "Table $TABLE_NAME created successfully."
fi
