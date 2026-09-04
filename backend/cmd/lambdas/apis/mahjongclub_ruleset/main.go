package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/ruleset"
	"mahjongclub-backend/cmd/lambdas/shared"
)

// GET /ruleset —— 把後台的家規台數表原封不動下發給 App（DESIGN_APP.md §5／§5a）。
//
// 載體：<TABLE_PREFIX>AdminConfigs 的**一列** info_key = "VoiceTai:Ruleset"，
// info_value 是一段 JSON 字串 {"version","fans","combos","ignores","config"}。
// 🔴 一列不是三列：三者合成一份 JSON，「表下發了、略過詞沒有」那個失效模式
// 在載體形狀上就不存在（§0.2 的 bug 根因）。
//
// 🔴 這支只讀不寫、不驗內容對不對。它唯一的職責是「原封不動拿出來，
// 或者誠實地說拿不到」—— 每一種失敗都要說不出來，不給好聽的答案：
//   - 那一列不存在      → 404（⛔ 不合成空表：空 fans 會讓每句話判 0 台，
//                              而那跟「表還沒建」在 App 端讀數上逐字相同）
//   - info_value 解析失敗 → 502（不回 200 帶半份表）
//   - fans/combos/ignores/config 任一鍵缺席或 null → 502
//     （ignores: [] 是合法值，要與缺席分開判；config: {} 同理，見下方 D5-b2 那段）
//   - version 缺席或空字串 → 502
//   - DDB 本身出錯        → 502
//   - 沒有 authorizer userId → 401（fail-closed，比照 POST /voice-corrections）
//
// 🔴 D5-b2（2026-09-03）：`config` 是**第五個**表鍵，缺了要 502。
// 起因是 §5b 量到的缺口：後台把「底」從 1 改成 2，下發傳不過去，
// App 端拿到新的 fans 卻配著 bundle 裡的舊 config —— 而且**零徵兆**，
// 因為它當時根本不在檢查清單裡（「表下發了、略過詞沒有」那個 bug 的同構）。
//
// 🔴 **界線：這支不看 config 裡面有什麼，`config: {}` 是合法的 200。**
// 唯一有計分作用的欄位是 config.base_di（scoring.js:165
// `if (cfg.base_di) total += cfg.base_di`）——而那一行讓「base_di 缺席」
// 與「base_di: 0」在引擎裡逐值相同，⇒ 缺席是「這家沒有底」的**合法表示法**，
// 不是遺失。要求它存在等於發明一條引擎沒有的約束。
// （config.allow_stack_menqing_zimo 是零讀取端的死旗標，§5b 實測確認，
// **不進契約**；哪天有人實作了它的語意，probe_config_flag.mjs 會轉紅。）
// 那 config 進契約還有什麼用？擋的是**整個 config 掉了**——
// 那一種是遺失，而它跟「這家沒有底」在 App 端的計分結果上逐字相同。

// 🔴 D5-e：契約（InfoKey／Parse）已搬到 cmd/lambdas/ruleset，因為後台唯讀檢視頁
// 是第二個讀取端。兩份實作會漂，而漂掉之後「後台說沒問題、App 拿到 502」
// 兩邊都不報錯。本檔保留同名的薄包裝，讓既有 14 條測試逐字不動地繼續跑。

type Config struct {
	AWSRegion   string
	TablePrefix string
}

type Database struct {
	client *dynamodb.Client
	cfg    *Config
}

// rulesetStore 讓測試能以假實作走完整條 handler 路徑而不碰 DDB。
// 回傳 (info_value, 那一列在不在, 錯誤)。
type rulesetStore interface {
	GetRulesetRaw(ctx context.Context) (raw string, found bool, err error)
}

// RulesetResponse 是 ruleset.Response 的別名 —— 回應形狀的定義只有一份。
type RulesetResponse = ruleset.Response

type ErrorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

var (
	db    *Database
	store rulesetStore
)

func init() {
	cfg := &Config{
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(cfg.AWSRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	db = &Database{
		client: dynamodb.NewFromConfig(awsCfg),
		cfg:    cfg,
	}
	store = db
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func (c *Config) GetTableName(tableName string) string {
	return c.TablePrefix + tableName
}

// GetRulesetRaw 用 GetItem 打單一 key（不像 app_version_config 那樣 Scan 整張表）。
func (d *Database) GetRulesetRaw(ctx context.Context) (string, bool, error) {
	out, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(d.cfg.GetTableName("AdminConfigs")),
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
		// 列在但 info_value 不是字串：等同「解析失敗」，交給上層回 502。
		return "", true, nil
	}
	return v.Value, true, nil
}

// parseRuleset 委派給契約那一份（cmd/lambdas/ruleset）。
// 🔴 保留這層薄包裝而不是全檔改名，是為了讓既有測試**逐字不動**地繼續跑 ——
// 重構的驗收是「同一批測試在改動前後都綠」，改了測試就驗不到這件事。
func parseRuleset(raw string) (RulesetResponse, error) {
	return ruleset.Parse(raw)
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	shared.RecordTokenUsageFromHeader(request, "ruleset")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers}, nil
	}
	if request.HTTPMethod != http.MethodGet {
		return respondError(http.StatusMethodNotAllowed, "method not allowed", headers)
	}

	// 身分一律取自 authorizer；取不到就 fail-closed 回 401（第二道防線，gateway 那層是第一道）。
	userID := shared.AuthorizerUserID(request)
	if userID == "" {
		return respondError(http.StatusUnauthorized, "unauthorized", headers)
	}

	raw, found, err := store.GetRulesetRaw(ctx)
	if err != nil {
		log.Printf("Failed to get ruleset from AdminConfigs: %v", err)
		return respondError(http.StatusBadGateway, "ruleset store unavailable", headers)
	}
	if !found {
		// ⛔ 不合成空表。App 端看到 404 要退回 bundle（D5-d）。
		return respondError(http.StatusNotFound, "ruleset not found", headers)
	}

	resp, err := parseRuleset(raw)
	if err != nil {
		log.Printf("Ruleset row is malformed: %v", err)
		return respondError(http.StatusBadGateway, "ruleset malformed: "+err.Error(), headers)
	}

	body, err := json.Marshal(resp)
	if err != nil {
		log.Printf("Failed to marshal ruleset response: %v", err)
		return respondError(http.StatusBadGateway, "ruleset malformed", headers)
	}
	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: string(body)}, nil
}

func respondError(status int, msg string, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(ErrorResponse{Success: false, Error: msg})
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: headers, Body: string(body)}, nil
}

func main() {
	lambda.Start(handler)
}
