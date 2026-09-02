// mahjongclub_admin_voice_corrections — 語音判台訂正資料的後台讀取端（D3-c）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4.3
// GET /admin/voice-corrections（auth=admin）
//
// 🔴 本支**不算建議，只回原始紀錄**。設計冊 §4.3 原本寫「呼叫 feedback.extractSuggestions」，
// 但那支是 JavaScript（tools/mahjong-tai/feedback.js 的 UMD），Go 叫不到它。
// 要在 Go 裡實現就得**把飛輪邏輯重寫一份** —— 那會變成第二個實作，
// 而正典那側的漂移守衛（SYNC.sha256 逐檔 sha256）**看不到 Go 這一份**，
// 兩邊分岔時不會有任何東西轉紅。
// ⇒ 分工：本支只負責「把資料拿出來」，`extractSuggestions` 仍然只有 JS 那一份，
//
//	由後台頁面（同樣是 JS，比照 vocab_editor.html）呼叫。
//	minCount／distinctUsers 那道防單人灌爆的門檻因此也只有一個實作（§4.5）。
//
// 🔴 回傳欄位是**對 JS 那支的契約**，不是隨便挑的：extractSuggestions 讀
// r.unmatched / r.added / r.removed / r.text / r.userId（feedback.js:86-104）。
// 少任何一個，飛輪會安靜地少找到一類建議 —— 不會報錯。main_test.go 有一條釘住這件事。
//
// 🔴 用 Scan 不用 Query，且**不靠 sk 排序**：sk 是 TS#<ts>#<uuid>，
// 而那個 ts 是呼叫端給的（§4.2）。前端若誤送毫秒，字串排序會與秒級紀錄錯開。
// v1 的量級極小且後台就是要全部看過，所以全表掃是對的，也不必替一個會騙人的順序負責。
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
	"strings"

	"mahjongclub-backend/cmd/lambdas/adminrole"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

// scanPageLimit：一次掃幾筆。後台一次看得完就好，超過用 cursor 續掃。
const scanPageLimit = 200

const devSecret = "dev_only_insecure_secret_do_not_use_in_prod"

// correctionScanner 讓測試能在不碰 DDB 的情況下驗「哪些路徑會查、哪些路徑絕不查」。
type correctionScanner interface {
	Scan(ctx context.Context, cursor string, limit int32) ([]map[string]types.AttributeValue, string, error)
}

type ddbScanner struct {
	client *dynamodb.Client
	table  string
}

var (
	scanner correctionScanner
)

