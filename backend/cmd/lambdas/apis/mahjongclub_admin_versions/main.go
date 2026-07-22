package main

import (
	"context"
	"encoding/json"
	"fmt"
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

// ConfigItem represents a row in MahjongClub_AdminConfigs
type ConfigItem struct {
	Key   string `dynamodbav:"info_key" json:"key"`
	Value string `dynamodbav:"info_value" json:"value"`
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if svc == nil {
		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			return errorResponse(500, "AWS config error"), nil
		}
		svc = dynamodb.NewFromConfig(cfg)
	}

	// Auth Check — REST API Gateway 正規化 header 為大寫,故兩種都試
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	claims, err := validateToken(authHeader)
	if err != nil {
		return errorResponse(401, "Unauthorized"), nil
	}

	table := tablePrefix + "AdminConfigs"

	// Check if GET or POST
	adminRole := claims["role"].(string)
	if adminRole != "super_admin" {
		return errorResponse(403, "Forbidden"), nil
	}

	if request.HTTPMethod == "POST" {
		adminUser := claims["sub"].(string)
		return handleUpdateConfig(ctx, request, table, adminUser)
	}

	// GET: Fetch all configs
	input := &dynamodb.ScanInput{
		TableName: aws.String(table),
	}

	// In a real scenario, version config might be a single item or specific keys
	// For simplicity, we scan the config table
	result, err := svc.Scan(ctx, input)
	if err != nil {
		// Create table if not exists logic omitted for brevity, assuming setup script handled it
		// Or just return empty defaults
		fmt.Println("Scan error:", err)
		return errorResponse(500, "DB Error"), nil
	}

	var items []ConfigItem
	err = attributevalue.UnmarshalListOfMaps(result.Items, &items)
	if err != nil {
		return errorResponse(500, "Unmarshal Error"), nil
	}

	// Convert list to map for easier frontend consumption
	configMap := make(map[string]string)
	// Defaults
	configMap["minVersion"] = "1.0.0"
	configMap["latestVersion"] = "1.0.0"

	for _, item := range items {
		configMap[item.Key] = item.Value
	}

	body, _ := json.Marshal(map[string]interface{}{
		"data": configMap,
	})

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		},
		Body: string(body),
	}, nil
}

func handleUpdateConfig(ctx context.Context, request events.APIGatewayProxyRequest, table string, adminUser string) (events.APIGatewayProxyResponse, error) {
	var updates map[string]interface{}
	if err := json.Unmarshal([]byte(request.Body), &updates); err != nil {
		return errorResponse(400, "Invalid JSON"), nil
	}

	for k, v := range updates {
		strValue := fmt.Sprintf("%v", v)
		// For consistency, we might want to ensure booleans are "true"/"false" not "1"/"0" if that matters?
		// But fmt.Sprintf("%v") handles bools as "true"/"false".

		// Upsert each config key
		_, err := svc.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(table),
			Item: map[string]types.AttributeValue{
				"info_key":   &types.AttributeValueMemberS{Value: k},
				"info_value": &types.AttributeValueMemberS{Value: strValue},
			},
		})
		if err != nil {
			fmt.Printf("Update error for %s: %v\n", k, err)
			return errorResponse(500, "Failed to update config"), nil
		}
	}

	// Log Action
	details, _ := json.Marshal(updates)
	shared.LogAdminAction(ctx, adminUser, "UPDATE_CONFIG", "AdminConfigs", string(details))

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		},
		Body: `{"message": "Config updated successfully"}`,
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

	if claims, ok := token.Claims.(jwt.MapClaims); ok {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid claims")
}

func errorResponse(status int, message string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]string{"error": message})
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
		},
		Body: string(body),
	}
}

func main() {
	lambda.Start(handleRequest)
}
