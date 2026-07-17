package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Type aliases for shared models
type Game = shared.Game
type Location = shared.Location
type GameInfo = shared.GameInfo
type Player = shared.Player
type ContactInfo = shared.ContactInfo
type FlexibleTime = shared.FlexibleTime

// Config holds the configuration
type Config struct {
	AWSRegion   string
	TablePrefix string
}

// Database handles DynamoDB operations
type Database struct {
	client *dynamodb.Client
	cfg    *Config
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
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
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

// GetGamesByStatus retrieves games by status using GSI
// GetGamesByStatus retrieves games by status using GSI
func (d *Database) GetGamesByStatus(ctx context.Context, status string) ([]*Game, error) {
	tableName := d.cfg.GetTableName("Games")
	var games []*Game
	var lastEvaluatedKey map[string]types.AttributeValue

	for {
		input := &dynamodb.QueryInput{
			TableName:              aws.String(tableName),
			IndexName:              aws.String("status-createdAt-index"),
			KeyConditionExpression: aws.String("#status = :status"),
			ExpressionAttributeNames: map[string]string{
				"#status": "status",
			},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":status": &types.AttributeValueMemberS{Value: status},
			},
			ScanIndexForward:  aws.Bool(false), // Sort by createdAt descending
			ExclusiveStartKey: lastEvaluatedKey,
		}

		result, err := d.client.Query(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("failed to query games: %w", err)
		}

		var pageItems []*Game
		err = attributevalue.UnmarshalListOfMaps(result.Items, &pageItems)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal games: %w", err)
		}
		games = append(games, pageItems...)

		if result.LastEvaluatedKey == nil {
			break
		}
		lastEvaluatedKey = result.LastEvaluatedKey
	}

	return games, nil
}

// UpdateGameStatus updates the status of a game
func (d *Database) UpdateGameStatus(ctx context.Context, gameID string, status string) error {
	tableName := d.cfg.GetTableName("Games")

	_, err := d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"gameId": &types.AttributeValueMemberS{Value: gameID},
		},
		UpdateExpression: aws.String("SET #status = :status, updatedAt = :updatedAt"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":status":    &types.AttributeValueMemberS{Value: status},
			":updatedAt": &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to update game status: %w", err)
	}
	return nil
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

	// DynamoDB BatchGetItem has a limit of 100 items
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
	shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "games", "search_games")

	// 記錄 Token 使用統計 (此 API 為公開，但仍追蹤有多少使用者帶 Token)
	shared.RecordTokenUsageFromHeader(request, "web_search_games")

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

	// Get search parameters
	searchType := request.QueryStringParameters["type"]
	if searchType == "" {
		searchType = "all"
	}

	// Get games by status (recruiting)
	games, err := db.GetGamesByStatus(ctx, shared.GameStatusRecruiting)
	if err != nil {
		log.Printf("Failed to get games: %v", err)
		response := Response{
			Success: false,
			Error:   "Failed to retrieve games",
		}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Filter and update expired games
	var validGames []*Game
	now := time.Now()
	for _, game := range games {
		if !game.GameInfo.StartTime.Time.IsZero() && game.GameInfo.StartTime.Time.Before(now) {
			// Expired
			log.Printf("Game %s expired (Start Time: %s). Updating status to expired.", game.GameID, game.GameInfo.StartTime.Time)
			err := db.UpdateGameStatus(ctx, game.GameID, shared.GameStatusExpired)
			if err != nil {
				log.Printf("Failed to update game %s status: %v", game.GameID, err)
			}
		} else if game.GameInfo.StartTime.Time.After(now) {
			validGames = append(validGames, game)
		}
	}

	// Filter by location if provided
	if searchType == "nearby" {
		latStr := request.QueryStringParameters["latitude"]
		lonStr := request.QueryStringParameters["longitude"]
		radiusStr := request.QueryStringParameters["radius"]

		if latStr != "" && lonStr != "" {
			lat, _ := strconv.ParseFloat(latStr, 64)
			lon, _ := strconv.ParseFloat(lonStr, 64)
			radius, _ := strconv.ParseFloat(radiusStr, 64)
			if radius == 0 {
				radius = 5 // Default 5km
			}

			// Filter games within radius
			var filteredGames []*Game
			for _, game := range validGames {
				distance := calculateDistance(lat, lon, game.Location.Latitude, game.Location.Longitude)
				if distance <= radius {
					filteredGames = append(filteredGames, game)
				}
			}
			validGames = filteredGames
		}
	}

	games = validGames

	// Inject host pictures
	hostIDs := make([]string, 0, len(games))
	for _, g := range games {
		hostIDs = append(hostIDs, g.HostUserID)
	}
	usersMap, err := db.GetUsersByIDs(ctx, hostIDs)
	if err == nil {
		for _, g := range games {
			if u, ok := usersMap[g.HostUserID]; ok {
				g.HostPictureURL = u.PictureURL
			}
		}
	}

	// Return games
	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"games": games,
			"count": len(games),
		},
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// calculateDistance calculates distance between two coordinates using Haversine formula
func calculateDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKm = 6371.0

	// Convert to radians
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	// Haversine formula
	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusKm * c
}

func main() {
	lambda.Start(Handler)
}
