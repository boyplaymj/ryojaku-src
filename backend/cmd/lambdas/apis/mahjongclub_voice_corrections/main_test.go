package main

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

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
	// 🔴 body 刻意夾帶 "userId":"attacker" —— 否則「pk 不取 body」這條斷言是空的：
	// 沒有衝突值的話，pk 正確與程式其實讀了 body 兩種情形長得一模一樣。
	// （Codex 交叉查驗 2026-09-02 指出：原版 body 沒有這個欄位，斷言從沒被考驗過。）
	body := `{"text":"平胡","normalizedText":"平胡","parsed":["pinghu"],"corrected":["pinghu"],` +
		`"added":[],"removed":[],"hadDiff":false,"rulesetVersion":"tw16-v3","engineVersion":"1.4.0",` +
		`"ts":1756800000,"userId":"attacker","pk":"USER#attacker"}`
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
		t.Fatalf("pk 必須來自 authorizer 而非 body（body 夾帶了 attacker）, got %#v", item["pk"])
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

// 8. 🔴 handler 層的 TTL 守衛：寫進 DDB 的 expiresAt 必須由**伺服器時刻**算出。
//
// 為什麼第 7 條不夠（Grok 交叉查驗 2026-09-02 抓到，我漏了）：
// 第 7 條釘的是 buildItem 的**第三個參數**，而「handler 到底傳了什麼進去」沒有人看。
// 實測：把 handler 改成 buildItem(userID, req, req.TS) 並拿掉因此沒用到的
// "time" import ⇒ **7 條全綠**。也就是說剛修掉的隱私 fail-open
// 可以原封不動被放回去，而測試一聲都不會叫。
// （只改呼叫、留著 import 會編譯失敗 —— 但那是 Go 編譯器在擋，不是測試在擋，
//
//	不能算數：把 import 一併拿掉就編得過了。）
//
// ⇒ 這一條走**完整 handler**，看真正寫進 store 的那個值。
func TestHandlerExpiresAtComesFromServerClock(t *testing.T) {
	const msTS int64 = 1756800000000 // 前端誤把毫秒當秒送

	f := withFakeStore(t)
	before := time.Now().Unix()
	body := `{"text":"平胡","hadDiff":false,"ts":1756800000000}`
	resp, err := handler(context.Background(), postRequest("u-ttl", body))
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	after := time.Now().Unix()
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	if len(f.items) != 1 {
		t.Fatalf("want exactly one write, got %d", len(f.items))
	}

	exp, ok := f.items[0]["expiresAt"].(*types.AttributeValueMemberN)
	if !ok {
		t.Fatalf("expiresAt missing or wrong type: %#v", f.items[0]["expiresAt"])
	}
	got, err := strconv.ParseInt(exp.Value, 10, 64)
	if err != nil {
		t.Fatalf("expiresAt 不是合法整數: %q", exp.Value)
	}

	// 必須落在「本次呼叫期間的伺服器時刻 + 365 天」這個區間內。
	lo, hi := before+expiresAtTTLSeconds, after+expiresAtTTLSeconds
	if got < lo || got > hi {
		t.Fatalf("expiresAt 必須由伺服器時刻算出: got %d, 期望落在 [%d, %d]", got, lo, hi)
	}

	// 並且明確地**不是**呼叫端 ts 算出來的那個值（西元五萬七千年）。
	if bad := msTS + expiresAtTTLSeconds; got == bad {
		t.Fatalf("expiresAt 由呼叫端 ts 算出 (%d) —— TTL 等於失效、資料永久保留", bad)
	}

	// ts 欄仍原樣保留呼叫端的宣稱。
	tsAttr, ok := f.items[0]["ts"].(*types.AttributeValueMemberN)
	if !ok || tsAttr.Value != strconv.FormatInt(msTS, 10) {
		t.Fatalf("ts 應原樣保留呼叫端的值: %#v", f.items[0]["ts"])
	}
}

// ── D4-g 漏斗埋點：kind 欄位 ────────────────────────────────────────────────

// 9. 既有資料沒有 kind ⇒ 一律當成 correction。
//
// 🔴 這條守的是**向後相容的方向**。反過來預設（空 ⇒ 事件）不會有任何錯誤訊號，
// 只會讓 D4-c 上線到現在寫下的每一筆真實訂正靜靜地從飛輪裡消失。
func TestKindDefaultsToCorrection(t *testing.T) {
	item, err := buildItem("u1", CorrectionRequest{TS: 1756800000}, 1756800000)
	if err != nil {
		t.Fatalf("buildItem failed: %v", err)
	}
	k, ok := item["kind"].(*types.AttributeValueMemberS)
	if !ok || k.Value != "correction" {
		t.Fatalf("缺 kind 必須補成 correction, got %#v", item["kind"])
	}
}

