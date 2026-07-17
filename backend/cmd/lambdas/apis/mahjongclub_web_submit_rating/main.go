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
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

type Request struct {
	LineID     string `json:"lineID"`
	GameID     string `json:"gameId"`
	ToUserID   string `json:"toUserId"`
	IsPositive bool   `json:"isPositive"`
	Comment    string `json:"comment"`
}

type Response struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type Rating struct {
	RatingID   string    `dynamodbav:"ratingId"`
	GameID     string    `dynamodbav:"gameId"`
	FromUserID string    `dynamodbav:"fromUserId"`
	ToUserID   string    `dynamodbav:"toUserId"`
	IsPositive bool      `dynamodbav:"isPositive"`
	Comment    string    `dynamodbav:"comment,omitempty"`
	CreatedAt  int64     `dynamodbav:"createdAt"`
	UpdatedAt  time.Time `dynamodbav:"updatedAt"`
}

type RatingComment struct {
	CommentID       string    `dynamodbav:"commentId"`
	RatingID        string    `dynamodbav:"ratingId"`
	GameID          string    `dynamodbav:"gameId"`
	FromUserID      string    `dynamodbav:"fromUserId"`
	FromDisplayName string    `dynamodbav:"fromDisplayName"`
	ToUserID        string    `dynamodbav:"toUserId"`
	IsPositive      bool      `dynamodbav:"isPositive"`
	Comment         string    `dynamodbav:"comment"`
	CreatedAt       int64     `dynamodbav:"createdAt"`
	UpdatedAt       time.Time `dynamodbav:"updatedAt"`
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

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_submit_rating")

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
		}, nil
	}

	var req Request
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		response := Response{Success: false, Error: "無效的請求格式"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get user ID - support both lineID (encrypted) in body and userId in query parameters
	var userID string
	var err error

	// Try to get userId parameter first (for APP users)
	userID = request.QueryStringParameters["userId"]

	// If userId is not provided, try lineID in body (for LINE Bot users)
	if userID == "" {
		if req.LineID == "" {
			response := Response{Success: false, Error: "缺少用戶 ID (userId 或 lineID)"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}

		// Decrypt LINE ID
		userID, err = decryptLineID(req.LineID)
		if err != nil {
			log.Printf("Failed to decrypt LINE ID: %v", err)
			response := Response{Success: false, Error: "無效的用戶 ID"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}

	// Validate input
	if req.GameID == "" || req.ToUserID == "" {
		response := Response{Success: false, Error: "缺少必要參數"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	if req.Comment == "" || len(req.Comment) < 5 {
		response := Response{Success: false, Error: "評論內容至少需要 5 個字"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Check if already rated
	existingRatings, err := getRatingsByGameAndFromUser(ctx, req.GameID, userID)
	if err != nil {
		log.Printf("Failed to get existing ratings: %v", err)
	}

	for _, rating := range existingRatings {
		if rating.ToUserID == req.ToUserID {
			response := Response{Success: false, Error: "您已經評分過這位玩家了"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}

	// Get user info for display name
	user, err := getUser(ctx, userID)
	if err != nil || user == nil {
		response := Response{Success: false, Error: "找不到用戶資料"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Create rating
	now := time.Now()
	ratingID := uuid.New().String()
	rating := Rating{
		RatingID:   ratingID,
		GameID:     req.GameID,
		FromUserID: userID,
		ToUserID:   req.ToUserID,
		IsPositive: req.IsPositive,
		Comment:    req.Comment,
		CreatedAt:  now.Unix(),
		UpdatedAt:  now,
	}

	// Save rating
	if err := saveRating(ctx, &rating); err != nil {
		log.Printf("Failed to save rating: %v", err)
		response := Response{Success: false, Error: "評分失敗，請稍後再試"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Save rating comment
	comment := RatingComment{
		CommentID:       ratingID,
		RatingID:        ratingID,
		GameID:          req.GameID,
		FromUserID:      userID,
		FromDisplayName: user.DisplayName,
		ToUserID:        req.ToUserID,
		IsPositive:      req.IsPositive,
		Comment:         req.Comment,
		CreatedAt:       now.Unix(),
		UpdatedAt:       now,
	}

	if err := saveRatingComment(ctx, &comment); err != nil {
		log.Printf("Failed to save rating comment: %v", err)
		// Continue anyway - rating is saved
	}

	// Update user stats synchronously to ensure data is updated before returning
	updateUserRatingStats(ctx, req.ToUserID)

	// Check if all players have completed rating and close game if so (can be async)
	go checkAndCloseGameIfAllRated(ctx, req.GameID)

	response := Response{Success: true}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// Database helper functions
func getUser(ctx context.Context, userID string) (*shared.User, error) {
	tableName := tablePrefix + "Users"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		return nil, err
	}

	if result.Item == nil {
		return nil, fmt.Errorf("user not found")
	}

	var user shared.User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
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

func saveRating(ctx context.Context, rating *Rating) error {
	tableName := tablePrefix + "Ratings"
	item, err := attributevalue.MarshalMap(rating)
	if err != nil {
		return err
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})

	return err
}

func saveRatingComment(ctx context.Context, comment *RatingComment) error {
	tableName := tablePrefix + "RatingComments"
	item, err := attributevalue.MarshalMap(comment)
	if err != nil {
		return err
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})

	return err
}

func updateUserRatingStats(ctx context.Context, userID string) {
	// Get all rating comments for this user from RatingComments table
	comments, err := getRatingCommentsForUser(ctx, userID)
	if err != nil {
		log.Printf("Failed to get rating comments for user %s: %v", userID, err)
		return
	}

	if len(comments) == 0 {
		return
	}

	// Calculate positive rating rate from RatingComments
	totalRatings := 0
	positiveRatings := 0
	for _, comment := range comments {
		totalRatings++
		if comment.IsPositive {
			positiveRatings++
		}
	}

	positiveRatingRate := (float64(positiveRatings) / float64(totalRatings)) * 100

	// Update user stats
	user, err := getUser(ctx, userID)
	if err != nil || user == nil {
		log.Printf("Failed to get user %s: %v", userID, err)
		return
	}

	if user.Stats == nil {
		user.Stats = &shared.UserStats{}
	}

	user.Stats.TotalRatings = totalRatings
	user.Stats.PositiveRatings = positiveRatings
	user.Stats.PositiveRatingRate = positiveRatingRate

	if err := saveUser(ctx, user); err != nil {
		log.Printf("Failed to update user stats: %v", err)
	}
}

func getRatingsForUser(ctx context.Context, toUserID string) ([]*Rating, error) {
	tableName := tablePrefix + "Ratings"
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("toUserId-createdAt-index"),
		KeyConditionExpression: aws.String("toUserId = :toUserId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":toUserId": &types.AttributeValueMemberS{Value: toUserID},
		},
		ScanIndexForward: aws.Bool(false),
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

// getRatingCommentsForUser gets all rating comments for a user from RatingComments table
func getRatingCommentsForUser(ctx context.Context, toUserID string) ([]*RatingComment, error) {
	tableName := tablePrefix + "RatingComments"
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

	var comments []*RatingComment
	err = attributevalue.UnmarshalListOfMaps(result.Items, &comments)
	if err != nil {
		return nil, err
	}

	return comments, nil
}

func saveUser(ctx context.Context, user *shared.User) error {
	tableName := tablePrefix + "Users"
	item, err := attributevalue.MarshalMap(user)
	if err != nil {
		return err
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})

	return err
}

// checkAndCloseGameIfAllRated checks if all players have completed rating and closes the game if so
func checkAndCloseGameIfAllRated(ctx context.Context, gameID string) {
	// Get game
	game, err := getGame(ctx, gameID)
	if err != nil || game == nil {
		log.Printf("Failed to get game %s: %v", gameID, err)
		return
	}

	// Only check for full games
	if game.Status != "full" {
		log.Printf("Game %s is not full (status: %s), skipping close check", gameID, game.Status)
		return
	}

	// Get all players in the game (host + joined players)
	allPlayers := []shared.Player{}
	allPlayers = append(allPlayers, shared.Player{
		UserID:      game.HostUserID,
		DisplayName: game.HostDisplayName,
	})
	allPlayers = append(allPlayers, game.JoinedPlayers...)

	log.Printf("Checking if all %d players have completed rating for game %s", len(allPlayers), gameID)

	// Check if each player has rated all other players
	for _, player := range allPlayers {
		// Get players this player needs to rate (all except self)
		var playersToRate []shared.Player
		for _, p := range allPlayers {
			if p.UserID != player.UserID {
				playersToRate = append(playersToRate, p)
			}
		}

		// Get all ratings from this player for this game
		ratings, err := getRatingsByGameAndFromUser(ctx, gameID, player.UserID)
		if err != nil {
			log.Printf("Failed to get ratings for game %s from user %s: %v", gameID, player.UserID, err)
			return
		}

		// Create a map of rated user IDs
		ratedUserIDs := make(map[string]bool)
		for _, rating := range ratings {
			ratedUserIDs[rating.ToUserID] = true
		}

		// Check if this player has rated all other players
		for _, p := range playersToRate {
			if !ratedUserIDs[p.UserID] {
				log.Printf("Player %s has not rated player %s yet, game %s not ready to close", player.UserID, p.UserID, gameID)
				return
			}
		}
	}

	// All players have completed rating, close the game
	log.Printf("All players have completed rating for game %s, closing game", gameID)
	game.Status = "closed"
	if err := saveGame(ctx, game); err != nil {
		log.Printf("Failed to close game %s: %v", gameID, err)
		return
	}

	log.Printf("✅ Game %s has been closed - all players completed rating", gameID)
}

// getGame retrieves a game by ID
func getGame(ctx context.Context, gameID string) (*shared.Game, error) {
	tableName := os.Getenv("GAMES_TABLE")
	if tableName == "" {
		tableName = "MahjongClub_Games"
	}

	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
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

// saveGame saves a game to DynamoDB
func saveGame(ctx context.Context, game *shared.Game) error {
	tableName := os.Getenv("GAMES_TABLE")
	if tableName == "" {
		tableName = "MahjongClub_Games"
	}

	item, err := attributevalue.MarshalMap(game)
	if err != nil {
		return err
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})

	return err
}

func main() {
	lambda.Start(handler)
}
