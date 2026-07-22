package main

// 帳號系統 — 解綁登入方式（AUTH_SYSTEM_DESIGN §5.E）。
// POST（需登入，僅 JWT 身分）{"provider":"google"} → 刪掉該 provider 的登入身分。
// 守衛：不准解掉最後一把可登入鑰匙(shared.UnbindIdentity 原子檢查) → 409。

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

type unbindRequest struct {
	Provider string `json:"provider"`
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

	userID, fromJWT := shared.GetUserIdentifier(request)
	if !fromJWT || userID == "" {
		return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "unauthorized"}), nil
	}

	var req unbindRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "invalid request"}), nil
	}
	// 只允許解綁社群登入方式(google/line)；password 不走此端點。
	if req.Provider != shared.ProviderGoogle && req.Provider != shared.ProviderLine {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "unsupported provider"}), nil
	}

	identity, err := shared.FindIdentityByProvider(ctx, userID, req.Provider)
	if err != nil {
		log.Printf("FindIdentityByProvider failed for %s: %v", userID, err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}
	if identity == "" {
		return jsonResp(headers, http.StatusNotFound, map[string]interface{}{"success": false, "error": "此帳號未綁定該登入方式"}), nil
	}

	if err := shared.UnbindIdentity(ctx, identity, userID); err != nil {
		if errors.Is(err, shared.ErrLastIdentity) {
			return jsonResp(headers, http.StatusConflict, map[string]interface{}{"success": false, "error": "至少保留一種登入方式，無法解綁最後一把鑰匙"}), nil
		}
		if errors.Is(err, shared.ErrIdentityNotOwned) {
			return jsonResp(headers, http.StatusConflict, map[string]interface{}{"success": false, "error": "解綁失敗，請重試"}), nil
		}
		log.Printf("UnbindIdentity failed for %s: %v", userID, err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}

	return jsonResp(headers, http.StatusOK, map[string]interface{}{"success": true}), nil
}

func main() {
	lambda.Start(Handler)
}
