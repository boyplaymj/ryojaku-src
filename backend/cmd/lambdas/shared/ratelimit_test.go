package shared

// PeekRateLimit / CheckRateLimit 的行為測試。
// maintenance_test.go 那套「指向 127.0.0.1:1」只驗得到 fail-open；這裡要驗**計數行為**，
// 所以用 httptest.Server 當假 DynamoDB 端點，回 DynamoDB JSON 協定的回應，
// 並把每個 request 的 X-Amz-Target 與 body **記下來**，讓測試去斷言實際送出去的 rlKey /
// ConsistentRead 是什麼 —— 假件只回我指定的答案的話，「送錯桶」對它零徵兆。

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// ddbRecordedRequest：假 DDB 收到的一筆 request。Op 取自 X-Amz-Target（"DynamoDB_20120810.GetItem"）。
type ddbRecordedRequest struct {
	Op   string
	Body map[string]any
}

// rlKey 取 Key.rlKey.S；缺任何一層就回空字串（呼叫端會拿它去比對，空字串必然不等）。
func (r ddbRecordedRequest) rlKey() string {
	key, _ := r.Body["Key"].(map[string]any)
	rl, _ := key["rlKey"].(map[string]any)
	s, _ := rl["S"].(string)
	return s
}

// fakeDDB：記錄 request、依 op 回固定 JSON。
type fakeDDB struct {
	mu   sync.Mutex
	reqs []ddbRecordedRequest
	// getItemResp / updateItemResp：回給對應 op 的 JSON 字串（DynamoDB 協定）。
	getItemResp    string
	updateItemResp string
}

func (f *fakeDDB) ops() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.reqs))
	for _, r := range f.reqs {
		out = append(out, r.Op)
	}
	return out
}

func (f *fakeDDB) requests() []ddbRecordedRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]ddbRecordedRequest(nil), f.reqs...)
}

// installFakeDDB：起 httptest.Server、把套件層 authDDBClient 指過去，t.Cleanup 還原。
func installFakeDDB(t *testing.T, f *fakeDDB) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		op := strings.TrimPrefix(r.Header.Get("X-Amz-Target"), "DynamoDB_20120810.")
		f.mu.Lock()
		f.reqs = append(f.reqs, ddbRecordedRequest{Op: op, Body: body})
		f.mu.Unlock()

		w.Header().Set("Content-Type", "application/x-amz-json-1.0")
		switch op {
		case "GetItem":
			_, _ = io.WriteString(w, f.getItemResp)
		case "UpdateItem":
			_, _ = io.WriteString(w, f.updateItemResp)
		default:
			http.Error(w, `{"__type":"UnknownOperationException"}`, 400)
		}
	}))
	t.Cleanup(srv.Close)

	orig := authDDBClient
	authDDBClient = dynamodb.New(dynamodb.Options{
		Region:       "ap-southeast-1",
		BaseEndpoint: aws.String(srv.URL),
		Credentials:  aws.AnonymousCredentials{},
		Retryer:      aws.NopRetryer{},
	})
	t.Cleanup(func() { authDDBClient = orig })
}

func testCtx(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func getItemCount(n int) string {
	return fmt.Sprintf(`{"Item":{"rlKey":{"S":"x"},"count":{"N":"%d"}}}`, n)
}

// T1 邊界：釘住 allowed = count < limit（「再加一次還在額度內嗎」）。
// 防的是 off-by-one 寫成 count <= limit —— 那會讓第 limit+1 次失敗才被擋，
// 每個桶多放一次；對照 CheckRateLimit 先加一再 n <= limit，兩者語意要對得起來。
func TestPeekRateLimit_Boundary(t *testing.T) {
	cases := []struct {
		count int
		want  bool
	}{
		{count: 0, want: true},
		{count: 9, want: true},   // 已計 9，再加一是 10 ⇒ 還在額度內
		{count: 10, want: false}, // 已計 10，再加一是 11 ⇒ 超額
		{count: 11, want: false},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("count=%d", tc.count), func(t *testing.T) {
			f := &fakeDDB{getItemResp: getItemCount(tc.count)}
			installFakeDDB(t, f)
			got, err := PeekRateLimit(testCtx(t), "login#email#a@b.com", 10, 900)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Fatalf("PeekRateLimit(count=%d, limit=10) = %v, want %v", tc.count, got, tc.want)
			}
		})
	}
}

