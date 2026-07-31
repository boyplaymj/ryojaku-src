package shared

import (
	"path"
	"strings"
	"unicode"
)

// 上傳端點的 S3 key 淨化。
//
// 背景：四支 upload 端點（avatars / posts / events / chat）都把使用者可控的
// `fileName`（chat 另加 `roomId`）直接 `fmt.Sprintf` 進 S3 key，沒有任何淨化。
//
// S3 的 key 是**字面字串**，`..` 不具目錄穿越語意，所以這不是傳統的 path traversal。
// 真正的問題是 `/`：檔名帶斜線就能把物件寫進非預期的前綴，例如
// `fileName = "../avatars/APP_victim/evil.png"` 會產生一個橫跨 avatars/ 前綴的 key。
// 前綴常被拿來當權限或清理的邊界（例如「只清 events/」「只服務 posts/」），
// 一旦可以跨越，那些邊界就不再成立。
//
// 另外 CloudFront／瀏覽器對含 `..`、`//`、控制字元的路徑正規化行為不一致，
// 同一個物件可能有多種可達路徑，讓稽核與清理更難對帳。

const maxFileNameLen = 100

// 允許的上傳 MIME。四支端點的前端都只選圖片（`image/*` 或明確清單），
// 故此處僅收點陣圖格式。
//
// 🔴 刻意**不含** `image/svg+xml`：SVG 可內嵌 <script>，若哪天這些 bucket
// 被直接對外服務（目前 CloudFront 回 403，但那是設定不是保證），就是儲存型 XSS。
// 也刻意收 heic/heif —— iPhone 預設就是這個格式，漏了會變成「iPhone 使用者傳不了圖」。
var allowedUploadContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
	"image/heic": true,
	"image/heif": true,
	"image/bmp":  true,
	"image/tiff": true,
}

// SanitizeUploadFileName 把使用者提供的檔名壓成單一、安全的 key 片段。
// 回傳 (淨化後檔名, 是否可用)。不可用時呼叫端應回 400，不要退而求其次自己編一個名字
// —— 靜默改名會讓使用者拿到一個他沒預期的 URL。
func SanitizeUploadFileName(name string) (string, bool) {
	// path.Base 會剝掉所有目錄成分：`a/b/c.png` → `c.png`、`../../x.png` → `x.png`。
	// 反斜線先轉成斜線，否則 Windows 風格路徑會整串被當成單一檔名留下。
	name = strings.ReplaceAll(name, `\`, "/")
	name = path.Base(strings.TrimSpace(name))

	// path.Base 對這幾種輸入會回傳它們本身，全都不是合法檔名。
	switch name {
	case "", ".", "..", "/":
		return "", false
	}

	var b strings.Builder
	for _, r := range name {
		switch {
		case r > unicode.MaxASCII:
			// 保留非 ASCII（中文檔名很常見），但排除控制類。
			if unicode.IsControl(r) {
				continue
			}
			b.WriteRune(r)
		case r == '/' || r == '\\' || unicode.IsControl(r):
			// 前面已 Base 過，這裡是保險：任何殘留的分隔符與控制字元一律丟棄。
			continue
		case strings.ContainsRune(`"'<>|?*:;&$`+"`", r):
			// 這些字元在 URL／shell／header 各層的處理不一致，換成底線最省事。
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.Trim(b.String(), ". ")
	if out == "" {
		return "", false
	}

	// 過長的檔名截斷，但保留副檔名 —— 直接切尾會把 .jpg 砍掉，
	// 讓下載端猜不出型別。
	if len(out) > maxFileNameLen {
		ext := path.Ext(out)
		if len(ext) > 16 { // 不是副檔名，只是名字裡有個點
			ext = ""
		}
		keep := maxFileNameLen - len(ext)
		if keep < 1 {
			keep = 1
		}
		out = out[:keep] + ext
	}
	return out, true
}

// SanitizeUploadPathSegment 用於 key 裡的其他使用者可控片段（目前是 chat 的 roomId）。
// 比檔名嚴格：只留 ASCII 英數與 `-_`，其餘一律丟棄。
//
// 註：這只擋住「寫進別的前綴」，**不驗證呼叫者是否為該聊天室成員** —— 那是另一個問題。
func SanitizeUploadPathSegment(s string) (string, bool) {
	var b strings.Builder
	for _, r := range s {
		if r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_') {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" || len(out) > 128 {
		return "", false
	}
	return out, true
}

// IsAllowedUploadContentType 檢查 MIME 是否在白名單內。
// 會剝掉 `; charset=` 之類的參數並轉小寫再比對。
func IsAllowedUploadContentType(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(ct))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return allowedUploadContentTypes[ct]
}
