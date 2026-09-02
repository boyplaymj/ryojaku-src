package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// expiresAtTTLSeconds: 記錄保留一年（DESIGN_APP.md §4.2）。
// ⚠️ 起算點是**伺服器收件時刻**，不是呼叫端給的 ts —— 理由見 buildItem 的註解。
const expiresAtTTLSeconds = 365 * 24 * 3600

type Config struct {
	AWSRegion   string
	TablePrefix string
}

type Database struct {
	client *dynamodb.Client
	cfg    *Config
}

// correctionStore 讓測試能以假實作驗證「哪些路徑會寫、哪些路徑絕不寫」。
type correctionStore interface {
	PutCorrection(ctx context.Context, item map[string]types.AttributeValue) error
}

// CorrectionRequest 是前端送來的訂正紀錄（DESIGN_APP.md §4.2）。
// 注意：刻意沒有 userId 欄位 —— 身分一律取自 authorizer，不信 body。
type CorrectionRequest struct {
	Text           string   `json:"text"`
	NormalizedText string   `json:"normalizedText"`
	Parsed         []string `json:"parsed"`
	Corrected      []string `json:"corrected"`
	Added          []string `json:"added"`
	Removed        []string `json:"removed"`
	Unmatched      string   `json:"unmatched"`
	HadDiff        bool     `json:"hadDiff"`
	RulesetVersion string   `json:"rulesetVersion"`
	EngineVersion  string   `json:"engineVersion"`
	// TS 由呼叫端提供（前端引擎刻意不取系統時間）。缺少或 <=0 一律 400。
	TS int64 `json:"ts"`

	// Kind 是這一列的種類（D4-g 漏斗埋點）。`correction`／`open`／`asr`。
	//
	// 🔴 **空字串一律當成 `correction`。** 這個預設是為了**既有資料**：
	// D4-c 上線到 D4-g 之間寫下的每一筆真實訂正都沒有這個欄位，
	// 反過來預設（空 ⇒ 事件）會把它們整批從飛輪裡丟掉。
	//
	// 🔴 認不得的值一律 **400**，不是「當成 correction」——
	// 打錯字的 kind 若被吞成訂正，事件列會混進準確率的分母，
	// 而那個方向剛好是「看起來判得更準」。
	Kind string `json:"kind"`

	// 以下只有 Kind=="asr" 用得到。ASR 成功時 AsrError 為空。
	AsrOk    bool   `json:"asrOk"`
	AsrTrack string `json:"asrTrack"`
	AsrError string `json:"asrError"`
}

// 允許的 kind。🔴 這份名單與前端 utils/voiceTaiMetrics.ts 的 EVENT_KINDS 是**同一份契約**，
// 兩邊各改一半的話：新 kind 前端送得出去、後端 400，而前端是 fail-open ⇒ 使用者無感、
// 資料靜靜地少一整類。前端那側有一條測試把名單釘死（D4g-7）。
var allowedKinds = map[string]bool{"correction": true, "open": true, "asr": true}

const kindCorrection = "correction"

