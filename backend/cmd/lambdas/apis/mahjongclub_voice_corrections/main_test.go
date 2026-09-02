package main

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// fakeStore 手寫假實作（不引入 mock 套件），記錄每一次寫入。
type fakeStore struct {
	items []map[string]types.AttributeValue
}

func (f *fakeStore) PutCorrection(_ context.Context, item map[string]types.AttributeValue) error {
	f.items = append(f.items, item)
	return nil
}

// withFakeStore 換掉 handler 用的 store，測試結束自動還原。
// handler → buildItem → store 這條真路徑因此可以整條走完而不碰 DDB。
func withFakeStore(t *testing.T) *fakeStore {
	t.Helper()
	f := &fakeStore{}
	old := store
	store = f
	t.Cleanup(func() { store = old })
	return f
}

func postRequest(userID, body string) events.APIGatewayProxyRequest {
	req := events.APIGatewayProxyRequest{
		HTTPMethod: "POST",
		Body:       body,
	}
	if userID != "" {
		req.RequestContext.Authorizer = map[string]interface{}{"userId": userID}
	}
	return req
}

const validBody = `{"text":"三暗刻 對對胡","normalizedText":"三暗刻對對胡",` +
	`"parsed":["san_anko"],"corrected":["san_anko","toitoi"],` +
	`"added":["toitoi"],"removed":[],"unmatched":"",` +
	`"hadDiff":true,"rulesetVersion":"tw16-v3","engineVersion":"1.4.0","ts":1756800000}`

// 1. authorizer 沒給 userId → 401，且絕不發生任何寫入（fail-closed）。
func TestHandlerUnauthorized(t *testing.T) {
	cases := map[string]events.APIGatewayProxyRequest{
		"no authorizer":  {HTTPMethod: "POST", Body: validBody},
		"empty userId":   postRequest("", validBody), // postRequest 對 "" 不掛 authorizer
		"blank userId":   {HTTPMethod: "POST", Body: validBody, RequestContext: events.APIGatewayProxyRequestContext{Authorizer: map[string]interface{}{"userId": "   "}}},
		"userId not str": {HTTPMethod: "POST", Body: validBody, RequestContext: events.APIGatewayProxyRequestContext{Authorizer: map[string]interface{}{"userId": 42}}},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			f := withFakeStore(t)
			resp, err := handler(context.Background(), req)
			if err != nil {
				t.Fatalf("handler returned error: %v", err)
			}
			if resp.StatusCode != 401 {
				t.Fatalf("want 401, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			if len(f.items) != 0 {
				t.Fatalf("expected zero DDB writes on 401, got %d", len(f.items))
			}
		})
	}
}

