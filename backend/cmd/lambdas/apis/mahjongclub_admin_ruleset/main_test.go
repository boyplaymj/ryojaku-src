package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"mahjongclub-backend/cmd/lambdas/adminrole"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-admin-secret-not-a-real-one"

// validRaw 刻意帶一個**這支不認得的頂層鍵** notes，還有中文 ——
// 前者釘住「原封不動」，後者讓 bytes 這一欄分得出 byte 數與字元數
// （138 個字元 / 180 個 byte）。
const validRaw = `{"version":"0.2.0","fans":[{"id":"ping_hu","tai":2}],"combos":[],"ignores":[],"config":{"base_di":1},"notes":"後台頁不認得這個鍵，它必須原封不動出現在 raw 裡"}`

// 🔴 期望的 sha256 是**寫死的字面值**，不是測試裡再算一次 ——
// 再算一次的話，實作改成「先 parse 再重新序列化才 hash」也會照樣綠，
// 而那正是這個欄位不可以發生的事（它要能與播種端的逐 byte 比對對得上）。
const validSHA = "0e76067cd36910df9e2fb749c780945ae44ed8b20744012d887636e53c054498"

// fakeReader 記錄「被查了幾次」——401/403/405/OPTIONS/未設定 secret 這幾條要斷言**零次**。
type fakeReader struct {
	calls int
	raw   string
	found bool
	err   error
}

func (f *fakeReader) GetRulesetRaw(_ context.Context) (string, bool, error) {
	f.calls++
	return f.raw, f.found, f.err
}

func withReader(t *testing.T, r *fakeReader) *fakeReader {
	t.Helper()
	old := reader
	reader = r
	t.Cleanup(func() { reader = old })
	return r
}

func withSecret(t *testing.T) {
	t.Helper()
	t.Setenv("ADMIN_JWT_SECRET", testSecret)
}

func tokenFor(t *testing.T, role, secret string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "admin-1", "role": role})
	s, err := tok.SignedString([]byte(secret))
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

func adminGet(t *testing.T) events.APIGatewayProxyRequest {
	t.Helper()
	return getRequest("Bearer " + tokenFor(t, adminrole.Admin, testSecret))
}

func decodeView(t *testing.T, body string) View {
	t.Helper()
	var v View
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("回應不是 View：%v（body=%s）", err, body)
	}
	return v
}

// ── 讀得到、而且是好的 ───────────────────────────────────────────────

