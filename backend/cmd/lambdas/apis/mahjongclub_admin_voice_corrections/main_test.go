package main

import (
	"context"
	"encoding/json"
	"testing"

	"mahjongclub-backend/cmd/lambdas/adminrole"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-admin-secret-not-a-real-one"

// fakeScanner 記錄「被查了幾次」——401/403/405/未設定 secret 這幾條要斷言**零次**。
type fakeScanner struct {
	calls  int
	items  []map[string]types.AttributeValue
	next   string
	err    error
	cursor string
}

func (f *fakeScanner) Scan(_ context.Context, cursor string, _ int32) ([]map[string]types.AttributeValue, string, error) {
	f.calls++
	f.cursor = cursor
	return f.items, f.next, f.err
}

func withFakeScanner(t *testing.T, items []map[string]types.AttributeValue) *fakeScanner {
	t.Helper()
	f := &fakeScanner{items: items}
	old := scanner
	scanner = f
	t.Cleanup(func() { scanner = old })
	return f
}

// tokenFor 產一個由 testSecret 簽出來的 admin token。
func tokenFor(t *testing.T, role string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "admin-1", "role": role})
	s, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return s
}

func getRequest(authHeader string) events.APIGatewayProxyRequest {
	req := events.APIGatewayProxyRequest{HTTPMethod: "GET"}
	if authHeader != "" {
		req.Headers = map[string]string{"Authorization": authHeader}
	}
	return req
}

func sampleItem() map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"pk":             &types.AttributeValueMemberS{Value: "USER#u-42"},
		"sk":             &types.AttributeValueMemberS{Value: "TS#1756800000#abc"},
		"text":           &types.AttributeValueMemberS{Value: "連三拉三"},
		"normalizedText": &types.AttributeValueMemberS{Value: "連三拉三"},
		"unmatched":      &types.AttributeValueMemberS{Value: "爭花"},
		"added":          &types.AttributeValueMemberSS{Value: []string{"zheng_hua"}},
		"hadDiff":        &types.AttributeValueMemberBOOL{Value: true},
		"ts":             &types.AttributeValueMemberN{Value: "1756800000"},
		// parsed / corrected / removed 刻意缺席：寫入端對空集合是「省略該欄」（D3-b）
	}
}

// 1. 沒有 Authorization → 401，且**沒有查過 DDB**。
func TestUnauthorizedNoScan(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	for name, hdr := range map[string]string{
		"no header":     "",
		"not bearer":    "Basic abc",
		"garbage token": "Bearer not.a.jwt",
		"wrong secret":  "Bearer " + signedWith(t, "some-other-secret", adminrole.Admin),
	} {
		t.Run(name, func(t *testing.T) {
			f := withFakeScanner(t, []map[string]types.AttributeValue{sampleItem()})
			resp, err := handler(context.Background(), getRequest(hdr))
			if err != nil {
				t.Fatalf("handler error: %v", err)
			}
			if resp.StatusCode != 401 {
				t.Fatalf("want 401, got %d (%s)", resp.StatusCode, resp.Body)
			}
			if f.calls != 0 {
				t.Fatalf("未通過驗證卻查了 DDB %d 次", f.calls)
			}
		})
	}
}

func signedWith(t *testing.T, secret, role string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "x", "role": role})
	s, _ := tok.SignedString([]byte(secret))
	return s
}

// 2. 簽章對但角色不是 admin → 403，且沒有查過 DDB。
func TestNonAdminForbiddenNoScan(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	for _, role := range []string{"", "user", "member", "moderator"} {
		t.Run("role="+role, func(t *testing.T) {
			f := withFakeScanner(t, []map[string]types.AttributeValue{sampleItem()})
			resp, err := handler(context.Background(), getRequest("Bearer "+tokenFor(t, role)))
			if err != nil {
				t.Fatalf("handler error: %v", err)
			}
			if resp.StatusCode != 403 {
				t.Fatalf("role=%q want 403, got %d (%s)", role, resp.StatusCode, resp.Body)
			}
			if f.calls != 0 {
				t.Fatalf("非 admin 卻查了 DDB %d 次", f.calls)
			}
		})
	}
}

