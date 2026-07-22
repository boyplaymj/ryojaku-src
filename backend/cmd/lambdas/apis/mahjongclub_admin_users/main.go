package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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

	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}
	svc = dynamodb.NewFromConfig(cfg)
}

type User struct {
	UserID      string `json:"id" dynamodbav:"userId"`
	DisplayName string `json:"displayName" dynamodbav:"displayName"`
	Email       string `json:"email" dynamodbav:"email"`
	Status      string `json:"status" dynamodbav:"status"`
	Role        string `json:"role" dynamodbav:"role"`
	Points      int    `json:"points" dynamodbav:"points"`
	LastLoginAt string `json:"lastLoginAt" dynamodbav:"lastLoginAt"`
	CreatedAt   string `json:"createdAt" dynamodbav:"createdAt"`
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Content-Type":                 "application/json",
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Headers": "Content-Type,Authorization",
		"Access-Control-Allow-Methods": "GET,OPTIONS",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers, Body: ""}, nil
	}

	claims, err := validateToken(request.Headers["Authorization"])
	if err != nil {
		claims, err = validateToken(request.Headers["authorization"])
	}
	if err != nil {
		return errorResponse(401, "Unauthorized", headers), nil
	}

	adminRole := claims["role"].(string)
	if adminRole != "super_admin" && adminRole != "admin" && adminRole != "super" {
		return errorResponse(403, "Forbidden", headers), nil
	}

	userIdQuery := request.QueryStringParameters["userId"]
	nameQuery := request.QueryStringParameters["displayName"]
	lastKey := request.QueryStringParameters["lastKey"]
	limit := 20

	table := tablePrefix + "Users"
	var users []User
	var newLastKey string
	var totalItems int64

	// Get total items for pagination info
	describeResult, err := svc.DescribeTable(ctx, &dynamodb.DescribeTableInput{
		TableName: aws.String(table),
	})
	if err == nil && describeResult.Table != nil {
		totalItems = *describeResult.Table.ItemCount
	}

	if userIdQuery != "" {
		result, err := svc.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: aws.String(table),
			Key: map[string]types.AttributeValue{
				"userId": &types.AttributeValueMemberS{Value: userIdQuery},
			},
		})
		if err != nil {
			return errorResponse(500, "Database error", headers), nil
		}
		if result.Item != nil {
			var u User
			attributevalue.UnmarshalMap(result.Item, &u)
			users = append(users, u)
		}
		totalItems = int64(len(users))
	} else {
		scanInput := &dynamodb.ScanInput{
			TableName: aws.String(table),
			Limit:     aws.Int32(int32(limit)),
		}

		if lastKey != "" {
			scanInput.ExclusiveStartKey = map[string]types.AttributeValue{
				"userId": &types.AttributeValueMemberS{Value: lastKey},
			}
		}

		if nameQuery != "" {
			scanInput.FilterExpression = aws.String("displayName = :name")
			scanInput.ExpressionAttributeValues = map[string]types.AttributeValue{
				":name": &types.AttributeValueMemberS{Value: nameQuery},
			}
		}

		result, err := svc.Scan(ctx, scanInput)
		if err != nil {
			return errorResponse(500, "Database error", headers), nil
		}

		err = attributevalue.UnmarshalListOfMaps(result.Items, &users)
		if err != nil {
			return errorResponse(500, "Data parsing error", headers), nil
		}

		if result.LastEvaluatedKey != nil {
			newLastKey = result.LastEvaluatedKey["userId"].(*types.AttributeValueMemberS).Value
		}

		// If filtering by name, total count changes, but DynamoDB scan doesn't give total matching count easily without full scan.
		// For admin, we show the table total as a reference.
	}

	for i := range users {
		if users[i].Status == "" {
			users[i].Status = "active"
		}
		if users[i].Role == "" {
			users[i].Role = "user"
		}
	}

	body, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"data":    users,
		"lastKey": newLastKey,
		"meta": map[string]interface{}{
			"total": totalItems,
			"limit": limit,
		},
	})

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers:    headers,
		Body:       string(body),
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

func errorResponse(status int, message string, headers map[string]string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]interface{}{"success": false, "error": message})
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers:    headers,
		Body:       string(body),
	}
}

func main() {
	lambda.Start(handleRequest)
}