// 10. 認不得的 kind 一律 400，不可以吞成 correction。
//
// 🔴 吞掉的方向剛好對我們有利（事件列混進準確率的分母 ⇒ 看起來判得更準），
// 這種「錯了會讓數字變好看」的預設一定要 fail-closed。
func TestUnknownKindRejected(t *testing.T) {
	f := withFakeStore(t)
	resp, err := handler(context.Background(), postRequest("u1", `{"ts":1756800000,"kind":"correctoin"}`))
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if resp.StatusCode != 400 {
		t.Fatalf("want 400 for unknown kind, got %d (body: %s)", resp.StatusCode, resp.Body)
	}
	if len(f.items) != 0 {
		t.Fatalf("expected zero DDB writes on unknown kind, got %d", len(f.items))
	}
	// 正控：同一條路徑,把 kind 改成合法值就要 200 —— 否則上面那個 400
	// 可能是別的原因造成的（例如 ts 沒帶），而兩者在狀態碼上逐字相同。
	resp2, err := handler(context.Background(), postRequest("u1", `{"ts":1756800000,"kind":"open"}`))
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if resp2.StatusCode != 200 {
		t.Fatalf("正控失敗：合法 kind 應該 200, got %d (body: %s)", resp2.StatusCode, resp2.Body)
	}
	if len(f.items) != 1 {
		t.Fatalf("合法 kind 應該寫入一筆, got %d", len(f.items))
	}
}

// 11. 🔴 事件列絕不寫入 added／removed／parsed／corrected，即使 body 送了。
//
// 這是第二道防線（第一道是後台的 kind 過濾）。它擋的不是「數字不好看」，
// 是**假的訂正建議被回灌進家規台數表** —— feedback.js 的 extractSuggestions
// 吃的就是 added／removed。
func TestEventRowsNeverCarryDiffFields(t *testing.T) {
	for _, kind := range []string{"open", "asr"} {
		item, err := buildItem("u1", CorrectionRequest{
			TS: 1756800000, Kind: kind,
			Parsed: []string{"pinghu"}, Corrected: []string{"pinghu"},
			Added: []string{"dasanyuan"}, Removed: []string{"pinghu"},
			Text: "大三元",
		}, 1756800000)
		if err != nil {
			t.Fatalf("buildItem(%s) failed: %v", kind, err)
		}
		for _, name := range []string{"parsed", "corrected", "added", "removed"} {
			if _, present := item[name]; present {
				t.Fatalf("kind=%s 的列不可以帶 %q, got %#v", kind, name, item[name])
			}
		}
	}
	// 反控：同一份 body 走 correction 時那四欄**必須**在 —— 否則上面那條
	// 可能只是 setStringSet 整個壞掉了，而「刻意不寫」與「根本不會寫」同形。
	item, err := buildItem("u1", CorrectionRequest{
		TS: 1756800000, Kind: "correction",
		Parsed: []string{"pinghu"}, Corrected: []string{"pinghu"},
		Added: []string{"dasanyuan"}, Removed: []string{"pinghu"},
	}, 1756800000)
	if err != nil {
		t.Fatalf("buildItem(correction) failed: %v", err)
	}
	for _, name := range []string{"parsed", "corrected", "added", "removed"} {
		if _, present := item[name]; !present {
			t.Fatalf("反控失敗：correction 列應該要有 %q", name)
		}
	}
}

// 12. asr 事件把成敗與原因存下來；成功時不留 asrError。
func TestAsrEventFields(t *testing.T) {
	fail, err := buildItem("u1", CorrectionRequest{
		TS: 1756800000, Kind: "asr", AsrOk: false, AsrTrack: "native", AsrError: "not-allowed",
	}, 1756800000)
	if err != nil {
		t.Fatalf("buildItem failed: %v", err)
	}
	ok, isBool := fail["asrOk"].(*types.AttributeValueMemberBOOL)
	if !isBool || ok.Value != false {
		t.Fatalf("asrOk 應該存成 false, got %#v", fail["asrOk"])
	}
	if e, isStr := fail["asrError"].(*types.AttributeValueMemberS); !isStr || e.Value != "not-allowed" {
		t.Fatalf("asrError 應該是 not-allowed, got %#v", fail["asrError"])
	}
	if tr, isStr := fail["asrTrack"].(*types.AttributeValueMemberS); !isStr || tr.Value != "native" {
		t.Fatalf("asrTrack 應該是 native, got %#v", fail["asrTrack"])
	}

	good, err := buildItem("u1", CorrectionRequest{TS: 1756800000, Kind: "asr", AsrOk: true, AsrTrack: "web"}, 1756800000)
	if err != nil {
		t.Fatalf("buildItem failed: %v", err)
	}
	if okv, isBool := good["asrOk"].(*types.AttributeValueMemberBOOL); !isBool || okv.Value != true {
		t.Fatalf("asrOk 應該存成 true, got %#v", good["asrOk"])
	}
	if _, present := good["asrError"]; present {
		t.Fatalf("成功的 asr 不該有 asrError, got %#v", good["asrError"])
	}

	// 🔴 asr 專屬欄位不可以外洩到別的 kind —— 否則後台以 asrOk 是否存在
	// 判斷「這是不是一筆辨識事件」時會誤判。
	opened, err := buildItem("u1", CorrectionRequest{TS: 1756800000, Kind: "open", AsrOk: true, AsrTrack: "web"}, 1756800000)
	if err != nil {
		t.Fatalf("buildItem failed: %v", err)
	}
	for _, name := range []string{"asrOk", "asrTrack", "asrError"} {
		if _, present := opened[name]; present {
			t.Fatalf("kind=open 不該有 %q, got %#v", name, opened[name])
		}
	}
}