// 3. 🔴 ADMIN_JWT_SECRET 未設定 → fail-closed 回 500，且沒有查過 DDB。
// 這條守的是「設錯了會不會靜靜放行」——方向必須是拒絕，不是通過。
func TestMissingSecretFailsClosed(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", "")
	t.Setenv("ALLOW_DEV_JWT_SECRET", "")
	f := withFakeScanner(t, []map[string]types.AttributeValue{sampleItem()})
	resp, err := handler(context.Background(), getRequest("Bearer "+tokenFor(t, adminrole.Admin)))
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if resp.StatusCode != 500 {
		t.Fatalf("secret 未設定時必須拒絕，want 500, got %d (%s)", resp.StatusCode, resp.Body)
	}
	if f.calls != 0 {
		t.Fatalf("secret 未設定卻查了 DDB %d 次", f.calls)
	}
}

// 4. admin → 200，回傳紀錄，且 cursor 有傳下去。
func TestAdminGetsRecords(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	f := withFakeScanner(t, []map[string]types.AttributeValue{sampleItem()})
	f.next = `{"pk":"USER#u-42","sk":"TS#1756800000#abc"}`

	req := getRequest("Bearer " + tokenFor(t, adminrole.SuperAdmin))
	req.QueryStringParameters = map[string]string{"cursor": "PREV"}
	resp, err := handler(context.Background(), req)
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d (%s)", resp.StatusCode, resp.Body)
	}
	if f.calls != 1 {
		t.Fatalf("want exactly one scan, got %d", f.calls)
	}
	if f.cursor != "PREV" {
		t.Fatalf("cursor 沒有傳給 scanner: got %q", f.cursor)
	}

	var body struct {
		Data       []Record `json:"data"`
		NextCursor string   `json:"nextCursor"`
		Skipped    int      `json:"skipped"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatalf("回應不是合法 JSON: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].UserID != "u-42" {
		t.Fatalf("userId 必須由 pk 去掉 USER# 得來, got %#v", body.Data)
	}
	if body.NextCursor == "" {
		t.Fatal("nextCursor 沒有傳回去，後台就翻不了頁")
	}
	if body.Skipped != 0 {
		t.Fatalf("正常列不該被跳過, skipped=%d", body.Skipped)
	}
}

// 5. 🔴 對 feedback.js extractSuggestions 的**契約守衛**。
//
// 那支 JS 讀 r.unmatched / r.added / r.removed / r.text / r.userId（feedback.js:86-104）。
// 少任何一個鍵，飛輪只會**安靜地少找到一類建議** —— 不會報錯、不會少一支函式，
// 所以只能在這裡釘住。改欄位名之前先看這條測試。
func TestResponseKeepsFlywheelContract(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	f := withFakeScanner(t, []map[string]types.AttributeValue{sampleItem()})
	_ = f
	resp, err := handler(context.Background(), getRequest("Bearer "+tokenFor(t, adminrole.Admin)))
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}

	var body struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatalf("回應不是合法 JSON: %v", err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("want 1 record, got %d", len(body.Data))
	}
	for _, key := range []string{"userId", "text", "unmatched", "added", "removed"} {
		if _, ok := body.Data[0][key]; !ok {
			t.Fatalf("回傳少了 %q —— feedback.js extractSuggestions 讀它，少了會安靜地漏掉一類建議", key)
		}
	}

	// 空集合必須是 []，不是 null：JS 那邊直接讀 .length，null 會 TypeError。
	for _, key := range []string{"parsed", "corrected", "removed"} {
		raw, ok := body.Data[0][key]
		if !ok {
			t.Fatalf("回傳少了 %q", key)
		}
		if string(raw) != "[]" {
			t.Fatalf("%q 缺欄時必須是 []，不可以是 %s（JS 讀 .length 會炸）", key, string(raw))
		}
	}
}

// 6. pk 形狀不對的列要跳過，不可以猜一個 userId ——
// 猜出來的會污染 distinctUsers 那道防單人灌爆的門檻（§4.5）。
func TestMalformedPKSkippedNotGuessed(t *testing.T) {
	bad := []map[string]types.AttributeValue{
		{"pk": &types.AttributeValueMemberS{Value: "u-42"}},    // 少前綴
		{"pk": &types.AttributeValueMemberS{Value: "USER#"}},   // 只有前綴，沒有 id
		{"pk": &types.AttributeValueMemberN{Value: "42"}},      // 型別錯
		{"text": &types.AttributeValueMemberS{Value: "沒有 pk"}}, // 缺 pk
	}
	for i, item := range bad {
		if r, ok := toRecord(item); ok {
			t.Fatalf("第 %d 筆形狀不對卻被接受，userId=%q", i, r.UserID)
		}
	}
	if r, ok := toRecord(sampleItem()); !ok || r.UserID != "u-42" {
		t.Fatalf("正常列應該通過且 userId=u-42, got ok=%v r=%#v", ok, r)
	}
}

// 7. 壞列要被算進 skipped 回報出去，不可以靜靜吞掉。
func TestSkippedIsReported(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	withFakeScanner(t, []map[string]types.AttributeValue{
		sampleItem(),
		{"pk": &types.AttributeValueMemberS{Value: "GARBAGE"}},
	})
	resp, err := handler(context.Background(), getRequest("Bearer "+tokenFor(t, adminrole.Admin)))
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}
	var body struct {
		Data    []Record `json:"data"`
		Skipped int      `json:"skipped"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatalf("回應不是合法 JSON: %v", err)
	}
	if len(body.Data) != 1 || body.Skipped != 1 {
		t.Fatalf("want 1 筆資料 + skipped=1, got %d 筆 skipped=%d", len(body.Data), body.Skipped)
	}
}

