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
	body := `{
		"type":"home","name":"某人家","exactAddress":"台北市某路9號",
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
	v := NewVenueFromCreateRequest(&r, "V-伺服器產生的", "U-來自JWT", 1000)

	// 正控先行：確認 body 真的被解析了。少了它，Unmarshal 整個沒作用也會全綠。
	if v.Name != "某人家" || v.ExactAddress != "台北市某路9號" {
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
	v := NewVenueFromCreateRequest(&r, "V1", "U1", 1000)
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
	if NewVenueFromCreateRequest(nil, "V", "U", 1) != nil {
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