// T2 不加一：peek 只能送 GetItem，**不能**送 UpdateItem。
// 防的是 peek 偷偷加一 —— 那樣「只計失敗」整個設計就沒了（成功登入也會被算進去）。
func TestPeekRateLimit_DoesNotIncrement(t *testing.T) {
	f := &fakeDDB{getItemResp: getItemCount(3)}
	installFakeDDB(t, f)
	if _, err := PeekRateLimit(testCtx(t), "login#email#a@b.com", 10, 900); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	ops := f.ops()
	if len(ops) != 1 || ops[0] != "GetItem" {
		t.Fatalf("PeekRateLimit 必須只送一個 GetItem，實際送出 %v", ops)
	}
	for _, op := range ops {
		if op == "UpdateItem" {
			t.Fatalf("PeekRateLimit 送出了 UpdateItem（偷偷加一）：%v", ops)
		}
	}
}

// T3 同桶（本次最重要的一條）：對同一組 (key, windowSec) 分別呼叫 PeekRateLimit 與
// CheckRateLimit，從假件記到的兩個 request body 取出 rlKey，斷言字串相等。
// 防的是：peek 與 increment 算到**不同桶** ⇒ peek 永遠讀到空 item ⇒ 永遠放行 ⇒
// 限流變 no-op，而每次呼叫都回 (true, nil)、log 乾淨、外觀完全正常 —— 沒有這條的話零徵兆。
// 另外拿字面公式 fmt.Sprintf("%s#%d", key, now/window) 再對一次，釘住與線上既有 item 的
// key 格式相容（兩支一起改格式雖然彼此同桶，但會跟舊資料脫鉤）。
func TestPeekAndCheckRateLimit_SameBucket(t *testing.T) {
	const key = "login_fail#email#a@b.com"
	const window int64 = 3600

	var reqs []ddbRecordedRequest
	var expected string
	for attempt := 0; attempt < 3; attempt++ {
		f := &fakeDDB{getItemResp: getItemCount(1), updateItemResp: `{"Attributes":{"count":{"N":"2"}}}`}
		installFakeDDB(t, f)
		before := time.Now().Unix() / window
		if _, err := PeekRateLimit(testCtx(t), key, 10, window); err != nil {
			t.Fatalf("peek err: %v", err)
		}
		if _, err := CheckRateLimit(testCtx(t), key, 10, window); err != nil {
			t.Fatalf("check err: %v", err)
		}
		after := time.Now().Unix() / window
		reqs = f.requests()
		if before == after { // 兩次呼叫沒跨過窗口邊界，這次取樣有效
			expected = fmt.Sprintf("%s#%d", key, before)
			break
		}
		reqs = nil // 剛好跨窗口（每小時一瞬），重試
	}
	if reqs == nil {
		t.Fatal("三次都跨到窗口邊界，取樣失敗")
	}
	if len(reqs) != 2 || reqs[0].Op != "GetItem" || reqs[1].Op != "UpdateItem" {
		t.Fatalf("預期 [GetItem UpdateItem]，實際 %v", f2ops(reqs))
	}
	peekKey, checkKey := reqs[0].rlKey(), reqs[1].rlKey()
	if peekKey == "" || checkKey == "" {
		t.Fatalf("從 request body 取不到 Key.rlKey.S：peek=%q check=%q", peekKey, checkKey)
	}
	if peekKey != checkKey {
		t.Fatalf("peek 與 increment 算到不同桶 ⇒ 限流變 no-op：peek=%q check=%q", peekKey, checkKey)
	}
	if peekKey != expected {
		t.Fatalf("rlKey 格式與既有字面公式不符：got %q want %q", peekKey, expected)
	}
}

func f2ops(rs []ddbRecordedRequest) []string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, r.Op)
	}
	return out
}

// T4 item 不存在：GetItem 回空 ⇒ count 視為 0 ⇒ (true, nil)。
// 防的是把「沒 item」當成錯誤或當成超額 —— 每個新窗口的第一個人都會被擋。
func TestPeekRateLimit_MissingItem(t *testing.T) {
	f := &fakeDDB{getItemResp: `{}`}
	installFakeDDB(t, f)
	got, err := PeekRateLimit(testCtx(t), "login#email#a@b.com", 10, 900)
	if err != nil {
		t.Fatalf("item 不存在不該回 err，實得 %v", err)
	}
	if !got {
		t.Fatal("item 不存在時必須放行（count=0 < limit），實得 false")
	}
}

