package main

// 帳號系統 — Google 登入/註冊/合併（AUTH_SYSTEM_DESIGN §5.B/§5.F）。
// POST {"idToken":"..."} → 後端驗 Google ID token → 依 google#sub 分流:
//   ① 已綁 google 身分 → 登入
//   ② 未綁、但 email 已由 Google 驗證且命中既有帳號 → 自動合併(掛 google 鑰匙到既有帳號)
//   ③ 皆無 → 建新帳號(emailVerified=true，因 Google 已驗信箱)
// 一律以驗證後 payload 的 sub/email 為準，絕不信前端欄位。

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

type googleRequest struct {
	IDToken string `json:"idToken"`
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

// respondAuth：發 JWT 並回 200。mode = login | merged | signup（供前端/除錯）。
func respondAuth(headers map[string]string, uid, email, mode string) events.APIGatewayProxyResponse {
	token, err := shared.GenerateToken(uid, email)
	if err != nil {
		log.Printf("GenerateToken failed for %s: %v", uid, err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"})
	}
	return jsonResp(headers, http.StatusOK, map[string]interface{}{
		"success": true, "token": token, "userId": uid, "mode": mode,
	})
}

// createGoogleUser：原子建立 Google 新帳號 + 綁 google 身分 + identityCount=1（單一交易）。
// emailVerified 依 Google claim 帶入（Codex P4 High：不可無條件 true，否則 email 未驗證/空也繞過軟門檻）。
func createGoogleUser(ctx context.Context, uid, email, name, identity string, emailVerified bool) error {
	now := time.Now().Format(time.RFC3339)
	userItem := map[string]types.AttributeValue{
		"userId":        &types.AttributeValueMemberS{Value: uid},
		"displayName":   &types.AttributeValueMemberS{Value: name},
		"accountType":   &types.AttributeValueMemberS{Value: "app"},
		"points":        &types.AttributeValueMemberN{Value: "0"},
		"rating":        &types.AttributeValueMemberN{Value: "5"},
		"isVerified":    &types.AttributeValueMemberBOOL{Value: false},
		"emailVerified": &types.AttributeValueMemberBOOL{Value: emailVerified},
		"identityCount": &types.AttributeValueMemberN{Value: "1"},
		"createdAt":     &types.AttributeValueMemberS{Value: now},
		"updatedAt":     &types.AttributeValueMemberS{Value: now},
	}
	if email != "" {
		userItem["email"] = &types.AttributeValueMemberS{Value: email}
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
					"provider":  &types.AttributeValueMemberS{Value: shared.ProviderGoogle},
					"createdAt": &types.AttributeValueMemberS{Value: now},
				},
				ConditionExpression: aws.String("attribute_not_exists(identity)"),
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

	var req googleRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil || req.IDToken == "" {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "missing idToken"}), nil
	}

	// 後端驗 Google ID token（簽章/aud/iss/exp）。
	g, err := shared.VerifyGoogleIDToken(ctx, req.IDToken)
	if err != nil {
		log.Printf("VerifyGoogleIDToken failed: %v", err)
		return jsonResp(headers, http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "invalid google token"}), nil
	}
	identity := shared.GoogleIdentityKey(g.Sub)

	// ① 已綁 google 身分 → 登入
	if uid, rerr := shared.ResolveIdentity(ctx, identity); rerr == nil && uid != "" {
		return respondAuth(headers, uid, g.Email, "login"), nil
	}

	// ② email 已驗證且命中既有帳號 → 自動合併(掛 google 鑰匙到既有帳號)
	if g.EmailVerified && g.Email != "" {
		if existing, rerr := shared.ResolveEmailToUserID(ctx, g.Email); rerr == nil && existing != "" {
			if berr := shared.BindIdentity(ctx, identity, existing, shared.ProviderGoogle); berr != nil {
				if errors.Is(berr, shared.ErrIdentityTaken) {
					// 競態:剛被別處綁上 → 重解析登入
					if u2, _ := shared.ResolveIdentity(ctx, identity); u2 != "" {
						return respondAuth(headers, u2, g.Email, "login"), nil
					}
				}
				log.Printf("merge BindIdentity failed for %s: %v", existing, berr)
				return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
			}
			// Google 已驗證此 email(進入此分支的前提) → 把既有帳號標 emailVerified，免被軟門檻誤擋(Codex P4 Medium)。
			// 非致命:合併已成功,驗證旗標 best-effort。
			markNow := time.Now().Format(time.RFC3339)
			if _, uerr := ddb.UpdateItem(ctx, &dynamodb.UpdateItemInput{
				TableName:                 aws.String(tablePrefix + "Users"),
				Key:                       map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: existing}},
				UpdateExpression:          aws.String("SET emailVerified = :t, updatedAt = :now"),
				ConditionExpression:       aws.String("attribute_exists(userId)"),
				ExpressionAttributeValues: map[string]types.AttributeValue{":t": &types.AttributeValueMemberBOOL{Value: true}, ":now": &types.AttributeValueMemberS{Value: markNow}},
			}); uerr != nil {
				log.Printf("merge: mark emailVerified failed for %s: %v", existing, uerr)
			}
			return respondAuth(headers, existing, g.Email, "merged"), nil
		}
	}

	// ③ 全新帳號
	uid, err := genUserID()
	if err != nil {
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}
	name := g.Name
	if name == "" {
		name = "麻友"
	}
	if err := createGoogleUser(ctx, uid, g.Email, name, identity, g.EmailVerified && g.Email != ""); err != nil {
		var tce *types.TransactionCanceledException
		if errors.As(err, &tce) {
			// google 身分被搶(競態) → 重解析登入
			if u2, _ := shared.ResolveIdentity(ctx, identity); u2 != "" {
				return respondAuth(headers, u2, g.Email, "login"), nil
			}
		}
		log.Printf("createGoogleUser failed: %v", err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}
	return respondAuth(headers, uid, g.Email, "signup"), nil
}

func main() {
	lambda.Start(Handler)
}
