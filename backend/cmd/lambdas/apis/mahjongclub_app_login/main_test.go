package main

// app_login 限流接線的測試（稽核 finding 5，2026-09-04）。
//
// 🔴 這批測試存在的理由：shared/ratelimit_test.go 驗的是 PeekRateLimit 這支
// 「送出去的 request 長什麼樣、拿到某個計數怎麼判」。它**驗不到接線** ——
// peek 排在 bcrypt 後面、或失敗時忘了加一、或成功時也加一，那批全部照樣綠。
// 而閘門靜靜地變寬鬆正是這類改動最可能的失敗方向，所以這裡直接跑 Handler，
// 斷言「實際打到 DynamoDB 的那串操作」。
//
// 假件：一個 httptest.Server 冒充 DynamoDB。
//   - login 自己的 client（套件層 db）在 TestMain 直接換掉。
//   - shared 那層的 authDDBClient 是別的套件的未匯出變數，這裡碰不到 ——
//     改用 AWS_ENDPOINT_URL_DYNAMODB 讓它 lazy init 時就指到假件。
//     ⚠️ 它初始化後會被快取一輩子 ⇒ 整個 test binary 只能有**一台**假伺服器，
//     所以伺服器開在 TestMain，各測試只換它的狀態，不各開各的。

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"golang.org/x/crypto/bcrypt"
)

// ── 假 DynamoDB ────────────────────────────────────────────────────────

type ddbCall struct {
	Target string // GetItem / UpdateItem / Query / PutItem …
	Table  string
	RLKey  string // AuthRateLimit 的 rlKey（已去掉尾端 #<桶號>），其它表為空
}

var (
	fakeMu     sync.Mutex
	fakeCalls  []ddbCall
	fakeCounts map[string]int  // rlKey 前綴 → GetItem 要回的 count
	fakeUser   json.RawMessage // Users 表 Query 要回的 item；nil ⇒ 查無此人
)

// 桶號後綴：rlKey 是 "<key>#<now/window>"。測試與 handler 取 now 的時刻可能
// 跨過窗口邊界，所以一律**去掉尾端桶號**再比對，避免自然的偽紅。
var bucketSuffix = regexp.MustCompile(`#\d+$`)

func stripBucket(k string) string { return bucketSuffix.ReplaceAllString(k, "") }

func fakeReset() {
	fakeMu.Lock()
	defer fakeMu.Unlock()
	fakeCalls = nil
	fakeCounts = map[string]int{}
	fakeUser = nil
}

func calls() []ddbCall {
	fakeMu.Lock()
	defer fakeMu.Unlock()
	out := make([]ddbCall, len(fakeCalls))
	copy(out, fakeCalls)
	return out
}

func setCount(keyPrefix string, n int) {
	fakeMu.Lock()
	defer fakeMu.Unlock()
	fakeCounts[keyPrefix] = n
}

func setUser(raw string) {
	fakeMu.Lock()
	defer fakeMu.Unlock()
	fakeUser = json.RawMessage(raw)
}

