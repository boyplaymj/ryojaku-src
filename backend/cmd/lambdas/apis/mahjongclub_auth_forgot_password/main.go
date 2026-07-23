package main

// 帳號系統 — 忘記密碼端點（AUTH_SYSTEM_DESIGN §5.C）。
// POST {"email":"..."} → 若帳號存在則 IssueToken(reset_password) + SendResetEmail。
// 防帳號枚舉：無論信箱存不存在、內部成功或失敗，一律回同一句 200 成功訊息。

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

// genericResponse：不管內部發生什麼，都回這一句（防帳號枚舉）。
func genericResponse(headers map[string]string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"message": "若此信箱已註冊，我們已寄出重設連結",
	})
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	var req forgotPasswordRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Invalid request body: %v", err)
		return genericResponse(headers), nil
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		// 空 / 明顯不是信箱 → 一樣回成功句，不洩漏。
		return genericResponse(headers), nil
	}

	// rate limit：防寄信轟炸（同 IP 20/hr、同信箱 5/hr）。超限一樣回成功句，不洩漏。
	if ip := request.RequestContext.Identity.SourceIP; ip != "" {
		if allowed, _ := shared.CheckRateLimit(ctx, "forgot#ip#"+ip, 20, 3600); !allowed {
			return genericResponse(headers), nil
		}
	}
	if allowed, _ := shared.CheckRateLimit(ctx, "forgot#email#"+email, 5, 3600); !allowed {
		return genericResponse(headers), nil
	}

	// AuthIdentities 優先 + email-index fallback（相容未 backfill 的既有 13k；能登入即能收重設信）。
	uid, err := shared.ResolveEmailToUserID(ctx, req.Email)
	if err != nil {
		log.Printf("ResolveEmailToUserID failed: %v", err)
		return genericResponse(headers), nil
	}

	if uid != "" {
		raw, err := shared.IssueToken(ctx, uid, shared.PurposeResetPassword, shared.TTLResetPassword)
		if err != nil {
			log.Printf("IssueToken failed for user %s: %v", uid, err)
			return genericResponse(headers), nil
		}
		if err := shared.SendResetEmail(ctx, email, raw); err != nil {
			log.Printf("SendResetEmail failed for user %s: %v", uid, err)
		}
	}

	return genericResponse(headers), nil
}

func main() {
	lambda.Start(Handler)
}
