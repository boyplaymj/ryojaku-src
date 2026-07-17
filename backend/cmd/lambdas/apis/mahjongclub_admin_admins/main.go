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
	"golang.org/x/crypto/bcrypt"
)

type Config struct {
	AWSRegion   string
	TablePrefix string
	JWTSecret   string
}

type AdminUser struct {
	Username     string    `dynamodbav:"username" json:"username"`
	PasswordHash string    `dynamodbav:"passwordHash" json:"-"`
	Password     string    `json:"password,omitempty"` // For POST/PATCH
	Role         string    `dynamodbav:"role" json:"role"`
	CreatedAt    time.Time `dynamodbav:"createdAt" json:"createdAt"`
	LastLoginAt  time.Time `dynamodbav:"lastLoginAt" json:"lastLoginAt"`
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
		"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers}, nil
	}

	// Auth
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	claims, err := validateToken(authHeader, appCfg.JWTSecret)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 401, Headers: headers, Body: `{"error":"Unauthorized"}`}, nil
	}

	currentUserRole := claims["role"].(string)
	currentUsername := claims["sub"].(string)

	// Admin CRUD usually restricted to super_admin
	// But let people update their own settings if needed?
	// The requirement says "restricted to super-admins" for admin account CRUD.

	tableName := appCfg.TablePrefix + "AdminUsers"

	switch request.HTTPMethod {
	case "GET":
		if currentUserRole != "super_admin" {
			return events.APIGatewayProxyResponse{StatusCode: 403, Headers: headers, Body: `{"error":"Forbidden"}`}, nil
		}
		return listAdmins(ctx, tableName)
	case "POST":
		if currentUserRole != "super_admin" {
			return events.APIGatewayProxyResponse{StatusCode: 403, Headers: headers, Body: `{"error":"Forbidden"}`}, nil
		}
		return createAdmin(ctx, request, tableName, currentUsername)
	case "PATCH":
		// Can update self or super_admin can update others
		return updateAdmin(ctx, request, tableName, currentUsername, currentUserRole)
	case "DELETE":
		if currentUserRole != "super_admin" {
			return events.APIGatewayProxyResponse{StatusCode: 403, Headers: headers, Body: `{"error":"Forbidden"}`}, nil
		}
		return deleteAdmin(ctx, request, tableName, currentUsername)
	}

	return events.APIGatewayProxyResponse{StatusCode: 405, Headers: headers, Body: `{"error":"Method not allowed"}`}, nil
}

func listAdmins(ctx context.Context, table string) (events.APIGatewayProxyResponse, error) {
	input := &dynamodb.ScanInput{
		TableName: aws.String(table),
	}
	result, err := dbSvc.Scan(ctx, input)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"%v"}`, err)}, nil
	}

	var admins []AdminUser
	err = attributevalue.UnmarshalListOfMaps(result.Items, &admins)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"%v"}`, err)}, nil
	}

	body, _ := json.Marshal(map[string]interface{}{"success": true, "data": admins})
	return events.APIGatewayProxyResponse{StatusCode: 200, Body: string(body)}, nil
}

func createAdmin(ctx context.Context, request events.APIGatewayProxyRequest, table string, operator string) (events.APIGatewayProxyResponse, error) {
	var admin AdminUser
	if err := json.Unmarshal([]byte(request.Body), &admin); err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 400, Body: `{"error":"Invalid JSON"}`}, nil
	}

	if admin.Username == "" || admin.Password == "" {
		return events.APIGatewayProxyResponse{StatusCode: 400, Body: `{"error":"Username and password required"}`}, nil
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(admin.Password), bcrypt.DefaultCost)
	admin.PasswordHash = string(hash)
	admin.CreatedAt = time.Now()
	if admin.Role == "" {
		admin.Role = "admin"
	}

	item, _ := attributevalue.MarshalMap(admin)
	_, err := dbSvc.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(table),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(username)"),
	})

	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"%v"}`, err)}, nil
	}

	shared.LogAdminAction(ctx, operator, "CREATE_ADMIN", admin.Username, "")
	return events.APIGatewayProxyResponse{StatusCode: 201, Body: `{"success": true}`}, nil
}

func updateAdmin(ctx context.Context, request events.APIGatewayProxyRequest, table string, operator string, operatorRole string) (events.APIGatewayProxyResponse, error) {
	var req struct {
		TargetUsername string `json:"username"`
		Password       string `json:"password,omitempty"`
		Role           string `json:"role,omitempty"`
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 400, Body: `{"error":"Invalid JSON"}`}, nil
	}

	if req.TargetUsername == "" {
		return events.APIGatewayProxyResponse{StatusCode: 400, Body: `{"error":"Target username required"}`}, nil
	}

	// Permission check
	if operatorRole != "super_admin" && operator != req.TargetUsername {
		return events.APIGatewayProxyResponse{StatusCode: 403, Body: `{"error":"Forbidden"}`}, nil
	}

	updateExpr := "SET #lastUpdate = :lastUpdate"
	exprNames := map[string]string{"#lastUpdate": "lastUpdate"}
	exprValues := map[string]types.AttributeValue{
		":lastUpdate": &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
	}

	if req.Password != "" {
		hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		updateExpr += ", passwordHash = :h"
		exprValues[":h"] = &types.AttributeValueMemberS{Value: string(hash)}
	}

	if req.Role != "" && operatorRole == "super_admin" {
		updateExpr += ", #r = :r"
		exprNames["#r"] = "role"
		exprValues[":r"] = &types.AttributeValueMemberS{Value: req.Role}
	}

	_, err := dbSvc.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(table),
		Key:                       map[string]types.AttributeValue{"username": &types.AttributeValueMemberS{Value: req.TargetUsername}},
		UpdateExpression:          aws.String(updateExpr),
		ExpressionAttributeNames:  exprNames,
		ExpressionAttributeValues: exprValues,
	})

	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"%v"}`, err)}, nil
	}

	shared.LogAdminAction(ctx, operator, "UPDATE_ADMIN", req.TargetUsername, "")
	return events.APIGatewayProxyResponse{StatusCode: 200, Body: `{"success": true}`}, nil
}

func deleteAdmin(ctx context.Context, request events.APIGatewayProxyRequest, table string, operator string) (events.APIGatewayProxyResponse, error) {
	var req struct {
		Username string `json:"username"`
	}
	json.Unmarshal([]byte(request.Body), &req)

	if req.Username == operator {
		return events.APIGatewayProxyResponse{StatusCode: 400, Body: `{"error":"Cannot delete self"}`}, nil
	}

	_, err := dbSvc.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(table),
		Key:       map[string]types.AttributeValue{"username": &types.AttributeValueMemberS{Value: req.Username}},
	})

	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf(`{"error":"%v"}`, err)}, nil
	}

	shared.LogAdminAction(ctx, operator, "DELETE_ADMIN", req.Username, "")
	return events.APIGatewayProxyResponse{StatusCode: 200, Body: `{"success": true}`}, nil
}

func main() {
	lambda.Start(handler)
}
