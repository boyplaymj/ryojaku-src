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

// maintenanceCheck 以 package 級變數注入，讓測試能在不打 DDB 的情況下覆寫。
// 生產上永遠是 shared.IsMaintenanceMode（讀取失敗 fail-open，見 shared/maintenance.go）。
var maintenanceCheck = shared.IsMaintenanceMode

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

// deny 回 Deny policy → API Gateway 對外 403（不是 401）。目前只有維護模式走這條。
//
// 🔴 403 是刻意挑的，不是隨手選的狀態碼。維護模式若沿用 errUnauthorized（401），
// App 端 frontend/services/apiService.ts 會把「非 auth 端點的 401」一律當成 session
// 過期，清掉 JWT / USER / AUTH_TYPE / LINE_ID 四個 localStorage key 並強制 reload
// ⇒ 拉一次 kill switch 等於把所有線上使用者永久登出，而且維護結束也不會回來。
// 那會讓一個本該可逆的緊急煞車，變成不可逆的破壞 —— 代價比它要解決的問題還大。
// 403 落在該檔「不清 session」的一般錯誤分支，維護結束後使用者重整即可繼續用。
//
// ⚠️ 真正的驗證失敗（缺 token / 無效 / 已撤銷）仍走 errUnauthorized 回 401：
// 那些情境「清掉本機憑證」正是對的行為，不要看到 401 就一起改掉。
func deny(methodArn string) events.APIGatewayCustomAuthorizerResponse {
	return events.APIGatewayCustomAuthorizerResponse{
		// PrincipalID 不可為空：API Gateway 對空 principal 會回 500，policy 根本不會被套用。
		PrincipalID: "maintenance",
		PolicyDocument: events.APIGatewayCustomAuthorizerPolicy{
			Version: "2012-10-17",
			Statement: []events.IAMPolicyStatement{{
				Action:   []string{"execute-api:Invoke"},
				Effect:   "Deny",
				Resource: []string{methodArn},
			}},
		},
	}
}

func Handler(ctx context.Context, ev events.APIGatewayCustomAuthorizerRequestTypeRequest) (events.APIGatewayCustomAuthorizerResponse, error) {
	// kill switch 擺在最前面（取 token 之前）：封鎖語意是無條件的 —— 不看你是誰、
	// token 對不對，開了就是擋；而且擺這裡的話，就算 Users 表正在抖（token 驗證
	// 那條 fail-closed 的路正在故障），封鎖也照樣鎖得住。
	// 管理員豁免不在這裡做：admin API 走另一顆 authorizer，天然不經過本函式。
	if maintenanceCheck(ctx) {
		log.Printf("[AUTHZ] 拒絕：維護模式（kill switch）開啟, arn=%s", ev.MethodArn)
		// 回 Deny（403）而不是 errUnauthorized（401）—— 理由見 deny() 的註解，
		// 一句話版：401 會讓 App 端把所有人的登入態刪掉。
		return deny(ev.MethodArn), nil
	}

	token := extractBearer(ev.Headers)

	// WebSocket 專用退路：瀏覽器的 WebSocket API 無法自訂 header，token 只能走 query string。
	// 這條退路不會削弱 REST / HTTP API：那兩者的 Identity 設為 Headers:[Authorization]，
	// 缺 header 時 API Gateway 會在「還沒叫到本函式」之前就回 401，故走不到這裡。
	// 代價：token 會出現在 WS 連線 URL → 可能被 API Gateway 存取日誌記下。
	// 日後強化方向是改發短效 WS ticket（見 SECURITY_AUTH_BYPASS.md）。
	if token == "" && ev.QueryStringParameters != nil {
		token = strings.TrimSpace(ev.QueryStringParameters["token"])
	}

	if token == "" {
		log.Printf("[AUTHZ] 拒絕：缺少 token, arn=%s", ev.MethodArn)
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
