package shared

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// --- 假件：一組「全部對得上」的 venue + evidence，各測試只破壞其中一格 ---

const (
	taVenueID = "V-home-1"
	taOwner   = "U-owner"
	taPlayer  = "U-player"
	taGameID  = "G-1"
	taAddress = "台北市大安區某某路 123 號 5 樓"
)

func taHomeVenue() *Venue {
	return &Venue{
		VenueID:      taVenueID,
		Type:         VenueTypeHome,
		OwnerID:      taOwner,
		Status:       VenueStatusActive,
		ExactAddress: taAddress,
		ApproxLocation: VenueLocation{
			Latitude: 25.03, Longitude: 121.54, PlaceName: "大安區",
		},
	}
}

func taAcceptedReg() *Registration {
	return &Registration{
		RegistrationID: "R-1",
		GameID:         taGameID,
		UserID:         taPlayer,
		Status:         "accepted",
	}
}

// taAcceptedEvidence 是「玩家 taPlayer 透過 G-1 這局、報名已核准」的完整證據。
func taAcceptedEvidence() AddressEvidence {
	return AddressEvidence{
		CallerUserID: taPlayer,
		GameID:       taGameID,
		GameVenueID:  taVenueID,
		Registration: taAcceptedReg(),
	}
}

func mustDecide(t *testing.T, v *Venue, ev AddressEvidence, wantAllow bool, wantReason string) {
	t.Helper()
	got, reason := CanSeeExactAddress(v, ev)
	if got != wantAllow || reason != wantReason {
		t.Fatalf("CanSeeExactAddress ⇒ (%v, %q)，要 (%v, %q)", got, reason, wantAllow, wantReason)
	}
}

// ===== 正控 =====
// 少了這組，CanSeeExactAddress 直接 `return false, x` 會讓底下所有反控一起變綠。

func TestCanSeeExactAddress_PositiveControls(t *testing.T) {
	t.Run("owner_of_home", func(t *testing.T) {
		mustDecide(t, taHomeVenue(), AddressEvidence{CallerUserID: taOwner}, true, AddressAllowOwner)
	})
	t.Run("hall_active_any_user", func(t *testing.T) {
		v := taHomeVenue()
		v.Type = VenueTypeHall
		mustDecide(t, v, AddressEvidence{CallerUserID: "U-stranger"}, true, AddressAllowPublicVenue)
	})
	t.Run("event_active_any_user", func(t *testing.T) {
		v := taHomeVenue()
		v.Type = VenueTypeEvent
		mustDecide(t, v, AddressEvidence{CallerUserID: "U-stranger"}, true, AddressAllowPublicVenue)
	})
	t.Run("home_accepted_registration", func(t *testing.T) {
		mustDecide(t, taHomeVenue(), taAcceptedEvidence(), true, AddressAllowAcceptedReg)
	})
}

// ===== 缺資料／匿名 =====

func TestCanSeeExactAddress_NilVenue(t *testing.T) {
	mustDecide(t, nil, taAcceptedEvidence(), false, AddressDenyNilVenue)
}

// 匿名者對三種 type 都不給 —— 含 hall。理由見 CanSeeExactAddress 註解末段。
func TestCanSeeExactAddress_Anonymous(t *testing.T) {
	for _, typ := range []string{VenueTypeHall, VenueTypeHome, VenueTypeEvent} {
		t.Run(typ, func(t *testing.T) {
			v := taHomeVenue()
			v.Type = typ
			ev := taAcceptedEvidence()
			ev.CallerUserID = ""
			mustDecide(t, v, ev, false, AddressDenyAnonymous)
		})
	}
}

