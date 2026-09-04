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

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

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
	Gender            string          `dynamodbav:"gender,omitempty" json:"gender,omitempty"`
	AgeRange          string          `dynamodbav:"ageRange,omitempty" json:"ageRange,omitempty"`
	MahjongExperience string          `dynamodbav:"mahjongExperience,omitempty" json:"mahjongExperience,omitempty"`
	LineID            string          `dynamodbav:"lineId,omitempty" json:"lineId,omitempty"`
	Points            int             `dynamodbav:"points" json:"points"`
	Rating            float64         `dynamodbav:"rating" json:"rating"`
	Stats             *UserStats      `dynamodbav:"stats,omitempty" json:"stats,omitempty"`
	IsVerified        bool            `dynamodbav:"isVerified" json:"isVerified"`
	Preferences       UserPreferences `dynamodbav:"preferences" json:"preferences"`
	InvitedBy         string          `dynamodbav:"invitedBy,omitempty" json:"invitedBy,omitempty"`
	CreatedAt         string          `dynamodbav:"createdAt" json:"createdAt"`
}

// Response structure for API responses
type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
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

func (c *Config) GetTableName(tableName string) string {
	return c.TablePrefix + tableName
}

// DecryptLineID decrypts an encrypted LINE ID
func (d *Database) DecryptLineID(encryptedData string) (string, error) {
	if d.cfg.EncryptionKey == "" {
		return "", fmt.Errorf("encryption key not configured")
	}

	// Decode URL-safe base64
	combined, err := base64.URLEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	// Decode encryption key
	key, err := base64.StdEncoding.DecodeString(d.cfg.EncryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to decode encryption key: %w", err)
	}

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM mode
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	// Extract nonce and ciphertext
	nonceSize := gcm.NonceSize()
	if len(combined) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce := combined[:nonceSize]
	ciphertext := combined[nonceSize:]

	// Decrypt
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

// resolveTargetUserID decides which user this request is allowed to look up,
// and is the only place in this endpoint that makes that decision.
//
// It returns (userID, nil) when the lookup may proceed, or ("", response) when
// the request must be rejected. It deliberately does NOT touch DynamoDB — the
// whole point is that the auth reasoning is testable on its own, and this
// package had no tests at all when finding 2 was written.
//
// The two entries are not symmetric, and that asymmetry is the fix:
//   - userId= : must be a VERIFIED identity, and the token's identity is what
//     gets used. A caller can only ever look up themselves.
//   - lineID= : left as-is. It is the LINE login fallback, so there is no token
//     yet at that point; the ciphertext itself is the credential (it must
//     decrypt with the server key, which an enumerator cannot forge).
func (d *Database) resolveTargetUserID(request events.APIGatewayProxyRequest, headers map[string]string) (string, *events.APIGatewayProxyResponse) {
	// Get user ID - support both lineID (encrypted) and userId (APP_xxx) parameters
	var userID string
	var err error

	// Try to get userId parameter first (for APP users)
	userID = request.QueryStringParameters["userId"]

	// 🔴 2026-09-04：`userId=` 這條入口改為「必須是驗證過的身分」（finding 2，稽核報告 §3／§3b）。
	//
	// 07-30 這裡放的是一段「刻意只記錄、不改行為」的探針，保留理由是一句**推測**：
	// 「Android bundle 內含 loginWithLineId／verifyUser，線上跑的是工程師較舊的版本，
	//   外部舊 App／LINE bot 是否在用只能向工程師確認。」
	// 那句話撐著整個決定，而它從沒被量過。2026-09-04 量了（報告 §3b）：
	//
	//   - 本端點 log group 最後一筆事件停在 2026-07-30 20:43，而同環境的
	//     search-games／game-detail／app-login／user-info 在 09-02~09-03 都有流量（正控）
	//   - 而那唯一一筆就是我們自己的探針（userId="APP_zzz_not_real_zzz" ua="curl/8.17.0"）
	//   - 該 log group retentionInDays=None ⇒「沒有事件」是真的沒有，不是被清掉
	//   - 上架 App 打的就是這個環境（iOS bundle／android-debug.yml → ryojaku-api.boyplaymj.com
	//     → base-path mapping → 9mu0vajn38 stg，即上面那些 log group）
	//   - Users 表全表 7 人，100% APP_*／accountType=app，**零個 LINE Bot 帳號**
	//     ⇒ 07-30 擔心的「關掉會鎖死 LINE Bot 登入」，在這個環境上沒有對象
	//
	// ⚠️ 仍然量不到的那一塊：frontend/QUICK_START.md:15 另一個 base URL
	// （00pox0hvv4/prod）不在本 AWS 帳號，那邊的流量看不到。但它同樣**改不到** ——
	// 那個環境跑它自己的舊 binary，本次改動不會讓它變好或變壞 ⇒ 它不構成不修的理由。
	//
	// 手法與 user_info 相同：**不採信 query 的 userId，改用 token claims 裡的身分**。
	// 對合法呼叫（查自己）行為不變 —— 「查他人」從來就不是有效用法，只是 IDOR。
	//
	// 🔴 `lineID=` 那條入口一行不動：它是 authService.loginWithLineId 的 fallback
	// 登入路徑，呼叫當下還沒有 token，對它掛驗證會鎖死 LINE Bot 登入。
	// 收緊的只有「明文 userId 直查」這一條。
	if userID != "" {
		verifiedID, verified := shared.GetUserIdentifierWithTracking(request, "web_verify_user")
		if !verified {
			// 觀測用：留下來源特徵，用來判斷是否真的有舊客戶端在打這條。
			log.Printf("[AUTH][verify-user] 拒絕未驗證的 userId= 查詢 queryUserId=%q sourceIp=%s ua=%q",
				userID, request.RequestContext.Identity.SourceIP, request.Headers["User-Agent"])
			response := Response{Success: false, Error: "需要登入"}
			body, _ := json.Marshal(response)
			return "", &events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}
		}
		// 一律改用 token 裡的身分，query 的 ?userId= 不再被採用。
		userID = verifiedID
	}

	// If userId is not provided, try lineID (for LINE Bot users)
	if userID == "" {
		encryptedLineID := request.QueryStringParameters["lineID"]
		if encryptedLineID == "" {
			response := Response{
				Success: false,
				Error:   "Missing userId or lineID parameter",
			}
			body, _ := json.Marshal(response)
			return "", &events.APIGatewayProxyResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    headers,
				Body:       string(body),
			}
		}

		// Decrypt LINE ID
		userID, err = d.DecryptLineID(encryptedLineID)
		if err != nil {
			log.Printf("Failed to decrypt LINE ID: %v", err)
			response := Response{
				Success: false,
				Error:   "Failed to decrypt LINE ID",
			}
			body, _ := json.Marshal(response)
			return "", &events.APIGatewayProxyResponse{
				StatusCode: http.StatusUnauthorized,
				Headers:    headers,
				Body:       string(body),
			}
		}
	}

	return userID, nil
}

