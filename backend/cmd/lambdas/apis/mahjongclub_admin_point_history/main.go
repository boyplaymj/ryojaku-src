package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"

	"mahjongclub-backend/cmd/lambdas/shared"
)

var (
	dynamoClient *dynamodb.Client
	tablePrefix  string
	jwtSecret    []byte
)

func init() {
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
	jwtSecret = []byte(os.Getenv("JWT_SECRET"))

	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers, Body: ""}, nil
	}

	// 1. Validate Token
	claims, err := validateToken(request.Headers["Authorization"])
	if err != nil {
		// Try case-insensitive
		if err != nil {
			claims, err = validateToken(request.Headers["authorization"])
		}
	}
	if err != nil {
		return errorResponse(headers, http.StatusUnauthorized, "Unauthorized")
	}

	adminRole := claims["role"].(string)
	if adminRole != "super_admin" && adminRole != "admin" && adminRole != "super" {
		return errorResponse(headers, http.StatusForbidden, "Forbidden")
	}

	// 2. Routing
	userID := request.QueryStringParameters["userId"]
	if userID == "" {
		return errorResponse(headers, http.StatusBadRequest, "Missing userId")
	}

	// Fetch history from DynamoDB
	// Using Query on PK (userId) and SortKey (sortKey)
	tableName := tablePrefix + "PointTransactions"

	queryInput := &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		KeyConditionExpression: aws.String("userId = :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false), // Newest first
		Limit:            aws.Int32(100),  // Default limit
	}

	result, err := dynamoClient.Query(ctx, queryInput)
	if err != nil {
		log.Printf("Query error for user %s: %v", userID, err)
		return errorResponse(headers, http.StatusInternalServerError, "Database error")
	}

	var transactions []shared.PointTransaction
	err = attributevalue.UnmarshalListOfMaps(result.Items, &transactions)
	if err != nil {
		log.Printf("Unmarshal error: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Data parsing error")
	}

	return successResponse(headers, map[string]interface{}{
		"transactions": transactions,
		"total":        len(transactions),
	})
}

func validateToken(authHeader string) (jwt.MapClaims, error) {
	if authHeader == "" {
		return nil, fmt.Errorf("missing token")
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return nil, fmt.Errorf("invalid header format")
	}
	tokenString := parts[1]

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid claims")
}

func successResponse(headers map[string]string, data interface{}) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(APIResponse{Success: true, Data: data})
	return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers, Body: string(body)}, nil
}

func errorResponse(headers map[string]string, statusCode int, message string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(APIResponse{Success: false, Error: message})
	return events.APIGatewayProxyResponse{StatusCode: statusCode, Headers: headers, Body: string(body)}, nil
}

func main() {
	lambda.Start(handler)
}
