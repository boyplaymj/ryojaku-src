#!/bin/bash
set -e

# Configuration
REGION="ap-southeast-1"
TABLE_PREFIX="MahjongClub_"

echo "Checking AWS Identity..."
aws sts get-caller-identity

# 1. Admin Users Table
TABLE_ADMIN_USERS="${TABLE_PREFIX}AdminUsers"
if aws dynamodb describe-table --table-name "$TABLE_ADMIN_USERS" --region "$REGION" >/dev/null 2>&1; then
    echo "Table $TABLE_ADMIN_USERS already exists."
else
    echo "Creating table $TABLE_ADMIN_USERS..."
    aws dynamodb create-table \
        --table-name "$TABLE_ADMIN_USERS" \
        --attribute-definitions AttributeName=username,AttributeType=S \
        --key-schema AttributeName=username,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "$REGION"
    aws dynamodb wait table-exists --table-name "$TABLE_ADMIN_USERS" --region "$REGION"
fi

# 2. Activity Vouchers Table
TABLE_VOUCHERS="${TABLE_PREFIX}ActivityVouchers"
if aws dynamodb describe-table --table-name "$TABLE_VOUCHERS" --region "$REGION" >/dev/null 2>&1; then
    echo "Table $TABLE_VOUCHERS already exists."
else
    echo "Creating table $TABLE_VOUCHERS..."
    aws dynamodb create-table \
        --table-name "$TABLE_VOUCHERS" \
        --attribute-definitions AttributeName=code,AttributeType=S \
        --key-schema AttributeName=code,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "$REGION"
    aws dynamodb wait table-exists --table-name "$TABLE_VOUCHERS" --region "$REGION"
fi

# 3. Admin Audit Logs Table
TABLE_LOGS="${TABLE_PREFIX}AdminAuditLogs"
if aws dynamodb describe-table --table-name "$TABLE_LOGS" --region "$REGION" >/dev/null 2>&1; then
    echo "Table $TABLE_LOGS already exists."
else
    echo "Creating table $TABLE_LOGS..."
    aws dynamodb create-table \
        --table-name "$TABLE_LOGS" \
        --attribute-definitions AttributeName=log_id,AttributeType=S \
        --key-schema AttributeName=log_id,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "$REGION"
    aws dynamodb wait table-exists --table-name "$TABLE_LOGS" --region "$REGION"
fi

# Initial Admin User
ADMIN_USER="admin"
PASSWORD_HASH="\$2a\$10\$hYLT3GN/wexnnKyIP93Sf.RrdWFyLtrHCW1NMWDgfVejm39GCUB8a" # Admin@123

USER_CHECK=$(aws dynamodb get-item \
    --table-name "$TABLE_ADMIN_USERS" \
    --key '{"username": {"S": "'"$ADMIN_USER"'"}}' \
    --region "$REGION" \
    --output text)

if [ "$USER_CHECK" == "" ] || [ "$USER_CHECK" == "None" ]; then
    echo "Creating initial admin user..."
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    aws dynamodb put-item \
        --table-name "$TABLE_ADMIN_USERS" \
        --item '{
            "username": {"S": "'"$ADMIN_USER"'"},
            "passwordHash": {"S": "'"$PASSWORD_HASH"'"},
            "role": {"S": "super"},
            "createdAt": {"S": "'"$TIMESTAMP"'"},
            "lastLoginAt": {"S": "'"$TIMESTAMP"'"}
        }' \
        --region "$REGION"
    echo "Admin user created."
fi

echo "Setup complete."
