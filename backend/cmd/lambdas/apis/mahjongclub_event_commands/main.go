package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	dynamoClient *dynamodb.Client
	tablePrefix  = os.Getenv("TABLE_PREFIX")
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)

	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
}

type Response struct {
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// EventCommand model
type EventCommand struct {
	CommandID   string    `dynamodbav:"commandId" json:"commandId"`
	Command     string    `dynamodbav:"command" json:"command"`
	CodeCount   int       `dynamodbav:"codeCount" json:"codeCount"`
	Points      int       `dynamodbav:"points" json:"points"`
	UsedCount   int       `dynamodbav:"usedCount" json:"usedCount"`
	StartTime   time.Time `dynamodbav:"startTime" json:"startTime"`
	EndTime     time.Time `dynamodbav:"endTime" json:"endTime"`
	StartTimeTS int64     `dynamodbav:"startTimeTS" json:"startTimeTS"`
	EndTimeTS   int64     `dynamodbav:"endTimeTS" json:"endTimeTS"`
	IsActive    string    `dynamodbav:"isActive" json:"isActive"` // "true" or "false"
	CreatedBy   string    `dynamodbav:"createdBy" json:"createdBy"`
	CreatedAt   time.Time `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt   time.Time `dynamodbav:"updatedAt" json:"updatedAt"`
}

type EventRedemption struct {
	RedemptionID string    `dynamodbav:"redemptionId" json:"redemptionId"`
	CommandID    string    `dynamodbav:"commandId" json:"commandId"`
	Command      string    `dynamodbav:"command" json:"command"`
	UserID       string    `dynamodbav:"userId" json:"userId"`
	DisplayName  string    `dynamodbav:"displayName" json:"displayName"`
	CodeID       string    `dynamodbav:"codeId" json:"codeId"`
	Points       int       `dynamodbav:"points" json:"points"`
	RedeemedAt   time.Time `dynamodbav:"redeemedAt" json:"redeemedAt"`
	RedeemedTS   int64     `dynamodbav:"redeemedTS" json:"redeemedTS"`
}

type CreateCommandRequest struct {
	Command   string `json:"command"`
	CodeCount int    `json:"codeCount"`
	Points    int    `json:"points"`
	StartTime string `json:"startTime"` // ISO 8601 format
	EndTime   string `json:"endTime"`   // ISO 8601 format
	CreatedBy string `json:"createdBy"`
}

type UpdateCommandRequest struct {
	CommandID string `json:"commandId"`
	IsActive  *bool  `json:"isActive,omitempty"` // Will be converted to "true"/"false" string
	CodeCount *int   `json:"codeCount,omitempty"`
}

func handler(ctx context.Context, request events.LambdaFunctionURLRequest) (Response, error) {
	// Extract path from RequestContext
	path := request.RequestContext.HTTP.Path
	method := request.RequestContext.HTTP.Method

	log.Printf("Received request: %s %s", method, path)

	// Headers (CORS is handled by Lambda Function URL)
	headers := map[string]string{
		"Content-Type": "application/json",
	}

	// Handle OPTIONS request
	if method == "OPTIONS" {
		return Response{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// AUTH
	authHeader := request.Headers["authorization"]
	if authHeader == "" {
		authHeader = request.Headers["Authorization"]
	}
	if authHeader == "" {
		return errorResponseLocal(headers, http.StatusUnauthorized, "Missing authorization header"), nil
	}

	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return errorResponseLocal(headers, http.StatusInternalServerError, "Server auth misconfigured"), nil
	}
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(jwtSecret), nil
	})

	if err != nil || !token.Valid {
		return errorResponseLocal(headers, http.StatusUnauthorized, "Invalid token"), nil
	}

	claims := token.Claims.(jwt.MapClaims)
	role := claims["role"].(string)

	if role != "super_admin" {
		return errorResponseLocal(headers, http.StatusForbidden, "Forbidden"), nil
	}

	var response Response
	// err is already declared above via token, err := ...

	switch path {
	case "/event-commands":
		if method == "GET" {
			response, err = handleListCommands(ctx, headers)
		} else if method == "POST" {
			response, err = handleCreateCommand(ctx, request.Body, headers)
		}
	case "/event-commands/update":
		if method == "POST" {
			response, err = handleUpdateCommand(ctx, request.Body, headers)
		}
	case "/event-commands/delete":
		if method == "POST" {
			response, err = handleDeleteCommand(ctx, request.Body, headers)
		}
	case "/event-commands/redemptions":
		if method == "GET" {
			commandID := request.QueryStringParameters["commandId"]
			response, err = handleGetRedemptions(ctx, commandID, headers)
		}
	case "/event-commands/stats":
		if method == "GET" {
			response, err = handleGetStats(ctx, headers)
		}
	default:
		response = errorResponse(headers, http.StatusNotFound, "Endpoint not found")
	}

	if err != nil {
		log.Printf("Error handling request: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, err.Error()), nil
	}

	return response, nil
}

func handleCreateCommand(ctx context.Context, body string, headers map[string]string) (Response, error) {
	var req CreateCommandRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid request body"), nil
	}

	// Validate input
	if req.Command == "" || req.CodeCount <= 0 || req.Points <= 0 {
		return errorResponse(headers, http.StatusBadRequest, "Invalid parameters"), nil
	}

	// Parse times
	startTime, err := time.Parse(time.RFC3339, req.StartTime)
	if err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid start time format"), nil
	}

	endTime, err := time.Parse(time.RFC3339, req.EndTime)
	if err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid end time format"), nil
	}

	if endTime.Before(startTime) {
		return errorResponse(headers, http.StatusBadRequest, "End time must be after start time"), nil
	}

	// Check if command already exists
	exists, err := checkCommandExists(ctx, req.Command)
	if err != nil {
		log.Printf("Error checking command exists: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, fmt.Sprintf("Failed to check command: %v", err)), nil
	}
	if exists {
		return errorResponse(headers, http.StatusBadRequest, "Command already exists"), nil
	}

	// Create command
	now := time.Now()
	cmd := &EventCommand{
		CommandID:   uuid.New().String(),
		Command:     req.Command,
		CodeCount:   req.CodeCount,
		Points:      req.Points,
		UsedCount:   0,
		StartTime:   startTime,
		EndTime:     endTime,
		StartTimeTS: startTime.Unix(),
		EndTimeTS:   endTime.Unix(),
		IsActive:    "true",
		CreatedBy:   req.CreatedBy,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := saveEventCommand(ctx, cmd); err != nil {
		log.Printf("Error saving event command: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, fmt.Sprintf("Failed to create command: %v", err)), nil
	}

	return successResponse(headers, cmd), nil
}

func handleListCommands(ctx context.Context, headers map[string]string) (Response, error) {
	commands, err := getAllEventCommands(ctx)
	if err != nil {
		return errorResponse(headers, http.StatusInternalServerError, "Failed to get commands"), nil
	}

	return successResponse(headers, commands), nil
}

func handleUpdateCommand(ctx context.Context, body string, headers map[string]string) (Response, error) {
	var req UpdateCommandRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid request body"), nil
	}

	cmd, err := getEventCommand(ctx, req.CommandID)
	if err != nil {
		return errorResponse(headers, http.StatusNotFound, "Command not found"), nil
	}

	// Update fields
	if req.IsActive != nil {
		if *req.IsActive {
			cmd.IsActive = "true"
		} else {
			cmd.IsActive = "false"
		}
	}
	if req.CodeCount != nil {
		cmd.CodeCount = *req.CodeCount
	}
	cmd.UpdatedAt = time.Now()

	if err := saveEventCommand(ctx, cmd); err != nil {
		return errorResponse(headers, http.StatusInternalServerError, "Failed to update command"), nil
	}

	return successResponse(headers, cmd), nil
}

func handleDeleteCommand(ctx context.Context, body string, headers map[string]string) (Response, error) {
	var req map[string]string
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid request body"), nil
	}

	commandID := req["commandId"]
	if commandID == "" {
		return errorResponse(headers, http.StatusBadRequest, "commandId is required"), nil
	}

	if err := deleteEventCommand(ctx, commandID); err != nil {
		return errorResponse(headers, http.StatusInternalServerError, "Failed to delete command"), nil
	}

	return successResponse(headers, map[string]string{"message": "Command deleted successfully"}), nil
}

func handleGetRedemptions(ctx context.Context, commandID string, headers map[string]string) (Response, error) {
	if commandID == "" {
		return errorResponse(headers, http.StatusBadRequest, "commandId is required"), nil
	}

	redemptions, err := getEventRedemptionsByCommand(ctx, commandID)
	if err != nil {
		return errorResponse(headers, http.StatusInternalServerError, "Failed to get redemptions"), nil
	}

	return successResponse(headers, redemptions), nil
}

func handleGetStats(ctx context.Context, headers map[string]string) (Response, error) {
	commands, err := getAllEventCommands(ctx)
	if err != nil {
		return errorResponse(headers, http.StatusInternalServerError, "Failed to get commands"), nil
	}

	totalCommands := len(commands)
	activeCommands := 0
	totalCodes := 0
	usedCodes := 0

	for _, cmd := range commands {
		if cmd.IsActive == "true" {
			activeCommands++
		}
		totalCodes += cmd.CodeCount
		usedCodes += cmd.UsedCount
	}

	stats := map[string]interface{}{
		"totalCommands":  totalCommands,
		"activeCommands": activeCommands,
		"totalCodes":     totalCodes,
		"usedCodes":      usedCodes,
		"unusedCodes":    totalCodes - usedCodes,
	}

	return successResponse(headers, stats), nil
}

func successResponse(headers map[string]string, data interface{}) Response {
	apiResp := APIResponse{
		Success: true,
		Data:    data,
	}
	body, _ := json.Marshal(apiResp)
	return Response{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}
}

func errorResponseLocal(headers map[string]string, statusCode int, message string) Response {
	apiResp := APIResponse{
		Success: false,
		Error:   message,
	}
	body, _ := json.Marshal(apiResp)
	return Response{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(body),
	}
}

func errorResponse(headers map[string]string, statusCode int, message string) Response {
	return errorResponseLocal(headers, statusCode, message)
}

func main() {
	lambda.Start(handler)
}
