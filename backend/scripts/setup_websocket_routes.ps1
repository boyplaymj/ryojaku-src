# Setup WebSocket API Routes and Integrations (Fixed PS Syntax)
$ApiId = "ek5dythoh9"
$Region = "ap-southeast-1"
$Env = "Local"
$AccountId = "228304098112"

$Lambdas = @{
    "`$connect" = "Mahjongclub-App-api-chat_ws_connect_$Env"
    "`$disconnect" = "Mahjongclub-App-api-chat_ws_disconnect_$Env"
    "sendMessage" = "Mahjongclub-App-api-chat_ws_send_message_$Env"
}

foreach ($route in $Lambdas.Keys) {
    $funcName = $Lambdas[$route]
    $funcArn = "arn:aws:lambda:${Region}:${AccountId}:function:${funcName}"
    
    Write-Host "Setting up route $route with lambda $funcName"
    
    # 1. Create Integration
    $integration = aws apigatewayv2 create-integration --api-id $ApiId --integration-type AWS_PROXY `
        --integration-uri "arn:aws:apigateway:${Region}:lambda:path/2015-03-31/functions/${funcArn}/invocations" `
        --region $Region --no-cli-pager | ConvertFrom-Json
    
    $integrationId = $integration.IntegrationId
    
    # 2. Create Route
    aws apigatewayv2 create-route --api-id $ApiId --route-key $route --target "integrations/$integrationId" --region $Region --no-cli-pager
    
    # 3. Add Permission to Lambda
    aws lambda add-permission --function-name $funcName --statement-id "apigateway-$ApiId-$(Get-Random)" `
        --action "lambda:InvokeFunction" --principal apigateway.amazonaws.com `
        --source-arn "arn:aws:execute-api:${Region}:${AccountId}:${ApiId}/*" --region $Region --no-cli-pager
}

# Create Stage and Deployment
aws apigatewayv2 create-deployment --api-id $ApiId --region $Region --no-cli-pager
aws apigatewayv2 create-stage --api-id $ApiId --stage-name "prod" --region $Region --no-cli-pager

Write-Host "WebSocket API Setup Complete: wss://$ApiId.execute-api.$Region.amazonaws.com/prod"
