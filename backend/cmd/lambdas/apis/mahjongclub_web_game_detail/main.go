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
	"strings"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Request struct {
	LineID string `json:"lineID"`
	GameID string `json:"gameId"`
}

type RegistrationWithStats struct {
	shared.Registration
	UserStats *shared.UserStats `json:"userStats,omitempty"`
}

type ResponseData struct {
	Game          *shared.Game            `json:"game"`
	Registrations []RegistrationWithStats `json:"registrations,omitempty"`
	HostStats     *shared.UserStats       `json:"hostStats,omitempty"`
	HostGender    string                  `json:"hostGender,omitempty"`
	HostAgeRange  string                  `json:"hostAgeRange,omitempty"`
}

type Response struct {
	Success bool          `json:"success"`
	Data    *ResponseData `json:"data,omitempty"`
	Error   string        `json:"error,omitempty"`
}

var (
	dynamoClient *dynamodb.Client
	tablePrefix  string
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
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	shared.RecordTraffic(ctx, dynamoClient, tablePrefix, "games", "game_detail")

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

	// Parse request body
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

	if req.GameID == "" {
		response := Response{Success: false, Error: "缺少團局 ID"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	gameID := req.GameID

	// Get game
	game, err := getGame(ctx, gameID)
	if err != nil {
		log.Printf("Failed to get game: %v", err)
		response := Response{Success: false, Error: "找不到團局"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get registrations for this game
	registrations, err := getRegistrations(ctx, gameID)
	if err != nil {
		log.Printf("Failed to get registrations: %v", err)
		// Don't fail the request, just return empty registrations
		registrations = []shared.Registration{}
	}

	// Enrich registrations with user stats
	registrationsWithStats := make([]RegistrationWithStats, 0, len(registrations))
	for _, reg := range registrations {
		regWithStats := RegistrationWithStats{
			Registration: reg,
		}

		// Get user rating stats from Ratings table
		stats, err := getUserRatingStats(ctx, reg.UserID)
		if err == nil && stats != nil {
			regWithStats.UserStats = stats
		}

		registrationsWithStats = append(registrationsWithStats, regWithStats)
	}

	// Determine requester userId and linked LineID
	requesterUserID := ""
	requesterLineID := ""
	if req.LineID != "" {
		if strings.HasPrefix(req.LineID, "APP_") {
			requesterUserID = req.LineID
			// Fetch user to see if they have a linked LINE ID
			u, err := getUser(ctx, requesterUserID)
			if err == nil && u != nil {
				if u.EncryptedLineID != "" {
					decrypted, err := decryptLineID(u.EncryptedLineID)
					if err == nil {
						requesterLineID = decrypted
					}
				} else if u.LineID != "" {
					requesterLineID = u.LineID
				}
			}
		} else {
			decrypted, err := decryptLineID(req.LineID)
			if err == nil {
				requesterUserID = decrypted
				requesterLineID = decrypted
			} else {
				// If decryption fails, maybe it's already a decrypted ID or a raw ID
				requesterUserID = req.LineID
				requesterLineID = req.LineID
			}
		}
	}

	// Fetch host's current profile to get latest LineID and other info
	hostUser, err := getUser(ctx, game.HostUserID)
	hostLineID := ""
	var hostGender, hostAgeRange string
	var hostStats *shared.UserStats

	if err == nil && hostUser != nil {
		game.ContactInfo.LineID = hostUser.LineID
		hostLineID = hostUser.LineID
		hostGender = hostUser.Gender
		hostAgeRange = hostUser.AgeRange

		// Get host stats
		hostStats, _ = getUserRatingStats(ctx, game.HostUserID)
	} else {
		// Fallback to what's in the game record
		hostLineID = game.ContactInfo.LineID
	}

	// Fetch each joined player's current profile to get latest LineID
	for i := range game.JoinedPlayers {
		playerUser, err := getUser(ctx, game.JoinedPlayers[i].UserID)
		if err == nil && playerUser != nil {
			game.JoinedPlayers[i].LineID = playerUser.LineID
		}
	}

	// Check if requester is authorized to see LINE IDs
	isAuthorized := false
	if requesterUserID != "" {
		// Check against host
		if requesterUserID == game.HostUserID || (requesterLineID != "" && hostLineID != "" && requesterLineID == hostLineID) {
			isAuthorized = true
		} else {
			// Check against joined players
			for _, p := range game.JoinedPlayers {
				if p.UserID == requesterUserID || (requesterLineID != "" && p.LineID != "" && requesterLineID == p.LineID) {
					isAuthorized = true
					break
				}
			}
		}
	}

	// If not authorized, hide LINE IDs
	if !isAuthorized {
		game.ContactInfo.LineID = ""
		for i := range game.JoinedPlayers {
			game.JoinedPlayers[i].LineID = ""
		}
	}

	// Collect all user IDs to fetch pictures
	userIDs := []string{game.HostUserID}
	for _, p := range game.JoinedPlayers {
		userIDs = append(userIDs, p.UserID)
	}
	for _, r := range registrationsWithStats {
		userIDs = append(userIDs, r.UserID)
	}

	usersMap, err := getUsersMap(ctx, userIDs)
	if err == nil {
		// Inject host picture
		if u, ok := usersMap[game.HostUserID]; ok {
			game.HostPictureURL = u.PictureURL
		}
		// Inject joined players pictures
		for i := range game.JoinedPlayers {
			if u, ok := usersMap[game.JoinedPlayers[i].UserID]; ok {
				game.JoinedPlayers[i].PictureURL = u.PictureURL
			}
		}
		// Inject registrations pictures
		for i := range registrationsWithStats {
			if u, ok := usersMap[registrationsWithStats[i].UserID]; ok {
				registrationsWithStats[i].PictureURL = u.PictureURL
			}
		}
	}

	response := Response{
		Success: true,
		Data: &ResponseData{
			Game:          game,
			Registrations: registrationsWithStats,
			HostStats:     hostStats,
			HostGender:    hostGender,
			HostAgeRange:  hostAgeRange,
		},
	}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func getGame(ctx context.Context, gameID string) (*shared.Game, error) {
	tableName := tablePrefix + "Games"
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
	if err != nil {
		return nil, err
	}

	return &game, nil
}

func getRegistrations(ctx context.Context, gameID string) ([]shared.Registration, error) {
	tableName := tablePrefix + "Registrations"

	// Query using GSI gameId-createdAt-index
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("gameId-createdAt-index"),
		KeyConditionExpression: aws.String("gameId = :gameId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":gameId": &types.AttributeValueMemberS{Value: gameID},
		},
	})

	if err != nil {
		log.Printf("Query registrations error: %v", err)
		return nil, err
	}

	var registrations []shared.Registration
	err = attributevalue.UnmarshalListOfMaps(result.Items, &registrations)
	if err != nil {
		log.Printf("Unmarshal registrations error: %v", err)
		return nil, err
	}

	return registrations, nil
}

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
		return nil, nil
	}

	var user shared.User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

func getUsersMap(ctx context.Context, userIDs []string) (map[string]*shared.User, error) {
	if len(userIDs) == 0 {
		return make(map[string]*shared.User), nil
	}

	tableName := tablePrefix + "Users"
	keys := make([]map[string]types.AttributeValue, 0, len(userIDs))
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

		result, err := dynamoClient.BatchGetItem(ctx, input)
		if err != nil {
			return nil, err
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

// getUserRatingStats calculates user rating statistics from the RatingComments table
func getUserRatingStats(ctx context.Context, userID string) (*shared.UserStats, error) {
	tableName := tablePrefix + "RatingComments"

	// Query rating comments using GSI toUserId-createdAt-index
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
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

	// Get user's basic stats (gamesHosted, gamesJoined)
	user, err := getUser(ctx, userID)
	gamesHosted := 0
	gamesJoined := 0
	if err == nil && user != nil && user.Stats != nil {
		gamesHosted = user.Stats.GamesHosted
		gamesJoined = user.Stats.GamesJoined
	}

	return &shared.UserStats{
		GamesHosted:        gamesHosted,
		GamesJoined:        gamesJoined,
		TotalRatings:       totalRatings,
		PositiveRatings:    positiveRatings,
		PositiveRatingRate: positiveRatingRate,
	}, nil
}

func decryptLineID(encryptedData string) (string, error) {
	encryptionKey := os.Getenv("ENCRYPTION_KEY")
	if encryptionKey == "" {
		return "", fmt.Errorf("encryption key not configured")
	}

	combined, err := base64.URLEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	key, err := base64.StdEncoding.DecodeString(encryptionKey)
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

func main() {
	lambda.Start(handler)
}
