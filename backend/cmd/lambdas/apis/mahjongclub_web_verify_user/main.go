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

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

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

// UserStats represents user statistics
type UserStats struct {
	GamesHosted        int     `dynamodbav:"gamesHosted" json:"gamesHosted"`
	GamesJoined        int     `dynamodbav:"gamesJoined" json:"gamesJoined"`
	TotalRatings       int     `dynamodbav:"totalRatings" json:"totalRatings"`
	PositiveRatings    int     `dynamodbav:"positiveRatings" json:"positiveRatings"`
	PositiveRatingRate float64 `dynamodbav:"positiveRatingRate" json:"positiveRatingRate"`
}

// UserPreferences represents user notification preferences
type UserPreferences struct {
	NotifyNewGames    bool `dynamodbav:"notifyNewGames" json:"notifyNewGames"`
	NotifyGameUpdates bool `dynamodbav:"notifyGameUpdates" json:"notifyGameUpdates"`
}

// User represents a user in the system
type User struct {
	UserID            string          `dynamodbav:"userId" json:"userId"`
	DisplayName       string          `dynamodbav:"displayName" json:"displayName"`
	Gender            string          `dynamodbav:"gender,omitempty" json:"gender,omitempty"`
	AgeRange          string          `dynamodbav:"ageRange,omitempty" json:"ageRange,omitempty"`
	MahjongExperience string          `dynamodbav:"mahjongExperience,omitempty" json:"mahjongExperience,omitempty"`
	LineID            string          `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`
	Points            int             `dynamodbav:"points" json:"points"`
	Rating            float64         `dynamodbav:"rating" json:"rating"`
	Stats             *UserStats      `dynamodbav:"stats,omitempty" json:"stats,omitempty"`
	IsVerified        bool            `dynamodbav:"isVerified" json:"isVerified"`
	Preferences       UserPreferences `dynamodbav:"preferences" json:"preferences"`
	InvitedBy         string          `dynamodbav:"invitedBy,omitempty" json:"invitedBy,omitempty"`
	CreatedAt         string          `dynamodbav:"createdAt" json:"createdAt"`
}

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

	// Decode URL-safe base64
	combined, err := base64.URLEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	// Decode encryption key
	key, err := base64.StdEncoding.DecodeString(d.cfg.EncryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to decode encryption key: %w", err)
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

// GetInviteCount counts how many users this user has invited
func (d *Database) GetInviteCount(ctx context.Context, userID string) (int, error) {
	tableName := d.cfg.GetTableName("Users")
	result, err := d.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("invitedBy-index"),
		KeyConditionExpression: aws.String("invitedBy = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
		},
		Select: types.SelectCount,
	})

	if err != nil {
		return 0, err
	}

	return int(result.Count), nil
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	if db != nil && db.client != nil {
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "core", "verify_user")
	}

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

	// Get user ID - support both lineID (encrypted) and userId (APP_xxx) parameters
	var userID string
	var err error

	// Try to get userId parameter first (for APP users)
	userID = request.QueryStringParameters["userId"]

	// If userId is not provided, try lineID (for LINE Bot users)
	if userID == "" {
		encryptedLineID := request.QueryStringParameters["lineID"]
		if encryptedLineID == "" {
			response := Response{
				Success: false,
				Error:   "Missing userId or lineID parameter",
			}
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
			log.Printf("Failed to decrypt LINE ID: %v", err)
			response := Response{
				Success: false,
				Error:   "Failed to decrypt LINE ID",
			}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}

	// Get user from database
	user, err := db.GetUser(ctx, userID)
	if err != nil {
		log.Printf("Failed to get user: %v", err)
		response := Response{
			Success: false,
			Error:   "Failed to retrieve user",
		}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	if user == nil {
		response := Response{
			Success: false,
			Error:   "User not found",
		}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Return user data
	gamesHosted := 0
	gamesJoined := 0
	if user.Stats != nil {
		gamesHosted = user.Stats.GamesHosted
		gamesJoined = user.Stats.GamesJoined
	}

	// Calculate Invite Stats
	inviteCount, _ := db.GetInviteCount(ctx, userID)
	inviteLimit := 10 // default
	inviterPoints := "100"
	inviteePoints := "50"
	configTable := db.cfg.GetTableName("AdminConfigs")
	
	limitRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteMaxUsage"},
		},
	})
	if err == nil && limitRes.Item != nil {
		if v, ok := limitRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			fmt.Sscanf(v.Value, "%d", &inviteLimit)
		}
	}
	
	// Get points config
	inviterRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviterPoints"},
		},
	})
	if err == nil && inviterRes.Item != nil {
		if v, ok := inviterRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			inviterPoints = v.Value
		}
	}
	
	inviteeRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteePoints"},
		},
	})
	if err == nil && inviteeRes.Item != nil {
		if v, ok := inviteeRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			inviteePoints = v.Value
		}
	}

	response := struct {
		Success bool        `json:"success"`
		Data    interface{} `json:"data,omitempty"`
		Error   string      `json:"error,omitempty"`
		InviterPoints string `json:"inviterPoints"`
		InviteePoints string `json:"inviteePoints"`
	}{
		Success: true,
		Data: map[string]interface{}{
			"userId":            user.UserID,
			"displayName":       user.DisplayName,
			"gender":            user.Gender,
			"ageRange":          user.AgeRange,
			"mahjongExperience": user.MahjongExperience,
			"lineId":            user.LineID,
			"points":            user.Points,
			"rating":            user.Rating,
			"gamesHosted":       gamesHosted,
			"gamesJoined":       gamesJoined,
			"stats":             user.Stats,
			"isVerified":        user.IsVerified,
			"preferences":       user.Preferences,
			"invitedBy":         user.InvitedBy,
			"inviteCount":       inviteCount,
			"inviteLimit":       inviteLimit,
			"createdAt":         user.CreatedAt,
		},
		InviterPoints: inviterPoints,
		InviteePoints: inviteePoints,
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
