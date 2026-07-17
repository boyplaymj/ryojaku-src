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
	"sync"
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

type CancelRegistrationRequest struct {
	GameID         string `json:"gameID"`
	RegistrationID string `json:"registrationID"`
}

type Response struct {
	Success bool        `json:"success"`
	Error   string      `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_cancel_registration")

	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

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
			return events.APIGatewayProxyResponse{
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
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}

	// Parse request body
	var req CancelRegistrationRequest
	err = json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		response := Response{Success: false, Error: "Invalid request body"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get registration
	registration, err := getRegistration(ctx, req.RegistrationID)
	if err != nil || registration == nil {
		response := Response{Success: false, Error: "找不到此報名資料"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Verify registration belongs to user
	if registration.UserID != userID {
		response := Response{Success: false, Error: "您無權取消此報名"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusForbidden,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Verify game ID matches
	if registration.GameID != req.GameID {
		response := Response{Success: false, Error: "報名資料與團局 ID 不符"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Verify status is pending
	if registration.Status != "pending" {
		response := Response{Success: false, Error: "僅能取消待審核中的報名"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get game to get host info and name
	game, err := getGame(ctx, req.GameID)
	if err != nil || game == nil {
		response := Response{Success: false, Error: "找不到此團局"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Update registration status to cancelled
	registration.Status = "cancelled"
	registration.UpdatedAt = shared.FlexibleTime{Time: time.Now()}

	err = saveRegistration(ctx, registration)
	if err != nil {
		log.Printf("Failed to cancel registration: %v", err)
		response := Response{Success: false, Error: "取消報名失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Notify host
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		createWebNotification(
			context.Background(),
			game.HostUserID,
			"registration_cancelled",
			"報名已取消",
			fmt.Sprintf("%s 已取消報名您的「%s」團局", registration.DisplayName, game.Location.PlaceName),
			req.GameID,
			game.Location.PlaceName,
			userID,
			registration.DisplayName,
		)
	}()

	// Wait for notification to complete
	wg.Wait()

	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"message": "✅ 已成功取消報名",
		},
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func getRegistration(ctx context.Context, registrationID string) (*shared.Registration, error) {
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
		return nil, nil
	}

	var reg shared.Registration
	err = attributevalue.UnmarshalMap(result.Item, &reg)
	return &reg, err
}

func saveRegistration(ctx context.Context, reg *shared.Registration) error {
	item, err := attributevalue.MarshalMap(reg)
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

func getGame(ctx context.Context, gameID string) (*shared.Game, error) {
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
		return nil, nil
	}

	var game shared.Game
	err = attributevalue.UnmarshalMap(result.Item, &game)
	return &game, err
}

func createWebNotification(ctx context.Context, userID, notifType, title, message, gameID, gameName, fromUserID, fromUserName string) error {
	now := time.Now()
	expiresAt := now.AddDate(0, 0, 30) // Expire after 30 days

	notification := map[string]interface{}{
		"notificationId": "NOTIF_" + uuid.New().String()[:8],
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

	// Send push notification
	if pushService != nil {
		data := map[string]interface{}{
			"url":    "/notifications",
			"gameId": gameID,
			"type":   notifType,
		}
		if fromUserID != "" {
			data["fromUserId"] = fromUserID
			data["fromUserName"] = fromUserName
		}
		pushService.SendPushNotificationToUser(ctx, userID, title, message, data)
	}

	return nil
}

func decryptLineID(encryptedData string) (string, error) {
	if encryptionKey == "" {
		return "", fmt.Errorf("encryption key not configured")
	}

	key, err := base64.StdEncoding.DecodeString(encryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to decode encryption key: %w", err)
	}

	combined, err := base64.URLEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(combined) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce := combined[:nonceSize]
	ciphertext := combined[nonceSize:]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

func main() {
	lambda.Start(Handler)
}
