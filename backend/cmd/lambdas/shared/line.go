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

// ───────────────────────── authorization code 交換 ─────────────────────────
//
// 為什麼需要這一段（不是可有可無的第二條路，是 **web 唯一的一條路**）：
// LINE Login 只支援 `response_type=code`（無 implicit），而 code 換 token 必須帶
// `client_secret` —— 連走 PKCE 都不豁免。所以瀏覽器**永遠拿不到 client-side id_token**，
// 只能把 code 送回後端、由後端拿 channel secret 去換。
//   - 官方：developers.line.biz/en/docs/line-login/integrate-line-login/ （"LINE Login only supports code"）
//   - 官方：developers.line.biz/en/docs/line-login/integrate-pkce/       （PKCE 範例仍帶 client_secret）
//
// 原生 App（LINE iOS/Android SDK）則相反：SDK 直接回 id_token，且
// LineAuthenticationParams 支援自訂 nonce → 走 idToken 那條路。兩條路都保留，
// 由 ValidateLineCredential 強制「二選一」。
//
// ⚠️ LIFF 不是第三條路：liff.getIDToken() 雖能 client-side 取 token，但 liff.login()
//    沒有 nonce 參數，過不了本檔「nonce 必填」的契約。

// ErrLineChannelSecretNotConfigured：未設 LINE_LOGIN_CHANNEL_SECRET（fail-closed）。
// 與 ErrLineChannelNotConfigured 分開，是為了讓「只設了 ID 忘了 secret」這個
// 最可能發生的部署失誤在日誌裡一眼可辨，而不是含混地報「未設定」。
var ErrLineChannelSecretNotConfigured = errors.New("LINE_LOGIN_CHANNEL_SECRET not configured")

// ErrLineCredentialShape：code 與 idToken 沒有剛好給一個。
var ErrLineCredentialShape = errors.New("provide exactly one of code or idToken")

// 可在測試中覆寫（指向 httptest server）。生產路徑不改。
var lineTokenEndpoint = "https://api.line.me/oauth2/v2.1/token"

// lineTokenResponse：token 端點回應（只取我們會用到的欄位）。
type lineTokenResponse struct {
	IDToken string `json:"id_token"`
	// 失敗時回這兩個。
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// validateLineRedirectURI：擋掉明顯不合法的 redirect_uri，並在送出前就失敗。
//
// ⚠️ 這**不是**安全邊界，別當成一道防線來依賴：真正擋住「把 code 導去攻擊者網站」的是
// LINE console 那份已註冊 callback URL 清單（LINE 會逐字比對，沒註冊的一律拒絕）。
// 這裡做的只有兩件事：擋掉相對路徑／空字串之類的垃圾輸入省一次外呼，以及擋掉
// 非 localhost 的明文 http（那種本來也不該被註冊）。
// 刻意**不**在後端另立一份白名單 —— 那會跟 console 的清單各走各的，日後有人在 console
// 加了 callback 卻忘了改 SSM，症狀是登入壞掉但錯誤訊息指向別處。
func validateLineRedirectURI(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return errors.New("invalid redirect_uri")
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		host := u.Hostname()
		if host == "localhost" || host == "127.0.0.1" || host == "::1" {
			return nil
		}
		return errors.New("redirect_uri: plain http only allowed for localhost")
	default:
		return errors.New("invalid redirect_uri scheme")
	}
}

// ExchangeLINECode：用 authorization code 換 id_token（POST /oauth2/v2.1/token）。
// 只回 id_token —— access_token 我們一概不留，因為這套流程只拿 LINE 當身分來源，
// 不代表使用者去呼叫任何 LINE API，留著等於多存一份沒人用的憑證。
//
// 回傳的 id_token 仍要再過 VerifyLINEIDToken。雖然它是從 LINE 經 TLS 直送、
// 理論上可信，但那樣就得在這裡另寫一套 iss/aud/exp/sub/nonce 的解析與檢查 ——
// 重複一份驗證邏輯遠比多打一次 verify 端點危險（兩份會漂）。
func ExchangeLINECode(ctx context.Context, code, redirectURI string) (string, error) {
	channelID := os.Getenv("LINE_LOGIN_CHANNEL_ID")
	if channelID == "" {
		return "", ErrLineChannelNotConfigured
	}
	channelSecret := os.Getenv("LINE_LOGIN_CHANNEL_SECRET")
	if channelSecret == "" {
		return "", ErrLineChannelSecretNotConfigured
	}
	if strings.TrimSpace(code) == "" {
		return "", errors.New("empty code")
	}
	if err := validateLineRedirectURI(redirectURI); err != nil {
		return "", err
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", channelID)
	form.Set("client_secret", channelSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, lineTokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := lineHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}

	var tr lineTokenResponse
	if jerr := json.Unmarshal(body, &tr); jerr != nil {
		// 非 JSON（如 5xx HTML 錯誤頁）→ 一律當交換失敗，不放行。
		return "", fmt.Errorf("line token: bad response (status %d)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		// invalid_grant 最常見的成因：code 已用過、逾時，或 redirect_uri 跟授權當下不逐字相符。
		return "", fmt.Errorf("line token exchange rejected (status %d): %s", resp.StatusCode, tr.ErrorDescription)
	}
	// 200 但帶 error 欄位也算失敗（別只看狀態碼）。
	if tr.Error != "" {
		return "", fmt.Errorf("line token exchange rejected: %s", tr.Error)
	}
	// 沒有 id_token 代表授權請求漏了 openid scope。這種情況必須硬失敗：
	// 空字串往下傳會變成 VerifyLINEIDToken 的 "empty id_token"，錯誤指向錯的地方。
	if strings.TrimSpace(tr.IDToken) == "" {
		return "", errors.New("line token response has no id_token (missing openid scope?)")
	}
	return tr.IDToken, nil
}

// ValidateLineCredential：憑證形狀檢查 —— code 與 idToken 必須**剛好給一個**。
//
// 兩個都給要擋，不能「有 code 就優先用 code」：那等於留一個沒人檢查的欄位，
// 日後有人改動分支順序就會變成可繞過的旋鈕。都不給當然也擋。
// 端點層在消耗 nonce **之前**先呼叫這支（純形狀檢查、不接觸 LINE，不構成預言機），
// 免得一個打錯的請求就白燒掉使用者一顆 nonce。
func ValidateLineCredential(code, idToken string) error {
	hasCode := strings.TrimSpace(code) != ""
	hasToken := strings.TrimSpace(idToken) != ""
	if hasCode == hasToken {
		return ErrLineCredentialShape
	}
	return nil
}

// ResolveLINELogin：把兩條路收斂成一個回傳值 —— 有 code 就先換成 id_token，然後
// 一律走同一支 VerifyLINEIDToken。兩支端點共用這裡，避免 web/native 分歧各驗一套。
//
// 🔴 呼叫端必須**已經**消耗過 nonce（ConsumeLineNonce）才呼叫這支。順序不可對調：
//    先驗證後消耗會開出一個競態窗口，也會讓端點變成 LINE verify 的預言機。
func ResolveLINELogin(ctx context.Context, code, redirectURI, idToken, nonce string) (*LineIdentity, error) {
	if err := ValidateLineCredential(code, idToken); err != nil {
		return nil, err
	}
	rawIDToken := idToken
	if strings.TrimSpace(code) != "" {
		exchanged, err := ExchangeLINECode(ctx, code, redirectURI)
		if err != nil {
			return nil, err
		}
		rawIDToken = exchanged
	}
	return VerifyLINEIDToken(ctx, rawIDToken, nonce)
}

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
