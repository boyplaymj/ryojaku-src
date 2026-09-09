package shared

import (
	"os"
	"regexp"
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

// 白名單與常數必須同步。
//
// 🔴 掃的是**常數定義行**（`\tAddressXxx = "`），不是「哪裡提到這個字」——
// 註解以 // 開頭，不會長成這個形狀，所以這裡沒有「提及 vs 接線」那個問題。
// 反控在下面：掃不到任何定義就判紅（regex 漂掉與「真的沒有常數」逐字相同）。
func TestAddressReasons_WhitelistMatchesConstants(t *testing.T) {
	src, err := os.ReadFile("venue_address.go")
	if err != nil {
		t.Fatalf("讀不到原始碼（設備問題，不是通過）：%v", err)
	}
	re := regexp.MustCompile(`(?m)^\tAddress(?:Allow|Deny)[A-Za-z]+\s+= "`)
	n := len(re.FindAllString(string(src), -1))
	if n == 0 {
		t.Fatal("掃不到任何 reason 常數定義 ⇒ 這把尺失明了（regex 漂掉？）")
	}
	if n != AddressReasonCount() {
		t.Fatalf("常數有 %d 個，白名單有 %d 個 ⇒ 新增 reason 忘了加進 addressReasons，"+
			"它會被稽核行記成 unknown 而靜靜失去資訊", n, AddressReasonCount())
	}
	// 正控：每一個常數都真的在白名單裡（數目對不代表內容對）。
	for _, r := range []string{
		AddressAllowOwner, AddressAllowPublicVenue, AddressAllowAcceptedReg,
		AddressDenyNilVenue, AddressDenyAnonymous, AddressDenyVenueNotActive,
		AddressDenyUnknownType, AddressDenyNoRegistration, AddressDenyRegNotCaller,
		AddressDenyRegOtherGame, AddressDenyGameOtherVenue, AddressDenyRegNotAccepted,
	} {
		if !IsKnownAddressReason(r) {
			t.Errorf("常數 %q 不在白名單裡", r)
		}
	}
	// 反控：不是 reason 的東西不可以通過。
	for _, bad := range []string{"", "allow", "台北市某路9號", "allow:owner\n偽造"} {
		if IsKnownAddressReason(bad) {
			t.Errorf("%q 不該被當成合法 reason", bad)
		}
	}
}
