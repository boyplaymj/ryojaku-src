package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/golang-jwt/jwt/v5"
)

var (
	svc         *dynamodb.Client
	tablePrefix string
	jwtSecret   []byte
)

func init() {
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
	jwtSecret = []byte(os.Getenv("JWT_SECRET"))
	if len(jwtSecret) == 0 {
		if os.Getenv("ALLOW_DEV_JWT_SECRET") == "true" {
			jwtSecret = []byte("dev_only_insecure_secret_do_not_use_in_prod")
		} else {
			panic("JWT_SECRET not configured — refusing empty admin JWT secret (AUTH_SYSTEM_DESIGN §6.1)")
		}
	}
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if svc == nil {
		cfg, _ := config.LoadDefaultConfig(ctx)
		svc = dynamodb.NewFromConfig(cfg)
	}

	// Auth check — REST API Gateway 正規化 header 為大寫,故兩種都試
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	_, err := validateToken(authHeader)
	if err != nil {
		return errorResponse(401, "Unauthorized"), nil
	}

	tableName := tablePrefix + "AdminAuditLogs"

	// Simple Scan for logs (in production use Query with index or pagination)
	input := &dynamodb.ScanInput{
		TableName: aws.String(tableName),
		Limit:     aws.Int32(100),
	}

	result, err := svc.Scan(ctx, input)
	if err != nil {
		return errorResponse(500, "Failed to fetch logs"), nil
	}

	// Raw items to JSON for frontend
	body, _ := json.Marshal(map[string]interface{}{
		"data": result.Items,
	})

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(body),
	}, nil
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

	return token.Claims.(jwt.MapClaims), nil
}

func errorResponse(status int, message string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]string{"error": message})
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(body),
	}
}

func main() {
	lambda.Start(handleRequest)
}
