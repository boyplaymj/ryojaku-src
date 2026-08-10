package shared

// shared/line.go 的 authorization code 交換段落的單元測試。
//
// 這一段存在的理由本身就值得測：web 拿不到 client-side id_token，所以 code 交換是
// 瀏覽器唯一的一條路。它會碰到 channel secret，錯了就是「拿不到 token」或
// 「把 secret 漏給不該去的地方」，所以負向案例比 happy path 重要。
//
// 慣例同 line_test.go：每個負向案例只改壞「那一項」，其餘全部合法 —— 這樣守衛被拿掉時
// 案例會由紅轉綠，而不是因為別的理由本來就紅。

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const testChannelSecret = "sekrit-abcdef0123456789"
const testRedirectURI = "https://jiomj.boyplaymj.com/auth/line/callback"

// newTokenStub：假的 LINE token 端點。回傳指標讓測試檢查我們實際送出的 form。
func newTokenStub(t *testing.T, status int, body interface{}) *map[string][]string {
	t.Helper()
	var got map[string][]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		got = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if s, ok := body.(string); ok {
			_, _ = w.Write([]byte(s))
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	old := lineTokenEndpoint
	lineTokenEndpoint = srv.URL
	t.Cleanup(func() { lineTokenEndpoint = old; srv.Close() })
	return &got
}

// lineConfigured：兩個 env 都設好（多數案例的共同前置）。
func lineConfigured(t *testing.T) {
	t.Helper()
	t.Setenv("LINE_LOGIN_CHANNEL_ID", testChannelID)
	t.Setenv("LINE_LOGIN_CHANNEL_SECRET", testChannelSecret)
}

func TestExchangeLINECode_NoChannelIDConfigured(t *testing.T) {
	t.Setenv("LINE_LOGIN_CHANNEL_ID", "")
	t.Setenv("LINE_LOGIN_CHANNEL_SECRET", testChannelSecret)
	newTokenStub(t, 200, map[string]interface{}{"id_token": "tok"})
	if _, err := ExchangeLINECode(context.Background(), "code123", testRedirectURI); err != ErrLineChannelNotConfigured {
		t.Fatalf("未設 channel id 應 fail-closed，得到 err=%v", err)
	}
}

// 只設 ID 忘了 secret 是最可能發生的部署失誤 —— 必須是**專屬**錯誤，
// 不能跟「未設 ID」混成同一個，否則日誌指不出到底缺哪一個。
func TestExchangeLINECode_NoChannelSecretConfigured(t *testing.T) {
	t.Setenv("LINE_LOGIN_CHANNEL_ID", testChannelID)
	t.Setenv("LINE_LOGIN_CHANNEL_SECRET", "")
	newTokenStub(t, 200, map[string]interface{}{"id_token": "tok"})
	_, err := ExchangeLINECode(context.Background(), "code123", testRedirectURI)
	if err != ErrLineChannelSecretNotConfigured {
		t.Fatalf("未設 channel secret 應 fail-closed 且為專屬錯誤，得到 err=%v", err)
	}
}

// 這支釘的是「我們真的照 OAuth 規格送出了那五個欄位」。
// 少了 client_secret 或 redirect_uri，LINE 一律回 invalid_grant，
// 而那個症狀在真實環境長得像「LINE 壞了」，很難回推到這裡。
func TestExchangeLINECode_SendsCorrectForm(t *testing.T) {
	lineConfigured(t)
	form := newTokenStub(t, 200, map[string]interface{}{"id_token": "the-id-token"})

	got, err := ExchangeLINECode(context.Background(), "code123", testRedirectURI)
	if err != nil {
		t.Fatalf("合法交換不該失敗：%v", err)
	}
	if got != "the-id-token" {
		t.Fatalf("應回傳回應中的 id_token，得到 %q", got)
	}
	want := map[string]string{
		"grant_type":    "authorization_code",
		"code":          "code123",
		"redirect_uri":  testRedirectURI,
		"client_id":     testChannelID,
		"client_secret": testChannelSecret,
	}
	for k, v := range want {
		if len((*form)[k]) == 0 || (*form)[k][0] != v {
			t.Errorf("送出的 %s 應為 %q，得到 %v", k, v, (*form)[k])
		}
	}
}

func TestExchangeLINECode_EmptyCode(t *testing.T) {
	lineConfigured(t)
	newTokenStub(t, 200, map[string]interface{}{"id_token": "tok"})
	if _, err := ExchangeLINECode(context.Background(), "   ", testRedirectURI); err == nil {
		t.Fatal("空 code 應被擋下")
	}
}

// 四種失敗形狀都不可以放行。
//
// 🔴 每一格都刻意設計成**只有那一道守衛擋得住**，其餘欄位全部合法。
// 這不是龜毛：第一版寫成「400 且沒有 id_token」，結果拿掉狀態碼守衛時
// 「缺 id_token」那道會補位擋下，測試照樣全綠 —— 守衛重疊會讓突變測試
// 報出「沒有鑑別力」，而在只跑 go test 的畫面上完全看不出來。
// （同一個坑本檔上游的 exp 短路也踩過，見 mutation_auth_line.sh 的註解。）
func TestExchangeLINECode_RejectsFailureShapes(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   interface{}
	}{
		// 狀態碼壞、內容全好 → 只有「非 200」那道擋得住。
		{"非200但內容全好", 500, map[string]interface{}{"id_token": "tok"}},
		// 200 且有 id_token，但帶 error 欄位 → 只有 tr.Error 那道擋得住。
		{"200帶error且有id_token", 200, map[string]interface{}{"error": "invalid_request", "id_token": "tok"}},
		// 200 且無 error，但沒有 id_token → 只有缺 id_token 那道擋得住。
		{"缺id_token", 200, map[string]interface{}{"access_token": "at-only"}},
		// 解不出 JSON → 只有解析失敗那道擋得住。
		{"非JSON", 500, "<html>oops</html>"},
		// 真實世界最常見的樣子（多道守衛都會擋，留著當回歸）。
		{"真實invalid_grant", 400, map[string]interface{}{"error": "invalid_grant", "error_description": "code expired"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			lineConfigured(t)
			newTokenStub(t, c.status, c.body)
			tok, err := ExchangeLINECode(context.Background(), "code123", testRedirectURI)
			if err == nil {
				t.Fatalf("%s 應被當成交換失敗，卻回傳了 token=%q", c.name, tok)
			}
			if tok != "" {
				t.Fatalf("失敗時不可回傳 token，得到 %q", tok)
			}
		})
	}
}

