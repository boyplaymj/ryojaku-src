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
	sharedPush "mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

var (
	pushService *sharedPush.PushNotificationService
)

// Config holds the configuration
type Config struct {
	AWSRegion     string
	TablePrefix   string
	EncryptionKey string
}

// Database handles DynamoDB operations
type Database struct {
	client *dynamodb.Client
	cfg    *Config
}

// RegisterRequest represents the request to register for a game
type RegisterRequest struct {
	GameID  string `json:"gameID"`
	LineID  string `json:"lineID"`
	Message string `json:"message"`
}

// User represents a user
type User struct {
	UserID      string `dynamodbav:"userId"`
	DisplayName string `dynamodbav:"displayName"`
	PictureURL  string `dynamodbav:"pictureUrl"`
}

// Use shared models
type Game = shared.Game
type Registration = shared.Registration
type FlexibleTime = shared.FlexibleTime

// Response structure for API responses
type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var db *Database

func init() {
	cfg := &Config{
		AWSRegion:     getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix:   getEnv("TABLE_PREFIX", "MahjongClub_"),
		EncryptionKey: os.Getenv("ENCRYPTION_KEY"),
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(cfg.AWSRegion),
	)
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	db = &Database{
		client: dynamodb.NewFromConfig(awsCfg),
		cfg:    cfg,
	}

	// Initialize VAPID keys for push notifications
	var errPush error
	pushService, errPush = sharedPush.NewPushNotificationService()
	if errPush != nil {
		log.Printf("Failed to initialize push notification service: %v", errPush)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func (c *Config) GetTableName(tableName string) string {
	return c.TablePrefix + tableName
}

// DecryptLineID decrypts an encrypted LINE ID
func (d *Database) DecryptLineID(encryptedData string) (string, error) {
	if d.cfg.EncryptionKey == "" {
		return "", fmt.Errorf("encryption key not configured")
	}

	combined, err := base64.URLEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	key, err := base64.StdEncoding.DecodeString(d.cfg.EncryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to decode encryption key: %w", err)
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

// GetUser retrieves a user from DynamoDB
func (d *Database) GetUser(ctx context.Context, userID string) (*User, error) {
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &[]string{d.cfg.GetTableName("Users")}[0],
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if result.Item == nil {
		return nil, nil
	}

	var user User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal user: %w", err)
	}

	return &user, nil
}

// GetGame retrieves a game by ID
func (d *Database) GetGame(ctx context.Context, gameID string) (*Game, error) {
	tableName := d.cfg.GetTableName("Games")

	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"gameId": &types.AttributeValueMemberS{Value: gameID},
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get game: %w", err)
	}

	if result.Item == nil {
		return nil, nil
	}

	var game Game
	err = attributevalue.UnmarshalMap(result.Item, &game)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal game: %w", err)
	}

	return &game, nil
}

// SaveRegistration saves a registration to DynamoDB
func (d *Database) SaveRegistration(ctx context.Context, reg *Registration) error {
	item, err := attributevalue.MarshalMap(reg)
	if err != nil {
		return fmt.Errorf("failed to marshal registration: %w", err)
	}

	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &[]string{d.cfg.GetTableName("Registrations")}[0],
		Item:      item,
	})

	return err
}

// UpdateGame updates a game in DynamoDB
func (d *Database) UpdateGame(ctx context.Context, gameID string, currentPlayers int, status string) error {
	tableName := d.cfg.GetTableName("Games")
	updateExpr := "SET currentPlayers = :cp, #status = :status, updatedAt = :updatedAt"

	_, err := d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"gameId": &types.AttributeValueMemberS{Value: gameID},
		},
		UpdateExpression: &updateExpr,
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":cp":        &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", currentPlayers)},
			":status":    &types.AttributeValueMemberS{Value: status},
			":updatedAt": &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
		},
	})

	return err
}

