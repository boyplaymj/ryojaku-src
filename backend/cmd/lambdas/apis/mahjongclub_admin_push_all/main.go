package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

// 並發 worker 數量 - 控制同時發送的推送數量
const workerCount = 50

type Config struct {
	AWSRegion   string
	TablePrefix string
	JWTSecret   string
}

type PushAllRequest struct {
	Title   string                 `json:"title"`
	Message string                 `json:"message"`
	Data    map[string]interface{} `json:"data"`
}

// PushJob 代表一個推送任務
type PushJob struct {
	UserID  string
	Title   string
	Message string
	Data    map[string]interface{}
}

var dbSvc *dynamodb.Client
var appCfg *Config

func init() {
	appCfg = &Config{
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
		JWTSecret:   getEnv("JWT_SECRET", "default-secret-change-me"),
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(appCfg.AWSRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	dbSvc = dynamodb.NewFromConfig(awsCfg)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func validateToken(tokenString, secret string) (jwt.MapClaims, error) {
	tokenString = strings.TrimPrefix(tokenString, "Bearer ")
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return token.Claims.(jwt.MapClaims), nil
}

// worker 從 jobs channel 接收任務並發送推送
func worker(ctx context.Context, pns *shared.PushNotificationService, jobs <-chan PushJob, successCount *int64, wg *sync.WaitGroup) {
	defer wg.Done()
	for job := range jobs {
		pns.SendPushNotificationToUser(ctx, job.UserID, job.Title, job.Message, job.Data)
		atomic.AddInt64(successCount, 1)
	}
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin": "*",
		"Content-Type":                "application/json",
	}

	// Auth
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	claims, err := validateToken(authHeader, appCfg.JWTSecret)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 401, Headers: headers, Body: `{"error":"Unauthorized"}`}, nil
	}
	adminUser := claims["sub"].(string)
	adminRole := claims["role"].(string)

	if adminRole != "super_admin" && adminRole != "admin" {
		return events.APIGatewayProxyResponse{StatusCode: 403, Headers: headers, Body: `{"error":"Forbidden"}`}, nil
	}

	var req PushAllRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 400, Headers: headers, Body: `{"error":"Invalid JSON"}`}, nil
	}

	if req.Title == "" || req.Message == "" {
		return events.APIGatewayProxyResponse{StatusCode: 400, Headers: headers, Body: `{"error":"Missing title or message"}`}, nil
	}

	// Get Push Service
	pns, err := shared.NewPushNotificationService()
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Headers: headers, Body: `{"error":"Failed to init push service"}`}, nil
	}

	// 收集所有訂閱用戶
	uniqueUsers := make(map[string]bool)

	// 1. Scan Old Table
	oldTableName := appCfg.TablePrefix + "PushSubscriptions"
	inputOld := &dynamodb.ScanInput{
		TableName:            aws.String(oldTableName),
		ProjectionExpression: aws.String("userId"),
	}

	resultOld, err := dbSvc.Scan(ctx, inputOld)
	if err == nil {
		for _, item := range resultOld.Items {
			if u, ok := item["userId"]; ok {
				userID := u.(*types.AttributeValueMemberS).Value
				uniqueUsers[userID] = true
			}
		}
	} else {
		log.Printf("Failed to scan old subscriptions: %v", err)
	}

	// 2. Scan New Table (MultiDevice)
	newTableName := appCfg.TablePrefix + "PushSubscriptions_MultiDevice"
	inputNew := &dynamodb.ScanInput{
		TableName:            aws.String(newTableName),
		ProjectionExpression: aws.String("userId"),
	}

	resultNew, err := dbSvc.Scan(ctx, inputNew)
	if err == nil {
		for _, item := range resultNew.Items {
			if u, ok := item["userId"]; ok {
				userID := u.(*types.AttributeValueMemberS).Value
				uniqueUsers[userID] = true
			}
		}
	} else {
		log.Printf("Failed to scan new subscriptions: %v", err)
	}

	totalUsers := len(uniqueUsers)
	log.Printf("開始並發推送通知給 %d 個用戶，使用 %d 個 worker", totalUsers, workerCount)

	// 建立 jobs channel 和 worker pool
	jobs := make(chan PushJob, totalUsers)
	var wg sync.WaitGroup
	var successCount int64

	// 啟動 worker goroutines
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go worker(ctx, pns, jobs, &successCount, &wg)
	}

	// 將所有用戶加入 jobs channel
	for userID := range uniqueUsers {
		jobs <- PushJob{
			UserID:  userID,
			Title:   req.Title,
			Message: req.Message,
			Data:    req.Data,
		}
	}
	close(jobs) // 關閉 channel，通知 workers 沒有更多任務

	// 等待所有 workers 完成
	wg.Wait()

	finalCount := atomic.LoadInt64(&successCount)
	log.Printf("推送完成：成功 %d / 總共 %d 個用戶", finalCount, totalUsers)

	shared.LogAdminAction(ctx, adminUser, "BROADCAST_PUSH", "ALL_USERS", fmt.Sprintf("Title: %s, Success: %d, Total: %d", req.Title, finalCount, totalUsers))

	body, _ := json.Marshal(map[string]interface{}{
		"success":    true,
		"count":      finalCount,
		"totalUsers": totalUsers,
	})
	return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers, Body: string(body)}, nil
}

func main() {
	lambda.Start(handler)
}
