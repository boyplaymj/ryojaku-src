package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
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
	AWSRegion   string
	TablePrefix string
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
	AccountType       string          `dynamodbav:"accountType" json:"accountType"` // "linebot" or "app"
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
	InvitedBy         string          `dynamodbav:"invitedBy,omitempty" json:"invitedBy,omitempty"`
	InviteRewarded    bool            `dynamodbav:"inviteRewarded,omitempty" json:"inviteRewarded,omitempty"`
	CreatedAt         time.Time       `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt         time.Time       `dynamodbav:"updatedAt" json:"updatedAt"`
}

// RegisterRequest represents the registration request
type RegisterRequest struct {
	Email             string `json:"email"`
	Password          string `json:"password"`
	DisplayName       string `json:"displayName"`
	Gender            string `json:"gender,omitempty"`
	AgeRange          string `json:"ageRange,omitempty"`
	MahjongExperience string `json:"mahjongExperience,omitempty"`
	InviteCode        string `json:"inviteCode,omitempty"`
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

// ValidateEmail validates email format
func ValidateEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

// ValidatePassword validates password strength
func ValidatePassword(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("密碼長度至少需要 8 個字元")
	}
	if len(password) > 128 {
		return fmt.Errorf("密碼長度不能超過 128 個字元")
	}
	return nil
}

// GenerateUserID generates a unique user ID
func GenerateUserID() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("APP_%s", base64.URLEncoding.EncodeToString(b)[:16]), nil
}

// HashPassword hashes a password using bcrypt
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckEmailExists checks if email already exists
func (d *Database) CheckEmailExists(ctx context.Context, email string) (bool, error) {
	tableName := d.cfg.TablePrefix + "Users"

	// Query by email using GSI (需要在 DynamoDB 中建立 email-index)
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
		return false, err
	}

	return result.Count > 0, nil
}

// SaveUser saves a user to DynamoDB
func (d *Database) SaveUser(ctx context.Context, user *User) error {
	tableName := d.cfg.TablePrefix + "Users"

	av, err := attributevalue.MarshalMap(user)
	if err != nil {
		return fmt.Errorf("failed to marshal user: %w", err)
	}

	input := &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      av,
	}

	_, err = d.client.PutItem(ctx, input)
	return err
}

// SaveUserWithIdentity 原子建立 user + 綁 email 登入身分 + 設 identityCount=1（單一 TransactWriteItems）。
// AuthIdentities 的 attribute_not_exists(identity) 是 email 唯一性的權威閘：
// 大小寫變體或併發同 email → 交易取消(idx1) → 呼叫端回 409。取代先前非致命 Bind 會留重複帳號的問題(Codex P2 High)。
func (d *Database) SaveUserWithIdentity(ctx context.Context, user *User, identity, provider string) error {
	av, err := attributevalue.MarshalMap(user)
	if err != nil {
		return fmt.Errorf("failed to marshal user: %w", err)
	}
	av["identityCount"] = &types.AttributeValueMemberN{Value: "1"} // 新帳號起算一把鑰匙
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = d.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{
				TableName:           stringPtr(d.cfg.TablePrefix + "Users"),
				Item:                av,
				ConditionExpression: stringPtr("attribute_not_exists(userId)"),
			}},
			{Put: &types.Put{
				TableName: stringPtr(d.cfg.TablePrefix + "AuthIdentities"),
				Item: map[string]types.AttributeValue{
					"identity":  &types.AttributeValueMemberS{Value: identity},
					"userId":    &types.AttributeValueMemberS{Value: user.UserID},
					"provider":  &types.AttributeValueMemberS{Value: provider},
					"createdAt": &types.AttributeValueMemberS{Value: now},
				},
				ConditionExpression: stringPtr("attribute_not_exists(identity)"),
			}},
		},
	})
	return err
}

func stringPtr(s string) *string {
	return &s
}

func int32Ptr(i int32) *int32 {
	return &i
}

func createWebNotification(ctx context.Context, userID, notifType, title, message, gameID, gameName, fromUserID, fromUserName string) error {
	now := time.Now()
	expiresAt := now.AddDate(0, 0, 30)

	notification := map[string]interface{}{
		"notificationId": fmt.Sprintf("INV-%d-%s", now.Unix(), userID[:8]),
		"userId":         userID,
		"type":           notifType,
		"title":          title,
		"message":        message,
		"isRead":         false,
		"createdAt":      now.Unix(),
		"expiresAt":      expiresAt.Unix(),
	}

	if gameID != "" {
		notification["gameId"] = gameID
	}
	if gameName != "" {
		notification["gameName"] = gameName
	}
	if fromUserID != "" {
		notification["fromUserId"] = fromUserID
	}
	if fromUserName != "" {
		notification["fromUserName"] = fromUserName
	}

	item, err := attributevalue.MarshalMap(notification)
	if err != nil {
		log.Printf("Failed to marshal notification: %v", err)
		return err
	}

	tableName := db.cfg.TablePrefix + "Notifications"
	_, err = db.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	if err != nil {
		log.Printf("Failed to save notification: %v", err)
		return err
	}

	return nil
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	if db != nil && db.client != nil {
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "core", "app_register")
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
	var req RegisterRequest
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

	// Validate required fields
	if req.Email == "" || req.Password == "" || req.DisplayName == "" {
		response := Response{Success: false, Error: "Email, password, and display name are required"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// P2 修正: normalize email(小寫去空白)→ CheckEmailExists / user.Email / identity 全用同一正規化值，
	// 避免大小寫變體繞過唯一性(Codex P2 High)。
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	// Validate email format
	if !ValidateEmail(req.Email) {
		response := Response{Success: false, Error: "Invalid email format"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Validate password
	if err := ValidatePassword(req.Password); err != nil {
		response := Response{Success: false, Error: err.Error()}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// rate limit：防大量註冊（同 IP 每小時 10 次）。超限回 429。
	if ip := request.RequestContext.Identity.SourceIP; ip != "" {
		if allowed, _ := shared.CheckRateLimit(ctx, "register#ip#"+ip, 10, 3600); !allowed {
			response := Response{Success: false, Error: "嘗試次數過多，請稍後再試"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{StatusCode: http.StatusTooManyRequests, Headers: headers, Body: string(body)}, nil
		}
	}

	// Check if email already exists
	exists, err := db.CheckEmailExists(ctx, req.Email)
	if err != nil {
		log.Printf("Failed to check email existence: %v", err)
		response := Response{Success: false, Error: "Internal server error"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	if exists {
		response := Response{Success: false, Error: "Email already registered"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusConflict,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Generate user ID
	userID, err := GenerateUserID()
	if err != nil {
		log.Printf("Failed to generate user ID: %v", err)
		response := Response{Success: false, Error: "Internal server error"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Hash password
	passwordHash, err := HashPassword(req.Password)
	if err != nil {
		log.Printf("Failed to hash password: %v", err)
		response := Response{Success: false, Error: "Internal server error"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Extract version info from headers
	version := request.Headers["X-App-Version"]
	if version == "" {
		version = request.Headers["x-app-version"] // case-insensitive
	}
	platform := request.Headers["X-Platform"]
	if platform == "" {
		platform = request.Headers["x-platform"]
	}

	// 1. Get current invite reward config from AdminConfigs
	inviteLimit := 10 // default
	inviterPoints := 0
	inviteePoints := 0

	configTable := db.cfg.TablePrefix + "AdminConfigs"
	limitRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &configTable,
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteMaxUsage"},
		},
	})
	if err == nil && limitRes.Item != nil {
		if v, ok := limitRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			fmt.Sscanf(v.Value, "%d", &inviteLimit)
		}
	}

	inviterRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &configTable,
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviterPoints"},
		},
	})
	if err == nil && inviterRes.Item != nil {
		if v, ok := inviterRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			fmt.Sscanf(v.Value, "%d", &inviterPoints)
		}
	}

	inviteeRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &configTable,
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteePoints"},
		},
	})
	if err == nil && inviteeRes.Item != nil {
		if v, ok := inviteeRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			fmt.Sscanf(v.Value, "%d", &inviteePoints)
		}
	}

	// 2. Validate invite code if provided
	var inviterID string
	if req.InviteCode != "" {
		usersTable := db.cfg.TablePrefix + "Users"

		// Try exact match first (could be a LINE ID or full APP ID)
		inviterRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: &usersTable,
			Key: map[string]types.AttributeValue{
				"userId": &types.AttributeValueMemberS{Value: req.InviteCode},
			},
		})

		if err == nil && inviterRes.Item != nil {
			inviterID = req.InviteCode
		} else {
			// Try with APP_ prefix
			prefixedID := "APP_" + req.InviteCode
			inviterRes, err = db.client.GetItem(ctx, &dynamodb.GetItemInput{
				TableName: &usersTable,
				Key: map[string]types.AttributeValue{
					"userId": &types.AttributeValueMemberS{Value: prefixedID},
				},
			})

			if err == nil && inviterRes.Item != nil {
				inviterID = prefixedID
			}
		}

		if inviterID == "" {
			response := Response{Success: false, Error: "邀請碼無效"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}

		// Check invite limit
		inviteCountInput := &dynamodb.QueryInput{
			TableName:              &usersTable,
			IndexName:              stringPtr("invitedBy-index"),
			KeyConditionExpression: stringPtr("invitedBy = :v"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":v": &types.AttributeValueMemberS{Value: inviterID},
			},
			Select: types.SelectCount,
		}
		countRes, err := db.client.Query(ctx, inviteCountInput)
		if err != nil {
			log.Printf("Failed to check invite count: %v", err)
		} else if int(countRes.Count) >= inviteLimit {
			response := Response{Success: false, Error: "該邀請碼已達使用上限"}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    headers,
				Body:       string(body),
			}, nil
		}
	}

	// 3. Create new user
	now := time.Now()
	user := &User{
		UserID:            userID,
		DisplayName:       req.DisplayName,
		Email:             req.Email,
		PasswordHash:      passwordHash,
		AccountType:       "app",
		Gender:            req.Gender,
		AgeRange:          req.AgeRange,
		MahjongExperience: req.MahjongExperience,
		Points:            0,
		Rating:            5.0,
		IsVerified:        false,
		EmailVerified:     false,
		Stats: &UserStats{
			GamesHosted:        0,
			GamesJoined:        0,
			TotalRatings:       0,
			PositiveRatings:    0,
			PositiveRatingRate: 0.0,
		},
		GamesHosted: 0, // Deprecated but still needed for compatibility
		GamesJoined: 0, // Deprecated but still needed for compatibility
		Preferences: UserPreferences{
			NotifyNewGames:    true,
			NotifyGameUpdates: true,
		},
		AppVersion: version,
		Platform:   platform,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	// Set invite data if valid
	if inviterID != "" {
		user.InvitedBy = inviterID
		user.Points += inviteePoints
		user.InviteRewarded = true
	}

	// P2 修正(Codex High): 原子建立 user + 綁 email 身分 + identityCount=1（單一交易）。
	// AuthIdentities 的 attribute_not_exists(identity) 是 email 唯一性權威閘 → 大小寫變體/併發重複 → 409。
	emailIdentity := shared.IdentityKey(shared.ProviderPassword, user.Email)
	err = db.SaveUserWithIdentity(ctx, user, emailIdentity, shared.ProviderPassword)
	if err != nil {
		var tce *types.TransactionCanceledException
		if errors.As(err, &tce) && len(tce.CancellationReasons) == 2 {
			if r := tce.CancellationReasons[1].Code; r != nil && *r == "ConditionalCheckFailed" {
				// idx1: email#identity 已存在 → 此信箱已被註冊
				log.Printf("register conflict email=%s: %v", user.Email, err)
				response := Response{Success: false, Error: "此信箱已被註冊"}
				body, _ := json.Marshal(response)
				return events.APIGatewayProxyResponse{StatusCode: http.StatusConflict, Headers: headers, Body: string(body)}, nil
			}
			// idx0: userId 撞號（隨機 APP_ id，近乎不可能）→ 當成內部錯誤
		}
		log.Printf("Failed to save user: %v", err)
		response := Response{Success: false, Error: "Failed to create user"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 寄認證信（非致命：失敗僅記錄，認證信可日後補寄；身分已於上方交易綁定）。
	if rawTok, tokErr := shared.IssueToken(ctx, user.UserID, shared.PurposeVerifyEmail, shared.TTLVerifyEmail); tokErr != nil {
		log.Printf("[register] 產認證 token 失敗 user=%s: %v", user.UserID, tokErr)
	} else if mailErr := shared.SendVerifyEmail(ctx, user.Email, rawTok); mailErr != nil {
		log.Printf("[register] 寄認證信失敗 user=%s: %v", user.UserID, mailErr)
	}

	// 3.5 Record Invitee Point Log (Shadow)
	// Since the user was just created with points, we only log the event
	if inviterID != "" && inviteePoints > 0 {
		go func() {
			logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			meta := map[string]interface{}{
				"inviterId": inviterID,
			}
			shared.RecordPointChangeShadow(logCtx, db.client, db.cfg.TablePrefix, user.UserID, inviteePoints, shared.PointTypeCredit, 0, inviteePoints, "註冊邀請獎勵", "app_register", meta)
		}()
	}

	// 4. Reward inviter and send notifications
	if inviterID != "" {
		// Award points to inviter using shared helper
		meta := map[string]interface{}{
			"inviteeId": user.UserID,
		}
		_, err = shared.UpdateUserPoints(ctx, db.client, db.cfg.TablePrefix, inviterID, inviterPoints, "成功邀請好友註冊", "app_register", meta)
		if err != nil {
			log.Printf("Failed to reward inviter %s: %v", inviterID, err)
		}

		// Initialize push service
		pushService, _ := shared.NewPushNotificationService()

		// Notify Inviter
		inviterNotifTitle := "獲得邀請獎勵！"
		inviterNotifMsg := fmt.Sprintf("%s 已使用您的邀請碼註冊，您獲得了 %d 點！", user.DisplayName, inviterPoints)
		createWebNotification(ctx, inviterID, "invite_reward", inviterNotifTitle, inviterNotifMsg, "", "", "", "")
		if pushService != nil {
			pushService.SendPushNotificationToUser(ctx, inviterID, inviterNotifTitle, inviterNotifMsg, map[string]interface{}{"type": "invite_reward"})
		}

		// Notify Invitee
		inviteeNotifTitle := "歡迎加入！"
		inviteeNotifMsg := fmt.Sprintf("使用邀請碼註冊成功，您獲得了 %d 點獎勵！", inviteePoints)
		createWebNotification(ctx, user.UserID, "invite_reward", inviteeNotifTitle, inviteeNotifMsg, "", "", "", "")
		if pushService != nil {
			pushService.SendPushNotificationToUser(ctx, user.UserID, inviteeNotifTitle, inviteeNotifMsg, map[string]interface{}{"type": "invite_reward"})
		}
	}

	// Return success response (不包含密碼)
	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"userId":            user.UserID,
			"displayName":       user.DisplayName,
			"email":             user.Email,
			"accountType":       user.AccountType,
			"gender":            user.Gender,
			"ageRange":          user.AgeRange,
			"mahjongExperience": user.MahjongExperience,
			"points":            user.Points,
			"rating":            user.Rating,
			"isVerified":        user.IsVerified,
			"emailVerified":     user.EmailVerified,
			"createdAt":         user.CreatedAt,
			"invitedBy":         user.InvitedBy,
		},
	}

	// Generate JWT Token
	token, err := shared.GenerateToken(user.UserID, user.Email)
	if err != nil {
		log.Printf("Failed to generate JWT token: %v", err)
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