// 2. ts 缺少／<=0 → 400，且不寫入。
func TestHandlerBadTS(t *testing.T) {
	cases := map[string]string{
		"ts missing":  `{"hadDiff":true}`,
		"ts zero":     `{"hadDiff":true,"ts":0}`,
		"ts negative": `{"hadDiff":true,"ts":-1}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			f := withFakeStore(t)
			resp, err := handler(context.Background(), postRequest("u1", body))
			if err != nil {
				t.Fatalf("handler returned error: %v", err)
			}
			if resp.StatusCode != 400 {
				t.Fatalf("want 400, got %d (body: %s)", resp.StatusCode, resp.Body)
			}
			if len(f.items) != 0 {
				t.Fatalf("expected zero DDB writes on 400, got %d", len(f.items))
			}
		})
	}

	// 純函式層也直接驗一次。
	if _, err := buildItem("u1", CorrectionRequest{TS: 0}, 1700000000); err == nil {
		t.Fatal("buildItem should reject ts=0")
	}
	if _, err := buildItem("u1", CorrectionRequest{TS: -5}, 1700000000); err == nil {
		t.Fatal("buildItem should reject negative ts")
	}
}

// 3. hadDiff=false 也要寫一筆（守衛「每次送出都寫」的刻意設計）。
// 同時驗 pk 用的是 authorizer 的 userId、走的是 handler→buildItem→store 真路徑。
func TestHadDiffFalseStillWrites(t *testing.T) {
	f := withFakeStore(t)
	body := `{"text":"平胡","normalizedText":"平胡","parsed":["pinghu"],"corrected":["pinghu"],` +
		`"added":[],"removed":[],"hadDiff":false,"rulesetVersion":"tw16-v3","engineVersion":"1.4.0","ts":1756800000}`
	resp, err := handler(context.Background(), postRequest("u-nodiff", body))
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	if len(f.items) != 1 {
		t.Fatalf("hadDiff=false must still produce exactly one write, got %d", len(f.items))
	}
	item := f.items[0]
	hadDiff, ok := item["hadDiff"].(*types.AttributeValueMemberBOOL)
	if !ok {
		t.Fatalf("hadDiff attribute missing or wrong type: %#v", item["hadDiff"])
	}
	if hadDiff.Value != false {
		t.Fatal("hadDiff should be false")
	}
	pk, ok := item["pk"].(*types.AttributeValueMemberS)
	if !ok || pk.Value != "USER#u-nodiff" {
		t.Fatalf("pk must come from authorizer userId, got %#v", item["pk"])
	}
	sk, ok := item["sk"].(*types.AttributeValueMemberS)
	if !ok || !strings.HasPrefix(sk.Value, "TS#1756800000#") {
		t.Fatalf("sk must be TS#<ts>#<uuid>, got %#v", item["sk"])
	}
}

// 4. 空陣列不可產生非法的空 String Set（本實作選擇：空陣列 → 省略該欄）。
func TestEmptySetsOmitted(t *testing.T) {
	item, err := buildItem("u1", CorrectionRequest{
		TS:        1756800000,
		Parsed:    []string{},
		Corrected: nil,
		Added:     []string{"a"},
		Removed:   []string{},
	}, 1756800000)
	if err != nil {
		t.Fatalf("buildItem failed: %v", err)
	}
	for _, name := range []string{"parsed", "corrected", "removed"} {
		if _, present := item[name]; present {
			t.Fatalf("empty set %q must be omitted, got %#v", name, item[name])
		}
	}
	added, ok := item["added"].(*types.AttributeValueMemberSS)
	if !ok || len(added.Value) != 1 || added.Value[0] != "a" {
		t.Fatalf("non-empty added should be SS [a], got %#v", item["added"])
	}
	// 全 item 掃一遍：不准有任何空 SS。
	for name, av := range item {
		if ss, isSS := av.(*types.AttributeValueMemberSS); isSS && len(ss.Value) == 0 {
			t.Fatalf("attribute %q is an illegal empty string set", name)
		}
	}
}

// 5. expiresAt == 伺服器時刻 + 365*24*3600（不是呼叫端的 ts —— 見第 7 條）。
func TestExpiresAt(t *testing.T) {
	const ts int64 = 1700000000
	const now int64 = 1750000000
	item, err := buildItem("u1", CorrectionRequest{TS: ts}, now)
	if err != nil {
		t.Fatalf("buildItem failed: %v", err)
	}
	want := strconv.FormatInt(now+365*24*3600, 10)
	exp, ok := item["expiresAt"].(*types.AttributeValueMemberN)
	if !ok {
		t.Fatalf("expiresAt missing or wrong type: %#v", item["expiresAt"])
	}
	if exp.Value != want {
		t.Fatalf("expiresAt: want %s, got %s", want, exp.Value)
	}
	tsAttr, ok := item["ts"].(*types.AttributeValueMemberN)
	if !ok || tsAttr.Value != strconv.FormatInt(ts, 10) {
		t.Fatalf("ts attribute wrong: %#v", item["ts"])
	}
}

// 只處理 POST：其他方法回 405（OPTIONS 除外，回 200 給 CORS preflight）。
func TestMethodNotAllowed(t *testing.T) {
	f := withFakeStore(t)
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "GET"})
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if resp.StatusCode != 405 {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
	if len(f.items) != 0 {
		t.Fatalf("expected zero writes, got %d", len(f.items))
	}
}

// 7. 🔴 呼叫端把毫秒當秒送時，TTL 不可以跟著爆掉。
//
// 這條是**針對已修掉的缺陷**寫的守衛：舊版 expiresAt = req.TS + 365 天，
// 前端誤送毫秒（1756800000000）時 expiresAt 會落在西元五萬多年 ⇒ TTL 等於失效、
// 資料永久保留。方向對隱私是 fail-open：壞輸入的後果是「留更久」不是「被拒絕」。
//
// ⚠️ 驗收這條時要確認它**在修正前會紅** —— 否則它只是把現況重寫一遍。
// 實測：把 buildItem 的 nowUnix 換回 req.TS，本條立刻失敗（差 5 萬年）。
func TestExpiresAtIgnoresCallerClockSkew(t *testing.T) {
	const nowSec int64 = 1750000000
	const msTS int64 = 1756800000000 // 毫秒誤當秒送

	item, err := buildItem("u1", CorrectionRequest{TS: msTS}, nowSec)
	if err != nil {
		t.Fatalf("buildItem failed: %v", err)
	}

	exp, ok := item["expiresAt"].(*types.AttributeValueMemberN)
	if !ok {
		t.Fatalf("expiresAt missing or wrong type: %#v", item["expiresAt"])
	}
	want := strconv.FormatInt(nowSec+365*24*3600, 10)
	if exp.Value != want {
		t.Fatalf("expiresAt 必須由伺服器時刻算出: want %s, got %s（呼叫端的 ts 不可影響保存期限）", want, exp.Value)
	}

	// ts 欄仍原樣保留呼叫端的宣稱 —— 那是資料本身，只是不拿來算保存期限。
	tsAttr, ok := item["ts"].(*types.AttributeValueMemberN)
	if !ok || tsAttr.Value != strconv.FormatInt(msTS, 10) {
		t.Fatalf("ts 應原樣保留呼叫端的值: %#v", item["ts"])
	}
}
