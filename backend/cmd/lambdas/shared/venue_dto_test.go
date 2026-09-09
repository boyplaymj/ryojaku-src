package shared

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func validCreateReq() *CreateVenueRequest {
	return &CreateVenueRequest{
		Type:           VenueTypeHall,
		Name:           "某某麻將館",
		ApproxLocation: VenueLocation{Latitude: 25.03, Longitude: 121.56},
	}
}

// --- Codex 第 ① 條：窄 DTO ---

// C1 🔴 承重：用**反射**掃 DTO 的 json tag，斷言伺服器自有欄位一個都不在上面。
//
// 這是機械掃描不是手打比對：之後有人往 DTO 加欄位，只要加到
// venueServerOwnedFields 裡任何一個就會紅。（[A2] 那次手打的兩個檔名清單
// 漏掉第三處，而測試照樣全綠 —— 同一個形狀。）
func TestCreateVenueRequest_NoServerOwnedFields(t *testing.T) {
	rt := reflect.TypeOf(CreateVenueRequest{})
	got := map[string]bool{}
	for i := 0; i < rt.NumField(); i++ {
		name := strings.Split(rt.Field(i).Tag.Get("json"), ",")[0]
		if name == "" || name == "-" {
			continue
		}
		got[name] = true
	}
	// 反控：掃不到任何欄位就不可以算通過 —— 空迴圈與「每個都合格」結果相同。
	if len(got) == 0 {
		t.Fatal("一個 json 欄位都沒掃到 ⇒ 這把尺失明了")
	}
	for _, forbidden := range venueServerOwnedFields {
		if got[forbidden] {
			t.Fatalf("DTO 上出現了伺服器自有欄位 %q ⇒ 前端可以直接指定它", forbidden)
		}
	}
	// 正控：確認清單本身有內容，且比對真的會命中。少了這條，
	// venueServerOwnedFields 被清成空 slice 也會讓上面的迴圈全綠。
	if len(venueServerOwnedFields) < 5 {
		t.Fatalf("禁止清單只有 %d 項 ⇒ 上面那個迴圈幾乎不檢查東西", len(venueServerOwnedFields))
	}
	if !got["type"] || !got["name"] {
		t.Fatal("正控失敗：連 type／name 都沒掃到 ⇒ 上面的比對證明不了任何事")
	}
}

// C2 端到端：前端硬塞伺服器自有欄位，全部要被丟掉。
// 這條與 C1 是兩把不同的尺：C1 看**型別形狀**，C2 看**實際 decode 的結果**。
func TestCreateVenueRequest_InjectedFieldsAreDropped(t *testing.T) {
	// 🔴 type 用 hall 不是 home：新規則下 home 的初始狀態**本來就是** active
	// ⇒ 拿 home 測「status 有沒有被前端指定成 active」會恆真地失去鑑別力
	// （就算前端真的指定得了，結果也一樣）。hall 的規則是 pending，
	// 而 body 說 active ⇒ 兩者相反，這條斷言才有東西可分辨。
	body := `{
		"type":"hall","name":"某某館","exactAddress":"台北市某路9號",
		"approxLocation":{"latitude":25.0,"longitude":121.5},
		"venueId":"V-偽造","ownerId":"別人的帳號","status":"active",
		"isDojo":true,"dojoPaidUntil":9999999999,"certifiedRefereeCount":99,
		"ratingPositive":999,"ratingCount":999,"createdAt":1
	}`
	var r CreateVenueRequest
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		t.Fatal(err)
	}
	if err := r.Validate(); err != nil {
		t.Fatalf("這份 body 本身是合法的建立請求：%v", err)
	}
	v := NewVenueFromCreateRequest(&r, "V-伺服器產生的", "U-來自JWT", 1000, fixedRnd)

	// 正控先行：確認 body 真的被解析了。少了它，Unmarshal 整個沒作用也會全綠。
	if v.Name != "某某館" || v.ExactAddress != "台北市某路9號" {
		t.Fatalf("正控失敗：合法欄位沒讀進來（name=%q addr=%q）", v.Name, v.ExactAddress)
	}

	checks := []struct {
		field string
		bad   bool
	}{
		{"venueId 被前端指定", v.VenueID != "V-伺服器產生的"},
		{"ownerId 被前端指定", v.OwnerID != "U-來自JWT"},
		{"status 被前端指定成 active", v.Status != VenueStatusPending},
		{"isDojo 被前端指定", v.IsDojo},
		{"dojoPaidUntil 被前端指定", v.DojoPaidUntil != 0},
		{"certifiedRefereeCount 被前端指定", v.CertifiedRefereeCount != 0},
		{"ratingPositive 被前端指定", v.RatingPositive != 0},
		{"ratingCount 被前端指定", v.RatingCount != 0},
		{"createdAt 被前端指定", v.CreatedAt != 1000},
	}
	for _, c := range checks {
		if c.bad {
			t.Errorf("🔴 %s", c.field)
		}
	}
}

