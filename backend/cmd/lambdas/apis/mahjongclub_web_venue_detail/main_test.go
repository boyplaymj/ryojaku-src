package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
)

// 🔴 界線（同 main.go 檔頭）：這一批驗不到 DDB 真的回什麼、GSI 延遲、
// authorizer 設定對不對。驗得到的是 **evidence 的每一格是從哪裡來的**。

const homeAddr = "台北市某路9號5樓"

// spySource 把收到的參數原樣記下來。
//
// 🔴 它刻意**不**幫忙補齊任何東西：handler 若漏傳 userID，spy 收到的就是空字串，
// 測試就會紅。假件自己把生產端缺的參數補上去的話，接線漏掉在假件裡結構上不可見。
type spySource struct {
	gotGameVenueID []string    // 每次 GameVenueID 收到的 gameID
	gotFindReg     [][2]string // 每次 FindRegistration 收到的 (gameID, userID)
	venueToReturn  *shared.Venue
	gameVenueID    string
	regToReturn    *shared.Registration
	gameVenueErr   error
	regErr         error
	venueErr       error
}

func (s *spySource) GetVenue(_ context.Context, venueID string) (*shared.Venue, error) {
	return s.venueToReturn, s.venueErr
}
func (s *spySource) GameVenueID(_ context.Context, gameID string) (string, error) {
	s.gotGameVenueID = append(s.gotGameVenueID, gameID)
	return s.gameVenueID, s.gameVenueErr
}
func (s *spySource) FindRegistration(_ context.Context, gameID, userID string) (*shared.Registration, error) {
	s.gotFindReg = append(s.gotFindReg, [2]string{gameID, userID})
	return s.regToReturn, s.regErr
}

func homeVenue() *shared.Venue {
	return &shared.Venue{
		VenueID: "V1", Type: shared.VenueTypeHome, OwnerID: "U-屋主",
		Status: shared.VenueStatusActive, ExactAddress: homeAddr,
	}
}

func acceptedReg(userID, gameID string) *shared.Registration {
	return &shared.Registration{UserID: userID, GameID: gameID, Status: "accepted"}
}

// bodyOf 從回應裡取出送到前端的 JSON。
func bodyOf(t *testing.T, resp events.APIGatewayProxyResponse) string {
	t.Helper()
	return resp.Body
}

// --- 正典 §5.3 第 ③ 條：Registration 依 (caller, gameId) 查 ---

// T1 🔴 承重：查報名用的 userID 必須是 handler 收到的 callerUserID。
// spy 把實際收到的參數記下來 —— 傳錯人的話這裡會看到別的字串。
func TestHandleDetail_RegistrationQueriedByCallerAndGame(t *testing.T) {
	s := &spySource{venueToReturn: homeVenue(), gameVenueID: "V1",
		regToReturn: acceptedReg("U-玩家", "G1")}
	req := VenueDetailRequest{VenueID: "V1", GameID: "G1"}

	if _, err := handleDetail(context.Background(), s, "U-玩家", req, 1000); err != nil {
		t.Fatal(err)
	}
	if len(s.gotFindReg) != 1 {
		t.Fatalf("FindRegistration 應該被呼叫一次，實際 %d 次", len(s.gotFindReg))
	}
	if got := s.gotFindReg[0]; got[0] != "G1" || got[1] != "U-玩家" {
		t.Fatalf("查報名的參數應該是 (G1, U-玩家)，實際 %v ⇒ 身分或局號傳錯了", got)
	}
	// GameVenueID 也必須用同一個 gameID 去查真來源。
	if len(s.gotGameVenueID) != 1 || s.gotGameVenueID[0] != "G1" {
		t.Fatalf("查 game 的 venueId 參數不對：%v", s.gotGameVenueID)
	}
}