func fakeDDBHandler(w http.ResponseWriter, r *http.Request) {
	target := r.Header.Get("X-Amz-Target")
	if i := strings.LastIndex(target, "."); i >= 0 {
		target = target[i+1:]
	}
	body, _ := io.ReadAll(r.Body)
	var req struct {
		TableName string `json:"TableName"`
		Key       struct {
			RLKey struct {
				S string `json:"S"`
			} `json:"rlKey"`
		} `json:"Key"`
	}
	_ = json.Unmarshal(body, &req)

	rl := stripBucket(req.Key.RLKey.S)

	fakeMu.Lock()
	fakeCalls = append(fakeCalls, ddbCall{Target: target, Table: req.TableName, RLKey: rl})
	count, hasCount := fakeCounts[rl]
	user := fakeUser
	fakeMu.Unlock()

	w.Header().Set("Content-Type", "application/x-amz-json-1.0")
	switch {
	case target == "GetItem" && strings.HasSuffix(req.TableName, "AuthRateLimit"):
		if !hasCount {
			io.WriteString(w, `{}`) // item 不存在
			return
		}
		fmt.Fprintf(w, `{"Item":{"rlKey":{"S":%q},"count":{"N":"%d"}}}`, req.Key.RLKey.S, count)
	case target == "UpdateItem" && strings.HasSuffix(req.TableName, "AuthRateLimit"):
		// UpdateItem 回的是**加一之後**的計數（ReturnValues=UPDATED_NEW）。
		// 有預設值就回預設值，讓「既有那把複合 key 超限」也演得出來 ——
		// 恆回 1 的話那條路結構上永遠 allowed，測試會變成恆綠。
		n := 1
		if hasCount {
			n = count
		}
		fmt.Fprintf(w, `{"Attributes":{"count":{"N":"%d"}}}`, n)
	case target == "Query":
		if user == nil {
			io.WriteString(w, `{"Count":0,"Items":[]}`)
			return
		}
		fmt.Fprintf(w, `{"Count":1,"Items":[%s]}`, user)
	default:
		io.WriteString(w, `{}`) // GetItem(AuthIdentities) 查無、UpdateLastLogin、RecordTraffic…
	}
}

func TestMain(m *testing.M) {
	srv := httptest.NewServer(http.HandlerFunc(fakeDDBHandler))
	defer srv.Close()

	// shared 那層：靠 endpoint 環境變數導向假件（見檔頭）。
	os.Setenv("AWS_ENDPOINT_URL_DYNAMODB", srv.URL)
	os.Setenv("AWS_REGION", "ap-southeast-1")
	os.Setenv("AWS_ACCESS_KEY_ID", "test")
	os.Setenv("AWS_SECRET_ACCESS_KEY", "test")
	os.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	// GetJWTSecret() 在未設定時刻意 panic（拒絕用已知預設值簽章）——
	// 那是生產端的 fail-closed 設計，不是本測試的目標，這裡給一把測試用的。
	os.Setenv("JWT_SECRET", "test-only-secret-do-not-use-in-prod")

	// login 自己的 client：init() 已經跑過並指向真 AWS，這裡整個換掉。
	db = &Database{
		client: dynamodb.New(dynamodb.Options{
			Region:       "ap-southeast-1",
			BaseEndpoint: aws.String(srv.URL),
			Credentials:  aws.AnonymousCredentials{},
			Retryer:      aws.NopRetryer{},
		}),
		cfg: &Config{AWSRegion: "ap-southeast-1", TablePrefix: "MahjongClub_"},
	}
	os.Exit(m.Run())
}

// ── 工具 ───────────────────────────────────────────────────────────────

const testIP = "203.0.113.7"
const testEmail = "victim@example.com"

func loginReq(t *testing.T, body string, ip string) events.APIGatewayProxyResponse {
	t.Helper()
	req := events.APIGatewayProxyRequest{HTTPMethod: "POST", Path: "/login", Body: body}
	req.RequestContext.Identity.SourceIP = ip
	resp, err := Handler(context.Background(), req)
	if err != nil {
		t.Fatalf("Handler 回了 error：%v", err)
	}
	return resp
}

// updatedRLKeys：實際被**加一**（UpdateItem）的限流 key（去掉桶號）。
func updatedRLKeys() []string {
	var out []string
	for _, c := range calls() {
		if c.Target == "UpdateItem" && strings.HasSuffix(c.Table, "AuthRateLimit") {
			out = append(out, c.RLKey)
		}
	}
	return out
}

func peekedRLKeys() []string {
	var out []string
	for _, c := range calls() {
		if c.Target == "GetItem" && strings.HasSuffix(c.Table, "AuthRateLimit") {
			out = append(out, c.RLKey)
		}
	}
	return out
}

func countTarget(target string) int {
	n := 0
	for _, c := range calls() {
		if c.Target == target {
			n++
		}
	}
	return n
}

