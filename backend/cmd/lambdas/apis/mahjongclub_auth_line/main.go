package main

// 帳號系統 — LINE 登入/註冊（AUTH_SYSTEM_DESIGN §5.B/§5.F）。
// POST {"idToken":"...","nonce":"（選填）"} → 後端呼叫 LINE verify 驗 id_token → 依 line#sub 分流：
//   ① 已綁 line 身分 → 登入
//   ② 沒有        → 建新帳號
//
// ⚠️ 與 auth_google 的差異：**不做 email 自動合併**。Google 那支敢合併，是因為 id_token 帶
//    `email_verified` 這個由 Google 背書的 claim；LINE 官方文件對 `email` 只寫「需 email scope」，
//    **沒有任何一句說它經過驗證**（已查 developers.line.biz/en/docs/line-login/verify-id-token/）。
//    拿沒背書的 email 去認領既有帳號 = 帳號接管漏洞。要把 LINE 掛到既有帳號，走 /auth/bind-line
//    （已登入狀態下綁，零認領糾紛）。
//
// ⚠️ LINE 回的 email 不寫進 Users.email（那是登入用的權威欄位），改存 lineEmail 當聯絡資訊。
//    連帶效果：LINE-only 帳號沒有 email 屬性 → 不受信箱軟門檻管轄，見 shared/authgate.go。

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/shared"
)

var ddb *dynamodb.Client
var tablePrefix string

func init() {
	region := getEnv("AWS_REGION", "ap-southeast-1")
	tablePrefix = getEnv("TABLE_PREFIX", "MahjongClub_")
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		log.Printf("Failed to load AWS config: %v", err)
	} else {
		ddb = dynamodb.NewFromConfig(cfg)
	}
}

func getEnv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type lineRequest struct {
	IDToken string `json:"idToken"`
	Nonce   string `json:"nonce"`
}

func genUserID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "APP_" + base64.URLEncoding.EncodeToString(b)[:16], nil
}

func jsonResp(headers map[string]string, code int, payload map[string]interface{}) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(payload)
	return events.APIGatewayProxyResponse{StatusCode: code, Headers: headers, Body: string(body)}
}

// respondAuth：發 JWT 並回 200。mode = login | signup（供前端/除錯）。
// email 傳空字串：LINE 帳號沒有權威 email，JWT 內不放未驗證的值。
func respondAuth(headers map[string]string, uid, mode string) events.APIGatewayProxyResponse {
	token, err := shared.GenerateToken(uid, "")
	if err != nil {
		log.Printf("GenerateToken failed for %s: %v", uid, err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"})
	}
	return jsonResp(headers, http.StatusOK, map[string]interface{}{
		"success": true, "token": token, "userId": uid, "mode": mode,
	})
}

// createLineUser：原子建立 LINE 新帳號 + 綁 line 身分 + identityCount=1（單一交易）。
// 不寫 email / emailVerified=false：見檔頭說明。
func createLineUser(ctx context.Context, uid, name, lineEmail, identity string) error {
	now := time.Now().Format(time.RFC3339)
	userItem := map[string]types.AttributeValue{
		"userId":        &types.AttributeValueMemberS{Value: uid},
		"displayName":   &types.AttributeValueMemberS{Value: name},
		"accountType":   &types.AttributeValueMemberS{Value: "app"},
		"points":        &types.AttributeValueMemberN{Value: "0"},
		"rating":        &types.AttributeValueMemberN{Value: "5"},
		"isVerified":    &types.AttributeValueMemberBOOL{Value: false},
		"emailVerified": &types.AttributeValueMemberBOOL{Value: false},
		"identityCount": &types.AttributeValueMemberN{Value: "1"},
		"createdAt":     &types.AttributeValueMemberS{Value: now},
		"updatedAt":     &types.AttributeValueMemberS{Value: now},
	}
	if lineEmail != "" {
		// 非權威、非登入用；只當聯絡資訊留存。刻意不叫 email。
		userItem["lineEmail"] = &types.AttributeValueMemberS{Value: lineEmail}
	}
	_, err := ddb.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{
				TableName:           aws.String(tablePrefix + "Users"),
				Item:                userItem,
				ConditionExpression: aws.String("attribute_not_exists(userId)"),
			}},
			{Put: &types.Put{
				TableName: aws.String(tablePrefix + "AuthIdentities"),
				Item: map[string]types.AttributeValue{
					"identity":  &types.AttributeValueMemberS{Value: identity},
					"userId":    &types.AttributeValueMemberS{Value: uid},
					"provider":  &types.AttributeValueMemberS{Value: shared.ProviderLine},
					"createdAt": &types.AttributeValueMemberS{Value: now},
				},
				// identity 是 DynamoDB 保留字 → 必須走 ExpressionAttributeNames 別名。
				ConditionExpression:      aws.String("attribute_not_exists(#identity)"),
				ExpressionAttributeNames: map[string]string{"#identity": "identity"},
			}},
		},
	})
	return err
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
	if ddb == nil {
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "service unavailable"}), nil
	}

	var req lineRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil || req.IDToken == "" {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "missing idToken"}), nil
	}

	// 限流：每次呼叫都會打 LINE 的 verify 端點（外部 API），比 Google 的本地 JWKS 驗證貴。
	// 同 IP 15 分鐘 30 次。fail-open（見 shared.CheckRateLimit）。
	if allowed, _ := shared.CheckRateLimit(ctx, "authline#ip#"+request.RequestContext.Identity.SourceIP, 30, 900); !allowed {
		return jsonResp(headers, http.StatusTooManyRequests, map[string]interface{}{"success": false, "error": "嘗試次數過多，請稍後再試"}), nil
	}

	// 後端驗 LINE id_token（簽章/aud/exp，另自驗 iss/aud/sub/exp/nonce）。
	li, err := shared.VerifyLINEIDToken(ctx, req.IDToken, req.Nonce)
	if err != nil {
		log.Printf("VerifyLINEIDToken failed: %v", err)
		return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "invalid line token"}), nil
	}
	identity := shared.LineIdentityKey(li.Sub)

	// ① 已綁 line 身分 → 登入
	if uid, rerr := shared.ResolveIdentity(ctx, identity); rerr == nil && uid != "" {
		return respondAuth(headers, uid, "login"), nil
	}

	// ② 全新帳號（刻意不做 email 合併，見檔頭）
	uid, err := genUserID()
	if err != nil {
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}
	name := li.Name
	if name == "" {
		name = "麻友"
	}
	if err := createLineUser(ctx, uid, name, li.Email, identity); err != nil {
		var tce *types.TransactionCanceledException
		if errors.As(err, &tce) {
			// line 身分被搶(競態) → 重解析登入
			if u2, _ := shared.ResolveIdentity(ctx, identity); u2 != "" {
				return respondAuth(headers, u2, "login"), nil
			}
		}
		log.Printf("createLineUser failed: %v", err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}
	return respondAuth(headers, uid, "signup"), nil
}

func main() {
	lambda.Start(Handler)
}
