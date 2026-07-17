# Setup REST API Ledger Routes
$ApiId = "yg7y0xkb50"
$Region = "ap-southeast-1"
$Env = "Local"
$AccountId = "228304098112"

$Routes = @{
    "GET /ledger" = "Mahjongclub-App-api-ledger_$Env"
    "POST /ledger" = "Mahjongclub-App-api-ledger_$Env"
    "PUT /ledger" = "Mahjongclub-App-api-ledger_$Env"
    "DELETE /ledger" = "Mahjongclub-App-api-ledger_$Env"
    "GET /ledger/summary" = "Mahjongclub-App-api-ledger_$Env"
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
        --payload-format-version "1.0" --region $Region --no-cli-pager | ConvertFrom-Json
    
    $integrationId = $integration.IntegrationId
    
    # 2. Create Route
    aws apigatewayv2 create-route --api-id $ApiId --route-key $routeKey --target "integrations/$integrationId" --region $Region --no-cli-pager
    
    # 3. Add Permission to Lambda (ignore if statement id exists, using random to avoid clash)
    aws lambda add-permission --function-name $funcName --statement-id "ledger-apigateway-$ApiId-$(Get-Random)" `
        --action "lambda:InvokeFunction" --principal apigateway.amazonaws.com `
        --source-arn "arn:aws:execute-api:${Region}:${AccountId}:${ApiId}/*" --region $Region --no-cli-pager
}

Write-Host "REST API Ledger Routes Setup Complete."