// 8. 非 GET → 405，且沒有查過 DDB。
func TestMethodNotAllowed(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	f := withFakeScanner(t, []map[string]types.AttributeValue{sampleItem()})
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "POST"})
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if resp.StatusCode != 405 {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
	if f.calls != 0 {
		t.Fatalf("非 GET 卻查了 DDB %d 次", f.calls)
	}
}

// 9. alg:none 必須被拒。
//
// 🔴 誠實標註：**這條對 handler 裡那道 HMAC 檢查鑑別力是零。**
// 突變實測（2026-09-02）：把 validateToken 裡
// `if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok` 整段拿掉 ⇒ 本條**照樣綠**。
// 原因是 golang-jwt/v5 自己就擋：keyfunc 沒回 jwt.UnsafeAllowNoneSignatureType 時
// 直接 `'none' signature type is not allowed`（實跑驗過，不是推論）。
//
// ⇒ 那道 HMAC 檢查是**防禦縱深**，在目前組態下沒有可達的繞過路徑
//
//	（secret 是對稱字串，RS256 token 也驗不過）。留著是標準寫法，
//	但不要以為本測試在守它。本條真正的價值是：**函式庫換版或降級時會叫。**
func TestRejectsNoneAlg(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{"sub": "x", "role": adminrole.Admin})
	s, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none: %v", err)
	}
	f := withFakeScanner(t, []map[string]types.AttributeValue{sampleItem()})
	resp, err := handler(context.Background(), getRequest("Bearer "+s))
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if resp.StatusCode != 401 {
		t.Fatalf("alg:none 必須被拒, got %d (%s)", resp.StatusCode, resp.Body)
	}
	if f.calls != 0 {
		t.Fatalf("alg:none 卻查了 DDB %d 次", f.calls)
	}
}

// ── D4-g 漏斗埋點：事件列不可以混進訂正資料 ──────────────────────────────

func eventItem(kind string, over map[string]types.AttributeValue) map[string]types.AttributeValue {
	it := map[string]types.AttributeValue{
		"pk":   &types.AttributeValueMemberS{Value: "USER#u-99"},
		"sk":   &types.AttributeValueMemberS{Value: "TS#1756800001#evt"},
		"kind": &types.AttributeValueMemberS{Value: kind},
		"ts":   &types.AttributeValueMemberN{Value: "1756800001"},
		// 🔴 text 缺席、hadDiff 缺席 —— 這正是重點：事件列與「判對了的訂正」
		// 在既有欄位上逐欄相同，唯一分得出來的是 kind。
	}
	for k, v := range over {
		it[k] = v
	}
	return it
}

