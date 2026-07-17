# Deploy Data Consistency Fix for APP APIs
# This script deploys the fixed mahjongclub_app_register and mahjongclub_app_login Lambda functions

param(
    [string]$Profile = "claude",
    [string]$Region = "ap-southeast-1"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deploy Data Consistency Fix" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Lambda functions to deploy
$lambdas = @(
    "mahjongclub_app_register",
    "mahjongclub_app_login"
)

$successCount = 0
$failCount = 0
$results = @()

foreach ($lambda in $lambdas) {
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    Write-Host "Deploying: $lambda" -ForegroundColor Yellow
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    
    $lambdaPath = Join-Path $PSScriptRoot $lambda
    
    if (-not (Test-Path $lambdaPath)) {
        Write-Host "❌ Lambda directory not found: $lambdaPath" -ForegroundColor Red
        $failCount++
        $results += [PSCustomObject]@{
            Lambda = $lambda
            Status = "Failed"
            Reason = "Directory not found"
        }
        continue
    }
    
    Push-Location $lambdaPath
    
    try {
        # Build
        Write-Host "📦 Building $lambda..." -ForegroundColor Cyan
        $env:GOOS = "linux"
        $env:GOARCH = "amd64"
        $env:CGO_ENABLED = "0"
        
        go build -o bootstrap main.go
        
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed"
        }
        
        Write-Host "✅ Build successful" -ForegroundColor Green
        
        # Create ZIP
        Write-Host "📦 Creating deployment package..." -ForegroundColor Cyan
        
        if (Test-Path "function.zip") {
            Remove-Item "function.zip" -Force
        }
        
        Compress-Archive -Path "bootstrap" -DestinationPath "function.zip" -Force
        
        Write-Host "✅ Package created" -ForegroundColor Green
        
        # Deploy
        Write-Host "🚀 Deploying to AWS Lambda..." -ForegroundColor Cyan
        
        aws lambda update-function-code `
            --function-name $lambda `
            --zip-file fileb://function.zip `
            --profile $Profile `
            --region $Region
        
        if ($LASTEXITCODE -ne 0) {
            throw "Deployment failed"
        }
        
        Write-Host "✅ Deployment successful" -ForegroundColor Green
        
        # Wait for update to complete
        Write-Host "⏳ Waiting for update to complete..." -ForegroundColor Cyan
        Start-Sleep -Seconds 3
        
        # Verify deployment
        $functionInfo = aws lambda get-function `
            --function-name $lambda `
            --profile $Profile `
            --region $Region | ConvertFrom-Json
        
        Write-Host "✅ Lambda updated successfully" -ForegroundColor Green
        Write-Host "   Last Modified: $($functionInfo.Configuration.LastModified)" -ForegroundColor Gray
        Write-Host "   Code Size: $($functionInfo.Configuration.CodeSize) bytes" -ForegroundColor Gray
        
        $successCount++
        $results += [PSCustomObject]@{
            Lambda = $lambda
            Status = "Success"
            Reason = "Deployed successfully"
        }
        
    } catch {
        Write-Host "❌ Error: $_" -ForegroundColor Red
        $failCount++
        $results += [PSCustomObject]@{
            Lambda = $lambda
            Status = "Failed"
            Reason = $_.Exception.Message
        }
    } finally {
        # Cleanup
        if (Test-Path "bootstrap") {
            Remove-Item "bootstrap" -Force
        }
        if (Test-Path "function.zip") {
            Remove-Item "function.zip" -Force
        }
        
        Pop-Location
    }
    
    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$results | Format-Table -AutoSize

Write-Host ""
Write-Host "Total: $($lambdas.Count) | Success: $successCount | Failed: $failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Yellow" })
Write-Host ""

if ($failCount -eq 0) {
    Write-Host "🎉 All Lambda functions deployed successfully!" -ForegroundColor Green
} else {
    Write-Host "⚠️  Some deployments failed. Please check the errors above." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Test APP registration:" -ForegroundColor White
Write-Host "   - Register a new APP user" -ForegroundColor Gray
Write-Host "   - Verify all fields are populated correctly" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Test APP login:" -ForegroundColor White
Write-Host "   - Login with the new user" -ForegroundColor Gray
Write-Host "   - Verify user data is complete" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Test data consistency:" -ForegroundColor White
Write-Host "   - Create a game with APP user" -ForegroundColor Gray
Write-Host "   - Register for a game" -ForegroundColor Gray
Write-Host "   - Check notifications" -ForegroundColor Gray
Write-Host "   - Submit ratings" -ForegroundColor Gray
Write-Host ""