// T2 🔴 承重：evidence 的 GameVenueID 來自 src，**不是**請求。
// game 記錄說這局在 V-別家 ⇒ 就算呼叫者報名核准了，也拿不到 V1 的地址。
func TestHandleDetail_GameVenueIDComesFromRecordNotRequest(t *testing.T) {
	s := &spySource{venueToReturn: homeVenue(),
		gameVenueID: "V-別家", // game 記錄上這局不在 V1
		regToReturn: acceptedReg("U-玩家", "G1")}
	resp, err := handleDetail(context.Background(), s, "U-玩家",
		VenueDetailRequest{VenueID: "V1", GameID: "G1"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(bodyOf(t, resp), homeAddr) {
		t.Fatalf("局不在這個 venue，卻拿到了地址：%s", resp.Body)
	}
}

// T3 正控：所有條件都對上時**要**拿得到地址。
// 🔴 少了它，handleDetail 直接回 404、或 evidence 永遠空的，也會讓 T2／T4 全綠。
func TestHandleDetail_HappyPathReturnsAddress(t *testing.T) {
	s := &spySource{venueToReturn: homeVenue(), gameVenueID: "V1",
		regToReturn: acceptedReg("U-玩家", "G1")}
	resp, err := handleDetail(context.Background(), s, "U-玩家",
		VenueDetailRequest{VenueID: "V1", GameID: "G1"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bodyOf(t, resp), homeAddr) {
		t.Fatalf("核准的玩家應該拿得到地址：%s", resp.Body)
	}
}

// T4 🔴 fail-closed：查詢**失敗**時不可以放行。
// 資料層抖動變成放行是最糟的一種 —— 它偶發、看起來像運氣好。
func TestHandleDetail_LookupErrorFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*spySource)
	}{
		{"查 game 的 venueId 失敗", func(s *spySource) { s.gameVenueErr = errors.New("ddb boom") }},
		{"查報名失敗", func(s *spySource) { s.regErr = errors.New("ddb boom") }},
		{"查不到報名（nil, nil）", func(s *spySource) { s.regToReturn = nil }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := &spySource{venueToReturn: homeVenue(), gameVenueID: "V1",
				regToReturn: acceptedReg("U-玩家", "G1")}
			c.mut(s)
			resp, err := handleDetail(context.Background(), s, "U-玩家",
				VenueDetailRequest{VenueID: "V1", GameID: "G1"}, 1000)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(bodyOf(t, resp), homeAddr) {
				t.Fatalf("%s ⇒ 不該給地址，但給了：%s", c.name, resp.Body)
			}
		})
	}
}

// T5 匿名呼叫者不去查任何東西（省一次 DDB，也讓 evidence 不可能誤成立）。
func TestHandleDetail_AnonymousDoesNotQuery(t *testing.T) {
	s := &spySource{venueToReturn: homeVenue(), gameVenueID: "V1"}
	resp, err := handleDetail(context.Background(), s, "",
		VenueDetailRequest{VenueID: "V1", GameID: "G1"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.gotFindReg) != 0 || len(s.gotGameVenueID) != 0 {
		t.Fatalf("匿名不該去查 evidence：reg=%v venue=%v", s.gotFindReg, s.gotGameVenueID)
	}
	if strings.Contains(bodyOf(t, resp), homeAddr) {
		t.Fatal("匿名拿到了地址")
	}
}

// T6 沒帶 gameId 時不查（公開場地不需要 evidence）。
func TestHandleDetail_NoGameIDSkipsEvidenceLookup(t *testing.T) {
	s := &spySource{venueToReturn: homeVenue()}
	if _, err := handleDetail(context.Background(), s, "U-玩家",
		VenueDetailRequest{VenueID: "V1"}, 1000); err != nil {
		t.Fatal(err)
	}
	if len(s.gotFindReg) != 0 || len(s.gotGameVenueID) != 0 {
		t.Fatalf("沒帶 gameId 不該查：reg=%v venue=%v", s.gotFindReg, s.gotGameVenueID)
	}
}

// T7 找不到 venue 回 404、查詢失敗回 500（兩者不可混為一談：
// 「沒有這個場地」與「我們壞了」對前端是不同的行為）。
func TestHandleDetail_NotFoundVsError(t *testing.T) {
	s := &spySource{venueToReturn: nil}
	resp, _ := handleDetail(context.Background(), s, "U1", VenueDetailRequest{VenueID: "V-不存在"}, 1000)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("找不到應該 404，得到 %d", resp.StatusCode)
	}
	s2 := &spySource{venueErr: errors.New("boom")}
	resp2, _ := handleDetail(context.Background(), s2, "U1", VenueDetailRequest{VenueID: "V1"}, 1000)
	if resp2.StatusCode != http.StatusInternalServerError {
		t.Fatalf("查詢失敗應該 500，得到 %d", resp2.StatusCode)
	}
}

// --- 窄 DTO 的反射尺 ---

// T8 機械掃描：查詢 DTO 上不可以有任何 evidence 欄位或身分欄位。
func TestVenueDetailRequest_NoForbiddenFields(t *testing.T) {
	rt := reflect.TypeOf(VenueDetailRequest{})
	got := map[string]bool{}
	for i := 0; i < rt.NumField(); i++ {
		n := strings.Split(rt.Field(i).Tag.Get("json"), ",")[0]
		if n != "" && n != "-" {
			got[strings.ToLower(n)] = true
		}
	}
	if len(got) == 0 {
		t.Fatal("一個 json 欄位都沒掃到 ⇒ 這把尺失明了")
	}
	for _, f := range venueDetailForbiddenFields {
		if got[strings.ToLower(f)] {
			t.Fatalf("查詢 DTO 上出現了 %q ⇒ 前端可以自己核發通行證", f)
		}
	}
	// 正控：清單非空，且合法欄位掃得到。
	if len(venueDetailForbiddenFields) < 5 {
		t.Fatalf("禁止清單只有 %d 項 ⇒ 上面的迴圈幾乎不檢查東西", len(venueDetailForbiddenFields))
	}
	if !got["venueid"] || !got["gameid"] {
		t.Fatalf("正控失敗：連 venueId／gameId 都沒掃到（%v）", got)
	}
}

