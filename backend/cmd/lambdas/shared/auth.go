package shared

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

// JWTClaims represents the claims in our JWT token
type JWTClaims struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// GetJWTSecret returns the JWT secret from environment variables.
// 硬化(AUTH_SYSTEM_DESIGN §6.1)：移除寫死 fallback（已知字串=可偽造 token 的洞）。
// 未設 JWT_SECRET 一律 fail-closed（拒簽/拒驗）；本機開發可設 ALLOW_DEV_JWT_SECRET=true。
func GetJWTSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		if os.Getenv("ALLOW_DEV_JWT_SECRET") == "true" {
			return []byte("dev_only_insecure_secret_do_not_use_in_prod")
		}
		panic("JWT_SECRET not configured — refusing to sign/verify with a known default; set JWT_SECRET (or ALLOW_DEV_JWT_SECRET=true for local dev)")
	}
	return []byte(secret)
}

// TokenIssuedBefore：token 是否不晚於某時間點（pwChangedAt 版本閘用）。
//
// 判定用 iat <= cutoff（不是嚴格 <）。JWT iat 與 pwChangedAt 都只有「秒」精度，
// 若用嚴格 <，同一秒內簽發的 token 會鑽過閘活下來——而那正是「按下登出全裝置的當下
// 另一台裝置剛好登入」這個最該擋的情境。
// 安全性：不會誤殺自己人——寫 pwChangedAt 的三個端點(change/reset/logout-all)都不發
// token，發 token 的 register/google 都不寫 pwChangedAt，故無「同秒發了又撤」的自撞。
func TokenIssuedBefore(claims *JWTClaims, cutoff *time.Time) bool {
	if cutoff == nil || claims == nil || claims.IssuedAt == nil {
		return false
	}
	return !claims.IssuedAt.Time.After(*cutoff)
}

// VerifyTokenWithPwGate：VerifyToken + pwChangedAt 版本閘。
// 呼叫端已取得 user 時傳入其 pwChangedAt；token 早於 pwChangedAt → 視為已被改密碼撤銷。
// 用途：改密碼/重設密碼後令舊裝置 token 立即失效（「登出其他裝置」）。
func VerifyTokenWithPwGate(tokenString string, pwChangedAt *time.Time) (*JWTClaims, error) {
	claims, err := VerifyToken(tokenString)
	if err != nil {
		return nil, err
	}
	if TokenIssuedBefore(claims, pwChangedAt) {
		return nil, errors.New("token revoked by password change")
	}
	return claims, nil
}

func getUserPwChangedAt(ctx context.Context, userID string) (*time.Time, error) {
	c := getAuthDDBClient()
	if c == nil {
		return nil, ErrAuthDDBUnavailable
	}
	// ConsistentRead 必須開：DynamoDB 預設最終一致，剛寫完 pwChangedAt 的數百毫秒內
	// 可能讀到舊值而放行——而「撤銷後的第一個請求」正是這道閘唯一要擋的東西，
	// 在那個窗口失效等於整個機制失效。代價是該次讀取的 RRU 加倍（單筆投影，可忽略）。
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(usersTable()),
		Key:                  map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		ProjectionExpression: aws.String("userId, pwChangedAt"),
		ConsistentRead:       aws.Bool(true),
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil || len(out.Item) == 0 {
		return nil, errors.New("user not found")
	}
	if v, ok := out.Item["pwChangedAt"].(*types.AttributeValueMemberN); ok && v.Value != "" {
		sec, err := strconv.ParseInt(v.Value, 10, 64)
		if err != nil {
			return nil, err
		}
		t := time.Unix(sec, 0)
		return &t, nil
	}
	return nil, nil
}

// VerifyTokenWithUserPwGate：驗簽 + 讀該用戶 pwChangedAt 做版本閘。
//
// ⚠️ 取捨（刻意 fail-closed）：DDB 查詢失敗一律回 error → 呼叫端視為未授權。
// 好處是撤銷語意在任何故障下都不會被繞過；代價是 Users 表若抖動，所有帶 JWT 的請求
// 會一起 401（客戶端可能誤判成 token 失效而強制登出）。若日後要改善可用性，正解是
// 讓本函式回可分辨的錯誤型別、由端點對「暫時性故障」回 503 而非 401，
// 不要改成 fail-open。
// 成本：每個帶 JWT 的請求 +1 次 Users 單筆強一致讀。
func VerifyTokenWithUserPwGate(ctx context.Context, tokenString string) (*JWTClaims, error) {
	claims, err := VerifyToken(tokenString)
	if err != nil {
		return nil, err
	}
	pwChangedAt, err := getUserPwChangedAt(ctx, claims.UserID)
	if err != nil {
		return nil, err
	}
	if TokenIssuedBefore(claims, pwChangedAt) {
		return nil, errors.New("token revoked by password change")
	}
	return claims, nil
}

// GenerateToken generates a new JWT token for a user
func GenerateToken(userID string, email string) (string, error) {
	// Token expires in 30 days
	expirationTime := time.Now().Add(30 * 24 * time.Hour)

	claims := &JWTClaims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   userID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(GetJWTSecret())
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

// VerifyToken parses and verifies a JWT token
func VerifyToken(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return GetJWTSecret(), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// GetUserIdentifier extracts userId from JWT or Fallback to Query Params
// This is the core of Phase 1 Compatibility
func GetUserIdentifier(request events.APIGatewayProxyRequest) (string, bool) {
	return GetUserIdentifierWithContext(context.Background(), request)
}

// GetUserIdentifierWithContext extracts userId from JWT or falls back to query params.
// If a JWT is present, it must verify and pass the pwChangedAt gate; revoked/invalid
// tokens fail closed and never fall back to query params.
func GetUserIdentifierWithContext(ctx context.Context, request events.APIGatewayProxyRequest) (string, bool) {
	// 1. Try to get from Authorization Header
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		// Case-insensitive check
		authHeader = request.Headers["authorization"]
	}

	if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := VerifyTokenWithUserPwGate(ctx, tokenString)
		if err == nil && claims != nil {
			fmt.Printf("[AUTH] Verified JWT for user: %s\n", claims.UserID)
			return claims.UserID, true
		}
		fmt.Printf("[AUTH] JWT provided but invalid: %v\n", err)
		return "", false
	}

	// 2. Fallback to Query Parameters (Existing logic)
	userId := request.QueryStringParameters["userId"]
	if userId == "" {
		userId = request.QueryStringParameters["lineID"]
	}

	if userId != "" {
		fmt.Printf("[AUTH] Fallback to Query Param for user: %s\n", userId)
		return userId, false
	}

	return "", false
}
