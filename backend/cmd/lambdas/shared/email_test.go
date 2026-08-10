package shared

// shared/email.go 的認證連結測試。
//
// 重點只有一個：**APP_BASE_URL 未設時不可以寄出信。**
// 改動前這裡有一個預設值 `https://jiomj.boyplaymj.com`，而那實測是後台的
// CloudFront —— 信會寄成功、連結指向後台、使用者永遠驗證不了、沒有錯誤日誌。

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestAuthLink_FailsClosedWithoutAppBaseURL(t *testing.T) {
	for _, v := range []string{"", "   ", "\t\n"} {
		t.Setenv("APP_BASE_URL", v)
		link, err := authLink("verify", "tok123")
		if !errors.Is(err, ErrAppBaseURLNotConfigured) {
			t.Errorf("APP_BASE_URL=%q 應回 ErrAppBaseURLNotConfigured，得到 err=%v", v, err)
		}
		if link != "" {
			t.Errorf("失敗時不可回傳連結，得到 %q", link)
		}
	}
}

func TestAuthLink_Format(t *testing.T) {
	cases := []struct {
		name  string
		base  string
		route string
		want  string
	}{
		{"一般", "https://app.example.com", "verify", "https://app.example.com/#/verify?token=tok123"},
		{"重設路由", "https://app.example.com", "reset", "https://app.example.com/#/reset?token=tok123"},
		// 結尾斜線不處理的話會拼出 https://app.example.com//#/verify —— 有些前端路由會吃不到。
		{"結尾斜線", "https://app.example.com/", "verify", "https://app.example.com/#/verify?token=tok123"},
		{"多個結尾斜線", "https://app.example.com///", "verify", "https://app.example.com/#/verify?token=tok123"},
		{"前後空白", "  https://app.example.com  ", "verify", "https://app.example.com/#/verify?token=tok123"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("APP_BASE_URL", c.base)
			got, err := authLink(c.route, "tok123")
			if err != nil {
				t.Fatalf("不該失敗：%v", err)
			}
			if got != c.want {
				t.Errorf("連結不符\n want %s\n got  %s", c.want, got)
			}
			if strings.Contains(got, "//#/") {
				t.Errorf("出現重複斜線：%s", got)
			}
		})
	}
}

// 🔴 authLink 自己正確，跟寄信函式**有沒有檢查它的錯誤**是兩件事。
// 少了這兩支，把 SendVerifyEmail 裡那段 `if err != nil { return err }` 刪掉，
// 上面的測試依然全綠 —— 而實際行為會退回「照樣寄出壞連結」。
func TestSendVerifyEmail_FailsClosedWithoutAppBaseURL(t *testing.T) {
	t.Setenv("APP_BASE_URL", "")
	err := SendVerifyEmail(context.Background(), "someone@example.com", "tok123")
	if !errors.Is(err, ErrAppBaseURLNotConfigured) {
		t.Fatalf("APP_BASE_URL 未設時應拒寄並回 ErrAppBaseURLNotConfigured，得到 %v", err)
	}
}

func TestSendResetEmail_FailsClosedWithoutAppBaseURL(t *testing.T) {
	t.Setenv("APP_BASE_URL", "")
	err := SendResetEmail(context.Background(), "someone@example.com", "tok123")
	if !errors.Is(err, ErrAppBaseURLNotConfigured) {
		t.Fatalf("APP_BASE_URL 未設時應拒寄並回 ErrAppBaseURLNotConfigured，得到 %v", err)
	}
}
