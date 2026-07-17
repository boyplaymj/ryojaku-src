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
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

var (
	dynamoClient  *dynamodb.Client
	tablePrefix   string
	encryptionKey string
	pushService   *shared.PushNotificationService
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("ap-southeast-1"))
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
		log.Println("WARNING: ENCRYPTION_KEY not set")
	}

	var errPush error
	pushService, errPush = shared.NewPushNotificationService()
	if errPush != nil {
		log.Printf("Failed to initialize push notification service: %v", errPush)
	}
}

type RejectRegistrationRequest struct {
	GameID         string `json:"gameID"`
	GameId         string `json:"gameId"` // Support both cases
	RegistrationID string `json:"registrationID"`
	RegistrationId string `json:"registrationId"` // Support both cases
}

type Response struct {
	Success bool        `json:"success"`
	Error   string      `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeaderV2(request, "web_reject_registration")

	log.Printf("Received request: %s %s", request.RequestContext.HTTP.Method, request.RequestContext.HTTP.Path)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// Get user ID - support both lineID (encrypted) and userId (APP_xxx) parameters
	var userID string
	var err error

	// Try to get userId parameter first (for APP users)
	userID = request.QueryStringParameters["userId"]

	// If userId is not provided, try lineID (for LINE Bot users)
	if userID == "" {
		encryptedLineID := request.QueryStringParameters["lineID"]
		if encryptedLineID == "" {
			response := Response{Success: false, Error: "Missing userId or lineID parameter"}
			body, _ := json.Marshal(response)
			return events.APIGatewayV2HTTPResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}

		// Decrypt LINE ID
		userID, err = decryptLineID(encryptedLineID)
		if err != nil {
			response := Response{Success: false, Error: "Failed to decrypt LINE ID"}
			body, _ := json.Marshal(response)
			return events.APIGatewayV2HTTPResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}

	// Parse request body
	var req RejectRegistrationRequest
	err = json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		log.Printf("Failed to parse request body: %v", err)
		response := Response{Success: false, Error: "Invalid request body"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Normalize IDs from request
	finalRegistrationID := req.RegistrationID
	if finalRegistrationID == "" {
		finalRegistrationID = req.RegistrationId
	}
	finalGameID := req.GameID
	if finalGameID == "" {
		finalGameID = req.GameId
	}

	if finalRegistrationID == "" {
		response := Response{Success: false, Error: "Missing registrationID parameter"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get registration first to get gameId if missing
	registration, err := getRegistration(ctx, finalRegistrationID)
	if err != nil || registration == nil {
		log.Printf("Registration not found: %s, err: %v", finalRegistrationID, err)
		response := Response{Success: false, Error: "找不到此報名紀錄"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// If gameId is missing in request, get it from registration
	if finalGameID == "" {
		if gid, ok := registration["gameId"].(string); ok {
			finalGameID = gid
		}
	}

	if finalGameID == "" {
		response := Response{Success: false, Error: "Missing gameID parameter"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get game
	game, err := getGame(ctx, finalGameID)
	if err != nil || game == nil {
		log.Printf("Game not found: %s, err: %v", finalGameID, err)
		response := Response{Success: false, Error: "找不到此團局"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Verify user is host
	if game["hostUserId"].(string) != userID {
		response := Response{Success: false, Error: "只有主揪可以拒絕報名"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusForbidden,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Check if registration has already been processed
	status := registration["status"].(string)
	if status == "accepted" {
		response := Response{Success: false, Error: "此報名已經接受過了"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	if status == "rejected" {
		response := Response{Success: false, Error: "此報名已經被拒絕過了"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Update registration status
	registration["status"] = "rejected"
	registration["updatedAt"] = time.Now().Format(time.RFC3339)

	err = saveRegistration(ctx, registration)
	if err != nil {
		log.Printf("Failed to update registration: %v", err)
		response := Response{Success: false, Error: "拒絕報名失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Create web notification for player (rejection)
	createWebNotification(
		ctx,
		registration["userId"].(string),
		"rejection",
		"報名已被拒絕",
		fmt.Sprintf("您的「%s」團局報名已被拒絕", getPlaceName(game)),
		finalGameID,
		getPlaceName(game),
		"",
		"",
	)

	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"message": "✅ 已拒絕報名",
		},
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func getGame(ctx context.Context, gameID string) (map[string]interface{}, error) {
	tableName := tablePrefix + "Games"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"gameId": &types.AttributeValueMemberS{Value: gameID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, fmt.Errorf("game not found")
	}

	var game map[string]interface{}
	err = attributevalue.UnmarshalMap(result.Item, &game)
	return game, err
}

func getRegistration(ctx context.Context, registrationID string) (map[string]interface{}, error) {
	tableName := tablePrefix + "Registrations"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"registrationId": &types.AttributeValueMemberS{Value: registrationID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, fmt.Errorf("registration not found")
	}

	var registration map[string]interface{}
	err = attributevalue.UnmarshalMap(result.Item, &registration)
	return registration, err
}

func saveRegistration(ctx context.Context, registration map[string]interface{}) error {
	item, err := attributevalue.MarshalMap(registration)
	if err != nil {
		return err
	}

	tableName := tablePrefix + "Registrations"
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})
	return err
}

func createWebNotification(ctx context.Context, userID, notifType, title, message, gameID, gameName, fromUserID, fromUserName string) error {
	now := time.Now()
	expiresAt := now.AddDate(0, 0, 30) // Expire after 30 days

	notification := map[string]interface{}{
		"notificationId": uuid.New().String(),
		"userId":         userID,
		"type":           notifType,
		"title":          title,
		"message":        message,
		"isRead":         false,
		"createdAt":      now.Unix(),
		"expiresAt":      expiresAt.Unix(),
	}

	if gameID != "" {
		notification["gameId"] = gameID
	}
	if gameName != "" {
		notification["gameName"] = gameName
	}
	if fromUserID != "" {
		notification["fromUserId"] = fromUserID
	}
	if fromUserName != "" {
		notification["fromUserName"] = fromUserName
	}

	item, err := attributevalue.MarshalMap(notification)
	if err != nil {
		log.Printf("Failed to marshal notification: %v", err)
		return err
	}

	tableName := tablePrefix + "Notifications"
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	if err != nil {
		log.Printf("Failed to save notification: %v", err)
		return err
	}

	// Send push notification synchronously
	data := map[string]interface{}{
		"url":    "/notifications",
		"gameId": gameID,
		"type":   notifType,
	}
	if fromUserID != "" {
		data["fromUserId"] = fromUserID
		data["fromUserName"] = fromUserName
	}

	if pushService != nil {
		pushService.SendPushNotificationToUser(context.Background(), userID, title, message, data)
	} else {
		log.Println("Push service not initialized, skipping push notification")
	}

	return nil
}

func getPlaceName(game map[string]interface{}) string {
	if location, ok := game["location"].(map[string]interface{}); ok {
		if placeName, ok := location["placeName"].(string); ok {
			return placeName
		}
	}
	return "團局"
}

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

func main() {
	lambda.Start(Handler)
}
