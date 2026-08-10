package shared

// shared/line.go 的單元測試。
// 重點不在「happy path 會過」，而在每一道自驗守衛都真的擋得住：
// 每個負向案例都只改壞「那一項」、其餘欄位全部合法 → 若守衛被拿掉，該案例會由紅轉綠。

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testChannelID = "1234567890"

// okBody：一份「全部合法」的 verify 回應，測試再逐項改壞其中一欄。
func okBody() map[string]interface{} {
	return map[string]interface{}{
		"iss":     "https://access.line.me",
		"sub":     "U1111111111111111111111111111111f",
		"aud":     testChannelID,
		"exp":     time.Now().Add(10 * time.Minute).Unix(),
		"iat":     time.Now().Add(-1 * time.Minute).Unix(),
		"name":    "阿明",
		"picture": "https://profile.line-scdn.net/x",
		"email":   "  Foo@Example.COM ",
	}
}

// newStub 起一個假的 LINE verify 端點，並把 shared 的呼叫導過去。
// 回傳的 *http.Request 指標讓測試能檢查我們實際送了什麼。
func newStub(t *testing.T, status int, body interface{}) *map[string][]string {
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
	old := lineVerifyEndpoint
	lineVerifyEndpoint = srv.URL
	t.Cleanup(func() { lineVerifyEndpoint = old; srv.Close() })
	return &got
}

func TestVerifyLINEIDToken_NoChannelIDConfigured(t *testing.T) {
	t.Setenv("LINE_LOGIN_CHANNEL_ID", "")
	newStub(t, 200, okBody())
	if _, err := VerifyLINEIDToken(context.Background(), "tok", ""); err != ErrLineChannelNotConfigured {
		t.Fatalf("未設 channel id 應 fail-closed，得到 err=%v", err)
	}
}

func TestVerifyLINEIDToken_Success(t *testing.T) {
	t.Setenv("LINE_LOGIN_CHANNEL_ID", testChannelID)
	form := newStub(t, 200, okBody())

	li, err := VerifyLINEIDToken(context.Background(), "tok-abc", "")
	if err != nil {
		t.Fatalf("合法 token 應通過，err=%v", err)
	}
	if li.Sub != "U1111111111111111111111111111111f" {
		t.Errorf("sub 錯：%q", li.Sub)
	}
	if li.Name != "阿明" {
		t.Errorf("name 錯：%q", li.Name)
	}
	// email 必須 lower + trim（下游拿它比對既有帳號時大小寫變體不可分岔）。
	if li.Email != "foo@example.com" {
		t.Errorf("email 未正規化：%q", li.Email)
	}
	// 送出的表單欄位名必須完全照官方文件；打錯名字 LINE 會回 400，但本地看起來一切正常。
	if (*form)["id_token"] == nil || (*form)["id_token"][0] != "tok-abc" {
		t.Errorf("未送出 id_token：%v", *form)
	}
	if (*form)["client_id"] == nil || (*form)["client_id"][0] != testChannelID {
		t.Errorf("未送出 client_id：%v", *form)
	}
	if _, ok := (*form)["nonce"]; ok {
		t.Errorf("nonce 為空時不該送出該欄位：%v", *form)
	}
}

func TestVerifyLINEIDToken_NonceForwardedAndChecked(t *testing.T) {
	t.Setenv("LINE_LOGIN_CHANNEL_ID", testChannelID)

	// ① 有帶 nonce → 必須原樣送給 LINE，且回應相符才過。
	b := okBody()
	b["nonce"] = "n-123"
	form := newStub(t, 200, b)
	if _, err := VerifyLINEIDToken(context.Background(), "tok", "n-123"); err != nil {
		t.Fatalf("nonce 相符應通過，err=%v", err)
	}
	if (*form)["nonce"] == nil || (*form)["nonce"][0] != "n-123" {
		t.Errorf("nonce 未轉送給 LINE：%v", *form)
	}

	// ② 回應的 nonce 不符 → 擋。
	b2 := okBody()
	b2["nonce"] = "someone-elses"
	newStub(t, 200, b2)
	if _, err := VerifyLINEIDToken(context.Background(), "tok", "n-123"); err == nil {
		t.Fatal("nonce 不符卻放行")
	}
}

// 逐項改壞：每個案例都只有一欄不合法，其餘照 okBody。
func TestVerifyLINEIDToken_RejectsEachInvalidField(t *testing.T) {
	cases := []struct {
		name   string
		status int
		mutate func(map[string]interface{})
	}{
		{"iss 被換掉", 200, func(m map[string]interface{}) { m["iss"] = "https://evil.example.com" }},
		{"aud 不是我方 channel", 200, func(m map[string]interface{}) { m["aud"] = "9999999999" }},
		{"sub 空", 200, func(m map[string]interface{}) { m["sub"] = "" }},
		{"sub 缺欄位", 200, func(m map[string]interface{}) { delete(m, "sub") }},
		{"已過期", 200, func(m map[string]interface{}) { m["exp"] = time.Now().Add(-time.Minute).Unix() }},
		{"200 但帶 error 欄位", 200, func(m map[string]interface{}) { m["error"] = "invalid_request" }},
		{"400 拒絕", 400, func(m map[string]interface{}) {
			for k := range m {
				delete(m, k)
			}
			m["error"] = "invalid_request"
			m["error_description"] = "Invalid IdToken"
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("LINE_LOGIN_CHANNEL_ID", testChannelID)
			b := okBody()
			c.mutate(b)
			newStub(t, c.status, b)
			if li, err := VerifyLINEIDToken(context.Background(), "tok", ""); err == nil {
				t.Fatalf("應擋下卻放行，回了 %+v", li)
			}
		})
	}
}

func TestVerifyLINEIDToken_NonJSONResponseIsRejected(t *testing.T) {
	t.Setenv("LINE_LOGIN_CHANNEL_ID", testChannelID)
	// 5xx HTML 錯誤頁：解不出 JSON 時所有欄位都是零值，若不明確擋下就會變成
	// 「iss=="" 卻通過」之類的空殼身分。
	newStub(t, 502, "<html>bad gateway</html>")
	if _, err := VerifyLINEIDToken(context.Background(), "tok", ""); err == nil {
		t.Fatal("非 JSON 回應卻放行")
	}
}

func TestVerifyLINEIDToken_EmptyToken(t *testing.T) {
	t.Setenv("LINE_LOGIN_CHANNEL_ID", testChannelID)
	newStub(t, 200, okBody())
	if _, err := VerifyLINEIDToken(context.Background(), "  ", ""); err == nil {
		t.Fatal("空 id_token 卻放行")
	}
}

func TestLineIdentityKey(t *testing.T) {
	sub := "U1111111111111111111111111111111f"
	got := LineIdentityKey(sub)
	want := "line#" + sub
	if got != want {
		t.Fatalf("identity key = %q，應為 %q", got, want)
	}
	// 與 google/password 三條 key space 不可互撞。
	if got == GoogleIdentityKey(sub) || got == IdentityKey(ProviderPassword, sub) {
		t.Fatal("line 的 identity key 與其他 provider 撞鍵")
	}
	// 大小寫**不可**被正規化：LINE userId 是大小寫敏感的，小寫化會讓兩個不同用戶撞成同一把鑰匙。
	if LineIdentityKey("Uabc") == LineIdentityKey("uabc") {
		t.Fatal("line identity key 被大小寫正規化了")
	}
}
