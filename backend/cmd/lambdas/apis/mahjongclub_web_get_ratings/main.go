package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Rating struct {
	RatingID   string `dynamodbav:"ratingId" json:"ratingId"`
	GameID     string `dynamodbav:"gameId" json:"gameId"`
	FromUserID string `dynamodbav:"fromUserId" json:"fromUserId"`
	ToUserID   string `dynamodbav:"toUserId" json:"toUserId"`
	IsPositive bool   `dynamodbav:"isPositive" json:"isPositive"`
	Comment    string `dynamodbav:"comment,omitempty" json:"comment,omitempty"`
	CreatedAt  int64  `dynamodbav:"createdAt" json:"createdAt"`
}

type ResponseData struct {
	Ratings []*Rating `json:"ratings"`
}

type Response struct {
	Success bool          `json:"success"`
	Data    *ResponseData `json:"data,omitempty"`
	Error   string        `json:"error,omitempty"`
}

var (
	dynamoClient  *dynamodb.Client
	tablePrefix   string
	encryptionKey string
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

	encryptionKey = os.Getenv("ENCRYPTION_KEY")
	if encryptionKey == "" {
		log.Fatal("ENCRYPTION_KEY environment variable is required")
	}
}

// DecryptLineID decrypts an encrypted LINE ID
func decryptLineID(encryptedData string) (string, error) {
	if encryptionKey == "" {
		return "", fmt.Errorf("encryption key not configured")
	}

	// Decode base64 key
	key, err := base64.StdEncoding.DecodeString(encryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to decode encryption key: %w", err)
	}

	// Decode URL-safe base64
	combined, err := base64.URLEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM mode
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	// Extract nonce and ciphertext
	nonceSize := gcm.NonceSize()
	if len(combined) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce := combined[:nonceSize]
	ciphertext := combined[nonceSize:]

	// Decrypt
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

func handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeaderV2(request, "web_get_ratings")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
		}, nil
	}

	// Get query parameters (v2 uses lowercase map keys or specific field)
	lineID := request.QueryStringParameters["lineID"]
	userID := request.QueryStringParameters["userId"]
	gameID := request.QueryStringParameters["gameId"]

	// Validate parameters according to API spec:
	// Must provide gameId OR (userId/lineID)
	if gameID == "" && lineID == "" && userID == "" {
		response := Response{Success: false, Error: "缺少必要參數: 必須提供 gameId 或 userId/lineID"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	var finalUserID string
	var err error

	// Handle user identification
	if lineID != "" {
		// Decrypt LINE ID for LINE Bot users
		finalUserID, err = decryptLineID(lineID)
		if err != nil {
			log.Printf("Failed to decrypt LINE ID: %v", err)
			response := Response{Success: false, Error: "無效的 LINE ID"}
			body, _ := json.Marshal(response)
			return events.APIGatewayV2HTTPResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	} else if userID != "" {
		// Use APP user ID directly
		finalUserID = userID
	}

	var ratings []*Rating

	if gameID != "" && finalUserID != "" {
		// Case 1: Both gameId and userId provided - get ratings from specific user in specific game
		ratings, err = getRatingsByGameAndFromUser(ctx, gameID, finalUserID)
	} else if gameID != "" {
		// Case 2: Only gameId provided - get all ratings for this game
		ratings, err = getRatingsByGame(ctx, gameID)
	} else if finalUserID != "" {
		// Case 3: Only userId provided - get all ratings received by this user
		ratings, err = getRatingsByToUser(ctx, finalUserID)
	}
	if err != nil {
		log.Printf("Failed to get ratings: %v", err)
		response := Response{Success: false, Error: "獲取評分失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	response := Response{
		Success: true,
		Data: &ResponseData{
			Ratings: ratings,
		},
	}
	body, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func getRatingsByGameAndFromUser(ctx context.Context, gameID, fromUserID string) ([]*Rating, error) {
	tableName := tablePrefix + "Ratings"
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("gameId-fromUserId-index"),
		KeyConditionExpression: aws.String("gameId = :gameId AND fromUserId = :fromUserId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":gameId":     &types.AttributeValueMemberS{Value: gameID},
			":fromUserId": &types.AttributeValueMemberS{Value: fromUserID},
		},
	})

	if err != nil {
		return nil, err
	}

	var ratings []*Rating
	err = attributevalue.UnmarshalListOfMaps(result.Items, &ratings)
	if err != nil {
		return nil, err
	}

	return ratings, nil
}

// getRatingsByGame gets all ratings for a specific game
func getRatingsByGame(ctx context.Context, gameID string) ([]*Rating, error) {
	tableName := tablePrefix + "Ratings"

	// Since we don't have a gameId-only index, we need to scan with filter
	result, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(tableName),
		FilterExpression: aws.String("gameId = :gameId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":gameId": &types.AttributeValueMemberS{Value: gameID},
		},
	})

	if err != nil {
		return nil, err
	}

	var ratings []*Rating
	err = attributevalue.UnmarshalListOfMaps(result.Items, &ratings)
	if err != nil {
		return nil, err
	}

	return ratings, nil
}

// getRatingsByToUser gets all ratings received by a specific user
func getRatingsByToUser(ctx context.Context, toUserID string) ([]*Rating, error) {
	tableName := tablePrefix + "Ratings"
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("toUserId-createdAt-index"),
		KeyConditionExpression: aws.String("toUserId = :toUserId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":toUserId": &types.AttributeValueMemberS{Value: toUserID},
		},
		ScanIndexForward: aws.Bool(false), // Sort by createdAt descending
	})

	if err != nil {
		return nil, err
	}

	var ratings []*Rating
	err = attributevalue.UnmarshalListOfMaps(result.Items, &ratings)
	if err != nil {
		return nil, err
	}

	return ratings, nil
}

func main() {
	lambda.Start(handler)
}
