# 批量生成剩餘 API 文檔的腳本

$baseUrl = "https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com"
$apiGateway = "MahjongClub-Web-HTTP-API"
$apiId = "k10zeqldu6"

# 定義剩餘需要生成的 API
$apis = @(
    @{
        Number = "08"
        Name = "cancel_game"
        Title = "取消團局"
        Lambda = "Linebot_mahjongclub_web_cancel_game_Go-Local"
        Endpoint = "/mahjongclub_web_cancel_game"
        Method = "POST"
        Auth = $true
        Points = "+120"
        Description = "主辦人取消團局，退還 120 點數，通知所有已加入和報名的用戶"
        RequestBody = @{
            gameId = "GAME_1732195200_abc123"
            reason = "臨時有事，抱歉取消"
        }
        ResponseData = @{
            gameId = "GAME_1732195200_abc123"
            status = "cancelled"
            pointsRefunded = 120
            pointsRemaining = 1500
        }
    },
    @{
        Number = "12"
        Name = "user_profile"
        Title = "用戶資料"
        Lambda = "Linebot_mahjongclub_web_user_profile_Go-Local"
        Endpoint = "/mahjongclub_web_user_profile"
        Method = "POST"
        Auth = $true
        Points = "0"
        Description = "獲取或更新用戶資料，包括個人資訊和偏好設定"
        RequestBody = @{
            displayName = "王小明"
            gender = "男"
            ageRange = "26-35"
            mahjongExperience = "中級"
            notifyNewGames = $true
        }
        ResponseData = @{
            userId = "APP_xxxxxxxxxxxx"
            displayName = "王小明"
            gender = "男"
            ageRange = "26-35"
            mahjongExperience = "中級"
            points = 1500
            rating = 4.8
        }
    },
    @{
        Number = "13"
        Name = "user_info"
        Title = "用戶資訊"
        Lambda = "Linebot_mahjongclub_web_user_info_Go-Local"
        Endpoint = "/mahjongclub_web_user_info"
        Method = "GET"
        Auth = $false
        Points = "0"
        Description = "獲取指定用戶的公開資訊，用於查看其他用戶的基本資料"
        QueryParams = @{
            userId = "APP_xxxxxxxxxxxx"
        }
        ResponseData = @{
            userId = "APP_xxxxxxxxxxxx"
            displayName = "王小明"
            rating = 4.8
            stats = @{
                gamesHosted = 5
                gamesJoined = 12
            }
        }
    },
    @{
        Number = "14"
        Name = "get_ratings"
        Title = "獲取評分"
        Lambda = "Linebot_mahjongclub_web_get_ratings_Go-Local"
        Endpoint = "/mahjongclub_web_get_ratings"
        Method = "POST"
        Auth = $true
        Points = "0"
        Description = "獲取用戶的評分列表，包括正面和負面評價"
        RequestBody = @{
            targetUserId = "APP_yyyyyyyyyyyy"
        }
        ResponseData = @{
            ratings = @()
            averageRating = 4.8
            totalRatings = 10
        }
    },
    @{
        Number = "15"
        Name = "submit_rating"
        Title = "提交評分"
        Lambda = "Linebot_mahjongclub_web_submit_rating_Go-Local"
        Endpoint = "/mahjongclub_web_submit_rating"
        Method = "POST"
        Auth = $true
        Points = "0"
        Description = "提交對其他用戶的評分和評論"
        RequestBody = @{
            targetUserId = "APP_yyyyyyyyyyyy"
            gameId = "GAME_1732195200_abc123"
            rating = 5
            isPositive = $true
            comment = "很準時，人很好"
        }
        ResponseData = @{
            ratingId = "RATING_1732197000_abc123"
            success = $true
        }
    },
    @{
        Number = "16"
        Name = "user_comments"
        Title = "用戶評論"
        Lambda = "Linebot_mahjongclub_web_user_comments_Go-Local"
        Endpoint = "/mahjongclub_web_user_comments"
        Method = "GET"
        Auth = $false
        Points = "0"
        Description = "獲取指定用戶收到的評論列表"
        QueryParams = @{
            userId = "APP_xxxxxxxxxxxx"
        }
        ResponseData = @{
            comments = @()
            totalComments = 10
        }
    },
    @{
        Number = "17"
        Name = "notifications"
        Title = "獲取通知"
        Lambda = "Linebot_mahjongclub_web_notifications_Go-Local"
        Endpoint = "/mahjongclub_web_notifications"
        Method = "GET"
        Auth = $true
        Points = "0"
        Description = "獲取用戶的通知列表，支援分頁"
        QueryParams = @{
            userId = "APP_xxxxxxxxxxxx"
            limit = 20
            lastKey = ""
        }
        ResponseData = @{
            notifications = @()
            unreadCount = 3
            hasMore = $false
        }
    }
)

Write-Host "API 文檔生成腳本" -ForegroundColor Green
Write-Host "==================" -ForegroundColor Green
Write-Host ""
Write-Host "此腳本用於生成剩餘的 API 文檔"
Write-Host "請手動創建以下文檔："
Write-Host ""

foreach ($api in $apis) {
    Write-Host "[$($api.Number)] $($api.Title) - $($api.Endpoint)" -ForegroundColor Cyan
    Write-Host "    Lambda: $($api.Lambda)"
    Write-Host "    Method: $($api.Method) | Auth: $($api.Auth) | Points: $($api.Points)"
    Write-Host "    Description: $($api.Description)"
    Write-Host ""
}

Write-Host "總共需要創建 $($apis.Count) 個文檔" -ForegroundColor Yellow

