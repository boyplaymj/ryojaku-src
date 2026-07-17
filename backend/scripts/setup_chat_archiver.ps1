# Setup Chat Archiver (Stream to Lambda)
$TableName = "MahjongClub_ChatMessages"
$FuncName = "Mahjongclub-App-api-chat-archiver-Local" # Adjust env if needed
$Region = "ap-southeast-1"

Write-Host "Enabling DynamoDB Stream for $TableName..."
$tableInfo = aws dynamodb update-table --table-name $TableName `
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES `
    --region $Region --no-cli-pager | ConvertFrom-Json

$streamArn = $tableInfo.TableDescription.LatestStreamArn

Write-Host "Stream ARN: $streamArn"

# Wait a bit for stream to be fully enabled
Start-Sleep -Seconds 5

Write-Host "Mapping stream to Lambda $FuncName..."
aws lambda create-event-source-mapping --function-name $FuncName `
    --event-source-arn $streamArn --starting-position LATEST `
    --region $Region --no-cli-pager

Write-Host "Chat Archiver Setup Complete."
