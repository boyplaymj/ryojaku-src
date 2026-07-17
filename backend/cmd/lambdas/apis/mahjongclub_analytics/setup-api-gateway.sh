#!/bin/bash

# API Gateway Setup Script for Mahjong Club Analytics
# This script automates the creation of API Gateway REST API

set -e

# Configuration
LAMBDA_FUNCTION_NAME="Linebot_mahjongclub_analytics_Go-Local"
API_NAME="MahjongClubAnalyticsAPI"
REGION="ap-southeast-1"
AWS_PROFILE="claude"
ACCOUNT_ID="228304098112"

echo "========== API Gateway Setup =========="
echo "🚀 Creating REST API for Mahjong Club Analytics"
echo "📋 Lambda Function: $LAMBDA_FUNCTION_NAME"
echo "🌏 Region: $REGION"
echo ""

# Create REST API
echo "📝 Creating REST API..."
API_ID=$(aws apigateway create-rest-api \
    --name "$API_NAME" \
    --description "Analytics API for Mahjong Club Dashboard" \
    --endpoint-configuration types=REGIONAL \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query 'id' \
    --output text)

echo "✅ API created with ID: $API_ID"

# Get root resource ID
ROOT_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query 'items[0].id' \
    --output text)

echo "📁 Root resource ID: $ROOT_ID"

# Create /analytics resource
echo "📁 Creating /analytics resource..."
ANALYTICS_ID=$(aws apigateway create-resource \
    --rest-api-id "$API_ID" \
    --parent-id "$ROOT_ID" \
    --path-part "analytics" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query 'id' \
    --output text)

echo "✅ /analytics resource created: $ANALYTICS_ID"

# Create /{proxy+} resource under /analytics
echo "📁 Creating /{proxy+} resource..."
PROXY_ID=$(aws apigateway create-resource \
    --rest-api-id "$API_ID" \
    --parent-id "$ANALYTICS_ID" \
    --path-part "{proxy+}" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query 'id' \
    --output text)

echo "✅ /{proxy+} resource created: $PROXY_ID"

# Create ANY method on /{proxy+}
echo "🔧 Creating ANY method..."
aws apigateway put-method \
    --rest-api-id "$API_ID" \
    --resource-id "$PROXY_ID" \
    --http-method ANY \
    --authorization-type NONE \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null

echo "✅ ANY method created"

# Set up Lambda integration
echo "🔗 Setting up Lambda integration..."
LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$LAMBDA_FUNCTION_NAME"
INTEGRATION_URI="arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations"

aws apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$PROXY_ID" \
    --http-method ANY \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "$INTEGRATION_URI" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null

echo "✅ Lambda integration configured"

# Add Lambda permission for API Gateway
echo "🔐 Adding Lambda permission..."
aws lambda add-permission \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --statement-id "apigateway-invoke-$(date +%s)" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null 2>&1 || echo "⚠️  Permission may already exist"

echo "✅ Lambda permission added"

# Enable CORS on /{proxy+}
echo "🌐 Enabling CORS..."
aws apigateway put-method \
    --rest-api-id "$API_ID" \
    --resource-id "$PROXY_ID" \
    --http-method OPTIONS \
    --authorization-type NONE \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null

aws apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$PROXY_ID" \
    --http-method OPTIONS \
    --type MOCK \
    --request-templates '{"application/json": "{\"statusCode\": 200}"}' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null

aws apigateway put-method-response \
    --rest-api-id "$API_ID" \
    --resource-id "$PROXY_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Headers": false, "method.response.header.Access-Control-Allow-Methods": false, "method.response.header.Access-Control-Allow-Origin": false}' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null

aws apigateway put-integration-response \
    --rest-api-id "$API_ID" \
    --resource-id "$PROXY_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Headers": "'"'"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"'"'", "method.response.header.Access-Control-Allow-Methods": "'"'"'GET,POST,PUT,DELETE,OPTIONS'"'"'", "method.response.header.Access-Control-Allow-Origin": "'"'"'*'"'"'"}' \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null

echo "✅ CORS enabled"

# Deploy API
echo "🚀 Deploying API to 'prod' stage..."
aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name prod \
    --stage-description "Production stage" \
    --description "Initial deployment" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" > /dev/null

echo "✅ API deployed to 'prod' stage"

# Get API endpoint
API_ENDPOINT="https://$API_ID.execute-api.$REGION.amazonaws.com/prod"

echo ""
echo "========== Setup Complete =========="
echo "✅ API Gateway successfully configured!"
echo ""
echo "📋 API Details:"
echo "   API ID: $API_ID"
echo "   API Name: $API_NAME"
echo "   Region: $REGION"
echo ""
echo "🌐 API Endpoint:"
echo "   $API_ENDPOINT"
echo ""
echo "📝 Next Steps:"
echo "   1. Update frontend config.js with this URL:"
echo "      const API_CONFIG = {"
echo "        baseURL: '$API_ENDPOINT'"
echo "      };"
echo ""
echo "   2. Test the API:"
echo "      curl $API_ENDPOINT/analytics/overview"
echo ""
echo "========================================="