func TestSeededRowIsReportedVerbatim(t *testing.T) {
	withSecret(t)
	f := withReader(t, &fakeReader{raw: validRaw, found: true})

	resp, err := handler(context.Background(), adminGet(t))
	if err != nil {
		t.Fatalf("handler err: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("狀態碼 = %d, want 200（body=%s）", resp.StatusCode, resp.Body)
	}
	v := decodeView(t, resp.Body)
	if v.State != stateSeeded {
		t.Errorf("state = %q, want %q", v.State, stateSeeded)
	}
	if v.Version != "0.2.0" {
		t.Errorf("version = %q, want 0.2.0", v.Version)
	}
	// 🔴 逐 byte：raw 不可以被重新序列化。notes 這個鍵不在契約裡，
	// 它消失的話後台就看不到「有人往那一列寫了別的東西」。
	if v.Raw != validRaw {
		t.Errorf("raw 不是原封不動：\n got=%s\nwant=%s", v.Raw, validRaw)
	}
	if !strings.Contains(v.Raw, "notes") {
		t.Errorf("契約外的鍵 notes 被吃掉了")
	}
	if v.SHA256 != validSHA {
		t.Errorf("sha256 = %q, want %q", v.SHA256, validSHA)
	}
	if v.Bytes != 180 {
		t.Errorf("bytes = %d, want 180（byte 數不是字元數；138 個字元的話這欄就錯了）", v.Bytes)
	}
	if v.Reason != "" {
		t.Errorf("好的那一列不該有 reason，實得 %q", v.Reason)
	}
	if v.InfoKey != "VoiceTai:Ruleset" {
		t.Errorf("infoKey = %q", v.InfoKey)
	}
	if !strings.HasSuffix(v.Table, "AdminConfigs") {
		t.Errorf("table = %q, 應以 AdminConfigs 結尾", v.Table)
	}
	if f.calls != 1 {
		t.Errorf("讀取次數 = %d, want 1", f.calls)
	}
}

// 這支不可以發明比 GET /ruleset 更嚴的規則：ignores: [] 與 config: {} 都合法。
func TestEmptyIgnoresAndConfigAreStillSeeded(t *testing.T) {
	withSecret(t)
	raw := `{"version":"0.3.0","fans":[],"combos":[],"ignores":[],"config":{}}`
	withReader(t, &fakeReader{raw: raw, found: true})

	resp, _ := handler(context.Background(), adminGet(t))
	v := decodeView(t, resp.Body)
	if v.State != stateSeeded {
		t.Fatalf("state = %q（reason=%q）, want seeded —— 空集合是合法值，不是缺損", v.State, v.Reason)
	}
}

// 反控：sha256 對內容有鑑別力。少了它，實作回一個常數也會讓上面那條綠。
func TestSHADiscriminates(t *testing.T) {
	withSecret(t)
	other := strings.Replace(validRaw, `"tai":2`, `"tai":3`, 1)
	if other == validRaw {
		t.Fatal("fixture 沒被改到 —— 這條反控等於沒做")
	}
	withReader(t, &fakeReader{raw: other, found: true})
	resp, _ := handler(context.Background(), adminGet(t))
	v := decodeView(t, resp.Body)
	if v.SHA256 == validSHA {
		t.Errorf("改了一個 byte，sha256 卻沒變：%s", v.SHA256)
	}
	if v.SHA256 != "626ed4ac08ab6ab86c39f6cacd57da0a30de8562d01416febef5c133fac30ad4" {
		t.Errorf("sha256 = %q，與獨立算出來的值不符", v.SHA256)
	}
}

// ── 那一列不存在 ────────────────────────────────────────────────────

func TestNotSeededIsTwoHundredWithState(t *testing.T) {
	withSecret(t)
	withReader(t, &fakeReader{found: false})

	resp, _ := handler(context.Background(), adminGet(t))
	// 🔴 不是 404：這一頁的 404 保留給「端點還沒部署」。
	if resp.StatusCode != 200 {
		t.Fatalf("狀態碼 = %d, want 200 —— 404 會與「端點不存在」逐字相同", resp.StatusCode)
	}
	v := decodeView(t, resp.Body)
	if v.State != stateNotSeeded {
		t.Errorf("state = %q, want %q", v.State, stateNotSeeded)
	}
	// ⛔ 不合成空表：沒有版本、沒有指紋、沒有長度。
	if v.Version != "" || v.SHA256 != "" || v.Raw != "" || v.Bytes != 0 {
		t.Errorf("那一列不存在，卻回了內容：%+v", v)
	}
	if strings.Contains(resp.Body, `"fans"`) {
		t.Errorf("body 裡出現了 fans —— 不可以合成空表：%s", resp.Body)
	}
}

// ── 那一列在，但壞了 ────────────────────────────────────────────────

func TestMalformedRowKeepsRawAndNamesTheKey(t *testing.T) {
	withSecret(t)
	cases := []struct {
		name    string
		raw     string
		because string
		version string
	}{
		{"缺 ignores", `{"version":"0.2.0","fans":[],"combos":[],"config":{}}`, "ignores", "0.2.0"},
		{"ignores 是 null", `{"version":"0.2.0","fans":[],"combos":[],"ignores":null,"config":{}}`, "ignores", "0.2.0"},
		{"缺 config", `{"version":"0.2.0","fans":[],"combos":[],"ignores":[]}`, "config", "0.2.0"},
		{"version 空字串", `{"version":"","fans":[],"combos":[],"ignores":[],"config":{}}`, "version", ""},
		{"根本不是 JSON", `這一列被別的東西寫過了`, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			withReader(t, &fakeReader{raw: c.raw, found: true})
			resp, _ := handler(context.Background(), adminGet(t))
			if resp.StatusCode != 200 {
				t.Fatalf("狀態碼 = %d, want 200 —— 壞掉是後台要看見的事實，不是這支的失敗", resp.StatusCode)
			}
			v := decodeView(t, resp.Body)
			if v.State != stateMalformed {
				t.Fatalf("state = %q, want %q", v.State, stateMalformed)
			}
			if v.Reason == "" {
				t.Error("reason 是空的 —— 「那一列壞了」對運維沒有用")
			}
			if c.because != "" && !strings.Contains(v.Reason, c.because) {
				t.Errorf("reason = %q，沒有指名是哪一鍵（want 含 %q）", v.Reason, c.because)
			}
			// 🔴 壞掉時 raw 更要給：不看原文查不出是誰寫的。
			if v.Raw != c.raw {
				t.Errorf("raw 不是原封不動：got=%q want=%q", v.Raw, c.raw)
			}
			// VersionOf 是另一把尺：壞掉的那一份仍然說得出它自稱幾版。
			if v.Version != c.version {
				t.Errorf("version = %q, want %q", v.Version, c.version)
			}
			if v.SHA256 == "" {
				t.Error("壞掉的那一列也要有指紋 —— 否則沒辦法回報「我看到的是哪一份」")
			}
		})
	}
}

// 列在、但 info_value 不是字串（DDB 型別層之下，假件繞不到）。
// 走的是 buildView(raw="", found=true) ⇒ 必須是 malformed，不是 not-seeded：那一列確實存在。
func TestRowExistsWithWrongTypeIsMalformedNotAbsent(t *testing.T) {
	v := buildView("", true)
	if v.State != stateMalformed {
		t.Fatalf("state = %q, want %q —— 「列在但型別不對」與「列不存在」處置不同", v.State, stateMalformed)
	}
}

// ── 讀不到（設備問題）────────────────────────────────────────────────