// 那個空字串的坑：venue.OwnerID == "" 且 caller == "" 時，`"" == ""` 不可以變成 owner。
// 兩道守衛（匿名先擋／owner 比對自己擋空）疊在一起：
//   - anonymous_caller_vs_empty_owner：斷言 reason 是 anonymous ⇒ 單獨拔掉匿名守衛時，
//     owner 那道雖然仍會擋、但 reason 變了，這格照樣紅（突變 M1）。
//     而「兩道**同時**壞掉 ⇒ 匿名者變 owner」只有 combined 突變 M8 打得到；
//     單獨拔 owner 那道的 `!= ""`（M9）在目前的規則順序下是**等價突變**，沒有尺能殺 —— 刻意記在這裡。
//   - non_anonymous_caller_vs_empty_owner：caller 非空、OwnerID 空 ⇒ 不可以被當 owner。
func TestCanSeeExactAddress_AnonymousVsEmptyOwner(t *testing.T) {
	t.Run("anonymous_caller_vs_empty_owner", func(t *testing.T) {
		v := taHomeVenue()
		v.OwnerID = ""
		ev := taAcceptedEvidence()
		ev.CallerUserID = ""
		ev.Registration = nil
		mustDecide(t, v, ev, false, AddressDenyAnonymous)
	})
	t.Run("non_anonymous_caller_vs_empty_owner", func(t *testing.T) {
		v := taHomeVenue()
		v.OwnerID = ""
		mustDecide(t, v, AddressEvidence{CallerUserID: "U-x"}, false, AddressDenyNoRegistration)
	})
}

// ===== owner 與 status =====

func TestCanSeeExactAddress_OwnerIgnoresStatus(t *testing.T) {
	for _, st := range []string{VenueStatusPending, VenueStatusSuspended, ""} {
		t.Run("status="+st, func(t *testing.T) {
			v := taHomeVenue()
			v.Status = st
			mustDecide(t, v, AddressEvidence{CallerUserID: taOwner}, true, AddressAllowOwner)
		})
	}
}

func TestCanSeeExactAddress_NonOwnerRequiresActive(t *testing.T) {
	t.Run("hall_pending", func(t *testing.T) {
		v := taHomeVenue()
		v.Type, v.Status = VenueTypeHall, VenueStatusPending
		mustDecide(t, v, AddressEvidence{CallerUserID: "U-x"}, false, AddressDenyVenueNotActive)
	})
	t.Run("hall_suspended", func(t *testing.T) {
		v := taHomeVenue()
		v.Type, v.Status = VenueTypeHall, VenueStatusSuspended
		mustDecide(t, v, AddressEvidence{CallerUserID: "U-x"}, false, AddressDenyVenueNotActive)
	})
	t.Run("home_accepted_but_suspended", func(t *testing.T) {
		v := taHomeVenue()
		v.Status = VenueStatusSuspended
		mustDecide(t, v, taAcceptedEvidence(), false, AddressDenyVenueNotActive)
	})
	t.Run("home_accepted_but_status_empty", func(t *testing.T) {
		v := taHomeVenue()
		v.Status = ""
		mustDecide(t, v, taAcceptedEvidence(), false, AddressDenyVenueNotActive)
	})
}

// ===== type =====

func TestCanSeeExactAddress_UnknownType(t *testing.T) {
	for _, typ := range []string{"dojo", "", "HOME", "Hall"} {
		t.Run("type="+typ, func(t *testing.T) {
			v := taHomeVenue()
			v.Type = typ
			mustDecide(t, v, taAcceptedEvidence(), false, AddressDenyUnknownType)
		})
	}
}

// ===== home 的報名交叉比對：每格只破壞一項 =====

func TestCanSeeExactAddress_HomeRegistration(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(v *Venue, ev *AddressEvidence)
		reason string
	}{
		{"no_registration", func(v *Venue, ev *AddressEvidence) { ev.Registration = nil }, AddressDenyNoRegistration},
		{"registration_belongs_to_someone_else", func(v *Venue, ev *AddressEvidence) { ev.Registration.UserID = "U-other" }, AddressDenyRegNotCaller},
		{"registration_userid_empty", func(v *Venue, ev *AddressEvidence) { ev.Registration.UserID = "" }, AddressDenyRegNotCaller},
		{"registration_for_other_game", func(v *Venue, ev *AddressEvidence) { ev.Registration.GameID = "G-2" }, AddressDenyRegOtherGame},
		{"registration_gameid_empty_and_evidence_gameid_empty", func(v *Venue, ev *AddressEvidence) {
			ev.Registration.GameID = ""
			ev.GameID = ""
		}, AddressDenyRegOtherGame},
		{"game_at_other_venue", func(v *Venue, ev *AddressEvidence) { ev.GameVenueID = "V-other" }, AddressDenyGameOtherVenue},
		{"game_venue_empty_and_venue_id_empty", func(v *Venue, ev *AddressEvidence) {
			ev.GameVenueID = ""
			v.VenueID = ""
		}, AddressDenyGameOtherVenue},
		{"status_pending", func(v *Venue, ev *AddressEvidence) { ev.Registration.Status = "pending" }, AddressDenyRegNotAccepted},
		{"status_rejected", func(v *Venue, ev *AddressEvidence) { ev.Registration.Status = "rejected" }, AddressDenyRegNotAccepted},
		{"status_cancelled", func(v *Venue, ev *AddressEvidence) { ev.Registration.Status = "cancelled" }, AddressDenyRegNotAccepted},
		{"status_empty", func(v *Venue, ev *AddressEvidence) { ev.Registration.Status = "" }, AddressDenyRegNotAccepted},
		{"status_case_variant", func(v *Venue, ev *AddressEvidence) { ev.Registration.Status = "Accepted" }, AddressDenyRegNotAccepted},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := taHomeVenue()
			ev := taAcceptedEvidence()
			c.mutate(v, &ev)
			mustDecide(t, v, ev, false, c.reason)
		})
	}
}

