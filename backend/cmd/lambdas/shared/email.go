package shared

// 帳號系統 — SES v2 寄信（認證信 / 重設密碼）。
// 寄件人 MAIL_FROM、前端 APP_BASE_URL、SES 區域 SES_REGION 由 env 提供。
// 詳 tools/ryojaku-webapp/AUTH_SYSTEM_DESIGN.md §4.3 / §8。

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

var sesClient *sesv2.Client

func getSESClient() *sesv2.Client {
	if sesClient == nil {
		cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion(sesRegion()))
		if err != nil {
			log.Printf("[Email] 無法載入 AWS 設定: %v", err)
			return nil
		}
		sesClient = sesv2.NewFromConfig(cfg)
	}
	return sesClient
}

func getenvDefault(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func sesRegion() string { return getenvDefault("SES_REGION", "ap-southeast-1") }
func mailFrom() string  { return getenvDefault("MAIL_FROM", "両雀 Ryōjaku <no-reply@jiomj.com>") }

// ErrAppBaseURLNotConfigured：未設 APP_BASE_URL。
//
// 🔴 這裡刻意**沒有預設值**（2026-08-10 改）。原本寫的是
//     getenvDefault("APP_BASE_URL", "https://jiomj.boyplaymj.com")
// 而 `jiomj.boyplaymj.com` 實測是**後台**的 CloudFront（根路徑 302 導向 /admin/，
// 任意路徑回 S3 AccessDenied）。也就是說沒設這個 env 時，認證信與重設密碼信
// 會照常寄出、但連結指向後台 —— 使用者點了到不了驗證頁，帳號永遠停在未驗證，
// 又因為信箱軟門檻而開不了團。**信寄成功、流程死掉、沒有任何錯誤日誌。**
//
// 一個指向錯地方的預設值比沒有預設值危險：後者部署當下就會炸，前者要等真實
// 使用者卡住才會被發現，而且症狀不會指向這裡。對齊本專案其他 fail-closed
// 慣例（LINE channel 未設 → 401；前端 VITE_API_BASE_URL 未設 → 直接 throw）。
var ErrAppBaseURLNotConfigured = errors.New("APP_BASE_URL not configured")

// authLink：組認證流程連結（HashRouter 前端 → /#/<route>?token=）。
// token 由 IssueToken 以 base64.RawURLEncoding 產生，本身就是 URL-safe，不需再跳脫。
func authLink(route, rawToken string) (string, error) {
	base := strings.TrimSpace(os.Getenv("APP_BASE_URL"))
	if base == "" {
		return "", ErrAppBaseURLNotConfigured
	}
	// 去掉結尾斜線，否則 APP_BASE_URL 設成 "https://x/" 會拼出 "https://x//#/verify"。
	return fmt.Sprintf("%s/#/%s?token=%s", strings.TrimRight(base, "/"), route, rawToken), nil
}

// sendEmail：SES v2 寄一封 HTML 信。
func sendEmail(ctx context.Context, to, subject, html string) error {
	c := getSESClient()
	if c == nil {
		return fmt.Errorf("ses client unavailable")
	}
	_, err := c.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(mailFrom()),
		Destination:      &types.Destination{ToAddresses: []string{to}},
		Content: &types.EmailContent{
			Simple: &types.Message{
				Subject: &types.Content{Data: aws.String(subject), Charset: aws.String("UTF-8")},
				Body:    &types.Body{Html: &types.Content{Data: aws.String(html), Charset: aws.String("UTF-8")}},
			},
		},
	})
	if err != nil {
		log.Printf("[Email] 寄送失敗 to=%s subject=%s: %v", to, subject, err)
	}
	return err
}

// SendVerifyEmail：寄認證信（連結帶明碼 token）。
func SendVerifyEmail(ctx context.Context, to, rawToken string) error {
	link, err := authLink("verify", rawToken)
	if err != nil {
		// 寧可整封不寄，也不要寄一封連結指向錯地方的信 —— 那種信收得到、點得下去、
		// 就是完不成驗證，使用者不會回報「連結壞了」，只會以為系統壞了。
		log.Printf("[Email] 略過認證信（APP_BASE_URL 未設）to=%s", to)
		return err
	}
	return sendEmail(ctx, to, "【両雀】驗證你的信箱", brandedEmail(
		"驗證你的信箱",
		"歡迎加入両雀！點下方按鈕完成信箱驗證，就能開團與加入牌局。",
		"驗證信箱", link,
		"此連結 24 小時內有效。若非你本人操作，請忽略這封信。",
	))
}

// SendResetEmail：寄重設密碼信。
func SendResetEmail(ctx context.Context, to, rawToken string) error {
	link, err := authLink("reset", rawToken)
	if err != nil {
		log.Printf("[Email] 略過重設信（APP_BASE_URL 未設）to=%s", to)
		return err
	}
	return sendEmail(ctx, to, "【両雀】重設你的密碼", brandedEmail(
		"重設你的密碼",
		"我們收到重設密碼的請求。點下方按鈕設定新密碼。",
		"重設密碼", link,
		"此連結 30 分鐘內有效、僅能使用一次。若非你本人操作，請忽略這封信，你的密碼不會被更動。",
	))
}

// brandedEmail：極簡品牌化 HTML 模板（文字不內嵌圖，遵 i18n 原則）。
func brandedEmail(title, body, btnText, btnURL, footer string) string {
	return fmt.Sprintf(`<!DOCTYPE html><html lang="zh-Hant"><body style="margin:0;background:#0f172a;font-family:-apple-system,'PingFang TC','Noto Sans TC',sans-serif;color:#f1f5f9;">
<div style="max-width:480px;margin:0 auto;padding:32px 24px;">
  <div style="font-size:20px;font-weight:800;letter-spacing:2px;margin-bottom:24px;">両雀 Ryōjaku</div>
  <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;">
    <div style="font-size:18px;font-weight:700;margin-bottom:12px;">%s</div>
    <div style="font-size:14px;line-height:1.7;color:#cbd5e1;margin-bottom:22px;">%s</div>
    <a href="%s" style="display:inline-block;background:linear-gradient(180deg,#5fd0ff,#38bdf8);color:#04222e;font-weight:800;text-decoration:none;padding:12px 24px;border-radius:12px;">%s</a>
    <div style="font-size:12px;color:#64748b;margin-top:22px;line-height:1.6;">%s</div>
    <div style="font-size:11px;color:#475569;margin-top:14px;word-break:break-all;">按鈕無法點擊時，請複製此連結：<br>%s</div>
  </div>
</div></body></html>`, title, body, btnURL, btnText, footer, btnURL)
}