// C3 就算三條原料被塞滿，算出來也不可以是道館 —— 因為原料根本沒進來。
func TestCreateVenueRequest_InjectedDojoNeverResolvesTrue(t *testing.T) {
	body := `{"type":"hall","name":"假道館","approxLocation":{"latitude":25,"longitude":121},
		"isDojo":true,"dojoPaidUntil":9999999999,"certifiedRefereeCount":99}`
	var r CreateVenueRequest
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		t.Fatal(err)
	}
	v := NewVenueFromCreateRequest(&r, "V1", "U1", 1000, fixedRnd)
	v.ResolveIsDojo(1000)
	if v.IsDojo {
		t.Fatal("🔴 前端塞三條原料就拿到道館徽章")
	}
	// 正控：同一個 venue，由**可信來源**填上原料之後應該算得出 true。
	// 少了它，EvaluateIsDojo 恆回 false 也會讓上面那條變綠。
	v.DojoPaidUntil, v.CertifiedRefereeCount = 2000, 1
	v.ResolveIsDojo(1000)
	if !v.IsDojo {
		t.Fatal("正控失敗：可信原料齊全時也算不出道館 ⇒ 上面那條證明不了任何事")
	}
}

// --- Validate 逐格 ---

func TestCreateVenueRequest_Validate(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*CreateVenueRequest)
		want error
	}{
		{"正控：合法的 hall", func(*CreateVenueRequest) {}, nil},
		{"type=dojo 不合法", func(r *CreateVenueRequest) { r.Type = "dojo" }, ErrVenueTypeInvalid},
		{"type 空", func(r *CreateVenueRequest) { r.Type = "" }, ErrVenueTypeInvalid},
		{"name 空", func(r *CreateVenueRequest) { r.Name = "" }, ErrVenueNameRequired},
		{"name 只有空白", func(r *CreateVenueRequest) { r.Name = "   " }, ErrVenueNameRequired},
		{"緯度超界", func(r *CreateVenueRequest) { r.ApproxLocation.Latitude = 91 }, ErrVenueLatLngRange},
		{"經度超界", func(r *CreateVenueRequest) { r.ApproxLocation.Longitude = -181 }, ErrVenueLatLngRange},
		{"自建場沒填地址", func(r *CreateVenueRequest) { r.Type = VenueTypeHome }, ErrVenueHomeNeedAddr},
		{"正控：自建場有填地址", func(r *CreateVenueRequest) {
			r.Type, r.ExactAddress = VenueTypeHome, "台北市某路9號"
		}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := validCreateReq()
			c.mut(r)
			got := r.Validate()
			if !errors.Is(got, c.want) {
				t.Fatalf("Validate = %v, want %v", got, c.want)
			}
		})
	}
	if NewVenueFromCreateRequest(nil, "V", "U", 1, fixedRnd) != nil {
		t.Fatal("nil 請求應該回 nil")
	}
	if (&CreateVenueRequest{}).Validate() == nil {
		t.Fatal("空請求不可以通過驗證")
	}
	var nilReq *CreateVenueRequest
	if nilReq.Validate() == nil {
		t.Fatal("nil 請求的 Validate 不可以回 nil（且不可 panic）")
	}
}

