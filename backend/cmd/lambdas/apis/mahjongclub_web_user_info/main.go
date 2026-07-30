package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Response struct {
	Success bool         `json:"success"`
	Data    *shared.User `json:"data,omitempty"`
	Error   string       `json:"error,omitempty"`
}

var (
	dynamoClient *dynamodb.Client
	tablePrefix  string
)

// Use shared models
type Game = shared.Game
type Registration = shared.Registration

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Unable to load SDK config: %v", err)
	}

	dynamoClient = dynamodb.NewFromConfig(cfg)
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
		}, nil
	}

	// 使用 GetUserIdentifierWithTracking 取得 userID 並記錄 Token 使用統計
	//
	// 🔴 這裡原本寫 `userID, _ :=`，把第二個回傳值（verified）丟掉。
	// GetUserIdentifier 系列在沒有有效 Authorization header 時會 fallback 到 ?userId=
	// 並回傳 (queryUserID, false)。丟掉那個 false 的後果是：不帶任何憑證
	// `GET /user-info?userId=<任意人>` 直接回該用戶的 points／isVerified／stats。
	// （2026-07-30 staging 實打確認 200，見 SECURITY_AUTH_BYPASS.md §5d。）
	//
	// 收緊為「必須是驗證過的身分」。這不會改變任何已登入情境的行為：
	// 有 token 時本函式回傳的一律是 JWT 內的 userID，query 的 ?userId= 根本不被採用
	// （實打：帶 A 的 token 查 B，回的是 A）。亦即「查他人」從來就沒有生效過。
	userID, verified := shared.GetUserIdentifierWithTracking(request, "web_user_info")
	if !verified {
		// 觀測用：留下來源特徵，用來判斷是否還有不帶 token 的舊客戶端在打這支。
		log.Printf("[AUTH][user-info] 拒絕未驗證請求 queryUserId=%q sourceIp=%s ua=%q",
			request.QueryStringParameters["userId"],
			request.RequestContext.Identity.SourceIP,
			request.Headers["User-Agent"])
		response := Response{Success: false, Error: "需要登入"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusUnauthorized,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}
	// 記錄流量統計
	shared.RecordTraffic(ctx, dynamoClient, tablePrefix, "user", "get_info")
	if userID == "" {
		response := Response{Success: false, Error: "缺少用戶 ID"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get user
	user, err := getUser(ctx, userID)
	if err != nil {
		log.Printf("Failed to get user: %v", err)
		response := Response{Success: false, Error: "找不到用戶"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Calculate real-time rating stats from RatingComments table
	stats, err := getUserRatingStats(ctx, userID)
	if err == nil && stats != nil {
		// Calculate real-time game stats to ensure consistency with "My Games"
		gameStats, err := getUserGameStats(ctx, userID)
		if err == nil && gameStats != nil {
			stats.GamesHosted = gameStats.GamesHosted
			stats.GamesJoined = gameStats.GamesJoined
		}
		user.Stats = stats
	}

	// Calculate and update Post Stats (TotalPosts, TotalLikesReceived)
	// This ensures we have independent API retrieval for these stats
	postStats, err := getUserPostStats(ctx, userID)
	if err == nil && postStats != nil {
		if user.Stats == nil {
			user.Stats = &shared.UserStats{}
		}
		user.Stats.TotalPosts = postStats.TotalPosts
		user.Stats.TotalLikesReceived = postStats.TotalLikesReceived
	}

	// ---------------------------------------------------------
	// Update User Version & Last Login (Shadow Update)
	// ---------------------------------------------------------
	// Extract version info from headers
	version := request.Headers["X-App-Version"]
	if version == "" {
		version = request.Headers["x-app-version"] // case-insensitive
	}
	platform := request.Headers["X-Platform"]
	if platform == "" {
		platform = request.Headers["x-platform"]
	}

	// Only update if version is present
	if version != "" {
		go func(uid, v, p string) {
			// Update user record with new version and last login time
			// Use a new context for the goroutine to avoid cancellation
			bgCtx := context.Background()
			tableName := tablePrefix + "Users"

			// Use time.Now() directly since shared.GetTimeNow might not be available
			updateTime := time.Now().Format("2006-01-02T15:04:05Z07:00") // time.RFC3339

			updateExpr := "SET lastLoginAt = :t, updatedAt = :t, appVersion = :v"
			exprValues := map[string]types.AttributeValue{
				":t": &types.AttributeValueMemberS{Value: updateTime},
				":v": &types.AttributeValueMemberS{Value: v},
			}

			if p != "" {
				updateExpr += ", platform = :p"
				exprValues[":p"] = &types.AttributeValueMemberS{Value: p}
			}

			_, _ = dynamoClient.UpdateItem(bgCtx, &dynamodb.UpdateItemInput{
				TableName: aws.String(tableName),
				Key: map[string]types.AttributeValue{
					"userId": &types.AttributeValueMemberS{Value: uid},
				},
				UpdateExpression:          aws.String(updateExpr),
				ExpressionAttributeValues: exprValues,
			})
		}(userID, version, platform)
	}
	// ---------------------------------------------------------
	// ---------------------------------------------------------

	// Calculate Invite Stats
	inviteCount, err := getInviteCount(ctx, userID)
	if err == nil {
		user.InviteCount = inviteCount
	}

	inviteLimit := 10 // default
	inviterPoints := "100"
	inviteePoints := "50"
	configTable := tablePrefix + "AdminConfigs"

	// Scan for activity configs (or get specifically)
	// For efficiency, we can get specific items

	limitRes, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteMaxUsage"},
		},
	})
	if err == nil && limitRes.Item != nil {
		if v, ok := limitRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			fmt.Sscanf(v.Value, "%d", &inviteLimit)
		}
	}
	user.InviteLimit = inviteLimit

	// Get points config
	inviterRes, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviterPoints"},
		},
	})
	if err == nil && inviterRes.Item != nil {
		if v, ok := inviterRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			inviterPoints = v.Value
		}
	}

	inviteeRes, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteePoints"},
		},
	})
	if err == nil && inviteeRes.Item != nil {
		if v, ok := inviteeRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			inviteePoints = v.Value
		}
	}

	response := struct {
		Success       bool         `json:"success"`
		Data          *shared.User `json:"data,omitempty"`
		Error         string       `json:"error,omitempty"`
		InviterPoints string       `json:"inviterPoints"`
		InviteePoints string       `json:"inviteePoints"`
	}{
		Success:       true,
		Data:          user,
		InviterPoints: inviterPoints,
		InviteePoints: inviteePoints,
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func getUser(ctx context.Context, userID string) (*shared.User, error) {
	tableName := tablePrefix + "Users"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		return nil, err
	}

	if result.Item == nil {
		return nil, nil
	}

	var user shared.User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// getUserRatingStats calculates user rating statistics from the RatingComments table
func getUserRatingStats(ctx context.Context, userID string) (*shared.UserStats, error) {
	tableName := tablePrefix + "RatingComments"

	// Query rating comments using GSI toUserId-createdAt-index
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("toUserId-createdAt-index"),
		KeyConditionExpression: aws.String("toUserId = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		log.Printf("Query rating comments error for user %s: %v", userID, err)
		return nil, err
	}

	// Calculate statistics
	totalRatings := len(result.Items)
	positiveRatings := 0

	for _, item := range result.Items {
		if isPositiveAttr, ok := item["isPositive"]; ok {
			if boolVal, ok := isPositiveAttr.(*types.AttributeValueMemberBOOL); ok {
				if boolVal.Value {
					positiveRatings++
				}
			}
		}
	}

	positiveRatingRate := 0.0
	if totalRatings > 0 {
		positiveRatingRate = float64(positiveRatings) / float64(totalRatings) * 100
	}

	// Get user's basic stats (gamesHosted, gamesJoined)
	user, err := getUser(ctx, userID)
	gamesHosted := 0
	gamesJoined := 0
	if err == nil && user != nil && user.Stats != nil {
		gamesHosted = user.Stats.GamesHosted
		gamesJoined = user.Stats.GamesJoined
	}

	return &shared.UserStats{
		TotalRatings:       totalRatings,
		PositiveRatings:    positiveRatings,
		PositiveRatingRate: positiveRatingRate,
		GamesHosted:        gamesHosted,
		GamesJoined:        gamesJoined,
	}, nil
}

// getUserGameStats calculates real-time game statistics (hosted and joined)
func getUserGameStats(ctx context.Context, userID string) (*shared.UserStats, error) {
	// 1. Count hosted games (not cancelled)
	gamesTableName := tablePrefix + "Games"
	hostedResult, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(gamesTableName),
		FilterExpression: aws.String("hostUserId = :userID"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userID": &types.AttributeValueMemberS{Value: userID},
		},
	})

	gamesHosted := 0
	if err == nil && hostedResult != nil {
		gamesHosted = len(hostedResult.Items)
		// Handle pagination for hosted games
		lastKey := hostedResult.LastEvaluatedKey
		for lastKey != nil {
			nextResult, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
				TableName:         aws.String(gamesTableName),
				FilterExpression:  aws.String("hostUserId = :userID"),
				ExclusiveStartKey: lastKey,
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":userID": &types.AttributeValueMemberS{Value: userID},
				},
			})
			if err != nil {
				break
			}
			gamesHosted += len(nextResult.Items)
			lastKey = nextResult.LastEvaluatedKey
		}
	} else if err != nil {
		log.Printf("Failed to scan hosted games for user %s: %v", userID, err)
	}

	// 2. Count joined games (accepted and game not cancelled)
	regsTableName := tablePrefix + "Registrations"
	regsResult, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(regsTableName),
		FilterExpression: aws.String("userId = :userID AND #status = :accepted"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userID":   &types.AttributeValueMemberS{Value: userID},
			":accepted": &types.AttributeValueMemberS{Value: "accepted"},
		},
	})

	gamesJoined := 0
	if err == nil && regsResult != nil {
		// Handle pagination for registrations
		allRegItems := regsResult.Items
		lastKey := regsResult.LastEvaluatedKey
		for lastKey != nil {
			nextResult, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
				TableName:         aws.String(regsTableName),
				FilterExpression:  aws.String("userId = :userID AND #status = :accepted"),
				ExclusiveStartKey: lastKey,
				ExpressionAttributeNames: map[string]string{
					"#status": "status",
				},
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":userID":   &types.AttributeValueMemberS{Value: userID},
					":accepted": &types.AttributeValueMemberS{Value: "accepted"},
				},
			})
			if err != nil {
				break
			}
			allRegItems = append(allRegItems, nextResult.Items...)
			lastKey = nextResult.LastEvaluatedKey
		}

		// For each accepted registration, we need to check if the game is cancelled
		// This matches the logic in my-games API
		for _, item := range allRegItems {
			var reg Registration
			if err := attributevalue.UnmarshalMap(item, &reg); err != nil {
				continue
			}

			// Get game to check status
			gameResult, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
				TableName: aws.String(gamesTableName),
				Key: map[string]types.AttributeValue{
					"gameId": &types.AttributeValueMemberS{Value: reg.GameID},
				},
			})

			if err == nil && gameResult.Item != nil {
				var game Game
				if err := attributevalue.UnmarshalMap(gameResult.Item, &game); err == nil {
					if game.Status != "cancelled" && game.HostUserID != userID {
						gamesJoined++
					}
				}
			}
		}
	} else if err != nil {
		log.Printf("Failed to scan registrations for user %s: %v", userID, err)
	}

	return &shared.UserStats{
		GamesHosted: gamesHosted,
		GamesJoined: gamesJoined,
	}, nil
}

func getInviteCount(ctx context.Context, userID string) (int, error) {
	tableName := tablePrefix + "Users"
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("invitedBy-index"),
		KeyConditionExpression: aws.String("invitedBy = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
		},
		Select: types.SelectCount,
	})

	if err != nil {
		log.Printf("Query invite count error for user %s: %v", userID, err)
		return 0, err
	}

	return int(result.Count), nil
}

func main() {
	lambda.Start(handler)
}
