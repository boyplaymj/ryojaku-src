package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
)

// 🔴 界線（同 main.go 檔頭）：這一批**沒有**任何一條驗到 PutItem、
// ConditionExpression、或 authorizer 本身設定對不對。驗的是決策。

// --- 正典 §5.3 第 ③ 條：身分只取自 authorizer ---

// T1 承重：body 與 authorizer 說法不同時，必須聽 authorizer。
//
// 對應的失效模式是 web_create_game 註解裡記著的 S5-C：那支原本讀 query param 的
// userId，登入者帶 ?userId=<他人> 就能用別人的身分開團。這裡的版本是「用別人的
// 身分建場地」—— 而 ownerId 是別人的話，那個人就成了自己家地址的合法查看者。
func TestCallerUserID_IgnoresBodyAndQuery(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		Body:                  `{"userId":"U-來自body","ownerId":"U-來自body"}`,
		QueryStringParameters: map[string]string{"userId": "U-來自query"},
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{"userId": "U-來自JWT"},
		},
	}
	if got := callerUserID(req); got != "U-來自JWT" {
		t.Fatalf("身分應該取自 authorizer，得到 %q", got)
	}
}

// T2 反控：authorizer 沒有身分時要回空字串（呼叫端據此回 401），
// 不可以退而求其次去讀 body。少了這條，`return "U-來自JWT"` 也會讓 T1 變綠。
func TestCallerUserID_NoAuthorizerMeansEmpty(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		Body:                  `{"userId":"U-來自body"}`,
		QueryStringParameters: map[string]string{"userId": "U-來自query"},
	}
	if got := callerUserID(req); got != "" {
		t.Fatalf("沒有 authorizer 時應該是空字串，得到 %q", got)
	}
}

// T3 未登入不可以走到 DDB。這條也順便證明 handler 在那條路徑上不需要 client
// （dynamoClient 在測試裡是 nil，真的打下去會 panic）。
func TestHandler_UnauthorizedBeforeAnyIO(t *testing.T) {
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{
		HTTPMethod: http.MethodPost,
		Body:       `{"type":"hall","name":"x"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d，want 401", resp.StatusCode)
	}
}

// --- 正典 §5.3 第 ② 條：回應前一定 ResolveIsDojo ---

// T4 承重：一個記憶體裡 IsDojo=true 但三條認證不成立的 venue，出口必須把它改回 false。
func TestVenueResponsePayload_ResolvesIsDojo(t *testing.T) {
	v := &shared.Venue{
		VenueID: "V1", Type: shared.VenueTypeHome, OwnerID: "U1",
		IsDojo: true, // 汙染：可能來自任何沒走窄 DTO 的路徑
	}
	view := venueResponsePayload(v, shared.AddressEvidence{CallerUserID: "U1"}, 1000)
	if view.IsDojo {
		t.Fatal("出口沒有重算 IsDojo ⇒ 汙染值被原樣送出")
	}
}

// T5 正控：三條認證成立時，出口要算出 true。
// 🔴 少了這條，`v.IsDojo = false` 這種「一律歸零」的實作也會讓 T4 變綠，
// 而那會讓真正的道館永遠不亮 —— 方向相反的另一種壞掉。
func TestVenueResponsePayload_RealDojoStaysTrue(t *testing.T) {
	v := &shared.Venue{
		VenueID: "V1", Type: shared.VenueTypeHall, OwnerID: "U1",
		DojoPaidUntil: 2000, CertifiedRefereeCount: 1,
	}
	view := venueResponsePayload(v, shared.AddressEvidence{CallerUserID: "U1"}, 1000)
	if !view.IsDojo {
		t.Fatal("三條認證成立時應該是道館 —— 出口把它一律歸零了")
	}
	// 同一個 venue，時間走到過期之後要掉下來。
	view2 := venueResponsePayload(v, shared.AddressEvidence{CallerUserID: "U1"}, 9999)
	if view2.IsDojo {
		t.Fatal("付費過期後徽章應該掉下來")
	}
}

// T6 出口不可以繞過地址授權：非 owner 拿到的 payload 不含 exactAddress。
func TestVenueResponsePayload_DoesNotBypassAddressGate(t *testing.T) {
	v := &shared.Venue{
		VenueID: "V1", Type: shared.VenueTypeHome, OwnerID: "U-屋主",
		Status: shared.VenueStatusActive, ExactAddress: "台北市某路9號",
	}
	b, err := json.Marshal(venueResponsePayload(v, shared.AddressEvidence{CallerUserID: "U-路人"}, 1000))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "台北市某路9號") {
		t.Fatalf("地址洩漏：%s", b)
	}
	// 正控：屋主自己要拿得到，否則上面那條可能只是「出口壞了」。
	b2, err := json.Marshal(venueResponsePayload(v, shared.AddressEvidence{CallerUserID: "U-屋主"}, 1000))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b2), "台北市某路9號") {
		t.Fatalf("正控失敗：屋主也拿不到自己的地址 ⇒ 上面那條證明不了任何事：%s", b2)
	}
}

// T7 nil 進 nil 出，不可 panic。
func TestVenueResponsePayload_Nil(t *testing.T) {
	if venueResponsePayload(nil, shared.AddressEvidence{}, 1) != nil {
		t.Fatal("nil 應該回 nil")
	}
}

// --- 驗證錯誤的狀態碼 ---

func TestValidationStatus(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{nil, http.StatusOK},
		{shared.ErrVenueTypeInvalid, http.StatusBadRequest},
		{shared.ErrVenueNameRequired, http.StatusBadRequest},
		{shared.ErrVenueLatLngRange, http.StatusBadRequest},
		{shared.ErrVenueHomeNeedAddr, http.StatusBadRequest},
	}
	for _, c := range cases {
		if got := validationStatus(c.err); got != c.want {
			t.Errorf("validationStatus(%v) = %d, want %d", c.err, got, c.want)
		}
	}
	// 🔴 未知錯誤要 500 不是 400：把沒想到的情況說成「你的輸入不對」，
	// 使用者會一直改輸入重試，而問題不在那裡。
	if got := validationStatus(errUnknownForTest); got != http.StatusInternalServerError {
		t.Fatalf("未知錯誤應該 500，得到 %d", got)
	}
}

var errUnknownForTest = &testErr{}

type testErr struct{}

func (*testErr) Error() string { return "某個沒想到的錯誤" }