// T9 handler 層：body 帶 userId 也不會變成身分（身分只從 authorizer 取）。
// 這條走的是 handler 而不是 handleDetail，因為那個 decode 只發生在 handler。
func TestHandler_BodyUserIDIsNotIdentity(t *testing.T) {
	var req VenueDetailRequest
	body := `{"venueId":"V1","gameId":"G1","userId":"U-偽造","ownerId":"U-偽造","gameVenueId":"V-偽造"}`
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatal(err)
	}
	// DTO 上沒有那些欄位 ⇒ 它們在 decode 之後不存在於任何地方。
	if req.VenueID != "V1" || req.GameID != "G1" {
		t.Fatalf("正控失敗：合法欄位沒讀進來 %+v", req)
	}
	// 反射再確認一次：整個結構只有兩個欄位。
	if n := reflect.TypeOf(req).NumField(); n != 2 {
		t.Fatalf("查詢 DTO 應該只有 2 個欄位，實際 %d ⇒ 有人加了東西", n)
	}
}

// T10 這支也是回應出口，同樣必須重算 IsDojo（正典 §5.3 第 ② 條）。
func TestHandleDetail_ResolvesIsDojo(t *testing.T) {
	v := homeVenue()
	v.IsDojo = true // 汙染
	s := &spySource{venueToReturn: v}
	resp, _ := handleDetail(context.Background(), s, "U-屋主", VenueDetailRequest{VenueID: "V1"}, 1000)
	if strings.Contains(resp.Body, `"isDojo":true`) {
		t.Fatalf("出口沒重算 IsDojo：%s", resp.Body)
	}
	// 正控：真的道館要是 true，否則「一律歸零」也會讓上面那條變綠。
	d := &shared.Venue{VenueID: "V1", Type: shared.VenueTypeHall, OwnerID: "U1",
		Status: shared.VenueStatusActive, DojoPaidUntil: 2000, CertifiedRefereeCount: 1}
	resp2, _ := handleDetail(context.Background(), &spySource{venueToReturn: d}, "U1",
		VenueDetailRequest{VenueID: "V1"}, 1000)
	if !strings.Contains(resp2.Body, `"isDojo":true`) {
		t.Fatalf("正控失敗：真的道館也沒亮：%s", resp2.Body)
	}
}

// --- 地址授權的稽核行（§13 那個盲區的最小補法）---

// T11 🔴 訂正（收 Codex 覆驗）：舊版斷言「只吃 2 個 string 參數」，而那對
// 「傳錯東西」**零鑑別力** —— venueId／userId／地址全都是 string，
// `addressAuditLine(v.ExactAddress, v.Type)` 照樣編譯、那條測試照樣綠（實測 FAIL=0）。
// 換成 sentinel：真的把敏感值餵進去，斷言它出不來。
func TestAddressAuditLine_SanitisesUnknownValues(t *testing.T) {
	const secret = "台北市大安區某路99號5樓"

	// 🔴 承重：把精確地址當 reason 傳進去，輸出不可以含它。
	got := addressAuditLine(secret, shared.VenueTypeHome)
	if strings.Contains(got, secret) {
		t.Fatalf("敏感值被寫進稽核行：%s", got)
	}
	if !strings.Contains(got, "unknown") {
		t.Fatalf("不在白名單的值應該記成 unknown，得到：%s", got)
	}
	// type 那一欄同理（venueId、userId 也都是 string，一樣走這條）。
	got2 := addressAuditLine(shared.AddressAllowOwner, "V_偷渡的venueId")
	if strings.Contains(got2, "V_偷渡的venueId") {
		t.Fatalf("type 欄沒有被白名單擋下：%s", got2)
	}

	// 🔴 日誌注入：含換行的值會偽造出第二行日誌。
	got3 := addressAuditLine("allow:owner\n[venue-address] reason=allow:owner type=hall", shared.VenueTypeHall)
	if strings.Count(got3, "\n") != 0 {
		t.Fatalf("稽核行含換行 ⇒ 可以偽造日誌：%q", got3)
	}

	// 正控（兩個方向都要）：合法值必須**原樣**出現，否則上面全部可以靠
	// 「一律回 unknown」通過，而那會讓這條日誌完全沒有資訊。
	ok := addressAuditLine(shared.AddressDenyGameOtherVenue, shared.VenueTypeHome)
	if !strings.Contains(ok, shared.AddressDenyGameOtherVenue) {
		t.Fatalf("合法 reason 沒有原樣出現：%s", ok)
	}
	if !strings.Contains(ok, shared.VenueTypeHome) {
		t.Fatalf("合法 type 沒有原樣出現：%s", ok)
	}
	if strings.Contains(ok, "unknown") {
		t.Fatalf("合法值不該被記成 unknown：%s", ok)
	}

	// ⚠️ 參數個數那條保留，但它守的**只是**「有人加第三個參數」，
	//    不守「傳錯東西」—— 兩者是不同的失效模式，別再把它當後者的尺。
	ft := reflect.TypeOf(addressAuditLine)
	if n := ft.NumIn(); n != 2 {
		t.Fatalf("addressAuditLine 應該只吃 2 個參數，實際 %d", n)
	}
}

