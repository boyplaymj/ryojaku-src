// mahjongclub_admin_ruleset — 後台唯讀檢視：**現在下發給玩家的家規表是哪一份**（D5-e）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c
// GET /admin/voice-tai/ruleset（auth=admin）
//
// 🔴 **唯讀。這支沒有任何寫入路徑，也不會有。**
// §5c 紀律 1：DDB 那一列只有一條寫入入口 —— 播種腳本 seed_ruleset.py，
// 從 repo 的 fan_table.json 生成。A 案與 B 案的差別不在於有幾份實體
// （兩案都是兩份），而在於**有幾個寫入入口**。這一頁一旦能存，A 案就變成
// B 案而沒有 B 案的守衛。⇒ 這支連 POST 都不接（405）。
//
// 🔴 **那一列不存在時回 200 + state:"not-seeded"，刻意不回 404。**
// 姊妹端點 GET /ruleset 對同一種情形回 404（App 端據此退回 bundle），
// 這裡不同，因為問的問題不同：
//   - App 問「我拿不拿得到表」⇒ 拿不到就是拿不到，404 沒有歧義。
//   - 後台問「那一列現在是什麼狀態」⇒ 若也回 404，「還沒播種」與
//     **「這支端點還沒部署」**在頁面上逐字相同，而兩者的處置完全相反
//     （跑播種腳本 vs 部署 stack）。
//
// ⇒ 這一頁的 404 保留給「端點不在」這一種。狀態一律用 state 欄位講。
//
// 🔴 **那一列壞掉（state:"malformed"）也是 200，而且照樣回 raw。**
// 它是後台要看見的事實，不是這支的失敗。reason 指名**是哪一鍵**壞了 ——
// 「那一列壞了」對運維沒有用，「壞在 ignores 這一鍵」才有。
// ⚠️ 判準不自己寫一份：import cmd/lambdas/ruleset 的 Parse，
// 與 GET /ruleset 同一份。兩份會漂，而漂掉之後「後台說沒問題、App 拿到 502」
// 兩邊都不會報錯。
//
// 🔴 **DDB 讀不到 → 502，⛔ 不合成 not-seeded。**
// 「讀不到」與「沒有」的處置相反（一個是設備問題、讀數作廢，
// 一個是要去播種），合成同一個答案只能給出一個對其中一種是錯的指示。
//
// 🔴 **界線：這支不比對 repo 正典，不下「一不一致」的判定。**
// 它手上沒有 repo 那一份，要有就得把 fan_table.json 也複製進 lambda ——
// 那是第三份表，而它會漂。逐 byte 比對那把尺是
// tools/mahjong-tai/check_ruleset_seeded.py（七種判定、各自的 rc 與處置），
// 已接線在兩支前端部署腳本上（D5-c2）。這支只給**DDB 這一側的事實**：
// 它自稱幾版、原文的 sha256 與長度、原文本身。頁面拿它與後台 build 內建的
// 正典版本並排顯示，並把 check_ruleset_seeded.py 的指令印出來。
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"mahjongclub-backend/cmd/lambdas/adminrole"
	"mahjongclub-backend/cmd/lambdas/ruleset"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

const devSecret = "dev_only_insecure_secret_do_not_use_in_prod"

// 三種狀態。頁面依它分支，所以值是契約的一部分。
const (
	stateSeeded    = "seeded"
	stateNotSeeded = "not-seeded"
	stateMalformed = "malformed"
)

// rulesetReader 讓測試能記錄「哪些路徑會查、哪些路徑絕不查」。
// 回傳 (info_value, 那一列在不在, 錯誤)。
type rulesetReader interface {
	GetRulesetRaw(ctx context.Context) (raw string, found bool, err error)
}

type ddbReader struct {
	client *dynamodb.Client
	table  string
}

var (
	reader    rulesetReader
	tableName string
)

func init() {
	prefix := os.Getenv("TABLE_PREFIX")
	if prefix == "" {
		prefix = "MahjongClub_"
	}
	tableName = prefix + ruleset.TableSuffix

	// 比照 mahjongclub_admin_voice_corrections：init() 不 panic，改成請求時
	// 讀 secret、讀不到就 fail-closed 回 500。兩者都是 fail-closed，
	// 差別只在死的時機，換來的是這支載得進 go test。
	if os.Getenv("ADMIN_JWT_SECRET") == "" && os.Getenv("ALLOW_DEV_JWT_SECRET") != "true" {
		log.Printf("WARN admin_ruleset: ADMIN_JWT_SECRET 未設定 —— 所有請求都會被拒絕（fail-closed）")
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	reader = &ddbReader{client: dynamodb.NewFromConfig(awsCfg), table: tableName}
}

// GetRulesetRaw 用 GetItem 打單一 key，與 GET /ruleset 同一列同一種取法。
func (d *ddbReader) GetRulesetRaw(ctx context.Context) (string, bool, error) {
	out, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(d.table),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: ruleset.InfoKey},
		},
	})
	if err != nil {
		return "", false, err
	}
	if out.Item == nil {
		return "", false, nil
	}
	v, ok := out.Item["info_value"].(*types.AttributeValueMemberS)
	if !ok {
		// 列在但 info_value 不是字串。⚠️ 這條路徑假件繞不到（它在 DDB 型別層之下）。
		// 回 ("", true, nil) ⇒ 上層走 malformed，而不是 not-seeded：那一列**確實存在**。
		return "", true, nil
	}
	return v.Value, true, nil
}

