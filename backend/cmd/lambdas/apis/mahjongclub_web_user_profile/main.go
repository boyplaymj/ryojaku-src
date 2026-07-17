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

// UpdateProfileRequest represents the request to update user profile
type UpdateProfileRequest struct {
	DisplayName       string `json:"displayName"`
	Gender            string `json:"gender"`
	AgeRange          string `json:"ageRange"`
	MahjongExperience string `json:"mahjongExperience"`
	LineID            string `json:"lineId"`
	NotifyNewGames    *bool  `json:"notifyNewGames"` // Use pointer to distinguish between false and not set
	PictureURL        string `json:"pictureUrl"`
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
func (d *Database) GetUser(ctx context.Context, userID string) (*shared.User, error) {
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

	var user shared.User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal user: %w", err)
	}

	return &user, nil
}

// UpdateUserProfile updates specific user profile fields using UpdateItem
func (d *Database) UpdateUserProfile(ctx context.Context, userID string, req UpdateProfileRequest) error {
	tableName := d.cfg.GetTableName("Users")
	now := time.Now()

	// Build update expression dynamically
	updateBuilder := make(map[string]interface{})

	if req.DisplayName != "" {
		updateBuilder["displayName"] = req.DisplayName
	}
	if req.Gender != "" {
		updateBuilder["gender"] = req.Gender
	}
	if req.AgeRange != "" {
		updateBuilder["ageRange"] = req.AgeRange
	}
	if req.MahjongExperience != "" {
		updateBuilder["mahjongExperience"] = req.MahjongExperience
	}
	if req.LineID != "" {
		updateBuilder["lineId"] = req.LineID
	}
	if req.PictureURL != "" {
		updateBuilder["pictureUrl"] = req.PictureURL
	}
	if req.NotifyNewGames != nil {
		updateBuilder["preferences.notifyNewGames"] = *req.NotifyNewGames
	}

	// Always update updatedAt
	updateBuilder["updatedAt"] = now

	// Build the update expression
	updateExpr := "SET "
	exprAttrNames := make(map[string]string)
	exprAttrValues := make(map[string]types.AttributeValue)

	idx := 0
	for key, value := range updateBuilder {
		if idx > 0 {
			updateExpr += ", "
		}

		// Handle nested attributes (e.g., "preferences.notifyNewGames")
		if key == "preferences.notifyNewGames" {
			// Ensure preferences object exists or use surgical update if it does
			// For simplicity and to avoid ValidationException if preferences is missing,
			// we use a surgical update with a placeholder.
			// Note: If preferences doesn't exist, this might still fail.
			// A better way would be to update the whole preferences object if it's small.
			exprAttrNames["#preferences"] = "preferences"
			exprAttrNames["#notifyNewGames"] = "notifyNewGames"
			updateExpr += "#preferences.#notifyNewGames = :val" + fmt.Sprintf("%d", idx)
		} else {
			placeholder := "#" + key
			exprAttrNames[placeholder] = key
			updateExpr += placeholder + " = :val" + fmt.Sprintf("%d", idx)
		}

		av, err := attributevalue.Marshal(value)
		if err != nil {
			return fmt.Errorf("failed to marshal value for %s: %w", key, err)
		}
		exprAttrValues[":val"+fmt.Sprintf("%d", idx)] = av
		idx++
	}

	input := &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression:          aws.String(updateExpr),
		ExpressionAttributeNames:  exprAttrNames,
		ExpressionAttributeValues: exprAttrValues,
	}

	_, err := d.client.UpdateItem(ctx, input)
	return err
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_user_profile")
	// 記錄流量統計
	shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "user", "view_profile")

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

	// Handle GET or POST request with empty body - retrieve user profile
	if request.HTTPMethod == "GET" || (request.HTTPMethod == "POST" && request.Body == "") {
		// Calculate real-time stats
		stats, err := getUserRatingStats(ctx, db.client, db.cfg.TablePrefix, user.UserID)
		if err == nil && stats != nil {
			// Calculate real-time game stats
			gameStats, err := getUserGameStats(ctx, db.client, db.cfg.TablePrefix, user.UserID)
			if err == nil && gameStats != nil {
				stats.GamesHosted = gameStats.GamesHosted
				stats.GamesJoined = gameStats.GamesJoined
			}
			user.Stats = stats
		}

		gamesHosted := 0
		gamesJoined := 0
		if user.Stats != nil {
			gamesHosted = user.Stats.GamesHosted
			gamesJoined = user.Stats.GamesJoined
		}

		response := Response{
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
				"preferences":       user.Preferences,
				"pictureUrl":        user.PictureURL,
			},
		}

		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Handle POST request with body - update user profile
	if request.HTTPMethod == "POST" {
		// Parse request body
		var req UpdateProfileRequest
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

		// Update user profile using UpdateItem (only updates specified fields)
		err = db.UpdateUserProfile(ctx, userID, req)
		if err != nil {
			log.Printf("Failed to update user profile: %v", err)
			response := Response{Success: false, Error: "Failed to update profile"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusInternalServerError,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}

		// Return updated fields
		response := Response{
			Success: true,
			Data: map[string]interface{}{
				"displayName":       req.DisplayName,
				"gender":            req.Gender,
				"ageRange":          req.AgeRange,
				"mahjongExperience": req.MahjongExperience,
				"lineId":            req.LineID,
				"pictureUrl":        req.PictureURL,
			},
		}

		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	response := Response{Success: false, Error: "Method not allowed"}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusMethodNotAllowed,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}

// getUserRatingStats calculates user rating statistics from the RatingComments table
func getUserRatingStats(ctx context.Context, client *dynamodb.Client, tablePrefix, userID string) (*shared.UserStats, error) {
	tableName := tablePrefix + "RatingComments"

	// Query rating comments using GSI toUserId-createdAt-index
	result, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("toUserId-createdAt-index"),
		KeyConditionExpression: aws.String("toUserId = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		log.Printf("Query rating comments error for user %s: %v", userID, err)
		return nil, err
	}

	// Calculate statistics
	totalRatings := len(result.Items)
	positiveRatings := 0

	for _, item := range result.Items {
		if isPositiveAttr, ok := item["isPositive"]; ok {
			if boolVal, ok := isPositiveAttr.(*types.AttributeValueMemberBOOL); ok {
				if boolVal.Value {
					positiveRatings++
				}
			}
		}
	}

	positiveRatingRate := 0.0
	if totalRatings > 0 {
		positiveRatingRate = float64(positiveRatings) / float64(totalRatings) * 100
	}

	return &shared.UserStats{
		TotalRatings:       totalRatings,
		PositiveRatings:    positiveRatings,
		PositiveRatingRate: positiveRatingRate,
	}, nil
}

// getUserGameStats calculates real-time game statistics (hosted and joined)
func getUserGameStats(ctx context.Context, client *dynamodb.Client, tablePrefix, userID string) (*shared.UserStats, error) {
	// 1. Count hosted games
	gamesTableName := tablePrefix + "Games"
	hostedResult, err := client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(gamesTableName),
		FilterExpression: aws.String("hostUserId = :userID"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userID": &types.AttributeValueMemberS{Value: userID},
		},
	})

	gamesHosted := 0
	if err == nil && hostedResult != nil {
		gamesHosted = len(hostedResult.Items)
		// Handle pagination
		lastKey := hostedResult.LastEvaluatedKey
		for lastKey != nil {
			nextResult, err := client.Scan(ctx, &dynamodb.ScanInput{
				TableName:         aws.String(gamesTableName),
				FilterExpression:  aws.String("hostUserId = :userID"),
				ExclusiveStartKey: lastKey,
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":userID": &types.AttributeValueMemberS{Value: userID},
				},
			})
			if err != nil {
				break
			}
			gamesHosted += len(nextResult.Items)
			lastKey = nextResult.LastEvaluatedKey
		}
	}

	// 2. Count joined games (accepted and game not cancelled)
	regsTableName := tablePrefix + "Registrations"
	regsResult, err := client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(regsTableName),
		FilterExpression: aws.String("userId = :userID AND #status = :accepted"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userID":   &types.AttributeValueMemberS{Value: userID},
			":accepted": &types.AttributeValueMemberS{Value: "accepted"},
		},
	})

	gamesJoined := 0
	if err == nil && regsResult != nil {
		allRegItems := regsResult.Items
		lastKey := regsResult.LastEvaluatedKey
		for lastKey != nil {
			nextResult, err := client.Scan(ctx, &dynamodb.ScanInput{
				TableName:         aws.String(regsTableName),
				FilterExpression:  aws.String("userId = :userID AND #status = :accepted"),
				ExclusiveStartKey: lastKey,
				ExpressionAttributeNames: map[string]string{
					"#status": "status",
				},
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":userID":   &types.AttributeValueMemberS{Value: userID},
					":accepted": &types.AttributeValueMemberS{Value: "accepted"},
				},
			})
			if err != nil {
				break
			}
			allRegItems = append(allRegItems, nextResult.Items...)
			lastKey = nextResult.LastEvaluatedKey
		}

		for _, item := range allRegItems {
			var reg shared.Registration
			if err := attributevalue.UnmarshalMap(item, &reg); err != nil {
				continue
			}

			// Get game to check status
			gameResult, err := client.GetItem(ctx, &dynamodb.GetItemInput{
				TableName: aws.String(gamesTableName),
				Key: map[string]types.AttributeValue{
					"gameId": &types.AttributeValueMemberS{Value: reg.GameID},
				},
			})

			if err == nil && gameResult.Item != nil {
				var game shared.Game
				if err := attributevalue.UnmarshalMap(gameResult.Item, &game); err == nil {
					if game.Status != "cancelled" && game.HostUserID != userID {
						gamesJoined++
					}
				}
			}
		}
	}

	return &shared.UserStats{
		GamesHosted: gamesHosted,
		GamesJoined: gamesJoined,
	}, nil
}
