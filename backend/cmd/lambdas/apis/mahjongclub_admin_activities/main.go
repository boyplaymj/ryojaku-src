package main

import (
	"context"
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

type ActivityConfig struct {
	InfoKey   string `json:"info_key" dynamodbav:"info_key"`
	InfoValue string `json:"info_value" dynamodbav:"info_value"`
}

func handleRequest(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	if svc == nil {
		cfg, _ := config.LoadDefaultConfig(ctx)
		svc = dynamodb.NewFromConfig(cfg)
	}

	// Auth Check
	claims, err := validateToken(request.Headers["authorization"])
	if err != nil {
		return errorResponse(http.StatusUnauthorized, "Unauthorized")
	}
	adminUser := claims["sub"].(string)

	tableName := tablePrefix + "AdminConfigs"

	switch request.RequestContext.HTTP.Method {
	case "GET":
		return getActivityConfigs(ctx, tableName)
	case "POST":
		return updateActivityConfigs(ctx, request, tableName, adminUser)
	default:
		return errorResponse(http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func getActivityConfigs(ctx context.Context, table string) (events.APIGatewayV2HTTPResponse, error) {
	// Scan for Activity: prefix
	scanInput := &dynamodb.ScanInput{
		TableName:        aws.String(table),
		FilterExpression: aws.String("begins_with(info_key, :p)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":p": &types.AttributeValueMemberS{Value: "Activity:"},
		},
	}

	result, err := svc.Scan(ctx, scanInput)
	if err != nil {
		log.Printf("Scan error: %v", err)
		return errorResponse(http.StatusInternalServerError, "Failed to fetch configs")
	}

	configs := make(map[string]string)
	for _, item := range result.Items {
		var config ActivityConfig
		err := attributevalue.UnmarshalMap(item, &config)
		if err == nil {
			// Remove prefix for frontend
			key := strings.TrimPrefix(config.InfoKey, "Activity:")
			configs[key] = config.InfoValue
		}
	}

	body, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"data":    configs,
	})
	return successResponse(body)
}

func updateActivityConfigs(ctx context.Context, request events.APIGatewayV2HTTPRequest, table string, adminUser string) (events.APIGatewayV2HTTPResponse, error) {
	var body map[string]string
	if err := json.Unmarshal([]byte(request.Body), &body); err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid JSON")
	}

	for k, v := range body {
		_, err := svc.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(table),
			Item: map[string]types.AttributeValue{
				"info_key":   &types.AttributeValueMemberS{Value: "Activity:" + k},
				"info_value": &types.AttributeValueMemberS{Value: v},
			},
		})
		if err != nil {
			log.Printf("Failed to update config %s: %v", k, err)
			return errorResponse(http.StatusInternalServerError, "Failed to update config "+k)
		}
	}

	shared.LogAdminAction(ctx, adminUser, "UPDATE_ACTIVITY_CONFIGS", "Activity", request.Body)

	return successResponse([]byte(`{"success": true, "message": "Configs updated"}`))
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

func successResponse(body []byte) (events.APIGatewayV2HTTPResponse, error) {
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(body),
	}, nil
}

func errorResponse(status int, message string) (events.APIGatewayV2HTTPResponse, error) {
	body, _ := json.Marshal(map[string]interface{}{"success": false, "error": message})
	return events.APIGatewayV2HTTPResponse{
		StatusCode: status,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(body),
	}, nil
}

func main() {
	lambda.Start(handleRequest)
}
