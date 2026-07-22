package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// Config holds the configuration
type Config struct {
	AWSRegion   string
	TablePrefix string
	JWTSecret   string
}

// Database handles DynamoDB operations
type Database struct {
	client *dynamodb.Client
	cfg    *Config
}

// AdminUser represents an admin user
type AdminUser struct {
	Username     string    `dynamodbav:"username" json:"username"`
	PasswordHash string    `dynamodbav:"passwordHash" json:"-"`
	Role         string    `dynamodbav:"role" json:"role"` // "admin" or "super_admin"
	CreatedAt    time.Time `dynamodbav:"createdAt" json:"createdAt"`
	LastLoginAt  time.Time `dynamodbav:"lastLoginAt" json:"lastLoginAt"`
}

// LoginRequest represents the login request
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Response structure for API responses
type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Token   string      `json:"token,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var db *Database

func init() {
	cfg := &Config{
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
		JWTSecret:   requireJWTSecret(),
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

// GetAdminUser retrieves an admin user by username
func (d *Database) GetAdminUser(ctx context.Context, username string) (*AdminUser, error) {
	tableName := d.cfg.TablePrefix + "AdminUsers"

	input := &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"username": &types.AttributeValueMemberS{Value: username},
		},
	}

	result, err := d.client.GetItem(ctx, input)
	if err != nil {
		return nil, err
	}

	if result.Item == nil {
		return nil, fmt.Errorf("user not found")
	}

	var user AdminUser
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// UpdateLastLogin updates the admin user's last login timestamp
func (d *Database) UpdateLastLogin(ctx context.Context, username string) error {
	tableName := d.cfg.TablePrefix + "AdminUsers"
	now := time.Now()

	updateExpression := "SET lastLoginAt = :lastLoginAt"
	expressionValues := map[string]types.AttributeValue{
		":lastLoginAt": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
	}

	input := &dynamodb.UpdateItemInput{
		TableName:                 &tableName,
		Key:                       map[string]types.AttributeValue{"username": &types.AttributeValueMemberS{Value: username}},
		UpdateExpression:          &updateExpression,
		ExpressionAttributeValues: expressionValues,
	}

	_, err := d.client.UpdateItem(ctx, input)
	return err
}

// VerifyPassword verifies a password against a hash
func VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// GenerateAdminToken generates a JWT token for the admin user
func GenerateAdminToken(username, role, secret string) (string, error) {
	claims := jwt.MapClaims{
		"sub":  username,
		"role": role,
		"exp":  time.Now().Add(time.Hour * 24).Unix(), // 24 hours
		"iat":  time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	// Enable CORS
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	var req LoginRequest
	err := json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid request body", headers)
	}

	if req.Username == "" || req.Password == "" {
		return errorResponse(http.StatusBadRequest, "Username and password are required", headers)
	}

	user, err := db.GetAdminUser(ctx, req.Username)
	if err != nil {
		log.Printf("Login failed for user %s: %v", req.Username, err)
		// Return generic error for security
		return errorResponse(http.StatusUnauthorized, "Invalid credentials", headers)
	}

	if !VerifyPassword(req.Password, user.PasswordHash) {
		log.Printf("Invalid password for user %s", req.Username)
		return errorResponse(http.StatusUnauthorized, "Invalid credentials", headers)
	}

	// Update last login
	if err := db.UpdateLastLogin(ctx, user.Username); err != nil {
		log.Printf("Failed to update last login: %v", err)
	}

	// Generate Token
	token, err := GenerateAdminToken(user.Username, user.Role, db.cfg.JWTSecret)
	if err != nil {
		log.Printf("Failed to generate token: %v", err)
		return errorResponse(http.StatusInternalServerError, "Internal error", headers)
	}

	// Success response
	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"username":  user.Username,
			"role":      user.Role,
			"createdAt": user.CreatedAt,
		},
		Token: token,
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func errorResponse(statusCode int, message string, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	response := Response{Success: false, Error: message}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}

// requireJWTSecret：fail-closed 讀 JWT_SECRET(移除 default-secret-change-me 死 fallback,AUTH_SYSTEM_DESIGN §6.1)。
func requireJWTSecret() string {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		panic("JWT_SECRET not configured — refusing admin JWT with a known default")
	}
	return s
}