// ===== 序列化 =====

func marshalView(t *testing.T, view *VenueView) (string, map[string]json.RawMessage) {
	t.Helper()
	b, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return string(b), m
}

func TestVenueView_GrantedCarriesAddress(t *testing.T) {
	view := NewVenueView(taHomeVenue(), taAcceptedEvidence())
	if view == nil || view.AddressReason != AddressAllowAcceptedReg {
		t.Fatalf("view=%+v", view)
	}
	_, m := marshalView(t, view)
	raw, ok := m["exactAddress"]
	if !ok {
		t.Fatal("授權後 exactAddress 鍵必須存在")
	}
	var got string
	if err := json.Unmarshal(raw, &got); err != nil || got != taAddress {
		t.Fatalf("exactAddress=%s err=%v", raw, err)
	}
}

// 放行但 venue 沒填地址 ⇒ 鍵仍在、值是 ""。「鍵在不在」＝「有沒有授權」，不摻第二個意義。
func TestVenueView_GrantedEmptyAddressKeepsKey(t *testing.T) {
	v := taHomeVenue()
	v.ExactAddress = ""
	_, m := marshalView(t, NewVenueView(v, taAcceptedEvidence()))
	if raw, ok := m["exactAddress"]; !ok || string(raw) != `""` {
		t.Fatalf("exactAddress=%s ok=%v，要 \"\" 且鍵存在", raw, ok)
	}
}

// 🔴 承重那條：沒授權時鍵**整個不存在**，而且地址字串不可以出現在輸出的任何地方
// （不只看那個鍵 —— 若嵌入的 Venue 哪天把 json:"-" 拿掉，這裡也要紅）。
func TestVenueView_DeniedOmitsKey(t *testing.T) {
	cases := []struct {
		name string
		ev   AddressEvidence
	}{
		{"pending_registration", func() AddressEvidence {
			ev := taAcceptedEvidence()
			ev.Registration.Status = "pending"
			return ev
		}()},
		{"stranger_no_registration", AddressEvidence{CallerUserID: "U-stranger"}},
		{"anonymous", AddressEvidence{}},
		{"zero_evidence_with_registration_for_other_game", func() AddressEvidence {
			ev := taAcceptedEvidence()
			ev.Registration.GameID = "G-9"
			return ev
		}()},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			view := NewVenueView(taHomeVenue(), c.ev)
			if view == nil {
				t.Fatal("nil view")
			}
			if !strings.HasPrefix(view.AddressReason, "deny:") {
				t.Fatalf("reason=%q 應該是 deny", view.AddressReason)
			}
			raw, m := marshalView(t, view)
			if _, ok := m["exactAddress"]; ok {
				t.Fatalf("沒授權時 exactAddress 鍵不可存在：%s", raw)
			}
			if strings.Contains(raw, taAddress) {
				t.Fatalf("地址字串出現在輸出裡：%s", raw)
			}
			if strings.Contains(raw, "deny:") {
				t.Fatalf("reason 不該上線：%s", raw)
			}
			// 公開的部分要在（不是整個空掉才叫安全）
			if _, ok := m["approxLocation"]; !ok {
				t.Fatalf("approxLocation 應該照常回：%s", raw)
			}
		})
	}
}