// normalizeKind 把空字串補成 correction，並擋掉不認得的值。
func normalizeKind(raw string) (string, error) {
	if raw == "" {
		return kindCorrection, nil
	}
	if !allowedKinds[raw] {
		return "", fmt.Errorf("unknown kind %q", raw)
	}
	return raw, nil
}

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var (
	db    *Database
	store correctionStore
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

func (d *Database) PutCorrection(ctx context.Context, item map[string]types.AttributeValue) error {
	tableName := d.cfg.GetTableName("VoiceCorrections")
	_, err := d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	return err
}

// buildItem 從已驗證的 userID 與請求造出要寫入 DDB 的 item（純函式，不碰網路）。
// 🔴 hadDiff=false 也要造出 item —— 「每次送出都寫一筆」是刻意設計：
// 只記有訂正的話，「0 筆」會同時代表「判得很準」與「沒人用」，兩者處置相反。
//
// 🔴 expiresAt 用 nowUnix（伺服器收件時刻）算，**不是**用 req.TS。
// 設計冊 §4.2 原本寫 `expiresAt = ts + 365 天`，但 ts 是**呼叫端提供的**，
// 前端若誤把毫秒當秒送（1756800000000 而非 1756800000），
// expiresAt 會落在西元五萬年 ⇒ **TTL 等於失效、資料永久保留**。
// 那個方向對隱私是 fail-open：壞輸入的後果是「留更久」而不是「被拒絕」。
// 而 TTL 的語意本來就是「從我們存下它算起保留多久」＝伺服器時刻，兩者正常時相同。
// ⚠️ req.TS 仍原樣存進 ts 欄（那是呼叫端的宣稱，是資料本身），只是不拿它算保存期限。
func buildItem(userID string, req CorrectionRequest, nowUnix int64) (map[string]types.AttributeValue, error) {
	if userID == "" {
		return nil, errors.New("userID is required")
	}
	if req.TS <= 0 {
		return nil, errors.New("ts must be a positive unix timestamp provided by the caller")
	}
	kind, err := normalizeKind(req.Kind)
	if err != nil {
		return nil, err
	}

	item := map[string]types.AttributeValue{
		"kind":           &types.AttributeValueMemberS{Value: kind},
		"pk":             &types.AttributeValueMemberS{Value: "USER#" + userID},
		"sk":             &types.AttributeValueMemberS{Value: fmt.Sprintf("TS#%d#%s", req.TS, uuid.New().String())},
		"text":           &types.AttributeValueMemberS{Value: req.Text},
		"normalizedText": &types.AttributeValueMemberS{Value: req.NormalizedText},
		"unmatched":      &types.AttributeValueMemberS{Value: req.Unmatched},
		"hadDiff":        &types.AttributeValueMemberBOOL{Value: req.HadDiff},
		"rulesetVersion": &types.AttributeValueMemberS{Value: req.RulesetVersion},
		"engineVersion":  &types.AttributeValueMemberS{Value: req.EngineVersion},
		"ts":             &types.AttributeValueMemberN{Value: strconv.FormatInt(req.TS, 10)},
		"expiresAt":      &types.AttributeValueMemberN{Value: strconv.FormatInt(nowUnix+expiresAtTTLSeconds, 10)},
	}

	// 🔴 事件列**絕不寫入 added／removed／parsed／corrected**，即使 body 送了。
	//
	// 後台那道 kind 過濾是第一道防線，這裡是第二道。理由是代價不對稱：
	// 回灌飛輪（feedback.js extractSuggestions）吃的就是 added／removed，
	// 一旦事件列帶著它們進了表，「後台忘了過濾」的後果不是少一個數字，
	// 是**假的訂正建議**被回灌進家規台數表 —— 而那一步是人工審核的上游。
	// ⇒ 讓那些欄位在事件列上**根本不存在**，比依賴每一個讀取端都記得過濾安全。
	if kind == kindCorrection {
		// DDB 的 String Set 不接受空集合：空陣列時省略該欄（缺欄＝空集合，讀取端好判斷，
		// 也避免同一欄位在不同筆之間 SS/L 型別混雜）。
		setStringSet(item, "parsed", req.Parsed)
		setStringSet(item, "corrected", req.Corrected)
		setStringSet(item, "added", req.Added)
		setStringSet(item, "removed", req.Removed)
	}

	if kind == "asr" {
		item["asrOk"] = &types.AttributeValueMemberBOOL{Value: req.AsrOk}
		if req.AsrTrack != "" {
			item["asrTrack"] = &types.AttributeValueMemberS{Value: req.AsrTrack}
		}
		if req.AsrError != "" {
			item["asrError"] = &types.AttributeValueMemberS{Value: req.AsrError}
		}
	}

	return item, nil
}

func setStringSet(item map[string]types.AttributeValue, name string, values []string) {
	if len(values) == 0 {
		return
	}
	item[name] = &types.AttributeValueMemberSS{Value: values}
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "voice_corrections")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers}, nil
	}
	if request.HTTPMethod != http.MethodPost {
		return respond(http.StatusMethodNotAllowed, Response{Success: false, Error: "method not allowed"}, headers)
	}

	// 身分一律取自 authorizer；取不到就 fail-closed 回 401。
	// 🔴 絕不可改從 body 拿 userId：gateway 那層的閘門是手工清單，漏掛時沒有錯誤訊號，
	// 這裡是第二道防線，兩層都要。
	userID := shared.AuthorizerUserID(request)
	if userID == "" {
		return respond(http.StatusUnauthorized, Response{Success: false, Error: "unauthorized"}, headers)
	}

	var req CorrectionRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"}, headers)
	}

	item, err := buildItem(userID, req, time.Now().Unix())
	if err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: err.Error()}, headers)
	}

	if err := store.PutCorrection(ctx, item); err != nil {
		log.Printf("Failed to put voice correction: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Failed to save correction"}, headers)
	}

	return respond(http.StatusOK, Response{Success: true}, headers)
}

func respond(status int, resp Response, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(resp)
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(handler)
}