// ⚠️ 上面那些 redirect_uri 案例只驗了 validateLineRedirectURI 這支**函式**。
// 函式對不對，跟 ExchangeLINECode 有沒有真的呼叫它，是兩件事 —— 少了這支，
// 把呼叫整行刪掉也不會有任何測試轉紅。這裡同時釘住「擋下來」與「沒有外呼」。
func TestExchangeLINECode_RejectsBadRedirectURI(t *testing.T) {
	lineConfigured(t)
	form := newTokenStub(t, 200, map[string]interface{}{"id_token": "tok"})

	if _, err := ExchangeLINECode(context.Background(), "code123", "http://evil.example.com/cb"); err == nil {
		t.Fatal("非本機的明文 http redirect_uri 應被擋下")
	}
	if *form != nil {
		t.Fatalf("被擋下時不該送出請求，卻收到 form=%v", *form)
	}
}

func TestValidateLineRedirectURI(t *testing.T) {
	cases := []struct {
		uri string
		ok  bool
	}{
		{"https://jiomj.boyplaymj.com/auth/line/callback", true},
		{"http://localhost:5173/auth/line/callback", true},
		{"http://127.0.0.1:5173/auth/line/callback", true},
		{"http://evil.example.com/callback", false}, // 明文 http 非本機
		{"/auth/line/callback", false},              // 相對路徑
		{"", false},
		{"ftp://example.com/x", false},
		{"javascript:alert(1)", false},
	}
	for _, c := range cases {
		err := validateLineRedirectURI(c.uri)
		if c.ok && err != nil {
			t.Errorf("%q 應通過，得到 err=%v", c.uri, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%q 應被擋下，卻通過了", c.uri)
		}
	}
}

// 「剛好給一個」的四格全測。兩個都給要擋 —— 不能悄悄挑一個用，
// 那會留下一個沒人檢查的欄位，日後改動分支順序就變成可繞過的旋鈕。
func TestValidateLineCredential(t *testing.T) {
	cases := []struct {
		name    string
		code    string
		idToken string
		ok      bool
	}{
		{"只給code", "c", "", true},
		{"只給idToken", "", "t", true},
		{"兩個都給", "c", "t", false},
		{"都不給", "", "", false},
		{"都是空白字元", "  ", "\t", false},
		{"code是空白+有token", "  ", "t", true},
	}
	for _, c := range cases {
		err := ValidateLineCredential(c.code, c.idToken)
		if c.ok && err != nil {
			t.Errorf("[%s] 應通過，得到 err=%v", c.name, err)
		}
		if !c.ok && err == nil {
			t.Errorf("[%s] 應回 ErrLineCredentialShape，卻通過了", c.name)
		}
	}
}

// resolveStubs：同時架起 token 與 verify 兩個假端點，並記錄**被呼叫的順序**。
func resolveStubs(t *testing.T, tokenStatus int, tokenBody interface{}, verifyBody interface{}) *[]string {
	t.Helper()
	var order []string
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		order = append(order, "token")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(tokenStatus)
		_ = json.NewEncoder(w).Encode(tokenBody)
	}))
	verifySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		order = append(order, "verify")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_ = json.NewEncoder(w).Encode(verifyBody)
	}))
	oldT, oldV := lineTokenEndpoint, lineVerifyEndpoint
	lineTokenEndpoint, lineVerifyEndpoint = tokenSrv.URL, verifySrv.URL
	t.Cleanup(func() {
		lineTokenEndpoint, lineVerifyEndpoint = oldT, oldV
		tokenSrv.Close()
		verifySrv.Close()
	})
	return &order
}

