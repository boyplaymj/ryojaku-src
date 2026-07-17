package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

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

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
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

	// Route the request
	var response Response
	var err error

	switch request.Path {
	case "/analytics/overview":
		response, err = handleOverview(ctx)
	case "/analytics/users/growth":
		response, err = handleUserGrowth(ctx, request.QueryStringParameters)
	case "/analytics/users/stats":
		response, err = handleUserStats(ctx)
	case "/analytics/games/stats":
		response, err = handleGameStats(ctx, request.QueryStringParameters)
	case "/analytics/games/status":
		response, err = handleGameStatus(ctx)
	case "/analytics/registrations/stats":
		response, err = handleRegistrationStats(ctx, request.QueryStringParameters)
	case "/analytics/ratings/stats":
		response, err = handleRatingStats(ctx)
	case "/analytics/realtime":
		response, err = handleRealtime(ctx)
	default:
		response = Response{
			Success: false,
			Error:   "Endpoint not found",
		}
		err = nil
	}

	if err != nil {
		log.Printf("Error handling request: %v", err)
		response = Response{
			Success: false,
			Error:   err.Error(),
		}
	}

	body, _ := json.Marshal(response)

	statusCode := http.StatusOK
	if !response.Success {
		statusCode = http.StatusInternalServerError
	}

	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// handleOverview returns overview statistics
func handleOverview(ctx context.Context) (Response, error) {
	data := make(map[string]interface{})

	// Get total users
	totalUsers, err := db.getTotalUsers(ctx)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}
	data["totalUsers"] = totalUsers

	// Get total games
	totalGames, err := db.getTotalGames(ctx)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}
	data["totalGames"] = totalGames

	// Get today's new users
	todayNewUsers, err := db.getTodayNewUsers(ctx)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}
	data["todayNewUsers"] = todayNewUsers

	// Get today's new games
	todayNewGames, err := db.getTodayNewGames(ctx)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}
	data["todayNewGames"] = todayNewGames

	// Get recruiting games count
	recruitingGames, err := db.getGamesByStatus(ctx, "recruiting")
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}
	data["recruitingGames"] = len(recruitingGames)

	// Get full games count
	fullGames, err := db.getGamesByStatus(ctx, "full")
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}
	data["fullGames"] = len(fullGames)

	return Response{Success: true, Data: data}, nil
}

// handleUserGrowth returns user growth statistics
func handleUserGrowth(ctx context.Context, params map[string]string) (Response, error) {
	days := 30
	if daysStr, ok := params["days"]; ok {
		if d, err := strconv.Atoi(daysStr); err == nil {
			days = d
		}
	}

	growth, err := db.getUserGrowth(ctx, days)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}

	return Response{Success: true, Data: growth}, nil
}

// handleUserStats returns user statistics
func handleUserStats(ctx context.Context) (Response, error) {
	stats, err := db.getUserStats(ctx)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}

	return Response{Success: true, Data: stats}, nil
}

// handleGameStats returns game statistics
func handleGameStats(ctx context.Context, params map[string]string) (Response, error) {
	days := 30
	if daysStr, ok := params["days"]; ok {
		if d, err := strconv.Atoi(daysStr); err == nil {
			days = d
		}
	}

	stats, err := db.getGameStats(ctx, days)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}

	return Response{Success: true, Data: stats}, nil
}

// handleGameStatus returns game status distribution
func handleGameStatus(ctx context.Context) (Response, error) {
	statusDist, err := db.getGameStatusDistribution(ctx)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}

	return Response{Success: true, Data: statusDist}, nil
}

// handleRegistrationStats returns registration statistics
func handleRegistrationStats(ctx context.Context, params map[string]string) (Response, error) {
	days := 30
	if daysStr, ok := params["days"]; ok {
		if d, err := strconv.Atoi(daysStr); err == nil {
			days = d
		}
	}

	stats, err := db.getRegistrationStats(ctx, days)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}

	return Response{Success: true, Data: stats}, nil
}

// handleRatingStats returns rating statistics
func handleRatingStats(ctx context.Context) (Response, error) {
	stats, err := db.getRatingStats(ctx)
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}

	return Response{Success: true, Data: stats}, nil
}

// handleRealtime returns real-time statistics
func handleRealtime(ctx context.Context) (Response, error) {
	data := make(map[string]interface{})

	// Current recruiting games
	recruitingGames, err := db.getGamesByStatus(ctx, "recruiting")
	if err != nil {
		return Response{Success: false, Error: err.Error()}, err
	}
	data["currentRecruitingGames"] = len(recruitingGames)

	// Today's stats
	todayNewUsers, _ := db.getTodayNewUsers(ctx)
	todayNewGames, _ := db.getTodayNewGames(ctx)
	todayRegistrations, _ := db.getTodayRegistrations(ctx)

	data["todayNewUsers"] = todayNewUsers
	data["todayNewGames"] = todayNewGames
	data["todayRegistrations"] = todayRegistrations

	return Response{Success: true, Data: data}, nil
}

func main() {
	lambda.Start(Handler)
}
