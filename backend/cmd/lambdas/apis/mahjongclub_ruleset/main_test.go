package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

// fakeStore 手寫假實作（不引 mock 套件）。它回什麼由每條測試自己設。
type fakeStore struct {
	raw   string
	found bool
	err   error
	calls int
}

func (f *fakeStore) GetRulesetRaw(_ context.Context) (string, bool, error) {
	f.calls++
	return f.raw, f.found, f.err
}

// withFakeStore 換掉 handler 用的 store，測試結束自動還原。
// handler → store → parseRuleset 這條真路徑因此可以整條走完而不碰 DDB。
func withFakeStore(t *testing.T, f *fakeStore) *fakeStore {
	t.Helper()
	old := store
	store = f
	t.Cleanup(func() { store = old })
	return f
}

func getRequest(userID string) events.APIGatewayProxyRequest {
	req := events.APIGatewayProxyRequest{HTTPMethod: "GET"}
	if userID != "" {
		req.RequestContext.Authorizer = map[string]interface{}{"userId": userID}
	}
	return req
}

// 一份「後台真的會長這樣」的 info_value：ignores 是空陣列（D1-A 之後的正常值）。
const validRaw = `{"version":"tw16-v3",` +
	`"fans":{"pinghu":{"tai":2,"aliases":["平胡"]},"dasanyuan":{"tai":8}},` +
	`"combos":{"toitoi+san_anko":{"note":"合併"}},` +
	`"ignores":[]}`

func call(t *testing.T, req events.APIGatewayProxyRequest) events.APIGatewayProxyResponse {
	t.Helper()
	resp, err := handler(context.Background(), req)
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	return resp
}

// 1. authorizer 沒給 userId → 401，且絕不打 DDB（fail-closed）。
func TestUnauthorized(t *testing.T) {
	cases := map[string]events.APIGatewayProxyRequest{
		"no authorizer":  {HTTPMethod: "GET"},
		"blank userId":   {HTTPMethod: "GET", RequestContext: events.APIGatewayProxyRequestContext{Authorizer: map[string]interface{}{"userId": "   "}}},
		"userId not str": {HTTPMethod: "GET", RequestContext: events.APIGatewayProxyRequestContext{Authorizer: map[string]interface{}{"userId": 42}}},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			f := withFakeStore(t, &fakeStore{raw: validRaw, found: true})
			resp := call(t, req)
			if resp.StatusCode != 401 {
				t.Fatalf("want 401, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			if f.calls != 0 {
				t.Fatalf("401 之前不可以碰 store, got %d calls", f.calls)
			}
		})
	}
}

