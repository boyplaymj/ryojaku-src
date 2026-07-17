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

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"mahjongclub-backend/cmd/lambdas/shared"
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

// CreateGameRequest represents the request to create a game
type CreateGameRequest struct {
	Type         string   `json:"type"` // "one-time" or "long-term"
	GameType     string   `json:"gameType"`
	PlaceName    string   `json:"placeName"`
	Location     string   `json:"location"`
	Latitude     float64  `json:"latitude"`
	Longitude    float64  `json:"longitude"`
	NeedPlayers  int      `json:"needPlayers"`
	Stakes       string   `json:"stakes"`
	StartTime    string   `json:"startTime"`
	Rules        []string `json:"rules"`
	Features     []string `json:"features"`
	Restrictions []string `json:"restrictions"`
	Images       []string `json:"images"`
}

// Type aliases for shared models
type Game = shared.Game
type User = shared.User
type Location = shared.Location
type GameInfo = shared.GameInfo
type Player = shared.Player
type ContactInfo = shared.ContactInfo
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

// SaveGame saves a game to DynamoDB
func (d *Database) SaveGame(ctx context.Context, game *Game) error {
	item, err := attributevalue.MarshalMap(game)
	if err != nil {
		return fmt.Errorf("failed to marshal game: %w", err)
	}

	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &[]string{d.cfg.GetTableName("Games")}[0],
		Item:      item,
	})

	return err
}

