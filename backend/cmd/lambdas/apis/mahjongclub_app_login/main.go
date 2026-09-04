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

// ── 登入限流（稽核 finding 5，2026-09-04）──────────────────────────────
// SECURITY_AUDIT_2026-09-03.md §6：login 是 auth 家族裡唯一「per-IP 與 per-帳號
// 上限都沒有」的端點。既有那把 login#<email>#<IP> 是**複合** key，兩邊都不是：
//   - 不是 per-帳號：攻擊者有 N 個 IP ⇒ 對同一帳號可試 10×N 次。
//   - 不是 per-IP：同一 IP 對**每個**帳號各有 10 次額度
//     ⇒ 單一 IP 的憑證填充（credential stuffing）總量完全沒有上限。
//
// 下面補的三個桶**只計失敗**：認證前 PeekRateLimit（只讀不加一），認證失敗才
// CheckRateLimit 加一 ⇒ 正常使用者的成功登入不扣額度。既有那把是成敗都計
// （15 分鐘內同 IP 登入 10 次也會被擋），那個毛病刻意不複製過來。
//
// ⚠️ 已接受的取捨：loginFailEmail 這桶帶帳號鎖定 DoS —— 攻擊者可故意打錯密碼
// 燒光受害者的登入額度，上限一小時（窗口結束自動恢復）。20/hr 是在「擋得住
// 暴力破解」與「真人打錯密碼不會被鎖」之間挑的。
const (
	loginFailIPLimit      = 50 // 同 IP 的失敗總量：擋單一 IP 的憑證填充
	loginFailIPWindow     = 3600
	loginFailEmailLimit   = 20 // 同帳號跨 IP 的失敗總量：擋分散式暴力破解
	loginFailEmailWindow  = 3600
	loginFailLineIPLimit  = 50 // LINE 密文登入分支：同 IP 的失敗總量
	loginFailLineIPWindow = 3600

	// 🔴 併發突發閘（2026-09-04 補，Codex 覆驗 TOCTOU）。
	// 上面那三個桶是「peek → 認證 → 失敗才加一」，peek 與加一之間隔著 DB 查詢與
	// bcrypt ⇒ **它們不是硬上限**：同一瞬間湧入的請求全都在 count=0 時通過 peek，
	// 之後才一起把計數加上去。實測 300 併發（同 IP、每次不同 email）有 239 次
	// 通過閘門，而宣稱上限是 50。既有的複合桶攔不住它（每個 email 都是不同 key）。
	// ⇒ 這個桶用**原子**的 CheckRateLimit（先加一再判），成敗都計、窗口很短，
	//    作用是把「一瞬間能有多少請求同時在飛」壓住 ⇒ 上面那層的超出量因此有界。
	// 可證明的界線：每小時每 IP 的失敗嘗試 ≤ loginFailIPLimit + loginBurstLimit。
	// 短窗口是刻意的：它成敗都計，萬一誤傷（同 IP 大量真人同時登入）30 秒自己復原，
	// 不像小時級的桶會把人鎖一小時。
	loginBurstLimit  = 30
	loginBurstWindow = 30

	// 既有的複合 key（成敗都計）。抽成常數只為了讓下面那條命名空間分析可以被測試釘住，
	// 數值與行為一字未改。
	loginLegacyComboLimit  = 10
	loginLegacyComboWindow = 900
)

// 三個桶的 key，與 auth 家族其它端點對齊（forgot#ip# / resend#ip# / register#ip# …）。
//
// 🔴 命名空間重疊分析（不要刪這段）：normEmail 若字面上等於 "ip"，既有複合 key
// 會長成 login#ip#<IP>，與 loginFailIPKey 產出**同形**。兩者不會真的撞在一起，
// 靠的是 shared 那層併上的桶號不同（桶號＝now/window，既有 900 vs 這裡 3600）。
// ⇒ 這個保護**依賴兩個窗口值不相等**，不是靠 key 本身不同。哪天有人把既有那把
// 也調成 3600，兩個桶就會共用計數。TestLoginFailKeys_LegacyCollisionOnlyBlockedByWindow
// 釘住這件事。
func loginFailIPKey(ip string) string       { return "login#ip#" + ip }
func loginFailEmailKey(email string) string { return "login#email#" + email }
func loginFailLineIPKey(ip string) string   { return "login#lineip#" + ip }

// 突發閘的 key。密碼登入與 LINE 登入**各自一個**，理由同 recordLineLoginFailure：
// 共用的話，一個重送過期密文的壞掉 client 會把同 IP 的密碼登入一起擋掉。
func loginBurstKey(ip string) string     { return "login#burst#" + ip }
func loginLineBurstKey(ip string) string { return "login#lineburst#" + ip }

// legacyComboKey：既有那把複合 key 的組法（原本是內嵌字串串接，抽出來讓上面那段
// 分析可以被測試實際求值，而不是只寫在註解裡）。
func legacyComboKey(normEmail, ip string) string { return "login#" + normEmail + "#" + ip }

