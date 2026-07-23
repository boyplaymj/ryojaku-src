package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"golang.org/x/crypto/bcrypt"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// Config holds the configuration
type Config struct {
	AWSRegion     string
	TablePrefix   string
	EncryptionKey string
}

// Database handles DynamoDB operations
type Database struct {
	client *dynamodb.Client
	cfg    *Config
}

// UserStats represents user statistics
type UserStats struct {
	GamesHosted        int     `dynamodbav:"gamesHosted" json:"gamesHosted"`
	GamesJoined        int     `dynamodbav:"gamesJoined" json:"gamesJoined"`
	TotalRatings       int     `dynamodbav:"totalRatings" json:"totalRatings"`
	PositiveRatings    int     `dynamodbav:"positiveRatings" json:"positiveRatings"`
	PositiveRatingRate float64 `dynamodbav:"positiveRatingRate" json:"positiveRatingRate"`
}

// UserPreferences represents user notification preferences
type UserPreferences struct {
	NotifyNewGames    bool `dynamodbav:"notifyNewGames" json:"notifyNewGames"`
	NotifyGameUpdates bool `dynamodbav:"notifyGameUpdates" json:"notifyGameUpdates"`
}

// User represents a user in the system
type User struct {
	UserID            string          `dynamodbav:"userId" json:"userId"`
	DisplayName       string          `dynamodbav:"displayName" json:"displayName"`
	Email             string          `dynamodbav:"email,omitempty" json:"email,omitempty"`
	PasswordHash      string          `dynamodbav:"passwordHash,omitempty" json:"passwordHash,omitempty"`
	AccountType       string          `dynamodbav:"accountType" json:"accountType"`
	Gender            string          `dynamodbav:"gender,omitempty" json:"gender,omitempty"`
	AgeRange          string          `dynamodbav:"ageRange,omitempty" json:"ageRange,omitempty"`
	MahjongExperience string          `dynamodbav:"mahjongExperience,omitempty" json:"mahjongExperience,omitempty"`
	LineID            string          `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`
	EncryptedLineID   string          `dynamodbav:"encryptedLineId,omitempty" json:"encryptedLineId,omitempty"`
	Points            int             `dynamodbav:"points" json:"points"`
	Rating            float64         `dynamodbav:"rating" json:"rating"`
	IsVerified        bool            `dynamodbav:"isVerified" json:"isVerified"`
	EmailVerified     bool            `dynamodbav:"emailVerified" json:"emailVerified"`
	Stats             *UserStats      `dynamodbav:"stats,omitempty" json:"stats,omitempty"`
	GamesHosted       int             `dynamodbav:"gamesHosted" json:"gamesHosted"` // Deprecated, use Stats.GamesHosted
	GamesJoined       int             `dynamodbav:"gamesJoined" json:"gamesJoined"` // Deprecated, use Stats.GamesJoined
	Preferences       UserPreferences `dynamodbav:"preferences" json:"preferences"`
	LastLoginAt       *time.Time      `dynamodbav:"lastLoginAt,omitempty" json:"lastLoginAt,omitempty"`
	AppVersion        string          `dynamodbav:"appVersion,omitempty" json:"appVersion,omitempty"`
	Platform          string          `dynamodbav:"platform,omitempty" json:"platform,omitempty"`
	CreatedAt         time.Time       `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt         time.Time       `dynamodbav:"updatedAt" json:"updatedAt"`
}

// LoginRequest represents the login request
type LoginRequest struct {
	Email           string `json:"email,omitempty"`
	Password        string `json:"password,omitempty"`
	EncryptedLineID string `json:"encryptedLineId,omitempty"` // 備援登入方式
}

// Response structure for API responses
type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	User    interface{} `json:"user,omitempty"`
	Token   string      `json:"token,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var db *Database

func init() {
	cfg := &Config{
		AWSRegion:     getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix:   getEnv("TABLE_PREFIX", "MahjongClub_"),
		EncryptionKey: os.Getenv("ENCRYPTION_KEY"),
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

func stringPtr(s string) *string {
	return &s
}

func int32Ptr(i int32) *int32 {
	return &i
}

// DecryptLineID decrypts the encrypted LINE ID
func (d *Database) DecryptLineID(encryptedID string) (string, error) {
	key := []byte(d.cfg.EncryptionKey)
	ciphertext, err := base64.StdEncoding.DecodeString(encryptedID)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	if len(ciphertext) < aes.BlockSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	iv := ciphertext[:aes.BlockSize]
	ciphertext = ciphertext[aes.BlockSize:]

	stream := cipher.NewCFBDecrypter(block, iv)
	stream.XORKeyStream(ciphertext, ciphertext)

	return string(ciphertext), nil
}

// GetUserByEmail retrieves a user by email
func (d *Database) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	tableName := d.cfg.TablePrefix + "Users"

	input := &dynamodb.QueryInput{
		TableName:              &tableName,
		IndexName:              stringPtr("email-index"),
		KeyConditionExpression: stringPtr("email = :email"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":email": &types.AttributeValueMemberS{Value: email},
		},
		Limit: int32Ptr(1),
	}

	result, err := d.client.Query(ctx, input)
	if err != nil {
		return nil, err
	}

	if result.Count == 0 {
		return nil, fmt.Errorf("user not found")
	}

	var user User
	err = attributevalue.UnmarshalMap(result.Items[0], &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// GetUserByLineID retrieves a user by LINE ID
func (d *Database) GetUserByLineID(ctx context.Context, lineID string) (*User, error) {
	tableName := d.cfg.TablePrefix + "Users"

	input := &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: lineID},
		},
	}

	result, err := d.client.GetItem(ctx, input)
	if err != nil {
		return nil, err
	}

	if result.Item == nil {
		return nil, fmt.Errorf("user not found")
	}

	var user User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// GetUserByID retrieves a user by userId.
func (d *Database) GetUserByID(ctx context.Context, userID string) (*User, error) {
	tableName := d.cfg.TablePrefix + "Users"
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key:       map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, fmt.Errorf("user not found")
	}
	var user User
	if err = attributevalue.UnmarshalMap(result.Item, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

// getUserForEmailLogin：P2(AUTH_SYSTEM_DESIGN §5.B) email/密碼登入的帳號解析。
// 先走 AuthIdentities(email#，權威 O(1))；查無則 fallback email-index(相容尚未 backfill 的既有用戶)。只讀不寫。
func (d *Database) getUserForEmailLogin(ctx context.Context, email string) (*User, error) {
	if uid, err := shared.ResolveIdentity(ctx, shared.IdentityKey(shared.ProviderPassword, email)); err == nil && uid != "" {
		if u, gerr := d.GetUserByID(ctx, uid); gerr == nil && u != nil {
			return u, nil
		}
	}
	return d.GetUserByEmail(ctx, email)
}

// UpdateLastLogin updates the user's last login timestamp and version info
func (d *Database) UpdateLastLogin(ctx context.Context, userID, version, platform string) error {
	tableName := d.cfg.TablePrefix + "Users"
	now := time.Now()

	updateExpression := "SET lastLoginAt = :lastLoginAt, updatedAt = :updatedAt"
	expressionValues := map[string]types.AttributeValue{
		":lastLoginAt": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		":updatedAt":   &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
	}

	if version != "" {
		updateExpression += ", appVersion = :version"
		expressionValues[":version"] = &types.AttributeValueMemberS{Value: version}
	}
	if platform != "" {
		updateExpression += ", platform = :platform"
		expressionValues[":platform"] = &types.AttributeValueMemberS{Value: platform}
	}

	input := &dynamodb.UpdateItemInput{
		TableName:                 &tableName,
		Key:                       map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
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

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	if db != nil && db.client != nil {
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "core", "app_login")
	}

	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	// Enable CORS
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Version, X-Platform",
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

	// Parse request body
	var req LoginRequest
	err := json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		response := Response{Success: false, Error: "Invalid request body"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	var user *User

	// 方式 1: 使用 Email + Password 登入（P2: AuthIdentities 優先 + email-index fallback）
	if req.Email != "" && req.Password != "" {
		// normEmail 只給限流 key：避免大小寫/空白變體落不同 bucket 繞過限流(Codex P6 High)。
		// ⚠️ 不可改動 req.Email 本身——登入查詢的 email-index fallback 需保留「原輸入精確比對」語意，
		//    否則 mixed-case 且未 backfill AuthIdentities 的 13k legacy 帳號會查不到(Codex P6 回歸)。
		normEmail := strings.ToLower(strings.TrimSpace(req.Email))
		// rate limit：防暴力破解（同信箱+IP，15 分鐘 10 次）。超限回 429。
		if allowed, _ := shared.CheckRateLimit(ctx, "login#"+normEmail+"#"+request.RequestContext.Identity.SourceIP, 10, 900); !allowed {
			response := Response{Success: false, Error: "嘗試次數過多，請稍後再試"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{StatusCode: http.StatusTooManyRequests, Headers: headers, Body: string(body)}, nil
		}
		user, err = db.getUserForEmailLogin(ctx, req.Email)
		if err != nil {
			log.Printf("User not found: %v", err)
			response := Response{Success: false, Error: "Invalid email or password"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}

		// Verify password
		if !VerifyPassword(req.Password, user.PasswordHash) {
			response := Response{Success: false, Error: "Invalid email or password"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	} else if req.EncryptedLineID != "" {
		// 方式 2: 使用加密的 LINE ID 登入（備援方式）
		lineID, err := db.DecryptLineID(req.EncryptedLineID)
		if err != nil {
			log.Printf("Failed to decrypt LINE ID: %v", err)
			response := Response{Success: false, Error: "Invalid LINE ID"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}

		user, err = db.GetUserByLineID(ctx, lineID)
		if err != nil {
			log.Printf("User not found by LINE ID: %v", err)
			response := Response{Success: false, Error: "User not found"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	} else {
		response := Response{Success: false, Error: "Email and password, or encrypted LINE ID required"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Update last login timestamp and version info
	version := request.Headers["X-App-Version"]
	if version == "" {
		version = request.Headers["x-app-version"] // case-insensitive
	}
	platform := request.Headers["X-Platform"]
	if platform == "" {
		platform = request.Headers["x-platform"]
	}

	err = db.UpdateLastLogin(ctx, user.UserID, version, platform)
	if err != nil {
		log.Printf("Failed to update last login: %v", err)
		// 不影響登入流程，只記錄錯誤
	}

	// Return success response (不包含密碼)
	response := Response{
		Success: true,
		User: map[string]interface{}{
			"userId":            user.UserID,
			"displayName":       user.DisplayName,
			"email":             user.Email,
			"accountType":       user.AccountType,
			"gender":            user.Gender,
			"ageRange":          user.AgeRange,
			"mahjongExperience": user.MahjongExperience,
			"lineId":            user.LineID,
			"points":            user.Points,
			"rating":            user.Rating,
			"isVerified":        user.IsVerified,
			"emailVerified":     user.EmailVerified,
			"stats":             user.Stats,
			"preferences":       user.Preferences,
			"createdAt":         user.CreatedAt,
		},
	}

	// Generate JWT Token
	token, err := shared.GenerateToken(user.UserID, user.Email)
	if err != nil {
		log.Printf("Failed to generate JWT token: %v", err)
		// Non-blocking error for Phase 1 compatibility
	} else {
		response.Token = token
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
