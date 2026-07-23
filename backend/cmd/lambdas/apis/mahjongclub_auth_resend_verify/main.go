package main

// 帳號系統 — 重寄認證信（AUTH_SYSTEM_DESIGN / BUILD_PLAN 6.5）。
// POST {"email":"..."} → 若帳號存在則重新 IssueToken(verify_email)+SendVerifyEmail。
// 防帳號枚舉：無論存不存在、內部成敗，一律回同一句 200。
// 用途:①verify token 過期/燒毀後重取 ②既有 LINE/legacy 帳號日後要走 email 門檻時補驗。

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

type resendRequest struct {
	Email string `json:"email"`
}

func genericResponse(headers map[string]string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"message": "若此信箱已註冊，我們已把驗證信寄到你的信箱",
	})
	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: string(body)}
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}
	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: ""}, nil
	}

	// rate limit：同信箱重寄認證信節流，防寄信轟炸（每小時 5 次）。
	if ip := request.RequestContext.Identity.SourceIP; ip != "" {
		if allowed, _ := shared.CheckRateLimit(ctx, "resend#ip#"+ip, 20, 3600); !allowed {
			return genericResponse(headers), nil
		}
	}

	var req resendRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return genericResponse(headers), nil
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		return genericResponse(headers), nil
	}
	if allowed, _ := shared.CheckRateLimit(ctx, "resend#email#"+email, 5, 3600); !allowed {
		return genericResponse(headers), nil
	}

	uid, err := shared.ResolveEmailToUserID(ctx, req.Email)
	if err != nil {
		log.Printf("ResolveEmailToUserID failed: %v", err)
		return genericResponse(headers), nil
	}
	if uid != "" {
		if raw, tErr := shared.IssueToken(ctx, uid, shared.PurposeVerifyEmail, shared.TTLVerifyEmail); tErr != nil {
			log.Printf("IssueToken(verify) failed for %s: %v", uid, tErr)
		} else if mErr := shared.SendVerifyEmail(ctx, email, raw); mErr != nil {
			log.Printf("SendVerifyEmail failed for %s: %v", uid, mErr)
		}
	}
	return genericResponse(headers), nil
}

func main() {
	lambda.Start(Handler)
}
