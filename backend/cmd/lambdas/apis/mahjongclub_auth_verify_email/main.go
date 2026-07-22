package main

// 帳號系統 — 認證信驗證端點（AUTH_SYSTEM_DESIGN §5.A）。
// GET ?token=... → shared.ConsumeToken 原子消耗一次性 token → 標記 Users.emailVerified = true。

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

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
		"Access-Control-Allow-Methods": "GET, OPTIONS",
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

	if dynamoClient == nil {
		return errorResponse(headers, http.StatusInternalServerError, "service unavailable"), nil
	}

	token := request.QueryStringParameters["token"]
	if token == "" {
		return errorResponse(headers, http.StatusBadRequest, "missing token"), nil
	}

	// 原子驗證＋消耗一次性 token；任何失敗一律回同一句、不洩漏細節。
	userID, err := shared.ConsumeToken(ctx, token, shared.PurposeVerifyEmail)
	if err != nil {
		log.Printf("ConsumeToken failed: %v", err)
		return errorResponse(headers, http.StatusBadRequest, "invalid, expired, or used token"), nil
	}

	now := time.Now().Format(time.RFC3339)
	_, err = dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(tablePrefix + "Users"),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression:    aws.String("SET emailVerified = :t, updatedAt = :now"),
		ConditionExpression: aws.String("attribute_exists(userId)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t":   &types.AttributeValueMemberBOOL{Value: true},
			":now": &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		log.Printf("Failed to update user %s: %v", userID, err)
		return errorResponse(headers, http.StatusBadRequest, "invalid, expired, or used token"), nil
	}

	body, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"userId":        userID,
			"emailVerified": true,
		},
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
