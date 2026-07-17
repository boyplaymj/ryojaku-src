package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type StatusRequest struct {
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId"`
}

type StatusResponse struct {
	Success      bool   `json:"success"`
	IsSubscribed bool   `json:"isSubscribed"`
	Error        string `json:"error,omitempty"`
}

type PushSubscriptionRecord struct {
	UserID    string                 `dynamodbav:"userId"`
	DeviceID  string                 `dynamodbav:"deviceId"`
	Endpoint  string                 `dynamodbav:"endpoint"`
	Keys      map[string]string      `dynamodbav:"keys"`
	IsActive  bool                   `dynamodbav:"isActive"`
	CreatedAt int64                  `dynamodbav:"createdAt"`
	UpdatedAt int64                  `dynamodbav:"updatedAt"`
	ExpiresAt int64                  `dynamodbav:"expiresAt"`
}

var (
	dynamoClient *dynamodb.Client
	tablePrefix  string
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)

	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_subscription_status")

	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	// Enable CORS
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	// Handle OPTIONS request for CORS
	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// Only allow POST method
	if request.HTTPMethod != "POST" {
		response := StatusResponse{Success: false, Error: "Method not allowed"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusMethodNotAllowed,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Parse request body
	var req StatusRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Failed to parse request body: %v", err)
		response := StatusResponse{Success: false, Error: "Invalid request format"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Validate required fields
	if req.UserID == "" || req.DeviceID == "" {
		response := StatusResponse{Success: false, Error: "Missing required fields (userId, deviceId)"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Check subscription status
	isSubscribed, err := checkSubscriptionStatus(ctx, &req)
	if err != nil {
		log.Printf("Failed to check subscription status: %v", err)
		response := StatusResponse{Success: false, Error: "Failed to check subscription status"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	response := StatusResponse{
		Success:      true,
		IsSubscribed: isSubscribed,
	}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// LegacyPushSubscriptionRecord 舊表結構（僅 userId 為 partition key）
type LegacyPushSubscriptionRecord struct {
	UserID    string            `dynamodbav:"userId"`
	DeviceID  string            `dynamodbav:"deviceId"`
	Endpoint  string            `dynamodbav:"endpoint"`
	Keys      map[string]string `dynamodbav:"keys"`
	ExpiresAt int64             `dynamodbav:"expiresAt"`
	CreatedAt string            `dynamodbav:"createdAt"`
	UpdatedAt string            `dynamodbav:"updatedAt"`
}

// checkSubscriptionStatus checks if a device is subscribed to push notifications
// 支援過渡期：先查新表，若無記錄則查舊表，並靜默遷移到新表
func checkSubscriptionStatus(ctx context.Context, req *StatusRequest) (bool, error) {
	// Step 1: 先查新表 PushSubscriptions_MultiDevice
	newTableName := tablePrefix + "PushSubscriptions_MultiDevice"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &newTableName,
		Key: map[string]types.AttributeValue{
			"userId":   &types.AttributeValueMemberS{Value: req.UserID},
			"deviceId": &types.AttributeValueMemberS{Value: req.DeviceID},
		},
	})

	if err != nil {
		log.Printf("Failed to get subscription from new table: %v", err)
		return false, err
	}

	// 如果新表有記錄，檢查是否有效
	if result.Item != nil {
		var record PushSubscriptionRecord
		if err := attributevalue.UnmarshalMap(result.Item, &record); err != nil {
			log.Printf("Failed to unmarshal subscription record: %v", err)
			return false, err
		}

		if !record.IsActive {
			log.Printf("Subscription exists but is inactive for user %s, device %s", req.UserID, req.DeviceID)
			return false, nil
		}

		now := time.Now().Unix()
		if record.ExpiresAt > 0 && record.ExpiresAt < now {
			log.Printf("Subscription expired for user %s, device %s", req.UserID, req.DeviceID)
			return false, nil
		}

		log.Printf("Active subscription found in new table for user %s, device %s", req.UserID, req.DeviceID)
		return true, nil
	}

	// Step 2: 新表無記錄，查舊表 PushSubscriptions
	log.Printf("No subscription in new table, checking legacy table for user %s", req.UserID)
	legacyTableName := tablePrefix + "PushSubscriptions"
	legacyResult, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &legacyTableName,
		KeyConditionExpression: stringPtr("userId = :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: req.UserID},
		},
		Limit: int32Ptr(1),
	})

	if err != nil {
		log.Printf("Failed to query legacy table: %v", err)
		// 舊表查詢失敗不影響結果，只記錄日誌
		return false, nil
	}

	if len(legacyResult.Items) == 0 {
		log.Printf("No subscription found in legacy table for user %s", req.UserID)
		return false, nil
	}

	// 解析舊表記錄
	var legacyRecord LegacyPushSubscriptionRecord
	if err := attributevalue.UnmarshalMap(legacyResult.Items[0], &legacyRecord); err != nil {
		log.Printf("Failed to unmarshal legacy subscription: %v", err)
		return false, nil
	}

	// 檢查是否過期
	now := time.Now().Unix()
	if legacyRecord.ExpiresAt > 0 && legacyRecord.ExpiresAt < now {
		log.Printf("Legacy subscription expired for user %s", req.UserID)
		return false, nil
	}

	log.Printf("Active subscription found in legacy table for user %s, device %s", req.UserID, legacyRecord.DeviceID)

	// Step 3: 靜默遷移到新表（非阻塞）
	go func() {
		migrateCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		migrateToNewTable(migrateCtx, &legacyRecord, req.DeviceID)
	}()

	return true, nil
}

// migrateToNewTable 將舊表資料遷移到新表
func migrateToNewTable(ctx context.Context, legacy *LegacyPushSubscriptionRecord, currentDeviceID string) {
	newTableName := tablePrefix + "PushSubscriptions_MultiDevice"

	// 使用舊表的 deviceId，如果沒有則使用當前設備 ID
	deviceID := legacy.DeviceID
	if deviceID == "" {
		deviceID = currentDeviceID
	}

	now := time.Now().Unix()
	expiresAt := now + (365 * 24 * 60 * 60) // 預設一年後過期

	// 如果舊記錄有過期時間且仍有效，保留原過期時間
	if legacy.ExpiresAt > now {
		expiresAt = legacy.ExpiresAt
	}

	newRecord := PushSubscriptionRecord{
		UserID:    legacy.UserID,
		DeviceID:  deviceID,
		Endpoint:  legacy.Endpoint,
		Keys:      legacy.Keys,
		IsActive:  true,
		CreatedAt: now,
		UpdatedAt: now,
		ExpiresAt: expiresAt,
	}

	item, err := attributevalue.MarshalMap(newRecord)
	if err != nil {
		log.Printf("Failed to marshal new record for migration: %v", err)
		return
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           &newTableName,
		Item:                item,
		ConditionExpression: stringPtr("attribute_not_exists(userId)"), // 避免覆蓋已存在的記錄
	})

	if err != nil {
		// ConditionalCheckFailedException 表示記錄已存在，這是正常的
		log.Printf("Migration result for user %s: %v", legacy.UserID, err)
		return
	}

	log.Printf("Successfully migrated subscription for user %s, device %s to new table", legacy.UserID, deviceID)
}

// 輔助函數
func stringPtr(s string) *string {
	return &s
}

func int32Ptr(i int32) *int32 {
	return &i
}

func main() {
	lambda.Start(Handler)
}
