package shared

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// TokenStatsTableName 統計表名稱
const TokenStatsTableName = "MahjongClub_APITokenStats"

// tokenStatsClient 用於統計的 DynamoDB client (懶加載)
var tokenStatsClient *dynamodb.Client

// getTokenStatsClient 取得或初始化 DynamoDB client
func getTokenStatsClient() *dynamodb.Client {
	if tokenStatsClient == nil {
		cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion("ap-southeast-1"))
		if err != nil {
			log.Printf("[TokenStats] 無法載入 AWS 設定: %v", err)
			return nil
		}
		tokenStatsClient = dynamodb.NewFromConfig(cfg)
	}
	return tokenStatsClient
}

// RecordTokenUsage 記錄 API 請求的 Token 使用情況 (異步，不阻塞主流程)
// endpoint: API 端點名稱 (例如 "web_search_games")
// hasToken: 此請求是否帶有有效的 JWT Token
func RecordTokenUsage(endpoint string, hasToken bool) {
	// 使用 goroutine 異步執行，確保不影響 API 回應時間
	go recordTokenUsageSync(context.Background(), endpoint, hasToken)
}

// recordTokenUsageSync 同步記錄統計 (內部函數)
func recordTokenUsageSync(ctx context.Context, endpoint string, hasToken bool) {
	client := getTokenStatsClient()
	if client == nil {
		return
	}

	// 使用台北時區
	taipeiLoc, err := time.LoadLocation("Asia/Taipei")
	if err != nil {
		taipeiLoc = time.FixedZone("Asia/Taipei", 8*60*60)
	}
	dateKey := time.Now().In(taipeiLoc).Format("2006-01-02")
	nowTimestamp := fmt.Sprintf("%d", time.Now().Unix())

	// 建立更新表達式
	// 使用 ADD 進行原子計數器增量
	var updateExpr string
	if hasToken {
		updateExpr = "SET updatedAt = :ts ADD totalRequests :one, withToken :one"
	} else {
		updateExpr = "SET updatedAt = :ts ADD totalRequests :one, withoutToken :one"
	}

	_, err = client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(TokenStatsTableName),
		Key: map[string]types.AttributeValue{
			"date":     &types.AttributeValueMemberS{Value: dateKey},
			"endpoint": &types.AttributeValueMemberS{Value: endpoint},
		},
		UpdateExpression: aws.String(updateExpr),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":ts":  &types.AttributeValueMemberN{Value: nowTimestamp},
			":one": &types.AttributeValueMemberN{Value: "1"},
		},
	})

	if err != nil {
		log.Printf("[TokenStats] 記錄統計失敗 endpoint=%s hasToken=%v: %v", endpoint, hasToken, err)
	}
}

// GetUserIdentifierWithTracking 取得用戶 ID 並記錄 Token 使用統計
// 這是 GetUserIdentifier 的擴展版本，會自動記錄統計
// endpoint: API 端點名稱，用於統計 (例如 "chat_get_rooms")
// 回傳: (userID, hasToken)
func GetUserIdentifierWithTracking(request events.APIGatewayProxyRequest, endpoint string) (string, bool) {
	userID, hasToken := GetUserIdentifier(request)

	// 只有當成功取得 userID 時才記錄統計
	// 這樣可以避免統計空請求或錯誤請求
	if userID != "" {
		RecordTokenUsage(endpoint, hasToken)
	}

	return userID, hasToken
}

// HasAuthorizationHeader 檢查請求是否帶有 Authorization Header
// 這是一個輕量級檢查，不驗證 Token 有效性
func HasAuthorizationHeader(request events.APIGatewayProxyRequest) bool {
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	return authHeader != ""
}

// RecordTokenUsageFromHeader 根據 Header 記錄統計 (用於不需要取得 userID 的情況)
// 例如：搜尋 API 可能不需要 userID，但我們仍想追蹤 Token 使用率
func RecordTokenUsageFromHeader(request events.APIGatewayProxyRequest, endpoint string) {
	hasToken := HasAuthorizationHeader(request)
	RecordTokenUsage(endpoint, hasToken)
}

// HasAuthorizationHeaderV2 檢查 V2 HTTP API 請求是否帶有 Authorization Header
func HasAuthorizationHeaderV2(request events.APIGatewayV2HTTPRequest) bool {
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	return authHeader != ""
}

// RecordTokenUsageFromHeaderV2 用於 HTTP API V2 格式 (APIGatewayV2HTTPRequest)
func RecordTokenUsageFromHeaderV2(request events.APIGatewayV2HTTPRequest, endpoint string) {
	hasToken := HasAuthorizationHeaderV2(request)
	RecordTokenUsage(endpoint, hasToken)
}