func has(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

// ── 純函式：key 與旋鈕值 ────────────────────────────────────────────────

// key 打錯字 ⇒ 換一個沒人寫入的桶 ⇒ 限流永遠放行，而且沒有任何徵兆。
func TestLoginFailKeys_Exact(t *testing.T) {
	for _, c := range []struct{ got, want string }{
		{loginFailIPKey("1.2.3.4"), "login#ip#1.2.3.4"},
		{loginFailEmailKey("a@b.com"), "login#email#a@b.com"},
		{loginFailLineIPKey("1.2.3.4"), "login#lineip#1.2.3.4"},
		{legacyComboKey("a@b.com", "1.2.3.4"), "login#a@b.com#1.2.3.4"},
	} {
		if c.got != c.want {
			t.Errorf("key = %q, want %q", c.got, c.want)
		}
	}
}

// 旋鈕值被靜靜調寬（限流變 no-op）是這類改動最可能的失敗方向，
// 而它在測試上與「沒改」逐字相同 ⇒ 直接把數值釘住，要改就得連這裡一起改。
func TestLoginFailLimits_Pinned(t *testing.T) {
	for _, c := range []struct {
		name      string
		got, want int
	}{
		{"loginFailIPLimit", loginFailIPLimit, 50},
		{"loginFailIPWindow", loginFailIPWindow, 3600},
		{"loginFailEmailLimit", loginFailEmailLimit, 20},
		{"loginFailEmailWindow", loginFailEmailWindow, 3600},
		{"loginFailLineIPLimit", loginFailLineIPLimit, 50},
		{"loginFailLineIPWindow", loginFailLineIPWindow, 3600},
		{"loginLegacyComboLimit", loginLegacyComboLimit, 10},
		{"loginLegacyComboWindow", loginLegacyComboWindow, 900},
	} {
		if c.got != c.want {
			t.Errorf("%s = %d, want %d（改動限流參數要連這條一起改，並在稽核冊記一筆）", c.name, c.got, c.want)
		}
	}
}

// 🔴 命名空間重疊：normEmail 若字面上等於 "ip"，既有複合 key 會與 loginFailIPKey
// 產出**同一個字串**。目前不會真的相撞，靠的是兩者窗口不同（900 vs 3600）⇒
// shared 併上的桶號不同。這條把那個「靠窗口不等」的前提釘住 ——
// 哪天有人把既有那把也調成 3600，這裡會紅，而不是在線上靜靜共用計數。
func TestLoginFailKeys_LegacyCollisionOnlyBlockedByWindow(t *testing.T) {
	if legacyComboKey("ip", testIP) != loginFailIPKey(testIP) {
		t.Fatalf("前提變了：兩把 key 不再同形，這條的理由要重寫")
	}
	if loginLegacyComboWindow == loginFailIPWindow {
		t.Fatalf("兩個窗口變成相等（%d）⇒ 桶號會相同 ⇒ email 字面為 \"ip\" 時，"+
			"既有複合桶與 per-IP 失敗桶會共用同一筆計數。要改窗口就必須先把 key 改成不同形。",
			loginFailIPWindow)
	}
}

// ── 接線：Handler 實跑 ─────────────────────────────────────────────────

// 認證失敗（查無此人）⇒ 兩個「只計失敗」的桶都要加一。
// user-not-found 也要計：只計密碼錯誤的話，額度耗盡的時機會隨帳號存不存在而不同，
// 429 就變成帳號枚舉的差別訊號。
func TestLogin_FailureIncrementsBothFailBuckets(t *testing.T) {
	fakeReset()
	resp := loginReq(t, `{"email":"`+testEmail+`","password":"wrong"}`, testIP)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d, want 401；body=%s", resp.StatusCode, resp.Body)
	}
	up := updatedRLKeys()
	for _, want := range []string{
		loginFailIPKey(testIP),
		loginFailEmailKey(testEmail),
		legacyComboKey(testEmail, testIP),
	} {
		if !has(up, want) {
			t.Errorf("失敗後沒有對 %q 加一；實得 %v", want, up)
		}
	}
	pk := peekedRLKeys()
	for _, want := range []string{loginFailIPKey(testIP), loginFailEmailKey(testEmail)} {
		if !has(pk, want) {
			t.Errorf("認證前沒有 peek %q；實得 %v", want, pk)
		}
	}
}

