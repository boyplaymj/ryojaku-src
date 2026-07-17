$env:AWS_ACCESS_KEY_ID="<REDACTED_AWS_ACCESS_KEY_ID>"
$env:AWS_SECRET_ACCESS_KEY="<REDACTED_AWS_SECRET_ACCESS_KEY>"
$env:AWS_DEFAULT_REGION="ap-southeast-1"

Write-Host "Creating DynamoDB Tables for Chat System..."

# 1. MahjongClub_ChatUserMemberships
Write-Host "Creating MahjongClub_ChatUserMemberships..."
aws dynamodb create-table `
    --table-name MahjongClub_ChatUserMemberships `
    --attribute-definitions `
        AttributeName=UserID,AttributeType=S `
        AttributeName=LastMessageTime#RoomID,AttributeType=S `
    --key-schema `
        AttributeName=UserID,KeyType=HASH `
        AttributeName=LastMessageTime#RoomID,KeyType=RANGE `
    --billing-mode PAY_PER_REQUEST

# 2. MahjongClub_ChatMessages
Write-Host "Creating MahjongClub_ChatMessages..."
aws dynamodb create-table `
    --table-name MahjongClub_ChatMessages `
    --attribute-definitions `
        AttributeName=RoomID,AttributeType=S `
        AttributeName=Timestamp#MessageID,AttributeType=S `
    --key-schema `
        AttributeName=RoomID,KeyType=HASH `
        AttributeName=Timestamp#MessageID,KeyType=RANGE `
    --billing-mode PAY_PER_REQUEST `
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES

# 3. MahjongClub_ChatRooms
Write-Host "Creating MahjongClub_ChatRooms..."
aws dynamodb create-table `
    --table-name MahjongClub_ChatRooms `
    --attribute-definitions `
        AttributeName=RoomID,AttributeType=S `
    --key-schema `
        AttributeName=RoomID,KeyType=HASH `
    --billing-mode PAY_PER_REQUEST

# 4. MahjongClub_ChatConnections
Write-Host "Creating MahjongClub_ChatConnections..."
# Use a JSON file for the GSI to avoid PowerShell quoting issues
$gsi = @(
    @{
        IndexName = "UserID-index"
        KeySchema = @(
            @{ AttributeName = "UserID"; KeyType = "HASH" }
        )
        Projection = @{ ProjectionType = "ALL" }
    }
) | ConvertTo-Json -Compress

# Escape for CLI
$gsi_formatted = $gsi.Replace('"', '\"')

aws dynamodb create-table `
    --table-name MahjongClub_ChatConnections `
    --attribute-definitions `
        AttributeName=ConnectionID,AttributeType=S `
        AttributeName=UserID,AttributeType=S `
    --key-schema `
        AttributeName=ConnectionID,KeyType=HASH `
    --global-secondary-indexes "$gsi_formatted" `
    --billing-mode PAY_PER_REQUEST

Write-Host "Waiting for tables to be active..."
aws dynamodb wait table-exists --table-name MahjongClub_ChatUserMemberships
aws dynamodb wait table-exists --table-name MahjongClub_ChatMessages
aws dynamodb wait table-exists --table-name MahjongClub_ChatRooms
aws dynamodb wait table-exists --table-name MahjongClub_ChatConnections

# Enable TTL for MahjongClub_ChatMessages
Write-Host "Enabling TTL for MahjongClub_ChatMessages..."
aws dynamodb update-time-to-live --table-name MahjongClub_ChatMessages --time-to-live-specification "Enabled=true,AttributeName=TTL"

Write-Host "All Chat System tables created successfully!"
