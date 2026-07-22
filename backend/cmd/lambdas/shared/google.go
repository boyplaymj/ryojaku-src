package shared

// 帳號系統 — Google ID token 後端驗證（AUTH_SYSTEM_DESIGN §5.B/§5.E/§5.F）。
// 用官方 idtoken.Validate 做本地 JWKS 驗證：自動檢查簽章 / aud=GOOGLE_CLIENT_ID / iss(accounts.google.com) / exp。
// 絕不只信前端傳來的欄位——一律以驗證後 payload 的 sub / email 為準。

import (
	"context"
	"errors"
	"os"
	"strings"

	"google.golang.org/api/idtoken"
)

// GoogleIdentity：驗證通過的 Google 身分。
type GoogleIdentity struct {
	Sub           string // Google 帳號唯一 id（穩定，綁定用）
	Email         string // 已 lower/trim
	EmailVerified bool
	Name          string
}

// ErrGoogleClientNotConfigured：未設 GOOGLE_CLIENT_ID（fail-closed）。
var ErrGoogleClientNotConfigured = errors.New("GOOGLE_CLIENT_ID not configured")

// VerifyGoogleIDToken：驗 Google ID token，回驗證後的身分。任何驗證失敗回 err。
func VerifyGoogleIDToken(ctx context.Context, rawIDToken string) (*GoogleIdentity, error) {
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	if clientID == "" {
		return nil, ErrGoogleClientNotConfigured
	}
	payload, err := idtoken.Validate(ctx, rawIDToken, clientID)
	if err != nil {
		return nil, err
	}
	g := &GoogleIdentity{Sub: payload.Subject}
	if v, ok := payload.Claims["email"].(string); ok {
		g.Email = strings.ToLower(strings.TrimSpace(v))
	}
	if v, ok := payload.Claims["email_verified"].(bool); ok {
		g.EmailVerified = v
	}
	if v, ok := payload.Claims["name"].(string); ok {
		g.Name = v
	}
	return g, nil
}

// GoogleIdentityKey：google#<sub>。
func GoogleIdentityKey(sub string) string { return IdentityKey(ProviderGoogle, sub) }
