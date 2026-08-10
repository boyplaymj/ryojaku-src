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
// nonce 非空時一併送出給 LINE 比對；空字串代表前端沒帶 nonce。
//
// 🔴 目前**沒有防重放**。nonce 是呼叫端自己傳進來的，後端沒有保存「本次登入預先發出的
// nonce」，所以拿到別人 id_token 的人可以把裡面的 nonce 一起送上來、照樣通過。
// 要真的擋重放，得走 LINE 建議的流程：伺服器產 nonce → 存起來（短 TTL）→ 前端帶去
// 授權請求 → 這裡驗完單次消耗。見 AUTH_SYSTEM_DESIGN §5.G「已知限制」。
func VerifyLINEIDToken(ctx context.Context, rawIDToken, nonce string) (*LineIdentity, error) {
	channelID := os.Getenv("LINE_LOGIN_CHANNEL_ID")
	if channelID == "" {
		return nil, ErrLineChannelNotConfigured
	}
	if strings.TrimSpace(rawIDToken) == "" {
		return nil, errors.New("empty id_token")
	}

	form := url.Values{}
	form.Set("id_token", rawIDToken)
	form.Set("client_id", channelID)
	if nonce != "" {
		form.Set("nonce", nonce)
	}

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
	// 有帶 nonce 就必須原樣回來。
	// ⚠️ 這**不是防重放**。nonce 由呼叫端自己給，攻擊者拿到 id_token 後可以直接讀出裡面的
	// nonce 一起送上來，這道檢查照樣會過。真正的防重放要「伺服器先發 nonce、存起來、
	// 事後單次消耗」，目前沒有那個狀態。這裡的作用只有：把 nonce 轉給 LINE 一併比對，
	// 以及在前端有正確實作時擋掉「token 與本次授權請求不相符」的低階錯誤。
	if nonce != "" && vr.Nonce != nonce {
		return nil, errors.New("nonce mismatch")
	}

	return &LineIdentity{
		Sub:     vr.Sub,
		Name:    vr.Name,
		Picture: vr.Picture,
		Email:   strings.ToLower(strings.TrimSpace(vr.Email)),
	}, nil
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