// per-IP 桶超限 ⇒ 429，而且**在做任何認證工作之前**就擋下：
// 不可以有 Query（查使用者）、不可以有任何 UpdateItem（不燒額度、不寫入）。
// 這條同時釘住「peek 排在 DB 查詢與 bcrypt 之前」——
// 順序被改到後面的話，Query 會出現，這裡會紅。
func TestLogin_IPBucketOverLimit_BlocksBeforeAuthWork(t *testing.T) {
	fakeReset()
	setCount(loginFailIPKey(testIP), loginFailIPLimit)
	resp := loginReq(t, `{"email":"`+testEmail+`","password":"wrong"}`, testIP)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("狀態碼 = %d, want 429；body=%s", resp.StatusCode, resp.Body)
	}
	if n := countTarget("Query"); n != 0 {
		t.Errorf("超限後仍查了使用者（Query %d 次）⇒ 閘門沒擋在認證工作之前", n)
	}
	if up := updatedRLKeys(); len(up) != 0 {
		t.Errorf("超限後仍寫入了限流桶 %v ⇒ 被擋的請求會自己把額度續命", up)
	}
}

// per-帳號桶超限 ⇒ 429（跨 IP 的那道）。
func TestLogin_EmailBucketOverLimit_Blocks(t *testing.T) {
	fakeReset()
	setCount(loginFailEmailKey(testEmail), loginFailEmailLimit)
	resp := loginReq(t, `{"email":"`+testEmail+`","password":"wrong"}`, "198.51.100.9")
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("狀態碼 = %d, want 429；body=%s", resp.StatusCode, resp.Body)
	}
	if n := countTarget("Query"); n != 0 {
		t.Errorf("超限後仍查了使用者（Query %d 次）", n)
	}
}

// 🔴 本批最重要的一條：**登入成功不可以扣「只計失敗」的額度**。
// 這正是既有那把複合 key 的毛病（成敗都計 ⇒ 正常使用者也會被擋），
// 整個 Peek/Check 拆兩支的設計就是為了不把它複製過來。
// 反過來說：既有那把仍然成敗都計，所以它的 UpdateItem **應該**還在 —— 一起釘住，
// 免得「不小心把既有行為也改掉」被讀成本次改動的一部分。
func TestLogin_Success_DoesNotBurnFailBuckets(t *testing.T) {
	fakeReset()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-horse"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("產生 bcrypt hash 失敗：%v", err)
	}
	setUser(fmt.Sprintf(`{"userId":{"S":"APP_test"},"email":{"S":%q},"passwordHash":{"S":%q}}`,
		testEmail, string(hash)))

	resp := loginReq(t, `{"email":"`+testEmail+`","password":"correct-horse"}`, testIP)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d, want 200；body=%s", resp.StatusCode, resp.Body)
	}
	up := updatedRLKeys()
	if has(up, loginFailIPKey(testIP)) {
		t.Errorf("登入成功卻扣了 per-IP 失敗額度：%v", up)
	}
	if has(up, loginFailEmailKey(testEmail)) {
		t.Errorf("登入成功卻扣了 per-帳號失敗額度：%v", up)
	}
	if !has(up, legacyComboKey(testEmail, testIP)) {
		t.Errorf("既有的複合 key（成敗都計）不見了 —— 本次不該改到它；實得 %v", up)
	}
}