// 9. 🔴 事件列不進 data，也不算 skipped。
//
// 兩個方向都要驗：
//
//	· 進了 data ⇒ 「未訂正率」被灌水，方向是「判得很準」
//	· 算成 skipped ⇒ 「寫入端出事了」與「有人在用」變成同一個數字
func TestEventRowsExcludedFromCorrections(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	withFakeScanner(t, []map[string]types.AttributeValue{
		sampleItem(),
		eventItem("open", nil),
		eventItem("open", nil),
		eventItem("asr", map[string]types.AttributeValue{"asrOk": &types.AttributeValueMemberBOOL{Value: true}}),
		eventItem("asr", map[string]types.AttributeValue{
			"asrOk":    &types.AttributeValueMemberBOOL{Value: false},
			"asrError": &types.AttributeValueMemberS{Value: "not-allowed"},
		}),
		eventItem("asr", map[string]types.AttributeValue{"asrOk": &types.AttributeValueMemberBOOL{Value: false}}),
		eventItem("something-new", nil),
	})

	resp, err := handler(context.Background(), getRequest("Bearer "+tokenFor(t, adminrole.SuperAdmin)))
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}
	var body struct {
		Data       []Record   `json:"data"`
		Skipped    int        `json:"skipped"`
		PageEvents PageEvents `json:"pageEvents"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatalf("回應不是合法 JSON: %v", err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("data 只該有那 1 筆訂正，got %d 筆: %#v", len(body.Data), body.Data)
	}
	if body.Data[0].UserID != "u-42" {
		t.Fatalf("留下來的應該是訂正那筆, got %#v", body.Data[0])
	}
	if body.Skipped != 0 {
		t.Fatalf("事件列不是壞掉的列，不可以算進 skipped, got %d", body.Skipped)
	}
	if body.PageEvents.Open != 2 {
		t.Fatalf("open 應該是 2, got %d", body.PageEvents.Open)
	}
	if body.PageEvents.AsrOk != 1 || body.PageEvents.AsrFailed != 2 {
		t.Fatalf("asr 成敗算錯: ok=%d failed=%d", body.PageEvents.AsrOk, body.PageEvents.AsrFailed)
	}
	if body.PageEvents.AsrErrors["not-allowed"] != 1 {
		t.Fatalf("失敗原因沒有分類: %#v", body.PageEvents.AsrErrors)
	}
	// 🔴 沒寫原因的失敗要落在 unknown，不可以憑空消失 ——
	// 不記的話它會偽裝成「從來沒有失敗過」。
	if body.PageEvents.AsrErrors["unknown"] != 1 {
		t.Fatalf("沒寫原因的失敗要記成 unknown: %#v", body.PageEvents.AsrErrors)
	}
	// 🔴 認不得的 kind 要單獨一格：寫入端加了新種類而這裡忘了跟上時，
	// 「有一種新東西在寫入」與「沒有那種東西」必須分得出來。
	if body.PageEvents.Other != 1 {
		t.Fatalf("認不得的 kind 應該落在 other, got %d", body.PageEvents.Other)
	}
}

// 10. 🔴 既有列沒有 kind ⇒ 必須當成訂正留下來。
//
// 這條守的是方向。反過來預設不會有任何錯誤訊號，只會讓 D4-c 上線到 D4-g 之間
// 寫下的每一筆真實訂正靜靜地從飛輪裡消失 —— 而後台看到的是「訂正變少了」，
// 最像的解讀是「判得更準了」。
func TestLegacyRowsWithoutKindCountAsCorrections(t *testing.T) {
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
	legacy := sampleItem() // 刻意不加 kind，模擬 D4-g 之前寫下的列
	if _, present := legacy["kind"]; present {
		t.Fatal("這條測試的前提是 sampleItem 沒有 kind —— 前提變了就不是在驗同一件事")
	}
	withFakeScanner(t, []map[string]types.AttributeValue{legacy})

	resp, err := handler(context.Background(), getRequest("Bearer "+tokenFor(t, adminrole.SuperAdmin)))
	if err != nil {
		t.Fatalf("handler error: %v", err)
	}
	var body struct {
		Data       []Record   `json:"data"`
		PageEvents PageEvents `json:"pageEvents"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatalf("回應不是合法 JSON: %v", err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("沒有 kind 的舊列必須留在 data 裡, got %d 筆", len(body.Data))
	}
	if body.PageEvents.Open+body.PageEvents.AsrOk+body.PageEvents.AsrFailed+body.PageEvents.Other != 0 {
		t.Fatalf("舊列不該被算成任何事件: %#v", body.PageEvents)
	}
}
