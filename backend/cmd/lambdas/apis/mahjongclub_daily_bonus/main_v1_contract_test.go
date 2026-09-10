package main

// 這支測的是「本 handler 是 REST_V1 (payload v1) 的」這個契約本身,不是每日獎勵的算法。
//
// 為什麼要有它:2026-09-10 把 /daily-bonus 由 HTTP_V2 搬到 REST_V1 時,
// 只搬了路由沒轉 handler,而**兩半的失敗都沒有錯誤訊號**:
//   ① 回應端:v2 結構多一個 `cookies` 欄位,REST proxy integration 只認
//      statusCode/headers/multiValueHeaders/body/isBase64Encoded ⇒ 判 malformed ⇒ 502,
//      而 Lambda 端 END 正常、零錯誤日誌、2.21ms。
//   ② 請求端:RequestContext.HTTP.Method 與 AuthorizerUserIDV2 讀的是 v2 專屬欄位,
//      餵 v1 事件時**靜靜取到零值** ⇒ 每個請求都被判成未授權。
// 在此之前這條的 v1 行為只由線上四格驗收支撐(`go test` 是 `[no test files]`)——
// 那把尺要真的部署上去才動得了,救不了「改回 v2 就靜靜壞掉」。
//
// 正典:infra/PATH_RECONCILE.md §4b。剩下七條要搬時,每一條都該複製一份這個測試。
//
// 🔴 突變 4 發:3 殺、**1 發存活,而存活的那發是最重要的那個形狀**。留著不修,理由如下。
//   M1 把 cookies 加進 restLegalKeys(讓 T3 恆真)      → T4 殺
//   M2 OPTIONS 判斷永遠不成立                          → T1 殺
//   M3 errorResponse 一律回 200                        → T2 殺
//   M4 `userID := ""`(身分永遠讀不到)                  → **存活**
//
// M4 為什麼存活:T5 測的是 shared.AuthorizerUserID 這支**函式**,不是 handler
// 有沒有真的用它的結果;而 T2 斷言「沒有 authorizer ⇒ 401」,在 M4 之下照樣成立。
// ⇒ **「身分讀得到的時候不會被判 401」這條線,目前沒有任何單元尺。**
// 要補它必須讓 handler 在帶合法 authorizer 時走得完而不碰真表 —— 那需要把
// dynamoClient 換成可注入的介面,是另一個決定,不在本次範圍內。
//
// ⚠️ 但 M4 **不是**當初那個 bug 的形狀。當初是 handler 讀 v2 專屬欄位;
//    那種寫法在 v1 簽章下**編譯不過**(型別不符)⇒ 那條的尺是編譯器,不是這裡。
//    M4 模擬的是「有人手動寫死空字串」——真的有洞,但沒發生過。
//    這兩者不要互相推論:編譯器擋得住型別走錯,擋不住值被寫死。

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aws/aws-lambda-go/events"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// REST proxy integration 允許的鍵。多一個就是 malformed ⇒ 502。
var restLegalKeys = map[string]bool{
	"statusCode": true, "headers": true, "multiValueHeaders": true,
	"body": true, "isBase64Encoded": true,
}

func keysOf(t *testing.T, v interface{}) map[string]bool {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	out := map[string]bool{}
	for k := range m {
		out[k] = true
	}
	return out
}

// T1 請求端:OPTIONS 走 v1 的 HTTPMethod 欄位。
// 若 handler 退回 v2 型別,這個事件的 RequestContext.HTTP.Method 會是空字串 ⇒ 不會回 200。
func TestT1_OptionsReadsV1HTTPMethod(t *testing.T) {
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "OPTIONS"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("OPTIONS 應回 200,實得 %d", resp.StatusCode)
	}
}

// T2【T1 的反控】非 OPTIONS 且沒有 authorizer ⇒ 401。
// 少了它,T1 的 200 與「這支永遠回 200」逐字相同。
func TestT2_NoAuthorizerIs401(t *testing.T) {
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "POST"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if resp.StatusCode != 401 {
		t.Fatalf("無 authorizer 應回 401(fail-closed),實得 %d", resp.StatusCode)
	}
}

// T3 回應端:marshal 出來的鍵必須全部落在 REST 允許的集合裡(尤其不可以有 cookies)。
func TestT3_ResponseHasOnlyRestLegalKeys(t *testing.T) {
	resp, _ := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "POST"})
	for k := range keysOf(t, resp) {
		if !restLegalKeys[k] {
			t.Fatalf("回應含 REST 不認得的鍵 %q ⇒ malformed ⇒ 502", k)
		}
	}
}

// T4【T3 的反控】v2 的回應型別**確實**會吐 cookies。
// 少了它,T3 可能只是因為我把判準寫成恆真而通過 —— 那與「尺看得見差別」逐字相同。
func TestT4_V2ResponseTypeDoesEmitCookies(t *testing.T) {
	ks := keysOf(t, events.APIGatewayV2HTTPResponse{StatusCode: 200})
	if !ks["cookies"] {
		t.Fatalf("反控失效:v2 回應型別沒有吐 cookies ⇒ T3 證明不了任何事(鍵集=%v)", ks)
	}
	if restLegalKeys["cookies"] {
		t.Fatal("反控失效:cookies 被列進 REST 合法鍵,T3 恆真")
	}
}

// T5 身分讀取走 v1 的 RequestContext.Authorizer(扁平 map),不是 v2 的 .Lambda 子層。
// 這條讓 T2 的 401 不會被讀成「它永遠 401」。
func TestT5_AuthorizerUserIDReadsV1Shape(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		HTTPMethod: "POST",
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{"userId": "APP_TEST_ONLY"},
		},
	}
	if got := shared.AuthorizerUserID(req); got != "APP_TEST_ONLY" {
		t.Fatalf("v1 authorizer 應讀到 APP_TEST_ONLY,實得 %q", got)
	}
	// fail-closed:沒有 authorizer 時必須是空字串,不是 panic 也不是預設值。
	if got := shared.AuthorizerUserID(events.APIGatewayProxyRequest{}); got != "" {
		t.Fatalf("無 authorizer 應為空字串,實得 %q", got)
	}
}