// GetGameRegistrations retrieves all registrations for a game
func (d *Database) GetGameRegistrations(ctx context.Context, gameID string) ([]*Registration, error) {
	tableName := d.cfg.GetTableName("Registrations")

	// Query using GSI: gameId-createdAt-index
	result, err := d.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		IndexName:              &[]string{"gameId-createdAt-index"}[0],
		KeyConditionExpression: &[]string{"gameId = :gameId"}[0],
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":gameId": &types.AttributeValueMemberS{Value: gameID},
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to query registrations: %w", err)
	}

	var registrations []*Registration
	for _, item := range result.Items {
		var reg Registration
		err = attributevalue.UnmarshalMap(item, &reg)
		if err != nil {
			log.Printf("Failed to unmarshal registration: %v", err)
			continue
		}
		registrations = append(registrations, &reg)
	}

	return registrations, nil
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_register")

	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
		userID, err = db.DecryptLineID(encryptedLineID)
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

	// Get user
	user, err := db.GetUser(ctx, userID)
	if err != nil || user == nil {
		response := Response{Success: false, Error: "User not found"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Parse request body
	var req RegisterRequest
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

	// Get game
	game, err := db.GetGame(ctx, req.GameID)
	if err != nil || game == nil {
		response := Response{Success: false, Error: "找不到此團局"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 1. Check if user is host
	if game.HostUserID == userID {
		response := Response{Success: false, Error: "您是主揪，無需報名"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 2. Check game status
	if game.Status != "recruiting" {
		response := Response{Success: false, Error: "此團局已不接受報名"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 3. Check if user is already in JoinedPlayers
	for _, player := range game.JoinedPlayers {
		if player.UserID == userID {
			response := Response{Success: false, Error: "您已經報名此團局"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}

	// 4. Check all registration records
	allRegistrations, err := db.GetGameRegistrations(ctx, req.GameID)
	if err == nil {
		for _, reg := range allRegistrations {
			if reg.UserID == userID {
				switch reg.Status {
				case "pending":
					response := Response{Success: false, Error: "您已經報名此團局，請等待主揪審核"}
					body, _ := json.Marshal(response)
					return events.APIGatewayProxyResponse{
						StatusCode: http.StatusBadRequest,
						Headers:    headers,
						Body:       string(body),
					}, nil
				case "accepted":
					response := Response{Success: false, Error: "您已經報名此團局"}
					body, _ := json.Marshal(response)
					return events.APIGatewayProxyResponse{
						StatusCode: http.StatusBadRequest,
						Headers:    headers,
						Body:       string(body),
					}, nil
				case "rejected":
					response := Response{Success: false, Error: "您的報名已被拒絕，無法重新報名此團局"}
					body, _ := json.Marshal(response)
					return events.APIGatewayProxyResponse{
						StatusCode: http.StatusBadRequest,
						Headers:    headers,
						Body:       string(body),
					}, nil
				}
			}
		}
	}

	// 5. Check if game is full
	if game.CurrentPlayers >= game.PlayersNeeded+1 {
		response := Response{Success: false, Error: "此團局已滿"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Create registration with pending status (需要主揪審核)
	now := time.Now()
	registration := &Registration{
		RegistrationID:   "REG_" + uuid.New().String()[:8],
		GameID:           req.GameID,
		UserID:           userID,
		DisplayName:      user.DisplayName,
		Status:           "pending", // 改為 pending，等待主揪審核
		Message:          req.Message,
		NotificationSent: false,
		CreatedAt:        now.Unix(),
		UpdatedAt:        FlexibleTime{Time: now},
	}

	// Save registration
	err = db.SaveRegistration(ctx, registration)
	if err != nil {
		log.Printf("Failed to save registration: %v", err)
		response := Response{Success: false, Error: "報名失敗，請稍後再試"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 報名時不更新團局人數，等待主揪審核通過後才更新
	// 這與 LINE Bot 的邏輯一致

	// Create WaitGroup to ensure async tasks complete
	var wg sync.WaitGroup

	// Create web notification for host (async but waited)
	wg.Add(1)
	go func() {
		defer wg.Done()
		createWebNotification(
			context.Background(), // Use background context to avoid cancellation
			game.HostUserID,
			"registration",
			"新報名通知",
			fmt.Sprintf("%s 報名了您的「%s」團局", user.DisplayName, game.Location.PlaceName),
			req.GameID,
			game.Location.PlaceName,
			userID,
			user.DisplayName,
		)
	}()

	// Send push notification to host (synchronous to ensure it completes)
	if pushService != nil {
		data := map[string]interface{}{
			"url":          "/notifications",
			"gameId":       req.GameID,
			"type":         "registration",
			"fromUserId":   userID,
			"fromUserName": user.DisplayName,
		}
		pushService.SendPushNotificationToUser(
			ctx,
			game.HostUserID,
			"新報名通知",
			fmt.Sprintf("%s 報名了您的「%s」團局", user.DisplayName, game.Location.PlaceName),
			data,
		)
	} else {
		log.Println("Push service not initialized, skipping push notification")
	}

	// Wait for async tasks
	wg.Wait()

	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"registrationID": registration.RegistrationID,
			"message":        "✅ 報名成功！您的報名申請已送出，請等待主揪審核",
		},
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// createWebNotification creates a web notification record in DynamoDB
func createWebNotification(ctx context.Context, userID, notifType, title, message, gameID, gameName, fromUserID, fromUserName string) error {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Printf("Failed to load AWS config: %v", err)
		return err
	}

	client := dynamodb.NewFromConfig(cfg)
	tablePrefix := os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

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

	// Add optional fields
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
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	if err != nil {
		log.Printf("Failed to save notification: %v", err)
		return err
	}

	return nil
}

func main() {
	lambda.Start(Handler)
}
