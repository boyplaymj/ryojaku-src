package main

// 帳號系統 — 綁定 LINE 到目前登入帳號（AUTH_SYSTEM_DESIGN §5.E）。
// POST（需登入，僅 JWT 身分）{"idToken":"...","nonce":"（選填）"} → 驗 LINE → BindIdentity(line#sub → 我的 userID)。
// 該 LINE 帳號已綁別帳號 → 409（attribute_not_exists 防搶綁，見 shared.BindIdentity）。
//
// 這支是 /auth/line **刻意不做 email 自動合併**的配套出口：要把 LINE 掛到既有帳號，
// 先用原本的方式登入，再在登入態下綁 —— 身分由 JWT 決定，不靠沒背書的 email 認領。

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
	Nonce   string `json:"nonce"`
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
	userID, fromJWT := shared.GetUserIdentifierWithContext(ctx, request)
	if !fromJWT || userID == "" {
		return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "unauthorized"}), nil
	}

	var req bindRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil || req.IDToken == "" {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "missing idToken"}), nil
	}

	li, err := shared.VerifyLINEIDToken(ctx, req.IDToken, req.Nonce)
	if err != nil {
		log.Printf("VerifyLINEIDToken failed: %v", err)
		return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "invalid line token"}), nil
	}

	identity := shared.LineIdentityKey(li.Sub)
	if err := shared.BindIdentity(ctx, identity, userID, shared.ProviderLine); err != nil {
		if errors.Is(err, shared.ErrIdentityTaken) {
			return jsonResp(headers, http.StatusConflict, map[string]interface{}{"success": false, "error": "此 LINE 帳號已綁定其他帳號"}), nil
		}
		if errors.Is(err, shared.ErrUserNotFound) {
			return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "unauthorized"}), nil
		}
		log.Printf("BindIdentity(line) failed for %s: %v", userID, err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}

	return jsonResp(headers, http.StatusOK, map[string]interface{}{"success": true}), nil
}

func main() {
	lambda.Start(Handler)
}
