package main

import (
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func signedToken(t *testing.T, claims jwt.MapClaims, secret string) string {
	t.Helper()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("SignedString failed: %v", err)
	}
	return token
}

func TestVerifyAdminTokenAllowsAdminRoles(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	token := signedToken(t, jwt.MapClaims{
		"sub":  "s2admin",
		"role": "super_admin",
		"exp":  time.Now().Add(time.Hour).Unix(),
	}, "test-secret")

	claims, err := verifyAdminToken(token)
	if err != nil {
		t.Fatalf("verifyAdminToken returned error: %v", err)
	}
	if claims["role"] != "super_admin" {
		t.Fatalf("role = %v, want super_admin", claims["role"])
	}
}

func TestVerifyAdminTokenRejectsUserTokenWithoutRole(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	token := signedToken(t, jwt.MapClaims{
		"userId": "APP_123",
		"email":  "user@example.com",
		"sub":    "APP_123",
		"exp":    time.Now().Add(time.Hour).Unix(),
	}, "test-secret")

	if _, err := verifyAdminToken(token); err == nil {
		t.Fatal("verifyAdminToken should reject token without role")
	}
}

func TestVerifyAdminTokenRejectsMissingSecret(t *testing.T) {
	old := os.Getenv("JWT_SECRET")
	t.Setenv("JWT_SECRET", "")
	if old == "" {
		os.Unsetenv("JWT_SECRET")
	}

	if _, err := verifyAdminToken("not-a-token"); err == nil {
		t.Fatal("verifyAdminToken should reject missing JWT_SECRET")
	}
}

func TestVerifyAdminTokenRejectsUnexpectedSigningMethod(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"sub":  "s2admin",
		"role": "super_admin",
		"exp":  time.Now().Add(time.Hour).Unix(),
	})
	tokenString, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("none SignedString failed: %v", err)
	}

	if _, err := verifyAdminToken(tokenString); err == nil {
		t.Fatal("verifyAdminToken should reject none alg")
	}
}