// tooManyLoginAttempts：三道閘共用**同一個** 429 回應。
// 刻意讓「IP 超限」「帳號超限」「既有複合 key 超限」回完全相同的訊息與狀態碼 ——
// 有差別的話，429 的形狀本身就變成「這個帳號存不存在／正在被打」的側信道。
func tooManyLoginAttempts(headers map[string]string) events.APIGatewayProxyResponse {
	response := Response{Success: false, Error: "嘗試次數過多，請稍後再試"}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{StatusCode: http.StatusTooManyRequests, Headers: headers, Body: string(body)}
}

// recordEmailLoginFailure：Email 登入**失敗**才加一。
// 🔴 user-not-found 與密碼錯誤**都要計**。只計密碼錯誤的話，額度消耗速度會隨
// 「帳號存不存在」而不同 ⇒ 429 出現的時機變成帳號枚舉的差別訊號。
// 回傳值刻意丟棄：這裡只負責記帳，擋不擋由下一次請求的 Peek 決定。
func recordEmailLoginFailure(ctx context.Context, ip, normEmail string) {
	if ip != "" {
		_, _ = shared.CheckRateLimit(ctx, loginFailIPKey(ip), loginFailIPLimit, loginFailIPWindow)
	}
	_, _ = shared.CheckRateLimit(ctx, loginFailEmailKey(normEmail), loginFailEmailLimit, loginFailEmailWindow)
}

// recordLineLoginFailure：LINE 密文登入失敗才加一。
// 刻意用**獨立**的桶，不與密碼登入共用：共用的話，一個重送過期密文的壞掉 client
// 會把同 IP 的密碼登入一起鎖死。
func recordLineLoginFailure(ctx context.Context, ip string) {
	if ip == "" {
		return
	}
	_, _ = shared.CheckRateLimit(ctx, loginFailLineIPKey(ip), loginFailLineIPLimit, loginFailLineIPWindow)
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

	// SourceIP 提前取出：三個限流桶與既有複合 key 都用它，避免兩處各取一次而漂開。
	ip := request.RequestContext.Identity.SourceIP

	// 方式 1: 使用 Email + Password 登入（P2: AuthIdentities 優先 + email-index fallback）
	if req.Email != "" && req.Password != "" {
		// normEmail 只給限流 key：避免大小寫/空白變體落不同 bucket 繞過限流(Codex P6 High)。
		// ⚠️ 不可改動 req.Email 本身——登入查詢的 email-index fallback 需保留「原輸入精確比對」語意，
		//    否則 mixed-case 且未 backfill AuthIdentities 的 13k legacy 帳號會查不到(Codex P6 回歸)。
		normEmail := strings.ToLower(strings.TrimSpace(req.Email))
		// ⓪ 併發突發閘：**原子**（先加一再判），成敗都計，30 秒窗口。
		//    一定要排在最前面 —— 它的職責是限制「同時有多少請求走到下面那兩道 peek」，
		//    排在後面就限制不到已經在飛的那些。
		if ip != "" {
			if allowed, _ := shared.CheckRateLimit(ctx, loginBurstKey(ip), loginBurstLimit, loginBurstWindow); !allowed {
				return tooManyLoginAttempts(headers), nil
			}
		}
		// ① 只計失敗的兩道閘（finding 5）：認證前只 peek，不加一 ⇒ 成功登入不扣額度。
		//    一定要排在 DB 查詢與 bcrypt 之前，否則閘門擋不到它要擋的那份成本。
		//    IP 為空時跳過 per-IP 桶 —— 不跳的話所有無 IP 請求會共用 "login#ip#" 一個桶。
		if ip != "" {
			if allowed, _ := shared.PeekRateLimit(ctx, loginFailIPKey(ip), loginFailIPLimit, loginFailIPWindow); !allowed {
				return tooManyLoginAttempts(headers), nil
			}
		}
		if allowed, _ := shared.PeekRateLimit(ctx, loginFailEmailKey(normEmail), loginFailEmailLimit, loginFailEmailWindow); !allowed {
			return tooManyLoginAttempts(headers), nil
		}
		// ② 既有的複合 key：同信箱+IP，15 分鐘 10 次，**成敗都計**（本次刻意不動）。
		if allowed, _ := shared.CheckRateLimit(ctx, legacyComboKey(normEmail, ip), loginLegacyComboLimit, loginLegacyComboWindow); !allowed {
			return tooManyLoginAttempts(headers), nil
		}
		user, err = db.getUserForEmailLogin(ctx, req.Email)
		if err != nil {
			log.Printf("User not found: %v", err)
			recordEmailLoginFailure(ctx, ip, normEmail)
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
			recordEmailLoginFailure(ctx, ip, normEmail)
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
		// finding 5：這條路原本完全沒有限流。用**獨立**的桶（見 recordLineLoginFailure）。
		if ip != "" {
			if allowed, _ := shared.CheckRateLimit(ctx, loginLineBurstKey(ip), loginBurstLimit, loginBurstWindow); !allowed {
				return tooManyLoginAttempts(headers), nil
			}
			if allowed, _ := shared.PeekRateLimit(ctx, loginFailLineIPKey(ip), loginFailLineIPLimit, loginFailLineIPWindow); !allowed {
				return tooManyLoginAttempts(headers), nil
			}
		}
		lineID, err := db.DecryptLineID(req.EncryptedLineID)
		if err != nil {
			log.Printf("Failed to decrypt LINE ID: %v", err)
			recordLineLoginFailure(ctx, ip)
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
			recordLineLoginFailure(ctx, ip)
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
