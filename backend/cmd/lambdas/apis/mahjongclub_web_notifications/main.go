package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type GetNotificationsResponse struct {
	Success       bool                  `json:"success"`
	Notifications []shared.Notification `json:"notifications,omitempty"`
	UnreadCount   int                   `json:"unreadCount"`
	HasMore       bool                  `json:"hasMore"`
	LastKey       string                `json:"lastKey,omitempty"`
	Error         string                `json:"error,omitempty"`
}

type MarkReadRequest struct {
	NotificationID string `json:"notificationId"`
}

type MarkReadResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

var (
	dynamoClient *dynamodb.Client
	tablePrefix  string
)

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

func handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeaderV2(request, "web_notifications")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
		}, nil
	}

	// Route based on HTTP method
	log.Printf("Method: %s, Path: %s, Body: %s", request.RequestContext.HTTP.Method, request.RequestContext.HTTP.Path, request.Body)

	if request.RequestContext.HTTP.Method == "GET" {
		return handleGetNotifications(ctx, request, headers)
	} else if request.RequestContext.HTTP.Method == "POST" {
		// Check if it's a mark-read request by looking at the body
		var bodyMap map[string]interface{}
		if err := json.Unmarshal([]byte(request.Body), &bodyMap); err == nil {
			if _, hasNotificationID := bodyMap["notificationId"]; hasNotificationID {
				return handleMarkRead(ctx, request, headers)
			}
		}

		response := map[string]interface{}{
			"success": false,
			"error":   "無效的請求格式",
		}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	response := map[string]interface{}{
		"success": false,
		"error":   "不支援的請求方法",
	}
	body, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusMethodNotAllowed,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// handleGetNotifications gets notifications for a user with pagination
func handleGetNotifications(ctx context.Context, request events.APIGatewayV2HTTPRequest, headers map[string]string) (events.APIGatewayV2HTTPResponse, error) {
	userID := request.QueryStringParameters["userId"]
	if userID == "" {
		response := GetNotificationsResponse{Success: false, Error: "缺少用戶 ID"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get pagination parameters
	limit := 5 // Default limit
	lastKey := request.QueryStringParameters["lastKey"]

	// Get notifications with pagination
	notifications, hasMore, newLastKey, err := getNotifications(ctx, userID, limit, lastKey)
	if err != nil {
		log.Printf("Failed to get notifications: %v", err)
		response := GetNotificationsResponse{Success: false, Error: "獲取通知失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Count total unread notifications (need to query all)
	allNotifications, _, _, err := getNotifications(ctx, userID, 1000, "")
	unreadCount := 0
	if err == nil {
		for _, notif := range allNotifications {
			if !notif.IsRead {
				unreadCount++
			}
		}
	}

	response := GetNotificationsResponse{
		Success:       true,
		Notifications: notifications,
		UnreadCount:   unreadCount,
		HasMore:       hasMore,
		LastKey:       newLastKey,
	}
	body, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// handleMarkRead marks a notification as read
func handleMarkRead(ctx context.Context, request events.APIGatewayV2HTTPRequest, headers map[string]string) (events.APIGatewayV2HTTPResponse, error) {
	var req MarkReadRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		response := MarkReadResponse{Success: false, Error: "無效的請求格式"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	if req.NotificationID == "" {
		response := MarkReadResponse{Success: false, Error: "缺少通知 ID"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Mark as read
	if err := markNotificationAsRead(ctx, req.NotificationID); err != nil {
		log.Printf("Failed to mark notification as read: %v", err)
		response := MarkReadResponse{Success: false, Error: "標記已讀失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	response := MarkReadResponse{Success: true}
	body, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// getNotifications retrieves notifications for a user with pagination, sorted by createdAt descending
func getNotifications(ctx context.Context, userID string, limit int, lastKey string) ([]shared.Notification, bool, string, error) {
	tableName := tablePrefix + "Notifications"

	queryInput := &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("userId-createdAt-index"),
		KeyConditionExpression: aws.String("userId = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false), // Sort by createdAt descending (newest first)
		Limit:            aws.Int32(int32(limit)),
	}

	// Add ExclusiveStartKey if lastKey is provided
	// lastKey format: "notificationId|createdAt"
	if lastKey != "" {
		// Parse lastKey to get notificationId and createdAt
		var notificationID, createdAt string
		for i := 0; i < len(lastKey); i++ {
			if lastKey[i] == '|' {
				notificationID = lastKey[:i]
				createdAt = lastKey[i+1:]
				break
			}
		}

		if notificationID != "" && createdAt != "" {
			queryInput.ExclusiveStartKey = map[string]types.AttributeValue{
				"notificationId": &types.AttributeValueMemberS{Value: notificationID},
				"userId":         &types.AttributeValueMemberS{Value: userID},
				"createdAt":      &types.AttributeValueMemberN{Value: createdAt},
			}
		}
	}

	result, err := dynamoClient.Query(ctx, queryInput)
	if err != nil {
		log.Printf("Query error: %v", err)
		return nil, false, "", err
	}

	var notifications []shared.Notification
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &notifications); err != nil {
		return nil, false, "", err
	}

	// Check if there are more results
	hasMore := result.LastEvaluatedKey != nil
	newLastKey := ""
	if hasMore && len(notifications) > 0 {
		// Create lastKey in format "notificationId|createdAt"
		lastNotif := notifications[len(notifications)-1]
		newLastKey = lastNotif.NotificationID + "|" + strconv.FormatInt(lastNotif.CreatedAt, 10)
	}

	log.Printf("Query returned %d notifications, hasMore: %v, newLastKey: %s", len(notifications), hasMore, newLastKey)
	return notifications, hasMore, newLastKey, nil
}

// markNotificationAsRead marks a notification as read
func markNotificationAsRead(ctx context.Context, notificationID string) error {
	tableName := tablePrefix + "Notifications"

	_, err := dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"notificationId": &types.AttributeValueMemberS{Value: notificationID},
		},
		UpdateExpression: aws.String("SET isRead = :isRead"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":isRead": &types.AttributeValueMemberBOOL{Value: true},
		},
	})

	return err
}

func main() {
	lambda.Start(handler)
}
