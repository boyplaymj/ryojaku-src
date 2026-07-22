package main

// 帳號系統 — 改密碼端點（AUTH_SYSTEM_DESIGN §5.D）。
// POST（需登入，僅接受 JWT 身分）{"currentPassword":"...","newPassword":"..."}
// 驗目前密碼 → 換新 bcrypt hash + 寫 pwChangedAt（Unix 秒，Number）作廢舊 JWT。

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"golang.org/x/crypto/bcrypt"

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

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
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

	// 安全鐵律：改密碼只接受 JWT 身分，絕不接受 query param userId。
	userID, fromJWT := shared.GetUserIdentifier(request)
	if !fromJWT || userID == "" {
		return errorResponse(headers, http.StatusUnauthorized, "unauthorized"), nil
	}

	var req changePasswordRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(headers, http.StatusBadRequest, "invalid request body"), nil
	}

	if len(req.NewPassword) < 8 {
		return errorResponse(headers, http.StatusBadRequest, "密碼長度至少 8 個字元"), nil
	}

	// 取現有 passwordHash（投影即可）。
	getResult, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tablePrefix + "Users"),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		ProjectionExpression: aws.String("passwordHash"),
	})
	if err != nil {
		log.Printf("GetItem failed for user %s: %v", userID, err)
		return errorResponse(headers, http.StatusInternalServerError, "service unavailable"), nil
	}
	if getResult.Item == nil {
		return errorResponse(headers, http.StatusUnauthorized, "目前密碼不正確"), nil
	}

	var storedHash string
	if attr, ok := getResult.Item["passwordHash"].(*types.AttributeValueMemberS); ok {
		storedHash = attr.Value
	}
	if storedHash == "" || bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(req.CurrentPassword)) != nil {
		return errorResponse(headers, http.StatusUnauthorized, "目前密碼不正確"), nil
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("bcrypt.GenerateFromPassword failed: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "service unavailable"), nil
	}

	now := time.Now()
	_, err = dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(tablePrefix + "Users"),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression:    aws.String("SET passwordHash = :h, pwChangedAt = :t, updatedAt = :now"),
		ConditionExpression: aws.String("attribute_exists(userId)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":h":   &types.AttributeValueMemberS{Value: string(newHash)},
			":t":   &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
			":now": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		},
	})
	if err != nil {
		log.Printf("UpdateItem failed for user %s: %v", userID, err)
		return errorResponse(headers, http.StatusInternalServerError, "service unavailable"), nil
	}

	body, _ := json.Marshal(map[string]interface{}{"success": true})
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
