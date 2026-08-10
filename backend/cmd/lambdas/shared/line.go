package shared

// 帳號系統 — LINE Login id_token 後端驗證（AUTH_SYSTEM_DESIGN §5.B/§5.E）。
// 對照 google.go：Google 用官方 SDK 做本地 JWKS 驗證，LINE 沒有等價的 Go SDK，
// 改呼叫官方 verify 端點 POST https://api.line.me/oauth2/v2.1/verify
// （form-urlencoded：id_token / client_id / 選填 nonce）。該端點會驗簽章、aud、exp。
// 一律以驗證後回應的 sub 為準，絕不信前端傳來的欄位。
//
// ⚠️ 這支驗的是「LINE Login channel」發的 id_token，跟工程師既有的 LINE bot 密文流
//    （ENCRYPTION_KEY / gcm.Open）是兩條不同的路，不要互相代入。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// LineIdentity：驗證通過的 LINE 身分。
type LineIdentity struct {
	Sub     string // LINE userId（同一 provider 下穩定，綁定用）
	Name    string // 需 profile scope
	Picture string // 需 profile scope
	Email   string // 需 email scope（且該 scope 要送審通過）；已 lower/trim
}

// ErrLineChannelNotConfigured：未設 LINE_LOGIN_CHANNEL_ID（fail-closed，對齊 ErrGoogleClientNotConfigured）。
var ErrLineChannelNotConfigured = errors.New("LINE_LOGIN_CHANNEL_ID not configured")

// lineExpectedIssuer：LINE id_token 的 iss 固定值（官方文件 payload 範例）。
const lineExpectedIssuer = "https://access.line.me"

// 可在測試中覆寫（指向 httptest server）。生產路徑不改。
var lineVerifyEndpoint = "https://api.line.me/oauth2/v2.1/verify"
var lineHTTPClient = &http.Client{Timeout: 10 * time.Second}

