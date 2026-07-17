# Setup REST API Chat Routes
$ApiId = "yg7y0xkb50"
$Region = "ap-southeast-1"
$Env = "Local"
$AccountId = "228304098112"

$Routes = @{
    "GET /chat/rooms" = "Mahjongclub-App-api-chat-get-rooms_$Env"
    "GET /chat/history" = "Mahjongclub-App-api-chat-get-history_$Env"
    "GET /chat/room-info" = "Mahjongclub-App-api-chat-get-room-info_$Env"
}

foreach ($routeKey in $Routes.Keys) {
    $funcName = $Routes[$routeKey]
    $funcArn = "arn:aws:lambda:${Region}:${AccountId}:function:${funcName}"
    
    Write-Host "Setting up REST route $routeKey with lambda $funcName"
    
    # 1. Create Integration
    $integration = aws apigatewayv2 create-integration --api-id $ApiId --integration-type AWS_PROXY `
        --integration-uri "arn:aws:apigateway:${Region}:lambda:path/2015-03-31/functions/${funcArn}/invocations" `
        --payload-format-version "2.0" --region $Region --no-cli-pager | ConvertFrom-Json
    
    $integrationId = $integration.IntegrationId
    
    # 2. Create Route
    aws apigatewayv2 create-route --api-id $ApiId --route-key $routeKey --target "integrations/$integrationId" --region $Region --no-cli-pager
    
    # 3. Add Permission to Lambda
    aws lambda add-permission --function-name $funcName --statement-id "rest-apigateway-$ApiId-$(Get-Random)" `
        --action "lambda:InvokeFunction" --principal apigateway.amazonaws.com `
        --source-arn "arn:aws:execute-api:${Region}:${AccountId}:${ApiId}/*" --region $Region --no-cli-pager
}

Write-Host "REST API Chat Routes Setup Complete."
