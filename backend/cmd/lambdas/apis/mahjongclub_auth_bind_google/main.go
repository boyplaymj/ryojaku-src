package main

// 帳號系統 — 綁定 Google 到目前登入帳號（AUTH_SYSTEM_DESIGN §5.E）。
// POST（需登入，僅 JWT 身分）{"idToken":"..."} → 驗 Google → BindIdentity(google#sub → 我的 userID)。
// 該 Google 已綁別帳號 → 409（attribute_not_exists 防搶綁，見 shared.BindIdentity）。

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type bindRequest struct {
	IDToken string `json:"idToken"`
}

func jsonResp(headers map[string]string, code int, payload map[string]interface{}) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(payload)
	return events.APIGatewayProxyResponse{StatusCode: code, Headers: headers, Body: string(body)}
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}
	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: ""}, nil
	}

	// 安全鐵律：只接受 JWT 身分。
	userID, fromJWT := shared.GetUserIdentifier(request)
	if !fromJWT || userID == "" {
		return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "unauthorized"}), nil
	}

	var req bindRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil || req.IDToken == "" {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "missing idToken"}), nil
	}

	g, err := shared.VerifyGoogleIDToken(ctx, req.IDToken)
	if err != nil {
		log.Printf("VerifyGoogleIDToken failed: %v", err)
		return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "invalid google token"}), nil
	}

	identity := shared.GoogleIdentityKey(g.Sub)
	if err := shared.BindIdentity(ctx, identity, userID, shared.ProviderGoogle); err != nil {
		if errors.Is(err, shared.ErrIdentityTaken) {
			return jsonResp(headers, http.StatusConflict, map[string]interface{}{"success": false, "error": "此 Google 帳號已綁定其他帳號"}), nil
		}
		if errors.Is(err, shared.ErrUserNotFound) {
			return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "unauthorized"}), nil
		}
		log.Printf("BindIdentity(google) failed for %s: %v", userID, err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}

	return jsonResp(headers, http.StatusOK, map[string]interface{}{"success": true}), nil
}

func main() {
	lambda.Start(Handler)
}