// 反枚舉：「查無此人」與「密碼錯誤」必須扣掉**同一組**桶。
// 兩者不同的話，額度耗盡的時機就會洩漏「這個帳號存不存在」。
func TestLogin_NotFoundAndWrongPassword_BurnSameBuckets(t *testing.T) {
	fakeReset()
	loginReq(t, `{"email":"`+testEmail+`","password":"x"}`, testIP) // 查無此人
	notFound := append([]string(nil), updatedRLKeys()...)

	fakeReset()
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct-horse"), bcrypt.MinCost)
	setUser(fmt.Sprintf(`{"userId":{"S":"APP_test"},"email":{"S":%q},"passwordHash":{"S":%q}}`,
		testEmail, string(hash)))
	loginReq(t, `{"email":"`+testEmail+`","password":"WRONG"}`, testIP) // 密碼錯
	wrongPw := updatedRLKeys()

	if strings.Join(notFound, ",") != strings.Join(wrongPw, ",") {
		t.Errorf("兩種失敗扣的桶不同 ⇒ 429 的時機會洩漏帳號是否存在\n查無此人=%v\n密碼錯誤=%v",
			notFound, wrongPw)
	}
}

// LINE 密文分支：原本完全沒有限流。失敗要扣**獨立**的桶 ——
// 與密碼登入共用的話，一個重送過期密文的壞掉 client 會把同 IP 的密碼登入一起鎖死。
func TestLogin_LineBranch_UsesSeparateBucket(t *testing.T) {
	fakeReset()
	resp := loginReq(t, `{"encryptedLineId":"bm90LXZhbGlk"}`, testIP)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d, want 401；body=%s", resp.StatusCode, resp.Body)
	}
	up := updatedRLKeys()
	if !has(up, loginFailLineIPKey(testIP)) {
		t.Errorf("LINE 分支失敗沒有扣 %q（這條路原本零限流）；實得 %v", loginFailLineIPKey(testIP), up)
	}
	if has(up, loginFailIPKey(testIP)) {
		t.Errorf("LINE 分支扣到了密碼登入的 per-IP 桶 %v ⇒ 兩條路會互相鎖死", up)
	}
}

// LINE 分支超限 ⇒ 429，且不進行解密／查詢。
func TestLogin_LineBranch_OverLimitBlocks(t *testing.T) {
	fakeReset()
	setCount(loginFailLineIPKey(testIP), loginFailLineIPLimit)
	resp := loginReq(t, `{"encryptedLineId":"bm90LXZhbGlk"}`, testIP)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("狀態碼 = %d, want 429；body=%s", resp.StatusCode, resp.Body)
	}
	if up := updatedRLKeys(); len(up) != 0 {
		t.Errorf("超限後仍寫入限流桶 %v", up)
	}
}

// 三道閘的 429 必須**逐字相同**：有差別的話，回應形狀本身就是側信道
// （「這個帳號正在被打」與「你這個 IP 被擋」可分辨）。
func TestLogin_AllRateLimitRejectionsLookIdentical(t *testing.T) {
	fakeReset()
	setCount(loginFailIPKey(testIP), loginFailIPLimit)
	byIP := loginReq(t, `{"email":"`+testEmail+`","password":"x"}`, testIP)

	fakeReset()
	setCount(loginFailEmailKey(testEmail), loginFailEmailLimit)
	byEmail := loginReq(t, `{"email":"`+testEmail+`","password":"x"}`, testIP)

	fakeReset()
	setCount(legacyComboKey(testEmail, testIP), loginLegacyComboLimit+1)
	byLegacy := loginReq(t, `{"email":"`+testEmail+`","password":"x"}`, testIP)

	if byIP.StatusCode != byEmail.StatusCode || byIP.Body != byEmail.Body {
		t.Errorf("per-IP 與 per-帳號的 429 不同：\nIP=%d %s\nEMAIL=%d %s",
			byIP.StatusCode, byIP.Body, byEmail.StatusCode, byEmail.Body)
	}
	if byLegacy.StatusCode != http.StatusTooManyRequests || byLegacy.Body != byIP.Body {
		t.Errorf("既有複合 key 的 429 與新的兩道不同：%d %s", byLegacy.StatusCode, byLegacy.Body)
	}
}