// code 路徑：必須「先換、後驗」，且兩支都真的被打到。
func TestResolveLINELogin_CodePathExchangesThenVerifies(t *testing.T) {
	lineConfigured(t)
	order := resolveStubs(t, 200, map[string]interface{}{"id_token": "exchanged-token"}, okBody())

	li, err := ResolveLINELogin(context.Background(), "code123", testRedirectURI, "", testNonce)
	if err != nil {
		t.Fatalf("合法 code 流程不該失敗：%v", err)
	}
	if li.Sub != okBody()["sub"] {
		t.Fatalf("身分應來自 verify 回應，得到 sub=%q", li.Sub)
	}
	if len(*order) != 2 || (*order)[0] != "token" || (*order)[1] != "verify" {
		t.Fatalf("順序必須是 token→verify，實際=%v", *order)
	}
}

// idToken 路徑：token 端點**一次都不該被打到**（原生 App 已經有 token 了）。
func TestResolveLINELogin_IDTokenPathSkipsExchange(t *testing.T) {
	lineConfigured(t)
	order := resolveStubs(t, 200, map[string]interface{}{"id_token": "should-not-be-used"}, okBody())

	if _, err := ResolveLINELogin(context.Background(), "", "", "native-token", testNonce); err != nil {
		t.Fatalf("合法 idToken 流程不該失敗：%v", err)
	}
	if len(*order) != 1 || (*order)[0] != "verify" {
		t.Fatalf("idToken 路徑不該碰 token 端點，實際=%v", *order)
	}
}

// 交換失敗時**不可以**再去打 verify —— 否則等於拿使用者的請求當 LINE verify 的探針，
// 而且會在日誌裡留下一個指向錯誤方向的失敗。
func TestResolveLINELogin_ExchangeFailureSkipsVerify(t *testing.T) {
	lineConfigured(t)
	order := resolveStubs(t, 400, map[string]interface{}{"error": "invalid_grant"}, okBody())

	if _, err := ResolveLINELogin(context.Background(), "code123", testRedirectURI, "", testNonce); err == nil {
		t.Fatal("交換失敗時整支應失敗")
	}
	for _, hit := range *order {
		if hit == "verify" {
			t.Fatalf("交換失敗後不該再打 verify，實際=%v", *order)
		}
	}
}

// 形狀不對時，兩支外部端點都不該被碰到。
func TestResolveLINELogin_BadShapeTouchesNothing(t *testing.T) {
	lineConfigured(t)
	order := resolveStubs(t, 200, map[string]interface{}{"id_token": "x"}, okBody())

	for _, c := range [][2]string{{"c", "t"}, {"", ""}} {
		if _, err := ResolveLINELogin(context.Background(), c[0], testRedirectURI, c[1], testNonce); err != ErrLineCredentialShape {
			t.Fatalf("code=%q idToken=%q 應回 ErrLineCredentialShape，得到 %v", c[0], c[1], err)
		}
	}
	if len(*order) != 0 {
		t.Fatalf("形狀不對時不該打任何外部端點，實際=%v", *order)
	}
}

// nonce 必填在 code 路徑上一樣成立（換完 token 之後仍會被 VerifyLINEIDToken 擋下）。
func TestResolveLINELogin_CodePathStillRequiresNonce(t *testing.T) {
	lineConfigured(t)
	resolveStubs(t, 200, map[string]interface{}{"id_token": "exchanged-token"}, okBody())

	if _, err := ResolveLINELogin(context.Background(), "code123", testRedirectURI, "", ""); err != ErrLineNonceRequired {
		t.Fatalf("code 路徑缺 nonce 應回 ErrLineNonceRequired，得到 %v", err)
	}
}