// T12 🔴 對應 Codex 那一發：測的是**生產路徑實際寫出去的日誌**，不是函式本身。
//
// T11 守的是「函式被餵到敏感值時不會吐出來」，但那一發改的是**呼叫端**
// （`addressAuditLine(v.ExactAddress, v.Type)`）—— 呼叫端傳什麼，T11 看不到。
// 這條捕獲 handleDetail 真正寫進 log 的每一個字元。
func TestHandleDetail_LogNeverContainsAddress(t *testing.T) {
	var buf bytes.Buffer
	old := log.Writer()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() { log.SetOutput(old); log.SetFlags(log.LstdFlags) })

	v := homeVenue() // ExactAddress = homeAddr
	s := &spySource{venueToReturn: v, gameVenueID: "V1", regToReturn: acceptedReg("U-玩家", "G1")}
	if _, err := handleDetail(context.Background(), s, "U-玩家",
		VenueDetailRequest{VenueID: "V1", GameID: "G1"}, 1000); err != nil {
		t.Fatal(err)
	}

	out := buf.String()
	if strings.Contains(out, homeAddr) {
		t.Fatalf("🔴 精確地址被寫進日誌：%q", out)
	}
	if strings.Contains(out, "U-屋主") || strings.Contains(out, "U-玩家") {
		t.Fatalf("🔴 userId 被寫進日誌：%q", out)
	}
	if strings.Contains(out, "V1") {
		t.Fatalf("🔴 venueId 被寫進日誌：%q", out)
	}
	// 正控：日誌**確實有寫東西**，而且是我們要的那一行。
	// 少了它，「handler 根本沒 log」也會讓上面三條全綠。
	if !strings.Contains(out, "[venue-address]") {
		t.Fatalf("正控失敗：稽核行根本沒寫出來 ⇒ 上面三條證明不了任何事：%q", out)
	}
	if !strings.Contains(out, shared.AddressAllowAcceptedReg) {
		t.Fatalf("正控失敗：日誌裡沒有預期的 reason：%q", out)
	}
}

// --- [B5-b] 詳情回應是白名單：路人查自建場拿不到 phone／ownerId ---

// 🔴 這條打的是 handler 這一層的接線，不是 shared 的建構子（那邊有自己的尺）。
// 「建構子對了但 handler 自己組回應」在 shared 的測試上看不出來。
func TestB5b_HandleDetail_StrangerSeesNoPrivateData(t *testing.T) {
	v := homeVenue()
	v.Phone, v.BusinessHours = "0912345678", "18:00-02:00"
	resp, err := handleDetail(context.Background(), &spySource{venueToReturn: v}, "U-路人",
		VenueDetailRequest{VenueID: "V1"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	body := bodyOf(t, resp)
	for _, leak := range []string{homeAddr, "0912345678", "18:00-02:00", "U-屋主", `"ownerId"`, `"exactAddress"`} {
		if strings.Contains(body, leak) {
			t.Fatalf("路人拿到了 %q：%s", leak, body)
		}
	}
	if !strings.Contains(body, `"isOwner":false`) {
		t.Fatalf("路人的 isOwner 應該是 false：%s", body)
	}
	// 正控：屋主查同一筆 ⇒ 地址在、isOwner 是 true（但 ownerId 仍然不在）。
	resp2, err := handleDetail(context.Background(), &spySource{venueToReturn: v}, "U-屋主",
		VenueDetailRequest{VenueID: "V1"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	body2 := bodyOf(t, resp2)
	if !strings.Contains(body2, homeAddr) || !strings.Contains(body2, `"isOwner":true`) {
		t.Fatalf("正控失敗：屋主拿不到自己的地址或 isOwner 不是 true：%s", body2)
	}
	if strings.Contains(body2, `"ownerId"`) {
		t.Fatalf("屋主回應裡也不該有 ownerId：%s", body2)
	}
}