func init() {
	tablePrefix := os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

	// 🔴 這裡刻意**不 panic**，與既有 14 支 admin lambda 不同 —— 取捨寫在這裡：
	// 那 14 支在 init() 就 panic（cold start 立刻死，很大聲），但那也讓
	// `go test` 連套件都載不進來 —— 它們全都沒有測試檔，所以從沒人撞到這件事。
	// 本支改成「請求時讀 secret、空的就 fail-closed 回 500 並記一行 log」，
	// 兩者都是 fail-closed；差別只在死的時機，換來的是這支有測試。
	// ⚠️ 若日後那 14 支要補測試，這個取捨可以整批沿用。
	if os.Getenv("ADMIN_JWT_SECRET") == "" && os.Getenv("ALLOW_DEV_JWT_SECRET") != "true" {
		log.Printf("WARN admin_voice_corrections: ADMIN_JWT_SECRET 未設定 —— 所有請求都會被拒絕（fail-closed）")
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	scanner = &ddbScanner{
		client: dynamodb.NewFromConfig(awsCfg),
		table:  tablePrefix + "VoiceCorrections",
	}
}

func (d *ddbScanner) Scan(ctx context.Context, cursor string, limit int32) ([]map[string]types.AttributeValue, string, error) {
	in := &dynamodb.ScanInput{TableName: aws.String(d.table), Limit: aws.Int32(limit)}
	if cursor != "" {
		start, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		in.ExclusiveStartKey = start
	}
	out, err := d.client.Scan(ctx, in)
	if err != nil {
		return nil, "", err
	}
	next := ""
	if len(out.LastEvaluatedKey) > 0 {
		next, err = encodeCursor(out.LastEvaluatedKey)
		if err != nil {
			return nil, "", err
		}
	}
	return out.Items, next, nil
}

// Record 是回給後台的一筆訂正。
// 🔴 欄位名是對 feedback.js extractSuggestions 的契約，改名等於讓飛輪安靜地漏掉一類建議。
type Record struct {
	UserID         string   `json:"userId"`
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
	TS             int64    `json:"ts"`
}

// toRecord 把 DDB item 轉成回傳形狀（純函式，不碰網路）。
// pk 形如 USER#<userId>；不合這個形狀的列一律跳過（回 false）而不是猜一個 userId ——
// 猜出來的 userId 會污染 distinctUsers 那道防單人灌爆的門檻。
func toRecord(item map[string]types.AttributeValue) (Record, bool) {
	pk := strAttr(item, "pk")
	if !strings.HasPrefix(pk, "USER#") || len(pk) <= len("USER#") {
		return Record{}, false
	}
	return Record{
		UserID:         strings.TrimPrefix(pk, "USER#"),
		Text:           strAttr(item, "text"),
		NormalizedText: strAttr(item, "normalizedText"),
		// 🔴 一律回空陣列而不是 null：extractSuggestions 直接讀 r.added.length，
		// JSON null 在 JS 那邊會 TypeError。
		Parsed:         setAttr(item, "parsed"),
		Corrected:      setAttr(item, "corrected"),
		Added:          setAttr(item, "added"),
		Removed:        setAttr(item, "removed"),
		Unmatched:      strAttr(item, "unmatched"),
		HadDiff:        boolAttr(item, "hadDiff"),
		RulesetVersion: strAttr(item, "rulesetVersion"),
		EngineVersion:  strAttr(item, "engineVersion"),
		TS:             numAttr(item, "ts"),
	}, true
}

// kindOf 回這一列是什麼（D4-g）。
//
// 🔴 **缺欄一律是 correction。** D4-c 上線到 D4-g 之間寫下的每一筆真實訂正
// 都沒有這個欄位；反過來預設會把它們整批從飛輪裡丟掉，而且沒有任何錯誤訊號。
func kindOf(item map[string]types.AttributeValue) string {
	if k := strAttr(item, "kind"); k != "" {
		return k
	}
	return "correction"
}

// PageEvents 是**這一頁**掃到的漏斗事件計數（D4-g）。
//
// 🔴 名字裡的 Page 不是修飾語，是判準：Scan 一次只看 scanPageLimit 筆，
// 這些數字**不是全表總數**。當成總數讀的話，漏斗的每一格都會被低估，
// 而低估的方向是「看起來沒人用」—— 正好是本功能要消滅的那個誤讀。
// 要總數就得把每一頁的數字自己加起來（後台頁的事，D6）。
type PageEvents struct {
	Open      int            `json:"open"`
	AsrOk     int            `json:"asrOk"`
	AsrFailed int            `json:"asrFailed"`
	AsrErrors map[string]int `json:"asrErrors"`
	// Other 是認得出是事件、但 kind 不在我們知道的清單裡的列。
	// 🔴 不可以併進上面任何一格：寫入端加了新 kind 而這裡忘了跟上時，
	// 「有一種新東西在寫入」與「沒有那種東西」必須分得出來。
	Other int `json:"other"`
}

func strAttr(item map[string]types.AttributeValue, name string) string {
	if v, ok := item[name].(*types.AttributeValueMemberS); ok {
		return v.Value
	}
	return ""
}

func boolAttr(item map[string]types.AttributeValue, name string) bool {
	if v, ok := item[name].(*types.AttributeValueMemberBOOL); ok {
		return v.Value
	}
	return false
}

func numAttr(item map[string]types.AttributeValue, name string) int64 {
	if v, ok := item[name].(*types.AttributeValueMemberN); ok {
		n, err := strconv.ParseInt(v.Value, 10, 64)
		if err == nil {
			return n
		}
	}
	return 0
}

// setAttr：寫入端對空集合是「省略該欄」（D3-b），所以缺欄要回空陣列不是 nil。
func setAttr(item map[string]types.AttributeValue, name string) []string {
	if v, ok := item[name].(*types.AttributeValueMemberSS); ok && v.Value != nil {
		return v.Value
	}
	return []string{}
}

func encodeCursor(key map[string]types.AttributeValue) (string, error) {
	m := map[string]string{}
	for k, v := range key {
		s, ok := v.(*types.AttributeValueMemberS)
		if !ok {
			return "", fmt.Errorf("unsupported cursor key type for %q", k)
		}
		m[k] = s.Value
	}
	b, err := json.Marshal(m)
	return string(b), err
}

func decodeCursor(cursor string) (map[string]types.AttributeValue, error) {
	var m map[string]string
	if err := json.Unmarshal([]byte(cursor), &m); err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return nil, errors.New("empty cursor")
	}
	out := map[string]types.AttributeValue{}
	for k, v := range m {
		out[k] = &types.AttributeValueMemberS{Value: v}
	}
	return out, nil
}