// SaveUser saves a user to DynamoDB
func (d *Database) SaveUser(ctx context.Context, user *User) error {
	item, err := attributevalue.MarshalMap(user)
	if err != nil {
		return fmt.Errorf("failed to marshal user: %w", err)
	}

	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &[]string{d.cfg.GetTableName("Users")}[0],
		Item:      item,
	})

	return err
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_create_game")

	// Record traffic
	if db != nil && db.client != nil {
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "games", "create_game")
	}

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
		log.Printf("Encrypted LINE ID: %s", encryptedLineID)
		if encryptedLineID == "" {
			log.Printf("ERROR: Missing userId or lineID parameter")
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
			log.Printf("ERROR: Failed to decrypt LINE ID: %v", err)
			response := Response{Success: false, Error: "Failed to decrypt LINE ID"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}
	log.Printf("User ID: %s", userID)

	// Get user
	user, err := db.GetUser(ctx, userID)
	if err != nil || user == nil {
		log.Printf("ERROR: User not found for user ID %s: %v", userID, err)
		response := Response{Success: false, Error: "User not found"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}
	log.Printf("User found: %s", user.DisplayName)

	// Parse request body
	log.Printf("Request body: %s", request.Body)
	var req CreateGameRequest
	err = json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		log.Printf("ERROR: Failed to parse request body: %v", err)
		response := Response{Success: false, Error: fmt.Sprintf("Invalid request body: %v", err)}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}
	log.Printf("Parsed request: GameType=%s, PlaceName=%s, NeedPlayers=%d", req.GameType, req.PlaceName, req.NeedPlayers)

	// Check user points before creating game
	const REQUIRED_POINTS = 120
	if user.Points < REQUIRED_POINTS {
		response := Response{
			Success: false,
			Error:   fmt.Sprintf("點數不足。發團需要 %d 點數，您目前有 %d 點數，請先充值", REQUIRED_POINTS, user.Points),
		}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Deduct points
	user.Points -= REQUIRED_POINTS
	user.UpdatedAt = time.Now()

	err = db.SaveUser(ctx, user)
	if err != nil {
		log.Printf("Failed to deduct points: %v", err)
		response := Response{Success: false, Error: "點數扣除失敗，發團失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 1.5 Record Shadow Point Log
	go func() {
		logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		shared.RecordPointChangeShadow(logCtx, db.client, db.cfg.TablePrefix, user.UserID, REQUIRED_POINTS, shared.PointTypeDebit, user.Points+REQUIRED_POINTS, user.Points, "發起團局扣費", "web_create_game", nil)
	}()

	// Create game
	now := time.Now()
	nowUnix := now.Unix()
	gameID := fmt.Sprintf("GAME_%s_%s", now.Format("20060102"), uuid.New().String()[:8])

	// Calculate geohash
	geohash := "default"
	if req.Latitude != 0 && req.Longitude != 0 {
		// TODO: Implement geohash calculation
		geohash = "wsqqq" // Placeholder
	}

	// Parse start time
	startTime, err := time.Parse(time.RFC3339, req.StartTime)
	if err != nil {
		log.Printf("Failed to parse start time: %v", err)
		// Use current time + 1 hour as fallback
		startTime = now.Add(1 * time.Hour)
	}

	game := &Game{
		GameID:          gameID,
		HostUserID:      userID,
		HostDisplayName: user.DisplayName,
		Type:            req.Type,
		Status:          "recruiting",
		Location: Location{
			Latitude:  req.Latitude,
			Longitude: req.Longitude,
			Address:   req.Location,
			PlaceName: req.PlaceName,
		},
		Geohash:        geohash,
		PlayersNeeded:  req.NeedPlayers,
		CurrentPlayers: 1,
		JoinedPlayers: []Player{
			{
				UserID:      userID,
				DisplayName: user.DisplayName,
				PictureURL:  "",
				JoinedAt:    FlexibleTime{Time: now},
			},
		},
		GameInfo: GameInfo{
			Stakes:    req.Stakes,
			TimeText:  startTime.Format("01/02 15:04"), // Format like LINE Bot
			StartTime: FlexibleTime{Time: startTime},
			GameType:  req.GameType,
			Rules:     req.Rules,
		},
		VenueFeatures:     req.Features,
		Images:            req.Images,
		Restrictions:      req.Restrictions,
		ContactInfo:       ContactInfo{LineID: user.LineID}, // Use user's LINE ID from profile
		NotificationQuota: 3,
		CreatedAt:         nowUnix,
		UpdatedAt:         FlexibleTime{Time: now},
		ExpiresAt:         now.Add(30 * 24 * time.Hour).Unix(),
	}

	// Update user stats - increment GamesHosted
	if user.Stats == nil {
		user.Stats = &shared.UserStats{
			GamesHosted: 0,
			GamesJoined: 0,
		}
	}
	user.Stats.GamesHosted++
	user.UpdatedAt = now

	// Save user with updated stats
	err = db.SaveUser(ctx, user)
	if err != nil {
		log.Printf("Failed to update user stats: %v", err)
		// Rollback points and stats
		user.Points += REQUIRED_POINTS
		user.Stats.GamesHosted--
		db.SaveUser(ctx, user)

		// Record Refund Log
		go func() {
			logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			shared.RecordPointChangeShadow(logCtx, db.client, db.cfg.TablePrefix, user.UserID, REQUIRED_POINTS, shared.PointTypeCredit, user.Points-REQUIRED_POINTS, user.Points, "發團失敗點數回填 (Stats Error)", "web_create_game_refund", nil)
		}()

		response := Response{Success: false, Error: "發團失敗，請稍後再試"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Save game
	err = db.SaveGame(ctx, game)
	if err != nil {
		log.Printf("Failed to save game: %v", err)
		// Rollback points and stats
		user.Points += REQUIRED_POINTS
		user.Stats.GamesHosted--
		user.UpdatedAt = now
		db.SaveUser(ctx, user)

		// Record Refund Log
		go func() {
			logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			shared.RecordPointChangeShadow(logCtx, db.client, db.cfg.TablePrefix, user.UserID, REQUIRED_POINTS, shared.PointTypeCredit, user.Points-REQUIRED_POINTS, user.Points, "發團失敗點數回填 (Save Game Error)", "web_create_game_refund", nil)
		}()

		response := Response{Success: false, Error: "發團失敗，請稍後再試"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 🚀 [New] Create Chat Room (Non-blocking for the main flow)
	chatTitle := req.PlaceName
	err = shared.CreateChatRoom(ctx, db.client, db.cfg.TablePrefix, game.GameID, chatTitle, userID, startTime, req.Location)
	if err != nil {
		// Just log error, don't fail the whole request
		log.Printf("Non-critical Error: Failed to create chat room for game %s: %v", game.GameID, err)
	}

	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"gameID":          game.GameID,
			"pointsDeducted":  REQUIRED_POINTS,
			"pointsRemaining": user.Points,
			"message":         fmt.Sprintf("✅ 團局發佈成功！已扣除 %d 點數，剩餘 %d 點數", REQUIRED_POINTS, user.Points),
		},
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