func TestVenueView_NilVenue(t *testing.T) {
	if NewVenueView(nil, taAcceptedEvidence()) != nil {
		t.Fatal("nil venue 要回 nil view")
	}
}

// 結構尺：VenueView 只有**一條**會帶出地址的 JSON 路徑，且嵌入的 Venue.ExactAddress 仍是 json:"-"。
// 這條擋的是「有人再加一個帶地址的欄位」或「把嵌入欄位的 tag 改掉」。
func TestVenueView_SingleJSONPathToAddress(t *testing.T) {
	rt := reflect.TypeOf(VenueView{})
	paths := 0
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		if f.Anonymous {
			inner, ok := f.Type.FieldByName("ExactAddress")
			if !ok || inner.Tag.Get("json") != "-" {
				t.Fatalf("嵌入的 %s.ExactAddress 必須是 json:\"-\"，現在是 %q", f.Type.Name(), inner.Tag.Get("json"))
			}
			continue
		}
		tag := f.Tag.Get("json")
		if tag == "-" {
			continue
		}
		if strings.HasPrefix(tag, "exactAddress,omitempty") && f.Type.Kind() == reflect.Ptr {
			paths++
			continue
		}
		t.Fatalf("VenueView 多了一個會上線的欄位 %s（tag %q）—— 每個新欄位都要重新問「它會不會帶出地址」", f.Name, tag)
	}
	if paths != 1 {
		t.Fatalf("帶地址的 JSON 路徑應該恰好 1 條，實際 %d", paths)
	}
}

// --- [B1-b 補] 第二道空字串守衛的獨立尺 ---
//
// 🔴 為什麼要單獨測 IsVenueOwner，而不是透過 CanSeeExactAddress 測：
// 透過上層測的話，匿名守衛（規則 2）永遠先命中 ⇒ 第二道那格**結構上求值不到**，
// 於是「第二道在」與「第二道被刪掉」在所有測試上逐字相同（實測：拔掉 OwnerID != ""
// 全綠；把 owner 比對搬到匿名守衛之前也全綠）。兩者疊起來才是真的洩漏。
func TestIsVenueOwner_EmptyStringNeverMatches(t *testing.T) {
	cases := []struct {
		name   string
		venue  *Venue
		userID string
		want   bool
	}{
		{"nil venue", nil, "U1", false},
		{"🔴 兩邊都空：匿名者不可以變成 owner", &Venue{OwnerID: ""}, "", false},
		{"venue 沒有 owner，呼叫者有身分", &Venue{OwnerID: ""}, "U1", false},
		{"venue 有 owner，呼叫者匿名", &Venue{OwnerID: "U1"}, "", false},
		{"不同人", &Venue{OwnerID: "U1"}, "U2", false},
		{"正控：同一人", &Venue{OwnerID: "U1"}, "U1", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsVenueOwner(c.venue, c.userID); got != c.want {
				t.Fatalf("IsVenueOwner = %v, want %v", got, c.want)
			}
		})
	}
}

// --- [B1-b 補・收 Codex 覆驗] VenueView 不可被 unmarshal ---
//
// 釘住那個「響亮失敗」的決定：Venue.UnmarshalJSON 會被提升成 VenueView 的方法，
// 於是外層 exactAddress 靜靜讀不進來（實測：加之前讀得到「台北市某路9號」，加之後 nil）。
// 與其少讀一個欄位，不如報錯。
func TestVenueView_UnmarshalIsRefused(t *testing.T) {
	var vw VenueView
	err := json.Unmarshal([]byte(`{"venueId":"V1","exactAddress":"台北市某路9號"}`), &vw)
	if err == nil {
		t.Fatal("VenueView 應該拒絕被 unmarshal —— 沉默地少讀 exactAddress 會讓人去懷疑授權壞了")
	}
	if !strings.Contains(err.Error(), "輸出專用") {
		t.Fatalf("錯誤訊息要說得出原因，得到：%v", err)
	}
	// 反控：確認它不是連 marshal 都壞了 —— 輸出方向必須照常。
	b, mErr := json.Marshal(NewVenueView(&Venue{VenueID: "V1"}, AddressEvidence{CallerUserID: "U1"}))
	if mErr != nil || !strings.Contains(string(b), `"venueId":"V1"`) {
		t.Fatalf("正控失敗：輸出方向也壞了（err=%v, out=%s）", mErr, b)
	}
}
