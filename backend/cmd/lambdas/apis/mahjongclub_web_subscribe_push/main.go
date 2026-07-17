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

type PushSubscription struct {
	Endpoint string                 `json:"endpoint"`
	Keys     map[string]interface{} `json:"keys"`
}

type SubscribeRequest struct {
	UserID       string           `json:"userId"`
	Subscription PushSubscription `json:"subscription"`
	DeviceID     string           `json:"deviceId"`
}

type Response struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type PushSubscriptionRecord struct {
	UserID    string                 `dynamodbav:"userId"`
	DeviceID  string                 `dynamodbav:"deviceId"`
	Endpoint  string                 `dynamodbav:"endpoint"`
	Keys      map[string]interface{} `dynamodbav:"keys"`
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
	shared.RecordTokenUsageFromHeader(request, "web_subscribe_push")

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

	// Parse request body
	var req SubscribeRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Failed to parse request body: %v", err)
		response := Response{Success: false, Error: "Invalid request format"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Validate required fields
	if req.UserID == "" || req.Subscription.Endpoint == "" || req.DeviceID == "" {
		response := Response{Success: false, Error: "Missing required fields (userId, endpoint, deviceId)"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Check if subscription already exists for this device
	isNewSubscription, err := checkSubscriptionExists(ctx, req.UserID, req.DeviceID)
	if err != nil {
		log.Printf("Warning: Failed to check subscription status: %v", err)
		// Default to false (don't send notification) if check fails to avoid annoying users
		isNewSubscription = false
	}

	// Save subscription to DynamoDB
	if err := savePushSubscription(ctx, &req); err != nil {
		log.Printf("Failed to save push subscription: %v", err)
		response := Response{Success: false, Error: "Failed to save subscription"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Enable notification preferences when user subscribes to push
	if err := enableNotificationPreferences(ctx, req.UserID); err != nil {
		log.Printf("Failed to enable notification preferences: %v", err)
		// Don't fail the request, just log the error
		// The subscription is already saved
	}

	// 🚀 Send Welcome Notification ONLY for new subscriptions (Non-blocking)
	if isNewSubscription {
		go func() {
			shared.CreateNotification(context.Background(), dynamoClient, tablePrefix, shared.CreateNotificationParams{
				UserID:  req.UserID,
				Type:    "push_enabled",
				Title:   "🔔 推播通知已開啟",
				Message: "您已成功開啟推播通知功能，將不再錯過任何精彩對局與訊息。",
			})
		}()
	}

	response := Response{Success: true}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// savePushSubscription saves the push subscription to DynamoDB
func savePushSubscription(ctx context.Context, req *SubscribeRequest) error {
	now := time.Now().Unix()
	expiresAt := now + (365 * 24 * 60 * 60) // Expire after 1 year

	record := PushSubscriptionRecord{
		UserID:    req.UserID,
		DeviceID:  req.DeviceID,
		Endpoint:  req.Subscription.Endpoint,
		Keys:      req.Subscription.Keys,
		IsActive:  true,
		CreatedAt: now,
		UpdatedAt: now,
		ExpiresAt: expiresAt,
	}

	item, err := attributevalue.MarshalMap(record)
	if err != nil {
		log.Printf("Failed to marshal subscription: %v", err)
		return err
	}

	tableName := tablePrefix + "PushSubscriptions_MultiDevice"
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	if err != nil {
		log.Printf("Failed to save subscription to DynamoDB: %v", err)
		return err
	}

	log.Printf("Push subscription saved for user %s, device %s", req.UserID, req.DeviceID)
	return nil
}

// enableNotificationPreferences enables notification preferences for the user
func enableNotificationPreferences(ctx context.Context, userID string) error {
	tableName := tablePrefix + "Users"

	// Use UpdateItem to set notification preferences to true
	updateExpression := "SET preferences.notifyNewGames = :true, preferences.notifyGameUpdates = :true"

	trueValue, err := attributevalue.Marshal(true)
	if err != nil {
		log.Printf("Failed to marshal true value: %v", err)
		return err
	}

	key, err := attributevalue.MarshalMap(map[string]string{
		"userId": userID,
	})
	if err != nil {
		log.Printf("Failed to marshal key: %v", err)
		return err
	}

	_, err = dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:        &tableName,
		Key:              key,
		UpdateExpression: &updateExpression,
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":true": trueValue,
		},
	})

	if err != nil {
		log.Printf("Failed to update notification preferences for user %s: %v", userID, err)
		return err
	}

	log.Printf("Notification preferences enabled for user %s", userID)
	return nil
}

// checkSubscriptionExists checks if a subscription already exists for the given user and device
func checkSubscriptionExists(ctx context.Context, userID, deviceID string) (bool, error) {
	tableName := tablePrefix + "PushSubscriptions_MultiDevice"

	key, err := attributevalue.MarshalMap(map[string]string{
		"userId":   userID,
		"deviceId": deviceID,
	})
	if err != nil {
		return false, err
	}

	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key:       key,
	})
	if err != nil {
		return false, err
	}

	// If result.Item is empty, it means no existing subscription was found
	return len(result.Item) == 0, nil
}

func main() {
	lambda.Start(Handler)
}
