package shared

// 帳號系統 — SES v2 寄信（認證信 / 重設密碼）。
// 寄件人 MAIL_FROM、前端 APP_BASE_URL、SES 區域 SES_REGION 由 env 提供。
// 詳 tools/ryojaku-webapp/AUTH_SYSTEM_DESIGN.md §4.3 / §8。

import (
	"context"
	"fmt"
	"log"
	"os"

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

func sesRegion() string   { return getenvDefault("SES_REGION", "ap-southeast-1") }
func mailFrom() string    { return getenvDefault("MAIL_FROM", "両雀 Ryōjaku <no-reply@jiomj.com>") }
func appBaseURL() string  { return getenvDefault("APP_BASE_URL", "https://jiomj.boyplaymj.com") }

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
	link := fmt.Sprintf("%s/#/verify?token=%s", appBaseURL(), rawToken) // HashRouter 前端 → 用 /#/ 形式
	return sendEmail(ctx, to, "【両雀】驗證你的信箱", brandedEmail(
		"驗證你的信箱",
		"歡迎加入両雀！點下方按鈕完成信箱驗證，就能開團與加入牌局。",
		"驗證信箱", link,
		"此連結 24 小時內有效。若非你本人操作，請忽略這封信。",
	))
}

// SendResetEmail：寄重設密碼信。
func SendResetEmail(ctx context.Context, to, rawToken string) error {
	link := fmt.Sprintf("%s/#/reset?token=%s", appBaseURL(), rawToken) // HashRouter 前端 → 用 /#/ 形式
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