func TestStoreErrorIsFiveOhTwoNotNotSeeded(t *testing.T) {
	withSecret(t)
	withReader(t, &fakeReader{err: errors.New("dynamodb exploded")})

	resp, _ := handler(context.Background(), adminGet(t))
	if resp.StatusCode != 502 {
		t.Fatalf("狀態碼 = %d, want 502 —— 「讀不到」不可以說成「沒有」", resp.StatusCode)
	}
	if strings.Contains(resp.Body, `"state"`) {
		t.Errorf("失敗時不可以回 state（會被讀成一種合法狀態）：%s", resp.Body)
	}
	if strings.Contains(resp.Body, "dynamodb exploded") {
		t.Errorf("內部錯誤訊息不可以外洩到 body：%s", resp.Body)
	}
}

// ── 認證與唯讀 ──────────────────────────────────────────────────────

func TestRejectedPathsNeverReadTheRow(t *testing.T) {
	cases := []struct {
		name   string
		setup  func(t *testing.T)
		req    func(t *testing.T) events.APIGatewayProxyRequest
		status int
	}{
		{"沒有 Authorization", withSecret, func(t *testing.T) events.APIGatewayProxyRequest {
			return getRequest("")
		}, 401},
		{"格式不是 Bearer", withSecret, func(t *testing.T) events.APIGatewayProxyRequest {
			return getRequest(tokenFor(t, adminrole.Admin, testSecret))
		}, 401},
		{"別的金鑰簽的", withSecret, func(t *testing.T) events.APIGatewayProxyRequest {
			return getRequest("Bearer " + tokenFor(t, adminrole.SuperAdmin, "another-secret"))
		}, 401},
		{"alg=none", withSecret, func(t *testing.T) events.APIGatewayProxyRequest {
			tok := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{"sub": "x", "role": adminrole.SuperAdmin})
			s, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
			if err != nil {
				t.Fatalf("sign none: %v", err)
			}
			return getRequest("Bearer " + s)
		}, 401},
		{"沒有 role 的 user token", withSecret, func(t *testing.T) events.APIGatewayProxyRequest {
			tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "u-1", "userId": "u-1"})
			s, _ := tok.SignedString([]byte(testSecret))
			return getRequest("Bearer " + s)
		}, 403},
		{"role 不是 admin", withSecret, func(t *testing.T) events.APIGatewayProxyRequest {
			return getRequest("Bearer " + tokenFor(t, "moderator", testSecret))
		}, 403},
		{"ADMIN_JWT_SECRET 未設定", func(t *testing.T) {
			t.Setenv("ADMIN_JWT_SECRET", "")
			t.Setenv("ALLOW_DEV_JWT_SECRET", "")
		}, func(t *testing.T) events.APIGatewayProxyRequest {
			return getRequest("Bearer " + tokenFor(t, adminrole.SuperAdmin, testSecret))
		}, 500},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.setup(t)
			f := withReader(t, &fakeReader{raw: validRaw, found: true})
			resp, _ := handler(context.Background(), c.req(t))
			if resp.StatusCode != c.status {
				t.Errorf("狀態碼 = %d, want %d（body=%s）", resp.StatusCode, c.status, resp.Body)
			}
			// 🔴 fail-closed 不只看狀態碼，也看有沒有真的去讀那一列。
			if f.calls != 0 {
				t.Errorf("被擋下來卻讀了 %d 次", f.calls)
			}
			if strings.Contains(resp.Body, "0.2.0") {
				t.Errorf("被擋下來卻回了表的內容：%s", resp.Body)
			}
		})
	}
}

// 🔴 唯讀不是「沒實作」——是紀律 1：寫入入口只有播種腳本一條。
func TestWriteMethodsAreRejectedAndSayWhy(t *testing.T) {
	withSecret(t)
	for _, m := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		t.Run(m, func(t *testing.T) {
			f := withReader(t, &fakeReader{raw: validRaw, found: true})
			req := events.APIGatewayProxyRequest{
				HTTPMethod: m,
				Headers:    map[string]string{"Authorization": "Bearer " + tokenFor(t, adminrole.SuperAdmin, testSecret)},
			}
			resp, _ := handler(context.Background(), req)
			if resp.StatusCode != 405 {
				t.Fatalf("%s 的狀態碼 = %d, want 405", m, resp.StatusCode)
			}
			if !strings.Contains(resp.Body, "seed_ruleset.py") {
				t.Errorf("405 沒有講出路：%s", resp.Body)
			}
			if f.calls != 0 {
				t.Errorf("寫入方法卻讀了 %d 次", f.calls)
			}
		})
	}
}

func TestOptionsIsPreflightOnly(t *testing.T) {
	withSecret(t)
	f := withReader(t, &fakeReader{raw: validRaw, found: true})
	resp, _ := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "OPTIONS"})
	if resp.StatusCode != 200 {
		t.Fatalf("OPTIONS 狀態碼 = %d, want 200", resp.StatusCode)
	}
	if f.calls != 0 {
		t.Errorf("OPTIONS 卻讀了 %d 次", f.calls)
	}
	if resp.Body != "" {
		t.Errorf("OPTIONS 不該有 body：%s", resp.Body)
	}
}
