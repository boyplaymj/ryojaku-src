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

// 一份「後台真的會長這樣」的 info_value：ignores 是空陣列（D1-A 之後的正常值），
// config 帶著唯一有計分作用的 base_di（scoring.js:165 直接進總台數）。
const validRaw = `{"version":"tw16-v3",` +
	`"fans":{"pinghu":{"tai":2,"aliases":["平胡"]},"dasanyuan":{"tai":8}},` +
	`"combos":{"toitoi+san_anko":{"note":"合併"}},` +
	`"ignores":[],` +
	`"config":{"base_di":1}}`

// 🔴 五個表鍵都會造成 502 ⇒ 每一條 502 測試的 fixture 只准缺**它自己要驗的那一個**。
// ⚠️ 本段初稿寫「D5-b2 加 config 時就一次製造了三條綠得不是地方的測試」——
// **那是我推的，實跑打臉**：config 的檢查排在最後，所以舊 fixture（沒有 config）
// 的 version／fans／combos／ignores 那幾條，502 的原因**仍然是對的**。
// 突變 M6（fixture 退回舊寫法）因此存活。
// 真正的形狀是**潛在的**：只要有人把 config 的檢查往前搬（一個很合理的重構），
// 那些 fixture 立刻變成「因為 config 缺了而 502」，而狀態碼逐字相同。
// 突變 M7（config 檢查移到最前面 ＋ fixture 退回舊寫法）確認 assert502Because
// 抓得到它：`502 的原因不是 "version"…實得: ruleset config missing`。
// ⇒ 留著它的理由是「檢查順序不該是測試綠不綠的隱性前提」，不是我修好了什麼。
const allKeys = `"version":"v","fans":{},"combos":{},"ignores":[],"config":{}`

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
	for _, k := range []string{"fans", "combos", "ignores", "version", "config"} {
		if _, present := out[k]; present {
			t.Fatalf("404 不可以夾帶 %q（那就是合成空表）: %s", k, resp.Body)
		}
	}
	if string(out["success"]) != "false" {
		t.Fatalf("404 的 success 必須是 false: %s", resp.Body)
	}
}

