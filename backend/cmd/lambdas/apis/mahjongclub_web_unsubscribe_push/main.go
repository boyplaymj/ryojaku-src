package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"fmt"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type UnsubscribeRequest struct {
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId"`
}

type UnsubscribeResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
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
	shared.RecordTokenUsageFromHeader(request, "web_unsubscribe_push")

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
		response := UnsubscribeResponse{Success: false, Error: "Method not allowed"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusMethodNotAllowed,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Parse request body
	var req UnsubscribeRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Failed to parse request body: %v", err)
		response := UnsubscribeResponse{Success: false, Error: "Invalid request format"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Validate required fields
	if req.UserID == "" || req.DeviceID == "" {
		response := UnsubscribeResponse{Success: false, Error: "Missing required fields (userId, deviceId)"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Remove subscription from DynamoDB
	if err := removeSubscription(ctx, &req); err != nil {
		log.Printf("Failed to remove subscription: %v", err)
		response := UnsubscribeResponse{Success: false, Error: "Failed to remove subscription"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	response := UnsubscribeResponse{Success: true}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// removeSubscription deactivates a push subscription for a specific device instead of removing it
func removeSubscription(ctx context.Context, req *UnsubscribeRequest) error {
	tableName := tablePrefix + "PushSubscriptions_MultiDevice"

	// Define expression to set isActive to false
	updateExpression := "SET isActive = :false, updatedAt = :now"
	
	now := types.AttributeValueMemberN{Value: stringPtrInt64(time.Now().Unix())}
	falseValue := types.AttributeValueMemberBOOL{Value: false}

	_, err := dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"userId":   &types.AttributeValueMemberS{Value: req.UserID},
			"deviceId": &types.AttributeValueMemberS{Value: req.DeviceID},
		},
		UpdateExpression: &updateExpression,
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":false": &falseValue,
			":now":   &now,
		},
	})

	if err != nil {
		log.Printf("Failed to deactivate subscription in DynamoDB: %v", err)
		return err
	}

	log.Printf("Push subscription deactivated (isActive=false) for user %s, device %s", req.UserID, req.DeviceID)
	return nil
}

// helper
func stringPtrInt64(i int64) string {
	return fmt.Sprintf("%d", i)
}

func main() {
	lambda.Start(Handler)
}
