package shared

import "testing"

func TestSanitizeUploadFileName(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		want  string
		wantOK bool
	}{
		// ── 這組是本次修補的理由：帶斜線的檔名可以跨出自己的前綴 ──
		{"斜線被剝掉", "../../avatars/APP_victim/evil.png", "evil.png", true},
		{"前導路徑", "a/b/c.png", "c.png", true},
		{"反斜線也算分隔符", `..\..\windows\evil.png`, "evil.png", true},
		{"純上層", "..", "", false},
		{"純點", ".", "", false},
		{"只有斜線", "/", "", false},
		{"空字串", "", "", false},
		{"只有空白", "   ", "", false},

		// ── 一般情況不可被破壞 ──
		{"正常檔名", "photo.jpg", "photo.jpg", true},
		{"中文檔名保留", "我的照片.png", "我的照片.png", true},
		{"含空白保留", "my photo.jpg", "my photo.jpg", true},
		{"含連字號底線", "a-b_c.webp", "a-b_c.webp", true},

		// ── 各層處理不一致的字元換成底線 ──
		{"引號與角括號", `a"b<c>.png`, "a_b_c_.png", true},
		{"分號與 and", "a;b&c.png", "a_b_c.png", true},

		// ── 控制字元丟棄 ──
		{"換行被丟棄", "a\nb.png", "ab.png", true},
		{"NUL 被丟棄", "a\x00b.png", "ab.png", true},

		// ── 尾端的點與空白會讓某些檔案系統/CDN 行為分歧 ──
		{"尾端點被剝除", "photo.jpg...", "photo.jpg", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := SanitizeUploadFileName(c.in)
			if ok != c.wantOK || got != c.want {
				t.Errorf("SanitizeUploadFileName(%q) = (%q, %v)，預期 (%q, %v)", c.in, got, ok, c.want, c.wantOK)
			}
		})
	}
}

func TestSanitizeUploadFileNameLength(t *testing.T) {
	long := ""
	for i := 0; i < 300; i++ {
		long += "a"
	}
	got, ok := SanitizeUploadFileName(long + ".jpg")
	if !ok {
		t.Fatal("超長檔名應被截斷而非拒絕")
	}
	if len(got) > maxFileNameLen {
		t.Errorf("截斷後長度 %d 超過上限 %d", len(got), maxFileNameLen)
	}
	// 🔴 截斷不可以把副檔名砍掉 —— 那會讓下載端猜不出型別。
	if got[len(got)-4:] != ".jpg" {
		t.Errorf("截斷後應保留副檔名，得到 %q", got)
	}
}

// 反控：確認淨化後的結果**真的不含**分隔符。
// 只斷言「等於某個預期字串」的話，若我把預期值也寫錯就一起錯了。
func TestSanitizedNameNeverContainsSeparator(t *testing.T) {
	inputs := []string{
		"../../etc/passwd", `..\..\x.png`, "a/b/c/d.png", "//////x.png",
		"a/./b/../c.png", "…/…/x.png",
	}
	for _, in := range inputs {
		got, ok := SanitizeUploadFileName(in)
		if !ok {
			continue
		}
		for _, bad := range []string{"/", `\`} {
			if containsStr(got, bad) {
				t.Errorf("SanitizeUploadFileName(%q) = %q，仍含分隔符 %q", in, got, bad)
			}
		}
	}
}

func containsStr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestSanitizeUploadPathSegment(t *testing.T) {
	cases := []struct {
		in     string
		want   string
		wantOK bool
	}{
		{"GAME_20260731_abc123", "GAME_20260731_abc123", true},
		{"room-1", "room-1", true},
		{"../../evil", "evil", true},   // 分隔符與點被丟棄
		{"a/b", "ab", true},            // 同上
		{"", "", false},
		{"///", "", false},             // 全被丟棄 → 判為不可用
		{"中文房間", "", false},          // 只留 ASCII 英數與 -_
	}
	for _, c := range cases {
		got, ok := SanitizeUploadPathSegment(c.in)
		if got != c.want || ok != c.wantOK {
			t.Errorf("SanitizeUploadPathSegment(%q) = (%q, %v)，預期 (%q, %v)", c.in, got, ok, c.want, c.wantOK)
		}
	}
}

func TestIsAllowedUploadContentType(t *testing.T) {
	allowed := []string{
		"image/jpeg", "image/png", "image/gif", "image/webp",
		"image/heic", "image/heif", // iPhone 預設格式，漏了會變成「iPhone 傳不了圖」
		"IMAGE/JPEG",               // 大小寫不敏感
		"image/png; charset=utf-8", // 參數要被剝掉
	}
	for _, ct := range allowed {
		if !IsAllowedUploadContentType(ct) {
			t.Errorf("%q 應被允許", ct)
		}
	}

	denied := []string{
		"image/svg+xml", // 🔴 可內嵌 script，明確排除
		"text/html", "application/javascript", "application/pdf",
		"application/octet-stream", "", "image", "image/",
	}
	for _, ct := range denied {
		if IsAllowedUploadContentType(ct) {
			t.Errorf("%q 不應被允許", ct)
		}
	}
}
