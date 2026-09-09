package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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
		{shared.ErrVenueLatLngNotFinite, http.StatusBadRequest},
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

// TestB5a3_ValidationStatusCoversEverySentinel 釘的是「**有沒有漏接**」，不是「接得對不對」。
//
// 🔴 這條的存在理由是一個真的發生過的漏接（2026-09-09，Codex 覆驗抓到）：
// [B5-a2] 加了 ErrVenueLatLngNotFinite 這個新 sentinel，而 validationStatus() 的
// switch 是**手打清單** ⇒ 沒加進去的那條走 default ⇒ 輸入錯誤回 **500 不是 400**。
// 上面那支 TestValidationStatus 對這件事零鑑別力：它自己也是手打清單，
// **同一個人漏掉一次就是兩邊一起漏**，而兩邊都漏之後測試照樣全綠。
//
// ⇒ 這裡改成**掃原始碼數 sentinel 定義**，與測試清單的長度比對（同 shared 那邊
// 「掃常數定義行數比對 map 大小」的手法）。新增 sentinel 而忘了接線 ⇒ 這條會紅。
//
// ⚠️ 界線：它只保證「每一個 ErrVenue* 都被 TestValidationStatus 列到」，
// 不保證列的那個 want 值是對的 —— 後者是 TestValidationStatus 自己的事。
func TestB5a3_ValidationStatusCoversEverySentinel(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "shared", "venue_dto.go"))
	if err != nil {
		// fail-closed：讀不到就判紅。讀不到與「一個 sentinel 都沒有」必須不同。
		t.Fatalf("讀不到 shared/venue_dto.go：%v", err)
	}
	found := regexp.MustCompile(`(ErrVenue\w+)\s*=\s*errors\.New`).FindAllStringSubmatch(string(src), -1)
	// 🔴 掃描器自己的反控：掃到 0 個一定是 regex 壞了，不是「真的沒有 sentinel」。
	if len(found) == 0 {
		t.Fatal("掃不到任何 ErrVenue* sentinel ⇒ 這把尺壞了，不是通過")
	}
	// 這份清單必須與 TestValidationStatus 的 cases 同步（那裡多了一格 nil）。
	listed := []error{
		shared.ErrVenueTypeInvalid,
		shared.ErrVenueNameRequired,
		shared.ErrVenueLatLngRange,
		shared.ErrVenueLatLngNotFinite,
		shared.ErrVenueHomeNeedAddr,
	}
	if len(listed) != len(found) {
		names := make([]string, 0, len(found))
		for _, m := range found {
			names = append(names, m[1])
		}
		t.Fatalf("shared 有 %d 個 ErrVenue* sentinel %v，而這裡只列了 %d 個 ⇒ 有新的沒接線",
			len(found), names, len(listed))
	}
	// 每一個都必須被 validationStatus 認得（走到 default 就是漏接）。
	for i, e := range listed {
		if got := validationStatus(e); got != http.StatusBadRequest {
			t.Errorf("listed[%d] (%v) = %d，走到 default 了 ⇒ 輸入錯誤被回成 500", i, e, got)
		}
	}
}

var errUnknownForTest = &testErr{}

type testErr struct{}

func (*testErr) Error() string { return "某個沒想到的錯誤" }

// --- [B5-a] 自助路徑只收 hall／home（正典 §5.1：活動場由官方建立）---

