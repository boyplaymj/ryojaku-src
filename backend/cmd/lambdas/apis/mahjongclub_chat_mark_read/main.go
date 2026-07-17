package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var dbClient *dynamodb.Client
var tablePrefix string

func init() {
	awsRegion := os.Getenv("AWS_REGION")
	if awsRegion == "" {
		awsRegion = "ap-southeast-1"
	}
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(awsRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	dbClient = dynamodb.NewFromConfig(awsCfg)
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "chat_mark_read")

	// Support CORS
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
			Body:       "",
		}, nil
	}

	// Parse body
	var req struct {
		UserID string `json:"userId"`
		RoomID string `json:"roomId"`
	}
	err := json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid request body", headers)
	}

	if req.UserID == "" || req.RoomID == "" {
		return errorResponse(http.StatusBadRequest, "Missing userId or roomId", headers)
	}

	tableName := tablePrefix + "ChatUserMemberships"

	// 1. Find existing membership to get the SortKey
	queryResult, err := dbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		KeyConditionExpression: aws.String("UserID = :uid"),
		FilterExpression:       aws.String("RoomID = :rid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: req.UserID},
			":rid": &types.AttributeValueMemberS{Value: req.RoomID},
		},
	})

	if err != nil {
		log.Printf("Failed to query membership: %v", err)
		return errorResponse(http.StatusInternalServerError, "Database error", headers)
	}

	if len(queryResult.Items) == 0 {
		// Membership not found, maybe user left or never joined
		return successResponse(map[string]string{"message": "Membership not found, nothing to update"}, headers)
	}

	// 2. Update UnreadCount to 0 for the found item(s)
	for _, item := range queryResult.Items {
		var mem shared.ChatMembership
		if err := attributevalue.UnmarshalMap(item, &mem); err != nil {
			continue
		}

		_, err := dbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &tableName,
			Key: map[string]types.AttributeValue{
				"UserID":                 item["UserID"],
				"LastMessageTime#RoomID": item["LastMessageTime#RoomID"],
			},
			UpdateExpression: aws.String("SET UnreadCount = :zero"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":zero": &types.AttributeValueMemberN{Value: "0"},
			},
		})

		if err != nil {
			log.Printf("Failed to update unread count: %v", err)
			// Continue trying other items if duplicates exist (though unlikely)
		}
	}

	return successResponse(map[string]string{"message": "Marked as read"}, headers)
}

func errorResponse(status int, msg string, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: false, Error: msg})
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func successResponse(data interface{}, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: true, Data: data})
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
