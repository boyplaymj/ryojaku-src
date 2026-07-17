# Master Setup Script for Chat System
Write-Host "--- Starting Chat System Setup ---" -ForegroundColor Cyan

$root = Get-Location
$scriptDir = "$root\backend\scripts"

Write-Host "1. Setting up WebSocket Routes..."
powershell -File "$scriptDir\setup_websocket_routes.ps1"

Write-Host "2. Setting up REST API Chat Routes..."
powershell -File "$scriptDir\setup_rest_chat_routes.ps1"

Write-Host "3. Setting up Chat Archiver (DynamoDB Streams)..."
powershell -File "$scriptDir\setup_chat_archiver.ps1"

Write-Host "--- Chat System Setup Complete! ---" -ForegroundColor Green