// View 是回給後台頁的那一份事實。
//
// 🔴 每個欄位都要能在三種 state 下說得清楚，不可以有「看起來合法的預設值」：
//   - not-seeded：Version/SHA256/Raw 全空、Bytes=0。⛔ 不合成空表。
//   - malformed：Raw 原封不動照給（不看原文查不下去）、Version 盡力給
//     （VersionOf 是另一把尺，見套件註解）、Reason 指名哪一鍵。
type View struct {
	Success bool   `json:"success"`
	State   string `json:"state"`
	Table   string `json:"table"`
	InfoKey string `json:"infoKey"`
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
	Bytes   int    `json:"bytes"`
	Raw     string `json:"raw"`
	Reason  string `json:"reason"`
}

// buildView 是純函式：不碰網路、不碰時鐘。found=false ⇒ 那一列不存在。
func buildView(raw string, found bool) View {
	v := View{Success: true, Table: tableName, InfoKey: ruleset.InfoKey}
	if !found {
		v.State = stateNotSeeded
		return v
	}
	sum := sha256.Sum256([]byte(raw))
	v.SHA256 = hex.EncodeToString(sum[:])
	v.Bytes = len(raw)
	v.Raw = raw
	v.Version = ruleset.VersionOf(raw)
	if _, err := ruleset.Parse(raw); err != nil {
		v.State = stateMalformed
		v.Reason = err.Error()
		return v
	}
	v.State = stateSeeded
	return v
}

func adminSecret() ([]byte, error) {
	if s := os.Getenv("ADMIN_JWT_SECRET"); s != "" {
		return []byte(s), nil
	}
	if os.Getenv("ALLOW_DEV_JWT_SECRET") == "true" {
		return []byte(devSecret), nil
	}
	return nil, errors.New("ADMIN_JWT_SECRET not configured")
}

func validateToken(authHeader string, secret []byte) (jwt.MapClaims, error) {
	if authHeader == "" {
		return nil, errors.New("missing token")
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return nil, errors.New("invalid header format")
	}
	token, err := jwt.Parse(parts[1], func(t *jwt.Token) (interface{}, error) {
		// 只收 HMAC —— 不擋的話 alg:none / RS256 公鑰混淆都進得來。
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return secret, nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, errors.New("invalid claims")
	}
	return claims, nil
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers}, nil
	}
	if request.HTTPMethod != http.MethodGet {
		// 🔴 這裡的 405 不只是「沒實作」——是紀律 1：唯一的寫入入口是播種腳本。
		return respond(http.StatusMethodNotAllowed, map[string]interface{}{"success": false, "error": "method not allowed（本頁唯讀：寫入路徑只有 seed_ruleset.py）"}, headers)
	}

	// 第二層。第一層是 gateway 的 RyojakuAdminAuth（gen_app_template.py 對 auth=="admin"
	// 自動掛上）。兩層都要：第一層漏掉時沒有任何錯誤訊號。
	secret, err := adminSecret()
	if err != nil {
		log.Printf("admin_ruleset: %v", err)
		return respond(http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "admin auth not configured"}, headers)
	}
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	claims, err := validateToken(authHeader, secret)
	if err != nil {
		return respond(http.StatusUnauthorized, map[string]interface{}{"success": false, "error": "unauthorized"}, headers)
	}
	if !adminrole.Allows(claims, adminrole.Admin, adminrole.SuperAdmin) {
		return respond(http.StatusForbidden, map[string]interface{}{"success": false, "error": "forbidden"}, headers)
	}

	raw, found, err := reader.GetRulesetRaw(ctx)
	if err != nil {
		log.Printf("admin_ruleset: failed to read %s/%s: %v", tableName, ruleset.InfoKey, err)
		return respond(http.StatusBadGateway, map[string]interface{}{"success": false, "error": "ruleset store unavailable"}, headers)
	}

	body, err := json.Marshal(buildView(raw, found))
	if err != nil {
		log.Printf("admin_ruleset: marshal failed: %v", err)
		return respond(http.StatusBadGateway, map[string]interface{}{"success": false, "error": "failed to encode view"}, headers)
	}
	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: string(body)}, nil
}

func respond(status int, body map[string]interface{}, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: headers, Body: string(b)}, nil
}

func main() {
	lambda.Start(handler)
}