// 3. 快樂路徑：四個表鍵原封不動、version 正確、success=true。
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
		Config  json.RawMessage `json:"config"`
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
	for k, got := range map[string]json.RawMessage{"fans": out.Fans, "combos": out.Combos, "ignores": out.Ignores, "config": out.Config} {
		if !jsonEqual(t, src[k], got) {
			t.Fatalf("%q 沒有原封不動轉出去:\n want %s\n got  %s", k, src[k], got)
		}
	}
	// fans 裡的巢狀鍵（aliases）也必須還在 —— 「原封不動」不是只有頂層。
	if !strings.Contains(string(out.Fans), `"aliases":["平胡"]`) {
		t.Fatalf("fans 的巢狀內容被丟掉了: %s", out.Fans)
	}
	// 🔴 config 也要驗到**值**，不能只驗「這個鍵在」：
	// 整段 config 原封不動與「回了一個空殼 {}」在 jsonEqual 以外的檢查上都成立，
	// 而後者正是 D5-b2 要防的失效（底傳不過去）。
	if !strings.Contains(string(out.Config), `"base_di":1`) {
		t.Fatalf("config.base_di 沒有原封不動轉出去（底傳不過去就是 §5b 那個缺口）: %s", out.Config)
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
	withFakeStore(t, &fakeStore{found: true, raw: `{"version":"tw16-v3","fans":{"a":1},"combos":{},"config":{}}`})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 502 {
		t.Fatalf("ignores 缺席必須 502（否則偽裝成「沒有略過詞」）, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	assertNoTable(t, resp.Body)
	assert502Because(t, resp.Body, "ignores")
}

func TestIgnoresNullIs502(t *testing.T) {
	withFakeStore(t, &fakeStore{found: true, raw: `{"version":"tw16-v3","fans":{"a":1},"combos":{},"ignores":null,"config":{}}`})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 502 {
		t.Fatalf("ignores: null 必須 502, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	assertNoTable(t, resp.Body)
	assert502Because(t, resp.Body, "ignores")
}

// 5. fans／combos 缺席或 null → 502。
func TestFansCombosMissingIs502(t *testing.T) {
	// 每個 fixture 只缺自己那一鍵，其餘四鍵齊全 ⇒ 502 的原因不會混。
	cases := map[string]struct{ raw, because string }{
		"fans absent":   {`{"version":"v","combos":{},"ignores":[],"config":{}}`, "fans"},
		"fans null":     {`{"version":"v","fans":null,"combos":{},"ignores":[],"config":{}}`, "fans"},
		"combos absent": {`{"version":"v","fans":{},"ignores":[],"config":{}}`, "combos"},
		"combos null":   {`{"version":"v","fans":{},"combos":null,"ignores":[],"config":{}}`, "combos"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			withFakeStore(t, &fakeStore{found: true, raw: c.raw})
			resp := call(t, getRequest("u1"))
			if resp.StatusCode != 502 {
				t.Fatalf("want 502, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			assertNoTable(t, resp.Body)
			assert502Because(t, resp.Body, c.because)
		})
	}
	// 正控：同形的 raw 把缺的鍵補回（空物件）就要 200 —— 否則上面的 502
	// 可能是別的原因（例如 version）造成的，而兩者在狀態碼上逐字相同。
	withFakeStore(t, &fakeStore{found: true, raw: `{` + allKeys + `}`})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 200 {
		t.Fatalf("正控失敗：五鍵齊全（即使是空物件）應該 200, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
}

// 6. version 缺席／空字串／null → 502。
func TestVersionMissingIs502(t *testing.T) {
	cases := map[string]string{
		"version absent": `{"fans":{},"combos":{},"ignores":[],"config":{}}`,
		"version empty":  `{"version":"","fans":{},"combos":{},"ignores":[],"config":{}}`,
		"version null":   `{"version":null,"fans":{},"combos":{},"ignores":[],"config":{}}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			withFakeStore(t, &fakeStore{found: true, raw: raw})
			resp := call(t, getRequest("u1"))
			if resp.StatusCode != 502 {
				t.Fatalf("want 502, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			assertNoTable(t, resp.Body)
			assert502Because(t, resp.Body, "version")
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

// 10. D5-b2：config 缺席／null → 502。
// 🔴 這是 §5b 量到的缺口：後台把「底」從 1 改成 2，下發傳不過去，
// App 端拿到新的 fans 配著 bundle 裡的舊 config —— 而且缺了不會叫。
func TestConfigMissingIs502(t *testing.T) {
	cases := map[string]string{
		"config absent": `{"version":"v","fans":{},"combos":{},"ignores":[]}`,
		"config null":   `{"version":"v","fans":{},"combos":{},"ignores":[],"config":null}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			withFakeStore(t, &fakeStore{found: true, raw: raw})
			resp := call(t, getRequest("u1"))
			if resp.StatusCode != 502 {
				t.Fatalf("config %s 必須 502（否則底傳不過去而零徵兆）, got %d (body: %s)", name, resp.StatusCode, resp.Body)
			}
			assertNoTable(t, resp.Body)
			assert502Because(t, resp.Body, "config")
		})
	}
}

// 11. 🔴 這一條與上一條必須一起看，理由同 ignores 那一對：
// 只有「缺席 502」的話，把判準寫成「config 是空物件也 502」照樣全綠 —— 那是錯的。
// config: {} 是**合法**的：唯一有計分作用的欄位是 config.base_di，而
// scoring.js:165 是 `if (cfg.base_di) total += cfg.base_di`
// ⇒「base_di 缺席」與「base_di: 0」在引擎裡逐值相同，缺席就是「這家沒有底」的
// 合法表示法。要求它存在等於發明一條引擎沒有的約束。
func TestConfigEmptyObjectIsValid(t *testing.T) {
	withFakeStore(t, &fakeStore{found: true, raw: `{` + allKeys + `}`})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 200 {
		t.Fatalf("config: {} 是合法值（沒有底），必須 200, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	var out map[string]json.RawMessage
	_ = json.Unmarshal([]byte(resp.Body), &out)
	if string(out["config"]) != "{}" {
		t.Fatalf("空 config 要回 {} 不回 null: %s", out["config"])
	}
}

// 12. 🔴 死旗標不進契約（§5b 實測：零讀取端）。
// 但這支的職責是「原封不動」⇒ 後台那一列裡真的有它時，**不可以被丟掉也不可以報錯**。
// 「不進契約」講的是「不要求它在」，不是「看到就過濾」——兩者差很多，
// 而過濾掉會讓 D5-e 後台編輯頁存進去的東西悄悄消失。
func TestUnknownConfigFieldsPassThrough(t *testing.T) {
	raw := `{"version":"v","fans":{},"combos":{},"ignores":[],` +
		`"config":{"base_di":2,"allow_stack_menqing_zimo":true,"future_knob":"x"}}`
	withFakeStore(t, &fakeStore{found: true, raw: raw})
	resp := call(t, getRequest("u1"))
	if resp.StatusCode != 200 {
		t.Fatalf("config 裡有契約外的欄位不該擋, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	var out map[string]json.RawMessage
	_ = json.Unmarshal([]byte(resp.Body), &out)
	for _, needle := range []string{`"base_di":2`, `"allow_stack_menqing_zimo":true`, `"future_knob":"x"`} {
		if !strings.Contains(string(out["config"]), needle) {
			t.Fatalf("config 沒有原封不動轉出去，少了 %s: %s", needle, out["config"])
		}
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
	for _, k := range []string{"fans", "combos", "ignores", "version", "config"} {
		if _, present := out[k]; present {
			t.Fatalf("錯誤回應不可以夾帶 %q（半份表）: %s", k, body)
		}
	}
}

// assert502Because：502 的 body 要指名**是哪一鍵**缺了。
// 🔴 五個表鍵都會 502 ⇒ 只斷言狀態碼的話，fixture 少寫一鍵會讓測試
// 綠得毫無鑑別力（D5-b2 加 config 時就一次製造了三條這種）。
func assert502Because(t *testing.T, body, key string) {
	t.Helper()
	var out struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("error body 應是 JSON: %v (%s)", err, body)
	}
	if !strings.Contains(out.Error, "ruleset "+key+" missing") {
		t.Fatalf("502 的原因不是 %q —— 這條測試綠得不是地方。實得: %s", key, out.Error)
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
