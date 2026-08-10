package main

// 帳號系統 — 發 LINE Login 用的一次性 nonce（AUTH_SYSTEM_DESIGN §5.G）。
// POST（public，無需登入）→ {"success":true,"nonce":"...","expiresIn":300}
//
// 流程裡它是第一步：
//   ① 前端打這支拿 nonce
//   ② 帶進 LINE 授權請求 → LINE 把它烘進 id_token 的 nonce claim
//   ③ POST /auth/line 或 /auth/bind-line 帶回來 → 後端原子消耗（單次）
//
// 為什麼要有這一步：沒有伺服器端狀態的話，nonce 只是呼叫端自說自話的字串，
// 拿到別人 id_token 的人可以把裡面的 nonce 一起送上來、照樣通過。
// 有了「伺服器發、只能用一次」，同一張 id_token 重送第二次就會被擋。

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"mahjongclub-backend/cmd/lambdas/shared"
)

func jsonResp(headers map[string]string, code int, payload map[string]interface{}) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(payload)
	return events.APIGatewayProxyResponse{StatusCode: code, Headers: headers, Body: string(body)}
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
		// nonce 是一次性機密，任何一層都不該留副本。
		"Cache-Control": "no-store",
	}
	if request.HTTPMethod == http.MethodOptions {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: ""}, nil
	}

	// 這支不需要憑證就能寫一筆 AuthTokens → 沒有限流的話任何人都能無限灌表。
	// 同 IP 15 分鐘 60 次（比 /auth/line 的 30 次寬，因為正常流程「拿 nonce」
	// 一定發生在「送 id_token」之前，且使用者放棄授權時只會消耗前者）。
	if allowed, _ := shared.CheckRateLimit(ctx, "linenonce#ip#"+request.RequestContext.Identity.SourceIP, 60, 900); !allowed {
		return jsonResp(headers, http.StatusTooManyRequests, map[string]interface{}{"success": false, "error": "嘗試次數過多，請稍後再試"}), nil
	}

	nonce, err := shared.IssueLineNonce(ctx)
	if err != nil {
		// 發不出來就不要回一個假的 —— 前端拿到假 nonce 會在 LINE 授權完才失敗，
		// 使用者已經跳過一輪 LINE 畫面，錯誤點離根因很遠。
		log.Printf("IssueLineNonce failed: %v", err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}

	return jsonResp(headers, http.StatusOK, map[string]interface{}{
		"success":   true,
		"nonce":     nonce,
		"expiresIn": int(shared.TTLLineNonce.Seconds()),
	}), nil
}

func main() {
	lambda.Start(Handler)
}