// T5 fail-open：DDB 連不上 ⇒ 放行且回 err。與 CheckRateLimit / IsMaintenanceMode 一致。
// 防的是被誰改成 fail-closed —— 限流層一故障就把所有登入擋死。
func TestPeekRateLimit_FailOpenOnDDBError(t *testing.T) {
	orig := authDDBClient
	authDDBClient = dynamodb.New(dynamodb.Options{
		Region:       "ap-southeast-1",
		BaseEndpoint: aws.String("http://127.0.0.1:1"),
		Credentials:  aws.AnonymousCredentials{},
		Retryer:      aws.NopRetryer{},
	})
	t.Cleanup(func() { authDDBClient = orig })

	got, err := PeekRateLimit(testCtx(t), "login#email#a@b.com", 10, 900)
	if err == nil {
		t.Fatal("連線必被拒絕，err 不該是 nil")
	}
	if !got {
		t.Fatalf("DDB 出錯時必須 fail-open（回 true），實得 false（err=%v）", err)
	}
}

// T6 ConsistentRead：GetItem request body 的 ConsistentRead 必須是 true。
// 防的是被改成最終一致讀 —— 這支是准入閘，落後的計數會低估 ⇒ 多放行，
// 而且症狀只在「剛好被加到 limit 的下一瞬間」出現，肉眼幾乎抓不到。
func TestPeekRateLimit_ConsistentRead(t *testing.T) {
	f := &fakeDDB{getItemResp: getItemCount(1)}
	installFakeDDB(t, f)
	if _, err := PeekRateLimit(testCtx(t), "login#email#a@b.com", 10, 900); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	reqs := f.requests()
	if len(reqs) != 1 {
		t.Fatalf("預期 1 個 request，實得 %d", len(reqs))
	}
	cr, ok := reqs[0].Body["ConsistentRead"].(bool)
	if !ok || !cr {
		t.Fatalf("GetItem 必須帶 ConsistentRead=true，實際 body: %v", reqs[0].Body)
	}
}

// T7 桶號隨窗口變：純函式，不需假件。
// 防的是分桶退化成常數（永遠同桶 ⇒ 永遠不重置）或每秒一桶（永遠不累積）。
func TestRateLimitBucketKey_ChangesAcrossWindow(t *testing.T) {
	const key = "k"
	const window int64 = 900
	a := rateLimitBucketKey(key, window, 900*100+0)
	b := rateLimitBucketKey(key, window, 900*100+899) // 同窗口最後一秒
	c := rateLimitBucketKey(key, window, 900*100+900) // 跨過邊界
	if a != b {
		t.Fatalf("同一窗口內必須同桶：%q vs %q", a, b)
	}
	if b == c {
		t.Fatalf("跨過窗口邊界必須換桶：%q vs %q", b, c)
	}
	if want := "k#100"; a != want {
		t.Fatalf("桶號格式：got %q want %q", a, want)
	}
	if want := "k#101"; c != want {
		t.Fatalf("桶號格式：got %q want %q", c, want)
	}
}

// T8 CheckRateLimit 對外行為不變：重構後仍是「先加一、n <= limit」、走 UpdateItem、
// key 格式與字面公式相同。這條是給本次抽出 rateLimitBucketKey 那個重構當回歸網用的。
func TestCheckRateLimit_BehaviorUnchanged(t *testing.T) {
	cases := []struct {
		count int
		want  bool
	}{
		{count: 10, want: true},  // 加一後正好 = limit ⇒ 放行
		{count: 11, want: false}, // 加一後 > limit ⇒ 擋
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("count=%d", tc.count), func(t *testing.T) {
			f := &fakeDDB{updateItemResp: fmt.Sprintf(`{"Attributes":{"count":{"N":"%d"}}}`, tc.count)}
			installFakeDDB(t, f)
			const key = "register#ip#1.2.3.4"
			const window int64 = 3600
			before := time.Now().Unix() / window
			got, err := CheckRateLimit(testCtx(t), key, 10, window)
			after := time.Now().Unix() / window
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tc.want {
				t.Fatalf("CheckRateLimit(n=%d, limit=10) = %v, want %v", tc.count, got, tc.want)
			}
			reqs := f.requests()
			if len(reqs) != 1 || reqs[0].Op != "UpdateItem" {
				t.Fatalf("CheckRateLimit 必須送一個 UpdateItem，實際 %v", f2ops(reqs))
			}
			if before == after {
				if want := fmt.Sprintf("%s#%d", key, before); reqs[0].rlKey() != want {
					t.Fatalf("rlKey got %q want %q", reqs[0].rlKey(), want)
				}
			}
		})
	}
}
