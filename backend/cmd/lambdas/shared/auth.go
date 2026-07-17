package shared

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang-jwt/jwt/v5"
)

// JWTClaims represents the claims in our JWT token
type JWTClaims struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// GetJWTSecret returns the JWT secret from environment variables
func GetJWTSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		// Default for development if not set, but should always be set in production
		return []byte("mahjong_club_default_secret_2025")
	}
	return []byte(secret)
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
	// 1. Try to get from Authorization Header
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		// Case-insensitive check
		authHeader = request.Headers["authorization"]
	}

	if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := VerifyToken(tokenString)
		if err == nil && claims != nil {
			fmt.Printf("[AUTH] Verified JWT for user: %s\n", claims.UserID)
			return claims.UserID, true
		}
		fmt.Printf("[AUTH] JWT provided but invalid: %v\n", err)
		// If JWT is invalid, we don't fall back, we should probably return error?
		// But in Phase 1, we might want to be more lenient.
		// Actually, if they sent a token and it's BAD, it's safer to reject.
		// However, the rule says Phase 1 should NOT impact.
		// Let's proceed to fallback if JWT verify fails in Phase 1.
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
