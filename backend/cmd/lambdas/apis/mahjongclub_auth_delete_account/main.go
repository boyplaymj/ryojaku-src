package main

// 帳號系統 — 提出刪除帳號（先停用、30 天後清除；判定與承諾見 shared/account_deletion.go）。
// POST（需登入，僅接受 JWT 身分）→ 寫 deleteRequestedAt 與 pwChangedAt（＝登出所有裝置）。
// 停用期內重新登入＝撤回，那一半在各登入入口（shared.ResolveAccountDeletionOnLogin）。
//
// 🔴 這支還沒做的（刪除頁已經寫了，行為還沒跟上）：
//    推播訂閱的清除、「主辦人有未舉行的團局要先取消」的檢查（Games 沒有主辦人索引）。

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"mahjongclub-backend/cmd/lambdas/shared"
)

var dynamoClient *dynamodb.Client
var tablePrefix string

func init() {
	awsRegion := getEnv("AWS_REGION", "ap-southeast-1")
	tablePrefix = getEnv("TABLE_PREFIX", "MahjongClub_")

	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(awsRegion))
	if err != nil {
		log.Printf("Failed to load AWS config: %v", err)
	} else {
		dynamoClient = dynamodb.NewFromConfig(cfg)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func errorResponse(headers map[string]string, statusCode int, message string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]interface{}{
		"success": false,
		"error":   message,
	})
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(body),
	}
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	if dynamoClient == nil {
		return errorResponse(headers, http.StatusInternalServerError, "service unavailable"), nil
	}

	// 安全鐵律：只接受 JWT 身分，絕不接受 query param userId。
	userID, fromJWT := shared.GetUserIdentifierWithContext(ctx, request)
	if !fromJWT || userID == "" {
		return errorResponse(headers, http.StatusUnauthorized, "unauthorized"), nil
	}

	now := time.Now()
	_, err := dynamoClient.UpdateItem(ctx, shared.BuildAccountDeletionRequest(tablePrefix, userID, now))
	if err != nil {
		log.Printf("UpdateItem failed for user %s: %v", userID, err)
		return errorResponse(headers, http.StatusInternalServerError, "service unavailable"), nil
	}

	// 回的是「提出時間＋停用期」算出來的期限；重複提出時 deleteRequestedAt 不會往後延，
	// 這裡因此可能比實際期限晚 —— 前端只拿它當提示，不當成承諾。
	body, _ := json.Marshal(map[string]interface{}{
		"success":   true,
		"purgeAt":   now.Add(shared.AccountDeletionGrace).Format(time.RFC3339),
		"graceDays": int(shared.AccountDeletionGrace / (24 * time.Hour)),
	})
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