// GetUser retrieves a user from DynamoDB
func (d *Database) GetUser(ctx context.Context, userID string) (*User, error) {
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &[]string{d.cfg.GetTableName("Users")}[0],
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if result.Item == nil {
		return nil, nil
	}

	var user User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal user: %w", err)
	}

	return &user, nil
}

// GetInviteCount counts how many users this user has invited
func (d *Database) GetInviteCount(ctx context.Context, userID string) (int, error) {
	tableName := d.cfg.GetTableName("Users")
	result, err := d.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("invitedBy-index"),
		KeyConditionExpression: aws.String("invitedBy = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
		},
		Select: types.SelectCount,
	})

	if err != nil {
		return 0, err
	}

	return int(result.Count), nil
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	if db != nil && db.client != nil {
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "core", "verify_user")
	}

	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	// Enable CORS
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
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

	// Decide WHICH user this request is allowed to look up. All of the auth
	// reasoning lives in resolveTargetUserID so it can be tested without DynamoDB.
	userID, deny := db.resolveTargetUserID(request, headers)
	if deny != nil {
		return *deny, nil
	}

	// Get user from database
	user, err := db.GetUser(ctx, userID)
	if err != nil {
		log.Printf("Failed to get user: %v", err)
		response := Response{
			Success: false,
			Error:   "Failed to retrieve user",
		}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	if user == nil {
		response := Response{
			Success: false,
			Error:   "User not found",
		}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Return user data
	gamesHosted := 0
	gamesJoined := 0
	if user.Stats != nil {
		gamesHosted = user.Stats.GamesHosted
		gamesJoined = user.Stats.GamesJoined
	}

	// Calculate Invite Stats
	inviteCount, _ := db.GetInviteCount(ctx, userID)
	inviteLimit := 10 // default
	inviterPoints := "100"
	inviteePoints := "50"
	configTable := db.cfg.GetTableName("AdminConfigs")
	
	limitRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteMaxUsage"},
		},
	})
	if err == nil && limitRes.Item != nil {
		if v, ok := limitRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			fmt.Sscanf(v.Value, "%d", &inviteLimit)
		}
	}
	
	// Get points config
	inviterRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviterPoints"},
		},
	})
	if err == nil && inviterRes.Item != nil {
		if v, ok := inviterRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			inviterPoints = v.Value
		}
	}
	
	inviteeRes, err := db.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(configTable),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:InviteePoints"},
		},
	})
	if err == nil && inviteeRes.Item != nil {
		if v, ok := inviteeRes.Item["info_value"].(*types.AttributeValueMemberS); ok {
			inviteePoints = v.Value
		}
	}

	response := struct {
		Success bool        `json:"success"`
		Data    interface{} `json:"data,omitempty"`
		Error   string      `json:"error,omitempty"`
		InviterPoints string `json:"inviterPoints"`
		InviteePoints string `json:"inviteePoints"`
	}{
		Success: true,
		Data: map[string]interface{}{
			"userId":            user.UserID,
			"displayName":       user.DisplayName,
			"gender":            user.Gender,
			"ageRange":          user.AgeRange,
			"mahjongExperience": user.MahjongExperience,
			"lineId":            user.LineID,
			"points":            user.Points,
			"rating":            user.Rating,
			"gamesHosted":       gamesHosted,
			"gamesJoined":       gamesJoined,
			"stats":             user.Stats,
			"isVerified":        user.IsVerified,
			"preferences":       user.Preferences,
			"invitedBy":         user.InvitedBy,
			"inviteCount":       inviteCount,
			"inviteLimit":       inviteLimit,
			"createdAt":         user.CreatedAt,
		},
		InviterPoints: inviterPoints,
		InviteePoints: inviteePoints,
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
