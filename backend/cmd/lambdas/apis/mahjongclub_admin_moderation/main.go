package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

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

type Config struct {
	AWSRegion   string
	TablePrefix string
	JWTSecret   string
}

type Report struct {
	ID         string    `dynamodbav:"id" json:"id"`
	Type       string    `dynamodbav:"type" json:"type"`
	TargetID   string    `dynamodbav:"targetId" json:"targetId"`
	ReporterID string    `dynamodbav:"reporterId" json:"reporterId"`
	Reason     string    `dynamodbav:"reason" json:"reason"`
	Status     string    `dynamodbav:"status" json:"status"`
	CreatedAt  time.Time `dynamodbav:"createdAt" json:"createdAt"`
	Content    string    `dynamodbav:"content" json:"content"`
}

var dbSvc *dynamodb.Client
var appCfg *Config

func init() {
	appCfg = &Config{
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
		JWTSecret:   getEnv("JWT_SECRET", "default-secret-change-me"),
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(appCfg.AWSRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	dbSvc = dynamodb.NewFromConfig(awsCfg)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func validateToken(tokenString, secret string) (jwt.MapClaims, error) {
	tokenString = strings.TrimPrefix(tokenString, "Bearer ")
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return token.Claims.(jwt.MapClaims), nil
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers}, nil
	}

	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	claims, err := validateToken(authHeader, appCfg.JWTSecret)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 401, Headers: headers, Body: `{"error":"Unauthorized"}`}, nil
	}

	operator := claims["sub"].(string)
	adminRole := claims["role"].(string)

	if adminRole != "super_admin" {
		return events.APIGatewayProxyResponse{StatusCode: 403, Headers: headers, Body: `{"error":"Forbidden"}`}, nil
	}

	switch request.Path {
	case "/admin/moderation/reports":
		if request.HTTPMethod == "GET" {
			return listReports(ctx)
		}
	case "/admin/moderation/action":
		if request.HTTPMethod == "POST" {
			return takeAction(ctx, request, operator)
		}
	}

	return events.APIGatewayProxyResponse{StatusCode: 404, Headers: headers, Body: `{"error":"Not found"}`}, nil
}

func listReports(ctx context.Context) (events.APIGatewayProxyResponse, error) {
	tableName := appCfg.TablePrefix + "Reports"
	input := &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	}
	result, err := dbSvc.Scan(ctx, input)
	if err != nil {
		// If table doesn't exist, return empty list instead of error for simulation
		if strings.Contains(err.Error(), "ResourceNotFoundException") {
			return events.APIGatewayProxyResponse{StatusCode: 200, Body: `{"success":true,"data":[]}`}, nil
		}
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"%v"}`, err)}, nil
	}

	var reports []Report
	err = attributevalue.UnmarshalListOfMaps(result.Items, &reports)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"%v"}`, err)}, nil
	}

	body, _ := json.Marshal(map[string]interface{}{"success": true, "data": reports})
	return events.APIGatewayProxyResponse{StatusCode: 200, Body: string(body)}, nil
}

func takeAction(ctx context.Context, request events.APIGatewayProxyRequest, operator string) (events.APIGatewayProxyResponse, error) {
	var req struct {
		ReportID string `json:"reportId"`
		Action   string `json:"action"` // "dismiss", "delete_content", "ban_user"
		TargetID string `json:"targetId"`
		Type     string `json:"type"` // "post", "comment", "user"
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 400, Body: `{"error":"Invalid JSON"}`}, nil
	}

	// 1. Update Report Status
	if req.ReportID != "" {
		tableName := appCfg.TablePrefix + "Reports"
		status := "resolved"
		if req.Action == "dismiss" {
			status = "dismissed"
		}
		_, _ = dbSvc.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName:                 aws.String(tableName),
			Key:                       map[string]types.AttributeValue{"id": &types.AttributeValueMemberS{Value: req.ReportID}},
			UpdateExpression:          aws.String("SET #s = :s"),
			ExpressionAttributeNames:  map[string]string{"#s": "status"},
			ExpressionAttributeValues: map[string]types.AttributeValue{":s": &types.AttributeValueMemberS{Value: status}},
		})
	}

	// 2. Perform Content Action
	if req.Action == "delete_content" {
		var contentTable string
		if req.Type == "post" {
			contentTable = appCfg.TablePrefix + "CommunityPosts"
		} else if req.Type == "comment" {
			contentTable = appCfg.TablePrefix + "CommunityComments"
		}

		if contentTable != "" {
			_, err := dbSvc.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: aws.String(contentTable),
				Key:       map[string]types.AttributeValue{"id": &types.AttributeValueMemberS{Value: req.TargetID}},
			})
			if err != nil {
				return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"Action failed: %v"}`, err)}, nil
			}
		}
	} else if req.Action == "ban_user" {
		tableName := appCfg.TablePrefix + "Users"
		_, err := dbSvc.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName:                 aws.String(tableName),
			Key:                       map[string]types.AttributeValue{"id": &types.AttributeValueMemberS{Value: req.TargetID}},
			UpdateExpression:          aws.String("SET #s = :s"),
			ExpressionAttributeNames:  map[string]string{"#s": "status"},
			ExpressionAttributeValues: map[string]types.AttributeValue{":s": &types.AttributeValueMemberS{Value: "banned"}},
		})
		if err != nil {
			return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"Ban failed: %v"}`, err)}, nil
		}
	}

	shared.LogAdminAction(ctx, operator, "MODERATION_"+strings.ToUpper(req.Action), req.TargetID, req.Type)
	return events.APIGatewayProxyResponse{StatusCode: 200, Body: `{"success":true}`}, nil
}

func main() {
	lambda.Start(handler)
}
