# Setup REST API Push Reward Routes
$ApiId = "yg7y0xkb50"
$Region = "ap-southeast-1"
$Env = "Local"
$AccountId = "228304098112"

$Routes = @{
    "POST /claim-push-bonus" = "Mahjongclub-App-api-claim-push-bonus_$Env"
}

# Load credentials
$KeysFile = "../ClaudeRead_accessKeys.csv"
if (Test-Path $KeysFile) {
    $csv = Import-Csv $KeysFile
    $env:AWS_ACCESS_KEY_ID = $csv[0]."Access key ID"
    $env:AWS_SECRET_ACCESS_KEY = $csv[0]."Secret access key"
}
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

foreach ($routeKey in $Routes.Keys) {
    $funcName = $Routes[$routeKey]
    $funcArn = "arn:aws:lambda:${Region}:${AccountId}:function:${funcName}"
    
    Write-Host "Setting up REST route $routeKey with lambda $funcName"
    
    $integration = aws apigatewayv2 create-integration --api-id $ApiId --integration-type AWS_PROXY `
        --integration-uri "arn:aws:apigateway:${Region}:lambda:path/2015-03-31/functions/${funcArn}/invocations" `
        --payload-format-version "2.0" --region $Region --no-cli-pager | ConvertFrom-Json
    
    $integrationId = $integration.IntegrationId
    
    # 2. Create Route
    aws apigatewayv2 create-route --api-id $ApiId --route-key $routeKey --target "integrations/$integrationId" --region $Region --no-cli-pager
    
    # 3. Add Permission to Lambda
    aws lambda add-permission --function-name $funcName --statement-id "push-reward-apigateway-$ApiId-$(Get-Random)" `
        --action "lambda:InvokeFunction" --principal apigateway.amazonaws.com `
        --source-arn "arn:aws:execute-api:${Region}:${AccountId}:${ApiId}/*" --region $Region --no-cli-pager
}

Write-Host "REST API Push Reward Routes Setup Complete."
