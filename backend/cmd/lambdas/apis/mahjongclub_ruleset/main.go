package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// GET /ruleset —— 把後台的家規台數表原封不動下發給 App（DESIGN_APP.md §5／§5a）。
//
// 載體：<TABLE_PREFIX>AdminConfigs 的**一列** info_key = "VoiceTai:Ruleset"，
// info_value 是一段 JSON 字串 {"version","fans","combos","ignores"}。
// 🔴 一列不是三列：三者合成一份 JSON，「表下發了、略過詞沒有」那個失效模式
// 在載體形狀上就不存在（§0.2 的 bug 根因）。
//
// 🔴 這支只讀不寫、不驗內容對不對。它唯一的職責是「原封不動拿出來，
// 或者誠實地說拿不到」—— 每一種失敗都要說不出來，不給好聽的答案：
//   - 那一列不存在      → 404（⛔ 不合成空表：空 fans 會讓每句話判 0 台，
//                              而那跟「表還沒建」在 App 端讀數上逐字相同）
//   - info_value 解析失敗 → 502（不回 200 帶半份表）
//   - fans/combos/ignores 任一鍵缺席或 null → 502（ignores: [] 是合法值，要與缺席分開判）
//   - version 缺席或空字串 → 502
//   - DDB 本身出錯        → 502
//   - 沒有 authorizer userId → 401（fail-closed，比照 POST /voice-corrections）

const rulesetInfoKey = "VoiceTai:Ruleset"

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

// rulesetPayload 是 info_value 的形狀。三個表鍵用 json.RawMessage 承接：
// 🔴 原封不動轉出去，不重新塑形、不挑鍵 —— 這支不知道也不該知道表裡有什麼。
// json.RawMessage 同時讓「鍵缺席」（nil）與「鍵存在但值是 null」（"null"）
// 與「空陣列」（"[]"）三者在解析後仍然分得開。
type rulesetPayload struct {
	Version *string         `json:"version"`
	Fans    json.RawMessage `json:"fans"`
	Combos  json.RawMessage `json:"combos"`
	Ignores json.RawMessage `json:"ignores"`
}

type RulesetResponse struct {
	Success bool            `json:"success"`
	Version string          `json:"version"`
	Fans    json.RawMessage `json:"fans"`
	Combos  json.RawMessage `json:"combos"`
	Ignores json.RawMessage `json:"ignores"`
}

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
			"info_key": &types.AttributeValueMemberS{Value: rulesetInfoKey},
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

// isAbsentOrNull：鍵缺席（RawMessage 為 nil）或值為 JSON null。
// 🔴 `[]`／`{}` 都不算 —— 「空」與「沒有」在這支裡是兩件事。
func isAbsentOrNull(raw json.RawMessage) bool {
	return raw == nil || string(raw) == "null"
}

// parseRuleset 把 info_value 解析成回應；純函式，不碰網路。
// 任何一種缺損都回 error（上層一律 502），不會回半份表。
func parseRuleset(raw string) (RulesetResponse, error) {
	var p rulesetPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return RulesetResponse{}, err
	}
	if p.Version == nil || *p.Version == "" {
		return RulesetResponse{}, errors.New("ruleset version missing or empty")
	}
	if isAbsentOrNull(p.Fans) {
		return RulesetResponse{}, errors.New("ruleset fans missing")
	}
	if isAbsentOrNull(p.Combos) {
		return RulesetResponse{}, errors.New("ruleset combos missing")
	}
	if isAbsentOrNull(p.Ignores) {
		return RulesetResponse{}, errors.New("ruleset ignores missing")
	}
	return RulesetResponse{
		Success: true,
		Version: *p.Version,
		Fans:    p.Fans,
		Combos:  p.Combos,
		Ignores: p.Ignores,
	}, nil
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