// 表名跟著 TABLE_PREFIX 走，不可以寫死。
// 🔴 這條有實際代價：實查這個 AWS 帳號（380931373365）只有 MahjongClubStg_* 那一套，
// 而 tablePrefix() 的預設是 "MahjongClub_"（prod）⇒ 寫死或漏讀 env 的話，
// lambda 會去打一張不存在的表，而錯誤訊息是 ResourceNotFound，不是「你環境搞錯了」。
func TestVenuesTableName_FollowsPrefix(t *testing.T) {
	t.Setenv("TABLE_PREFIX", "MahjongClubStg_")
	if got := VenuesTableName(); got != "MahjongClubStg_Venues" {
		t.Fatalf("VenuesTableName = %q", got)
	}
	// 反控：換一個 prefix 要跟著變。少了它，直接 return 常數字串也會讓上面那條變綠。
	t.Setenv("TABLE_PREFIX", "ZZZ_")
	if got := VenuesTableName(); got != "ZZZ_Venues" {
		t.Fatalf("換 prefix 之後 VenuesTableName = %q ⇒ 它是寫死的", got)
	}
}

// 初始 status 依 type（✅ 2026-09-09 拍板選項 B）。
//
// 🔴 這條的效果只有一個：pending 的 venue，非 owner 拿不到 exactAddress。
// 它**擋不住曝光** —— status 目前在生產程式裡只被授權判斷讀。
func TestInitialVenueStatus(t *testing.T) {
	cases := []struct {
		venueType string
		want      string
		why       string
	}{
		{VenueTypeHall, VenueStatusPending, "付費 ≠ 是真店主，未審核的店地址不該被當真"},
		{VenueTypeHome, VenueStatusActive, "自建場免費量大、人工審不可行；地址另有報名核准那道閘"},
		{VenueTypeEvent, VenueStatusActive, "官方建的，沒有審的對象"},
		{"dojo", VenueStatusPending, "不認得的 type 一律 fail-closed"},
		{"", VenueStatusPending, "空 type 也是 fail-closed"},
	}
	for _, c := range cases {
		if got := initialVenueStatus(c.venueType); got != c.want {
			t.Errorf("initialVenueStatus(%q) = %q, want %q（%s）", c.venueType, got, c.want, c.why)
		}
	}
	// 反控：三種合法 type 不可以全部回同一個值 —— 全 pending 或全 active
	// 都會讓上面那五格裡的一半自動成立，而「規則沒分辨 type」正是要防的。
	if initialVenueStatus(VenueTypeHall) == initialVenueStatus(VenueTypeHome) {
		t.Fatal("hall 與 home 的初始狀態相同 ⇒ 這條規則沒有在分辨 type")
	}
}

// 端到端：建立 hall 拿到 pending、建立 home 拿到 active。
// 這條與上面那條分開，因為上面測純函式、這條測它真的被 NewVenueFromCreateRequest 用到
// —— 函式寫對但沒接上，在上面那條是看不出來的。
func TestNewVenueFromCreateRequest_StatusFollowsType(t *testing.T) {
	hall := &CreateVenueRequest{Type: VenueTypeHall, Name: "館"}
	if got := NewVenueFromCreateRequest(hall, "V1", "U1", 1, fixedRnd).Status; got != VenueStatusPending {
		t.Fatalf("hall 建立後 status = %q，want pending", got)
	}
	home := &CreateVenueRequest{Type: VenueTypeHome, Name: "家", ExactAddress: "x"}
	if got := NewVenueFromCreateRequest(home, "V2", "U1", 1, fixedRnd).Status; got != VenueStatusActive {
		t.Fatalf("home 建立後 status = %q，want active", got)
	}
}

// fixedRnd 是既有測試用的固定隨機源：這些測試不在乎位移到哪裡，只在乎其他欄位。
// 位移本身的尺在 venue_blur_test.go。
func fixedRnd() float64 { return 0.5 }