// 2. 那一列不存在 → 404，⛔ 不合成空表。
func TestRowMissingIs404(t *testing.T) {
	withFakeStore(t, &fakeStore{found: false})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 404 {
		t.Fatalf("want 404, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	// 就算狀態碼對了，body 也不可以長得像一份表（App 端若只看 body 會被騙）。
	var out map[string]json.RawMessage
	if err := json.Unmarshal([]byte(resp.Body), &out); err != nil {
		t.Fatalf("404 body 應是 JSON: %v", err)
	}
	for _, k := range []string{"fans", "combos", "ignores", "version"} {
		if _, present := out[k]; present {
			t.Fatalf("404 不可以夾帶 %q（那就是合成空表）: %s", k, resp.Body)
		}
	}
	if string(out["success"]) != "false" {
		t.Fatalf("404 的 success 必須是 false: %s", resp.Body)
	}
}

// 3. 快樂路徑：三鍵原封不動、version 正確、success=true。
func TestHappyPath(t *testing.T) {
	f := withFakeStore(t, &fakeStore{raw: validRaw, found: true})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	if f.calls != 1 {
		t.Fatalf("應該正好打 store 一次, got %d", f.calls)
	}
	var out struct {
		Success bool            `json:"success"`
		Version string          `json:"version"`
		Fans    json.RawMessage `json:"fans"`
		Combos  json.RawMessage `json:"combos"`
		Ignores json.RawMessage `json:"ignores"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &out); err != nil {
		t.Fatalf("body 不是 JSON: %v", err)
	}
	if !out.Success || out.Version != "tw16-v3" {
		t.Fatalf("success/version 錯: %s", resp.Body)
	}
	// 原封不動：用「語意相等」比（Go 的 json 會重排空白但不會重排鍵值）。
	var src map[string]json.RawMessage
	_ = json.Unmarshal([]byte(validRaw), &src)
	for k, got := range map[string]json.RawMessage{"fans": out.Fans, "combos": out.Combos, "ignores": out.Ignores} {
		if !jsonEqual(t, src[k], got) {
			t.Fatalf("%q 沒有原封不動轉出去:\n want %s\n got  %s", k, src[k], got)
		}
	}
	// fans 裡的巢狀鍵（aliases）也必須還在 —— 「原封不動」不是只有頂層。
	if !strings.Contains(string(out.Fans), `"aliases":["平胡"]`) {
		t.Fatalf("fans 的巢狀內容被丟掉了: %s", out.Fans)
	}
}

// 4. 🔴 這一對必須一起看：ignores: [] 合法 200；ignores 鍵缺席 502。
// 只有前者的話，把判準寫成 len(ignores)==0 → 502 也能全綠 —— 那是錯的。
func TestIgnoresEmptyArrayIsValid(t *testing.T) {
	withFakeStore(t, &fakeStore{raw: validRaw, found: true}) // validRaw 的 ignores 就是 []
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 200 {
		t.Fatalf("ignores: [] 是合法值，必須 200, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	var out map[string]json.RawMessage
	_ = json.Unmarshal([]byte(resp.Body), &out)
	if string(out["ignores"]) != "[]" {
		t.Fatalf("空集合要回 [] 不回 null: %s", out["ignores"])
	}
}

func TestIgnoresAbsentIs502(t *testing.T) {
	withFakeStore(t, &fakeStore{found: true, raw: `{"version":"tw16-v3","fans":{"a":1},"combos":{}}`})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 502 {
		t.Fatalf("ignores 缺席必須 502（否則偽裝成「沒有略過詞」）, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	assertNoTable(t, resp.Body)
}

func TestIgnoresNullIs502(t *testing.T) {
	withFakeStore(t, &fakeStore{found: true, raw: `{"version":"tw16-v3","fans":{"a":1},"combos":{},"ignores":null}`})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 502 {
		t.Fatalf("ignores: null 必須 502, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	assertNoTable(t, resp.Body)
}

// 5. fans／combos 缺席或 null → 502。
func TestFansCombosMissingIs502(t *testing.T) {
	cases := map[string]string{
		"fans absent":   `{"version":"v","combos":{},"ignores":[]}`,
		"fans null":     `{"version":"v","fans":null,"combos":{},"ignores":[]}`,
		"combos absent": `{"version":"v","fans":{},"ignores":[]}`,
		"combos null":   `{"version":"v","fans":{},"combos":null,"ignores":[]}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			withFakeStore(t, &fakeStore{found: true, raw: raw})
			resp := call(t, getRequest("u1"))
			if resp.StatusCode != 502 {
				t.Fatalf("want 502, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			assertNoTable(t, resp.Body)
		})
	}
	// 正控：同形的 raw 把缺的鍵補回（空物件）就要 200 —— 否則上面的 502
	// 可能是別的原因（例如 version）造成的，而兩者在狀態碼上逐字相同。
	withFakeStore(t, &fakeStore{found: true, raw: `{"version":"v","fans":{},"combos":{},"ignores":[]}`})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 200 {
		t.Fatalf("正控失敗：三鍵齊全（即使是空物件）應該 200, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
}

// 6. version 缺席／空字串／null → 502。
func TestVersionMissingIs502(t *testing.T) {
	cases := map[string]string{
		"version absent": `{"fans":{},"combos":{},"ignores":[]}`,
		"version empty":  `{"version":"","fans":{},"combos":{},"ignores":[]}`,
		"version null":   `{"version":null,"fans":{},"combos":{},"ignores":[]}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			withFakeStore(t, &fakeStore{found: true, raw: raw})
			resp := call(t, getRequest("u1"))
			if resp.StatusCode != 502 {
				t.Fatalf("want 502, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			assertNoTable(t, resp.Body)
		})
	}
}

// 7. info_value 不是合法 JSON → 502，不回 200 帶半份表。
func TestMalformedJSONIs502(t *testing.T) {
	cases := map[string]string{
		"truncated":   `{"version":"v","fans":{"a":1},"combos":{},"ignores":[`,
		"not json":    `hello`,
		"empty":       ``,
		"json array":  `[]`,
		"json string": `"tw16-v3"`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			withFakeStore(t, &fakeStore{found: true, raw: raw})
			resp := call(t, getRequest("u1"))
			if resp.StatusCode != 502 {
				t.Fatalf("want 502, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			assertNoTable(t, resp.Body)
		})
	}
}

// 8. DDB 呼叫本身出錯 → 502（不是 404：「拿不到」與「沒有」是兩件事）。
func TestStoreErrorIs502(t *testing.T) {
	withFakeStore(t, &fakeStore{err: errors.New("dynamodb: throttled"), raw: validRaw, found: true})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 502 {
		t.Fatalf("want 502, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	assertNoTable(t, resp.Body)
}

// 9. OPTIONS → 200（CORS preflight），且不碰 store；其他方法 405。
func TestOptionsAndMethods(t *testing.T) {
	f := withFakeStore(t, &fakeStore{raw: validRaw, found: true})
	resp := call(t, events.APIGatewayProxyRequest{HTTPMethod: "OPTIONS"})
	if resp.StatusCode != 200 {
		t.Fatalf("OPTIONS want 200, got %d", resp.StatusCode)
	}
	if resp.Headers["Access-Control-Allow-Origin"] != "*" {
		t.Fatalf("CORS header missing: %#v", resp.Headers)
	}
	if f.calls != 0 {
		t.Fatalf("OPTIONS 不該碰 store, got %d calls", f.calls)
	}
	resp = call(t, events.APIGatewayProxyRequest{HTTPMethod: "POST", RequestContext: events.APIGatewayProxyRequestContext{Authorizer: map[string]interface{}{"userId": "u1"}}})
	if resp.StatusCode != 405 {
		t.Fatalf("POST want 405, got %d", resp.StatusCode)
	}
}

// ── helpers ─────────────────────────────────────────────────────────────────

// assertNoTable：非 200 的 body 不可以夾帶任何表鍵（不回半份表）。
func assertNoTable(t *testing.T, body string) {
	t.Helper()
	var out map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("error body 應是 JSON: %v (%s)", err, body)
	}
	if string(out["success"]) != "false" {
		t.Fatalf("error body 的 success 必須是 false: %s", body)
	}
	for _, k := range []string{"fans", "combos", "ignores", "version"} {
		if _, present := out[k]; present {
			t.Fatalf("錯誤回應不可以夾帶 %q（半份表）: %s", k, body)
		}
	}
}

func jsonEqual(t *testing.T, a, b json.RawMessage) bool {
	t.Helper()
	var va, vb interface{}
	if err := json.Unmarshal(a, &va); err != nil {
		t.Fatalf("bad json a: %v", err)
	}
	if err := json.Unmarshal(b, &vb); err != nil {
		t.Fatalf("bad json b: %v", err)
	}
	ca, _ := json.Marshal(va)
	cb, _ := json.Marshal(vb)
	return string(ca) == string(cb)
}
