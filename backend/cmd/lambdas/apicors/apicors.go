// Package apicors 在 handler 邊界補上 CORS 回應標頭（設計冊 tools/ryojaku-admin-migration/DESIGN.md §5.7）。
//
// 修的是 P4-c 點測抓到的缺陷：admin-admins 與 admin-moderation 在 handler 開頭建了含
// Access-Control-Allow-Origin 的 headers，卻**只用在驗證失敗的分支** —— 業務函式一律回
// events.APIGatewayProxyResponse{StatusCode: 200, Body: ...}，完全沒有 Headers 欄位。
// 結果是 curl 看起來 200 一切正常，瀏覽器卻在 CORS 層就擋掉、整頁壞掉。
//
// 刻意做成「包在 lambda.Start 外面」而不是逐一修每個 return：
// 業務函式有十幾處 return（含 4xx/5xx），逐處補一定會漏，日後新增分支也會再漏一次。
// 包一層則是單一入口、分支再多都蓋得到。
//
// 只補「還沒有的」標頭，不覆蓋既有值 —— 例如 redeem 的 CSV 下載會自己設
// Content-Type: text/csv 與 Content-Disposition，不能被洗掉。
//
// ⚠️ 刻意不放進 cmd/lambdas/shared：那包有 package 級 init() 與推播／Firebase 相依，
// 加進原本沒引用的 admin lambda 會讓 binary 由 16MB 漲到 23MB（見 adminrole 的同款說明）。
// 本包零相依。
package apicors

import (
	"context"

	"github.com/aws/aws-lambda-go/events"
)

// Headers 是後台各支共用的 CORS 標頭組合。
//
// Allow-Origin 用 "*" 而非白名單：這些端點一律要求 Authorization bearer token，
// 而瀏覽器在 Allow-Origin: * 時本來就不會送 cookie，不存在 credential 被跨站帶出的問題；
// 真正的門檻是 authorizer 與程式碼閘，不是 CORS。要改白名單得先決定 Console 的正式網域
// （§7 待決事項），現階段 staging 與未來 prod 網域不同，寫死反而會踩自己。
var Headers = map[string]string{
	"Access-Control-Allow-Origin":  "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
}

// HandlerV1 是 REST v1（APIGatewayProxyRequest）的 handler 形狀。
type HandlerV1 func(context.Context, events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error)

// WrapV1 包住 handler，確保回應一定帶 CORS 標頭。
//
// handler 回 error 時不動它（lambda runtime 會轉成 502，那條路本來就沒有可用的回應可以改）；
// 我方 admin 各支的慣例是「錯誤也回 nil error ＋ 4xx/5xx 回應」，故實務上都會被蓋到。
func WrapV1(h HandlerV1) HandlerV1 {
	return func(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
		resp, err := h(ctx, req)
		if err != nil {
			return resp, err
		}
		if resp.Headers == nil {
			resp.Headers = map[string]string{}
		}
		for k, v := range Headers {
			if _, exists := resp.Headers[k]; !exists {
				resp.Headers[k] = v
			}
		}
		return resp, nil
	}
}
