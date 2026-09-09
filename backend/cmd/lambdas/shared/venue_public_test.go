package shared

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const pubAddr = "台北市大安區某路99號5樓"

func pubVenue() *Venue {
	return &Venue{
		VenueID: "V1", Type: VenueTypeHall, Name: "某某館", OwnerID: "U-館方",
		Status: VenueStatusActive, ExactAddress: pubAddr, Phone: "02-1234-5678",
		ApproxLocation: VenueLocation{Latitude: 25.03, Longitude: 121.56, PlaceName: "大安區"},
		RatingPositive: 7, RatingCount: 10,
	}
}

// P1 🔴 承重：公開卡片是**白名單**，用反射掃它不含任何禁止欄位。
//
// 為什麼要獨立型別而不是嵌入 Venue：嵌入的話「不會洩漏」依賴 json:"-" 一直存在，
// 那是否定式保證 —— 任何人改掉 tag 或加一個新的敏感欄位，這條路徑就跟著漏。
func TestPublicVenueCard_IsAWhitelist(t *testing.T) {
	rt := reflect.TypeOf(PublicVenueCard{})
	got := map[string]bool{}
	for i := 0; i < rt.NumField(); i++ {
		n := strings.Split(rt.Field(i).Tag.Get("json"), ",")[0]
		if n != "" && n != "-" {
			got[strings.ToLower(n)] = true
		}
	}
	if len(got) == 0 {
		t.Fatal("一個欄位都沒掃到 ⇒ 這把尺失明了")
	}
	for _, f := range publicCardForbiddenFields {
		if got[strings.ToLower(f)] {
			t.Fatalf("公開卡片上出現了 %q", f)
		}
	}
	if len(publicCardForbiddenFields) < 5 {
		t.Fatalf("禁止清單只有 %d 項 ⇒ 上面的迴圈幾乎不檢查東西", len(publicCardForbiddenFields))
	}
	// 正控：該有的欄位在。少了它，把整個 struct 清空也會讓上面全綠。
	for _, need := range []string{"venueid", "name", "approxlocation"} {
		if !got[need] {
			t.Fatalf("正控失敗：公開卡片少了 %q（%v）", need, got)
		}
	}
}

// P2 端到端：序列化出來的 JSON 不含精確地址，也不含 ownerId／phone。
func TestPublicVenueCard_JSONLeaksNothing(t *testing.T) {
	b, err := json.Marshal(NewPublicVenueCard(pubVenue(), 1000))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, leak := range []string{pubAddr, "U-館方", "02-1234-5678"} {
		if strings.Contains(s, leak) {
			t.Fatalf("公開卡片洩漏 %q：%s", leak, s)
		}
	}
	// 正控：公開資訊必須在，否則上面那些斷言可能只是「整個空的」。
	for _, need := range []string{"某某館", "大安區", "25.03"} {
		if !strings.Contains(s, need) {
			t.Fatalf("正控失敗：公開資訊 %q 也不見了：%s", need, s)
		}
	}
}

// P3 🔴 自建場永遠不進公開列表，即使它是 active。
//
// §5.1：自建場「只在有場次時顯示」——「有沒有場次」是 game 那邊的事，
// 不是 venue 的狀態。把 home 整個排除是 fail-closed：少列一間的代價是看不到它，
// 多列一間的代價是**某個人的住處出現在地圖上**。兩者不對稱。
func TestIsPubliclyListable(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*Venue)
		want bool
	}{
		{"正控：active 的麻將館", func(*Venue) {}, true},
		{"正控：active 的活動場", func(v *Venue) { v.Type = VenueTypeEvent }, true},
		{"🔴 active 的自建場也不列", func(v *Venue) { v.Type = VenueTypeHome }, false},
		{"pending 不列", func(v *Venue) { v.Status = VenueStatusPending }, false},
		{"rejected 不列", func(v *Venue) { v.Status = VenueStatusRejected }, false},
		{"suspended 不列", func(v *Venue) { v.Status = VenueStatusSuspended }, false},
		{"不認得的 type 不列", func(v *Venue) { v.Type = "dojo" }, false},
		{"空 status 不列", func(v *Venue) { v.Status = "" }, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := pubVenue()
			c.mut(v)
			if got := IsPubliclyListable(v); got != c.want {
				t.Fatalf("IsPubliclyListable = %v, want %v", got, c.want)
			}
		})
	}
	if IsPubliclyListable(nil) {
		t.Fatal("nil 不該可列")
	}
}

// P4 公開卡片也要重算 isDojo（它不落地），且不照抄記憶體裡的汙染值。
func TestNewPublicVenueCard_ResolvesIsDojo(t *testing.T) {
	v := pubVenue()
	v.DojoPaidUntil, v.CertifiedRefereeCount = 2000, 1
	if !NewPublicVenueCard(v, 1000).IsDojo {
		t.Fatal("真的道館在公開卡片上沒亮")
	}
	v2 := pubVenue()
	v2.IsDojo = true // 汙染，三條件不成立
	if NewPublicVenueCard(v2, 1000).IsDojo {
		t.Fatal("汙染的 isDojo 被照抄進公開卡片")
	}
}
