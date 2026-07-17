$tableName = "MahjongClub_Ledger"

Write-Host "Creating DynamoDB table $tableName..."

try {
    aws dynamodb create-table `
        --table-name $tableName `
        --attribute-definitions `
            AttributeName=userId,AttributeType=S `
            AttributeName=sortKey,AttributeType=S `
            AttributeName=gameId,AttributeType=S `
            AttributeName=createdAt,AttributeType=N `
        --key-schema `
            AttributeName=userId,KeyType=HASH `
            AttributeName=sortKey,KeyType=RANGE `
        --billing-mode PAY_PER_REQUEST `
        --global-secondary-indexes `
            "IndexName=gameId-createdAt-index,KeySchema=[{AttributeName=gameId,KeyType=HASH},{AttributeName=createdAt,KeyType=RANGE}],Projection={ProjectionType=ALL}"

    Write-Host "Table creation initiated. It might take a minute to be active."
} catch {
    Write-Host "Error creating table: $_"
}
