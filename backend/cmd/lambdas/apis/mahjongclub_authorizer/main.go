package main

// 両雀 — API Gateway Lambda Authorizer（REQUEST type，payload format 1.0）。
//
// 為什麼要它：manifest 早就為每個端點標了 auth: public|user|admin，但直到 S1 之前
// 沒有任何東西在執行那個標記（CFN 模板 authorizer 數 = 0），34 個標記 auth:user 的端點
// 只有 5 個在程式內自行驗 JWT，其餘不帶 token 即可冒充任意用戶。
// 掛上本 authorizer 後，manifest 的標記才第一次成為「會被執行的規則」。
//
// 刻意選 payload format 1.0（而非 HTTP API 專屬的 2.0 simple response）：
// 1.0 的事件與回應格式在 REST API 與 HTTP API 之間一致，故 REST_V1 與 HTTP_V2
// 兩種 apiType 可共用這同一顆 Lambda，不必維護兩份驗證邏輯（=兩份可能不一致的安全碼）。
//
// 驗證一律走 shared.VerifyTokenWithUserPwGate，故自動繼承 pwChangedAt 撤銷語意：
// 改密碼／登出全裝置後，舊 token 在 authorizer 這層就被擋下，業務碼完全不會被叫到。

import (
	"context"
	"errors"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// errUnauthorized：訊息必須正好是 "Unauthorized"。
// API Gateway 的約定：authorizer 回這個 error → 對外 401；回 Deny policy → 403；
// 回其他 error → 500。我們要的是 401，故一律用它，不要換字。
var errUnauthorized = errors.New("Unauthorized")

// extractBearer 大小寫不敏感地取 Authorization header。
// REST API 原樣傳遞 header 名稱，HTTP API 則一律小寫，故兩個都要看。
func extractBearer(headers map[string]string) string {
	for k, v := range headers {
		if strings.EqualFold(k, "Authorization") {
			if len(v) > 7 && strings.EqualFold(v[:7], "Bearer ") {
				return strings.TrimSpace(v[7:])
			}
			return ""
		}
	}
	return ""
}

func allow(userID, email, methodArn string) events.APIGatewayCustomAuthorizerResponse {
	return events.APIGatewayCustomAuthorizerResponse{
		PrincipalID: userID,
		PolicyDocument: events.APIGatewayCustomAuthorizerPolicy{
			Version: "2012-10-17",
			Statement: []events.IAMPolicyStatement{{
				Action:   []string{"execute-api:Invoke"},
				Effect:   "Allow",
				Resource: []string{methodArn},
			}},
		},
		// 業務碼從這裡取「已驗證的 userId」，不再信任 query param / body 的 userId。
		// REST: request.RequestContext.Authorizer["userId"]
		Context: map[string]interface{}{
			"userId": userID,
			"email":  email,
		},
	}
}

func Handler(ctx context.Context, ev events.APIGatewayCustomAuthorizerRequestTypeRequest) (events.APIGatewayCustomAuthorizerResponse, error) {
	token := extractBearer(ev.Headers)
	if token == "" {
		log.Printf("[AUTHZ] 拒絕：缺少 Bearer token, arn=%s", ev.MethodArn)
		return events.APIGatewayCustomAuthorizerResponse{}, errUnauthorized
	}

	// fail-closed：驗簽失敗、pwChangedAt 撤銷、或 DDB 查詢失敗，一律拒絕。
	// DDB 抖動會讓帶 JWT 的請求全 401 —— 這是刻意的取捨，撤銷語意不可因故障被繞過。
	// 詳見 shared/auth.go VerifyTokenWithUserPwGate 的註解。
	claims, err := shared.VerifyTokenWithUserPwGate(ctx, token)
	if err != nil || claims == nil || claims.UserID == "" {
		log.Printf("[AUTHZ] 拒絕：token 無效或已撤銷: %v", err)
		return events.APIGatewayCustomAuthorizerResponse{}, errUnauthorized
	}

	log.Printf("[AUTHZ] 放行 user=%s", claims.UserID)
	return allow(claims.UserID, claims.Email, ev.MethodArn), nil
}

func main() {
	lambda.Start(Handler)
}