// B5a-H1 承重：登入者送 type=event（其餘欄位全合法）要拿到 400 ＋ 自助擋門訊息，
// 而且**在碰 DDB 之前**（dynamoClient 在測試裡是 nil，走到 PutItem 會回 500「建立失敗」，
// 見 H2 —— 所以 400 就代表沒走到那一行）。
func TestB5a_Handler_RejectsEventBeforeAnyIO(t *testing.T) {
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{
		HTTPMethod: http.MethodPost,
		Body:       `{"type":"event","name":"官方盃","approxLocation":{"latitude":25,"longitude":121.5}}`,
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{"userId": "U-玩家"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("event 自助建立應該 400，得到 %d（body=%s）", resp.StatusCode, resp.Body)
	}
	var body Response
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error != errVenueNotSelfServe {
		t.Fatalf("錯誤訊息 = %q，want %q", body.Error, errVenueNotSelfServe)
	}
	// 訊息要與既有四條驗證訊息不同 —— 否則前端分不出「type 打錯」與「這種 type 不給自助建」。
	for _, e := range []error{shared.ErrVenueTypeInvalid, shared.ErrVenueNameRequired, shared.ErrVenueLatLngRange, shared.ErrVenueHomeNeedAddr} {
		if body.Error == e.Error() {
			t.Fatalf("自助擋門訊息與既有驗證訊息相同：%q", body.Error)
		}
	}
}

// B5a-H2 反控：hall／home 不可以被同一道門擋下。
//
// 🔴 少了這條，`selfServeGate` 一律回訊息（＝整個端點不能建任何場地）也會讓 H1 變綠。
// 過了門之後會走到 PutItem；測試裡 dynamoClient 是 nil，**實測**它回 error 而不是 panic
// （2026-09-09 用探針量過：status=500、error="建立失敗"）⇒ 這個 500 就是
// 「確實過了門、走到 IO 那一行」的證據，而且與 400＋擋門訊息逐字不同。
func TestB5a_Handler_HallAndHomePassTheGate(t *testing.T) {
	bodies := map[string]string{
		"hall": `{"type":"hall","name":"某館","approxLocation":{"latitude":25,"longitude":121.5}}`,
		"home": `{"type":"home","name":"某家","exactAddress":"台北市某路9號","approxLocation":{"latitude":25,"longitude":121.5}}`,
	}
	for typ, b := range bodies {
		resp, err := handler(context.Background(), events.APIGatewayProxyRequest{
			HTTPMethod: http.MethodPost, Body: b,
			RequestContext: events.APIGatewayProxyRequestContext{
				Authorizer: map[string]interface{}{"userId": "U-玩家"},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		var body Response
		if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode == http.StatusBadRequest && body.Error == errVenueNotSelfServe {
			t.Fatalf("%s 被自助擋門攔下 ⇒ 這道門沒有在分辨 type", typ)
		}
		// 正控：要真的走到 PutItem（nil client ⇒ 500「建立失敗」）。
		// 少了這條，上面那句對「handler 在更早的地方就回了別的 4xx」零鑑別力。
		if resp.StatusCode != http.StatusInternalServerError || body.Error != "建立失敗" {
			t.Fatalf("%s 沒有走到 PutItem：status=%d body=%s", typ, resp.StatusCode, resp.Body)
		}
	}
}

// B5a-H3 純函式那一層：三種 type 逐格，含認不得的 type（fail-closed 擋下）。
func TestB5a_SelfServeGate_Matrix(t *testing.T) {
	cases := map[string]bool{ // type → 要不要擋
		shared.VenueTypeHall:  false,
		shared.VenueTypeHome:  false,
		shared.VenueTypeEvent: true,
		"dojo":                true,
		"":                    true,
	}
	for typ, blocked := range cases {
		got := selfServeGate(typ) != ""
		if got != blocked {
			t.Errorf("selfServeGate(%q) 擋=%v，want %v", typ, got, blocked)
		}
	}
	// 反控：hall 與 event 不可以拿到同一個結果 —— 否則上面一半的格子是自動成立的。
	if (selfServeGate(shared.VenueTypeHall) != "") == (selfServeGate(shared.VenueTypeEvent) != "") {
		t.Fatal("hall 與 event 的擋門結果相同 ⇒ 這道門沒有在分辨 type")
	}
}

// --- [B5-b] 建場回應是白名單：與 detail 端點同一份型別、同一條規矩 ---

func TestB5b_Payload_StrangerSeesNoPrivateData(t *testing.T) {
	v := &shared.Venue{
		VenueID: "V1", Type: shared.VenueTypeHome, OwnerID: "U-屋主", Phone: "0912345678",
		Status: shared.VenueStatusActive, ExactAddress: "台北市某路9號",
	}
	b, err := json.Marshal(venueResponsePayload(v, shared.AddressEvidence{CallerUserID: "U-路人"}, 1000))
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{"台北市某路9號", "0912345678", "U-屋主", `"ownerId"`} {
		if strings.Contains(string(b), leak) {
			t.Fatalf("路人拿到了 %q：%s", leak, b)
		}
	}
	if !strings.Contains(string(b), `"isOwner":false`) {
		t.Fatalf("路人的 isOwner 應該是 false：%s", b)
	}
	// 正控：屋主自己 ⇒ 地址在、isOwner 是 true。
	b2, err := json.Marshal(venueResponsePayload(v, shared.AddressEvidence{CallerUserID: "U-屋主"}, 1000))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b2), "台北市某路9號") || !strings.Contains(string(b2), `"isOwner":true`) {
		t.Fatalf("正控失敗：屋主拿不到地址或 isOwner 不是 true：%s", b2)
	}
}