// lineVerifyResponse：verify 端點的成功回應（只取我們會用到的欄位）。
type lineVerifyResponse struct {
	Iss     string `json:"iss"`
	Sub     string `json:"sub"`
	Aud     string `json:"aud"`
	Exp     int64  `json:"exp"`
	Nonce   string `json:"nonce"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
	Email   string `json:"email"`
	// 失敗時回這兩個（HTTP 400）。
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// VerifyLINEIDToken：驗 LINE id_token，回驗證後的身分。任何驗證失敗回 err。
// nonce 一併送出給 LINE 比對，並在這裡再驗一次回應相符。
//
// ⚠️ 光是這個比對**擋不住重放** —— nonce 由呼叫端傳進來，拿到別人 id_token 的人可以
// 把裡面的 nonce 一起送上來。真正的防重放靠的是呼叫端先跑 ConsumeLineNonce()
// （伺服器發、單次消耗），兩者要一起用才成立。端點層的順序見 auth_line/main.go。
func VerifyLINEIDToken(ctx context.Context, rawIDToken, nonce string) (*LineIdentity, error) {
	channelID := os.Getenv("LINE_LOGIN_CHANNEL_ID")
	if channelID == "" {
		return nil, ErrLineChannelNotConfigured
	}
	if strings.TrimSpace(rawIDToken) == "" {
		return nil, errors.New("empty id_token")
	}
	// nonce 必填。原本寫成「非空才比對」，那是一個任何人都能靠「不帶 nonce」繞過的旋鈕；
	// 端點層已經強制要有 nonce（ConsumeLineNonce），這裡再擋一次，讓這支函式本身
	// 不存在「沒 nonce 的合法用法」。
	if strings.TrimSpace(nonce) == "" {
		return nil, ErrLineNonceRequired
	}

	form := url.Values{}
	form.Set("id_token", rawIDToken)
	form.Set("client_id", channelID)
	form.Set("nonce", nonce)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, lineVerifyEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := lineHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var vr lineVerifyResponse
	if jerr := json.Unmarshal(body, &vr); jerr != nil {
		// 非 JSON（如 5xx HTML 錯誤頁）→ 一律當驗證失敗，不放行。
		return nil, fmt.Errorf("line verify: bad response (status %d)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("line verify rejected (status %d): %s", resp.StatusCode, vr.ErrorDescription)
	}
	// 200 但帶 error 欄位也算失敗（別只看狀態碼）。
	if vr.Error != "" {
		return nil, fmt.Errorf("line verify rejected: %s", vr.Error)
	}

	// 以下四項 verify 端點理論上都已把關，這裡再自行驗一次（fail-closed，對齊 google.go 明驗 iss 的作法）：
	// 端點行為改變 / 送錯 client_id / 回應被中間層置換，任一情形都不該讓身分溜過去。
	if vr.Iss != lineExpectedIssuer {
		return nil, errors.New("invalid issuer")
	}
	if vr.Aud != channelID {
		return nil, errors.New("invalid audience")
	}
	if vr.Sub == "" {
		return nil, errors.New("missing sub")
	}
	// exp 缺失或 <=0 一律拒絕，不可「沒有 exp 就當沒過期」——那等於在回應被置換或
	// 端點行為改變時自動放行一張永不過期的票。官方文件把 exp 列為必回欄位
	// （不像 name/picture/email 標明有條件），所以要求它存在不會誤傷正常流量。
	if vr.Exp <= 0 {
		return nil, errors.New("missing exp")
	}
	if time.Now().Unix() >= vr.Exp {
		return nil, errors.New("id_token expired")
	}
	// nonce 必須原樣回來 —— 這一道確認的是「這張 id_token 綁的正是本次授權請求」。
	// 它單獨不構成防重放（nonce 由呼叫端傳入），要跟呼叫端的 ConsumeLineNonce
	// （伺服器發、單次消耗）合起來看：那邊保證這個 nonce 沒被用過，這邊保證 token 綁的是它。
	if vr.Nonce != nonce {
		return nil, errors.New("nonce mismatch")
	}

	return &LineIdentity{
		Sub:     vr.Sub,
		Name:    vr.Name,
		Picture: vr.Picture,
		Email:   strings.ToLower(strings.TrimSpace(vr.Email)),
	}, nil
}

// ErrLineNonceRequired：呼叫端沒帶 nonce。fail-closed —— 不接受「沒帶就跳過」，
// 否則整套防重放等於一個任何人都能繞過的旋鈕。
var ErrLineNonceRequired = errors.New("nonce is required")

// IssueLineNonce：發一個伺服器端 nonce（256-bit），存進 AuthTokens 並設短 TTL，回明碼。
// 前端把它帶進 LINE 授權請求，LINE 會把它烘進 id_token 的 nonce claim。
// DB 只存 SHA-256（沿用 AuthTokens 的既有作法），明碼只存在於回應與前端手上。
func IssueLineNonce(ctx context.Context) (string, error) {
	// userId 留空：這是 pre-auth 的 nonce，發的時候還不知道是誰。
	// 身分完全由後續 id_token 的 sub 決定，nonce 只負責「這張票只能用一次」。
	return IssueToken(ctx, "", PurposeLineNonce, TTLLineNonce)
}

// ConsumeLineNonce：原子消耗一個 nonce。成功回 nil；不存在／用途不符／過期／已用過都回 err。
// 靠 ConsumeToken 的單一 conditional UpdateItem 完成 → 同一個 nonce 被併發送兩次，
// 只有一次會成功（這正是擋重放的那一下）。
func ConsumeLineNonce(ctx context.Context, nonce string) error {
	if strings.TrimSpace(nonce) == "" {
		return ErrLineNonceRequired
	}
	// 回傳的 userId 對 nonce 沒有意義（發的時候是空的），刻意丟棄。
	_, err := ConsumeToken(ctx, nonce, PurposeLineNonce)
	return err
}

// LineIdentityKey：line#<sub>。
//
// ⚠️ 與設計冊字面不同，刻意的。AUTH_SYSTEM_DESIGN.md §2 表格原文寫的是：
//     「| **PK** `identity` | `google#<sub>` / `email#<lowercased>` / `line#<encryptedLineId>` |」
// 那個 `<encryptedLineId>` 描述的是工程師既有 LINE bot 那條路的密文 ID。本函式服務的是
// 新的 LINE Login channel，且密文不能當 PK —— AES-GCM 每次加密帶隨機 nonce，同一個
// LINE ID 會產生不同密文，拿來當主鍵每次登入都查不到自己。故改用 verify 端點回傳的
// 明文 sub。實證：全 repo `line#` 只出現在設計冊與註解，AuthIdentities 沒有任何既有
// line 身分（`ProviderLine` 先前只被 auth_unbind 的白名單引用過），不會撞鍵。
func LineIdentityKey(sub string) string { return IdentityKey(ProviderLine, sub) }