// adminSecret 每次請求讀一次（Lambda 的 env 不會在執行期改變，成本可忽略）。
// 讀不到就回 error ⇒ 呼叫端 fail-closed。
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
		return respond(http.StatusMethodNotAllowed, map[string]interface{}{"error": "method not allowed"}, headers)
	}

	// 🔴 第二層。第一層是 gateway 的 RyojakuAdminAuth（gen_app_template.py 對 auth=="admin"
	// 自動掛上）。兩層都要：第一層漏掉時**沒有任何錯誤訊號**（見 DESIGN_APP.md §4.3）。
	secret, err := adminSecret()
	if err != nil {
		log.Printf("admin_voice_corrections: %v", err)
		return respond(http.StatusInternalServerError, map[string]interface{}{"error": "admin auth not configured"}, headers)
	}

	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"] // REST APIGW 會正規化大小寫，兩種都試
	}
	claims, err := validateToken(authHeader, secret)
	if err != nil {
		return respond(http.StatusUnauthorized, map[string]interface{}{"error": "unauthorized"}, headers)
	}
	if !adminrole.Allows(claims, adminrole.Admin, adminrole.SuperAdmin) {
		return respond(http.StatusForbidden, map[string]interface{}{"error": "forbidden"}, headers)
	}

	items, next, err := scanner.Scan(ctx, request.QueryStringParameters["cursor"], scanPageLimit)
	if err != nil {
		log.Printf("admin_voice_corrections scan failed: %v", err)
		return respond(http.StatusInternalServerError, map[string]interface{}{"error": "failed to fetch corrections"}, headers)
	}

	records := make([]Record, 0, len(items))
	events := PageEvents{AsrErrors: map[string]int{}}
	skipped := 0
	for _, it := range items {
		r, ok := toRecord(it)
		if !ok {
			skipped++
			continue
		}
		// 🔴 漏斗事件不可以進 data —— 它們的 text 是空字串、hadDiff 是 false，
		// 與「判對了的訂正」在既有欄位上**逐欄相同**。混進去的話
		// 「未訂正率 = hadDiff=false ÷ 總筆數」會往「判得很準」的方向灌水，
		// 而且 extractSuggestions 也會多吃一批空紀錄。
		//
		// ⚠️ 但也不可以併進 skipped：那一格的意思是「形狀壞掉」，
		// 事件列沒有壞，它們正是本功能刻意要寫的東西。兩者混在一起的話，
		// 「寫入端出事了」與「有人在用」會變成同一個數字。
		if k := kindOf(it); k != "correction" {
			countEvent(&events, k, it)
			continue
		}
		records = append(records, r)
	}
	if skipped > 0 {
		// 不靜靜吞掉：形狀不對的列代表寫入端或表結構出了事，後台看得到才查得下去。
		log.Printf("admin_voice_corrections: skipped %d malformed rows", skipped)
	}

	return respond(http.StatusOK, map[string]interface{}{
		"data":       records,
		"nextCursor": next,
		"skipped":    skipped,
		"pageEvents": events,
	}, headers)
}

// countEvent 把一列事件計進本頁的漏斗計數。
func countEvent(acc *PageEvents, kind string, item map[string]types.AttributeValue) {
	switch kind {
	case "open":
		acc.Open++
	case "asr":
		if boolAttr(item, "asrOk") {
			acc.AsrOk++
			return
		}
		acc.AsrFailed++
		code := strAttr(item, "asrError")
		if code == "" {
			// 🔴 不可以直接不計：「失敗但沒寫原因」是一個真實而且值得看見的狀態
			// （寫入端漏填、或舊版前端）。不記的話它會偽裝成「從來沒有失敗過」。
			code = "unknown"
		}
		acc.AsrErrors[code]++
	default:
		acc.Other++
	}
}

func respond(status int, body map[string]interface{}, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: headers, Body: string(b)}, nil
}

func main() {
	lambda.Start(handler)
}
