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
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
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

// Use shared models
type Game = shared.Game
type Location = shared.Location
type GameInfo = shared.GameInfo
type Player = shared.Player
type ContactInfo = shared.ContactInfo
type FlexibleTime = shared.FlexibleTime
type Registration = shared.Registration

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

// GetGamesByHostID retrieves games hosted by a user
func (d *Database) GetGamesByHostID(ctx context.Context, hostID string) ([]*Game, error) {
	tableName := d.cfg.GetTableName("Games")

	result, err := d.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        &tableName,
		FilterExpression: &[]string{"hostUserId = :hostID"}[0],
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":hostID": &types.AttributeValueMemberS{Value: hostID},
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to scan games: %w", err)
	}

	var games []*Game
	err = attributevalue.UnmarshalListOfMaps(result.Items, &games)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal games: %w", err)
	}

	// Handle pagination
	lastKey := result.LastEvaluatedKey
	for lastKey != nil {
		nextResult, err := d.client.Scan(ctx, &dynamodb.ScanInput{
			TableName:         &tableName,
			FilterExpression:  &[]string{"hostUserId = :hostID"}[0],
			ExclusiveStartKey: lastKey,
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":hostID": &types.AttributeValueMemberS{Value: hostID},
			},
		})
		if err != nil {
			break
		}
		var nextGames []*Game
		err = attributevalue.UnmarshalListOfMaps(nextResult.Items, &nextGames)
		if err == nil {
			games = append(games, nextGames...)
		}
		lastKey = nextResult.LastEvaluatedKey
	}

	return games, nil
}

// GetRegistrationsByUserID retrieves registrations for a user
func (d *Database) GetRegistrationsByUserID(ctx context.Context, userID string) ([]*Registration, error) {
	tableName := d.cfg.GetTableName("Registrations")

	result, err := d.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        &tableName,
		FilterExpression: &[]string{"userId = :userID"}[0],
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userID": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to scan registrations: %w", err)
	}

	var registrations []*Registration
	err = attributevalue.UnmarshalListOfMaps(result.Items, &registrations)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal registrations: %w", err)
	}

	// Handle pagination
	lastKey := result.LastEvaluatedKey
	for lastKey != nil {
		nextResult, err := d.client.Scan(ctx, &dynamodb.ScanInput{
			TableName:         &tableName,
			FilterExpression:  &[]string{"userId = :userID"}[0],
			ExclusiveStartKey: lastKey,
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":userID": &types.AttributeValueMemberS{Value: userID},
			},
		})
		if err != nil {
			break
		}
		var nextRegs []*Registration
		err = attributevalue.UnmarshalListOfMaps(nextResult.Items, &nextRegs)
		if err == nil {
			registrations = append(registrations, nextRegs...)
		}
		lastKey = nextResult.LastEvaluatedKey
	}

	return registrations, nil
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

// GetUsersByIDs retrieves multiple users by their IDs
func (d *Database) GetUsersByIDs(ctx context.Context, userIDs []string) (map[string]*shared.User, error) {
	if len(userIDs) == 0 {
		return make(map[string]*shared.User), nil
	}

	tableName := d.cfg.GetTableName("Users")
	keys := make([]map[string]types.AttributeValue, 0, len(userIDs))

	// Remove duplicates
	uniqueIDs := make(map[string]bool)
	for _, id := range userIDs {
		if id != "" && !uniqueIDs[id] {
			uniqueIDs[id] = true
			keys = append(keys, map[string]types.AttributeValue{
				"userId": &types.AttributeValueMemberS{Value: id},
			})
		}
	}

	if len(keys) == 0 {
		return make(map[string]*shared.User), nil
	}

	usersMap := make(map[string]*shared.User)
	for i := 0; i < len(keys); i += 100 {
		end := i + 100
		if end > len(keys) {
			end = len(keys)
		}

		input := &dynamodb.BatchGetItemInput{
			RequestItems: map[string]types.KeysAndAttributes{
				tableName: {
					Keys: keys[i:end],
				},
			},
		}

		result, err := d.client.BatchGetItem(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("failed to batch get users: %w", err)
		}

		for _, item := range result.Responses[tableName] {
			var user shared.User
			err = attributevalue.UnmarshalMap(item, &user)
			if err == nil {
				usersMap[user.UserID] = &user
			}
		}
	}

	return usersMap, nil
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	if db != nil && db.client != nil {
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "games", "my_games")
	}

	// 記錄 Token 使用統計
	shared.RecordTokenUsageFromHeader(request, "web_my_games")

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

	// Get hosted games
	hostedGames, err := db.GetGamesByHostID(ctx, userID)
	if err != nil {
		log.Printf("Failed to get hosted games: %v", err)
		hostedGames = []*Game{}
	}

	// Get joined games
	registrations, err := db.GetRegistrationsByUserID(ctx, userID)
	if err != nil {
		log.Printf("Failed to get registrations: %v", err)
		registrations = []*Registration{}
	}

	// Create a map of hosted game IDs for quick lookup
	hostedGameIDs := make(map[string]bool)
	for _, game := range hostedGames {
		hostedGameIDs[game.GameID] = true
	}

	var joinedGames []*Game
	var pendingGames []*Game
	var rejectedGames []*Game
	for _, reg := range registrations {
		// Skip if this game is already in hosted games (user is the host)
		if hostedGameIDs[reg.GameID] {
			log.Printf("Skipping game %s - user is the host", reg.GameID)
			continue
		}

		game, err := db.GetGame(ctx, reg.GameID)
		if err != nil || game == nil {
			continue
		}

		// Skip cancelled games
		if game.Status == "cancelled" {
			log.Printf("Skipping game %s - game is cancelled", reg.GameID)
			continue
		}

		// Include accepted registrations in joinedGames
		if reg.Status == "accepted" {
			joinedGames = append(joinedGames, game)
		} else if reg.Status == "pending" {
			// Include pending registrations in pendingGames
			pendingGames = append(pendingGames, game)
		} else if reg.Status == "rejected" {
			// Include rejected registrations in rejectedGames
			rejectedGames = append(rejectedGames, game)
		}
		// Skip cancelled registrations
	}

	// Inject host pictures for all game lists
	allGames := append([]*Game{}, hostedGames...)
	allGames = append(allGames, joinedGames...)
	allGames = append(allGames, pendingGames...)
	allGames = append(allGames, rejectedGames...)

	hostIDs := make([]string, 0, len(allGames))
	for _, g := range allGames {
		hostIDs = append(hostIDs, g.HostUserID)
	}

	usersMap, err := db.GetUsersByIDs(ctx, hostIDs)
	if err == nil {
		for _, g := range allGames {
			if u, ok := usersMap[g.HostUserID]; ok {
				g.HostPictureURL = u.PictureURL
			}
		}
	}

	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"hostedGames":   hostedGames,
			"joinedGames":   joinedGames,
			"pendingGames":  pendingGames,
			"rejectedGames": rejectedGames,
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
