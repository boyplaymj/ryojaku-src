package shared

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// [B5-b] VenueDetailView 的尺。命名 TestB5b_… 是為了落在 mutation_venue_blur.sh 的
// `-run '^TestB5'` 射程內 —— 「射不到」與「射到了但殺不掉」在那份報告上長得一樣。

const (
	dvAddr  = "台北市大安區某某路 123 號 5 樓"
	dvPhone = "0912345678"
	dvOwner = "U-屋主"
	dvHours = "18:00-02:00"
)

func dvHomeVenue() *Venue {
	return &Venue{
		VenueID: "V_HOME", Type: VenueTypeHome, Name: "小明家", OwnerID: dvOwner,
		Status: VenueStatusActive, ExactAddress: dvAddr, Phone: dvPhone, BusinessHours: dvHours,
		ApproxLocation: VenueLocation{Latitude: 25.03, Longitude: 121.54, PlaceName: "大安區"},
		DojoPaidUntil:  2000, CertifiedRefereeCount: 3, CreatedAt: 1234567, UpdatedAt: 7654321,
	}
}

func dvMarshal(t *testing.T, view *VenueDetailView) (string, map[string]json.RawMessage) {
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

// D1 🔴 承重：詳情是**白名單**，用反射掃它不含任何禁止欄位（不是手打欄位比對）。
func TestB5b_DetailView_IsAWhitelist(t *testing.T) {
	rt := reflect.TypeOf(VenueDetailView{})
	got := map[string]bool{}
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		if f.Anonymous {
			t.Fatalf("VenueDetailView 嵌入了 %s ⇒ 白名單變成黑名單（否定式保證）", f.Type.Name())
		}
		n := strings.Split(f.Tag.Get("json"), ",")[0]
		if n != "" && n != "-" {
			got[strings.ToLower(n)] = true
		}
	}
	// 反控：掃到 0 個欄位一定是尺壞了，不是「型別是空的」。
	if len(got) == 0 {
		t.Fatal("一個欄位都沒掃到 ⇒ 這把尺失明了")
	}
	if len(venueDetailForbiddenFields) < 5 {
		t.Fatalf("禁止清單只有 %d 項 ⇒ 下面的迴圈幾乎不檢查東西", len(venueDetailForbiddenFields))
	}
	for _, f := range venueDetailForbiddenFields {
		if got[strings.ToLower(f)] {
			t.Fatalf("詳情回應上出現了 %q", f)
		}
	}
	// 正控：該有的欄位在。少了它，把整個 struct 清空也會讓上面全綠。
	for _, need := range []string{"venueid", "name", "approxlocation", "status", "isowner", "exactaddress"} {
		if !got[need] {
			t.Fatalf("正控失敗：詳情少了 %q（%v）", need, got)
		}
	}
}

// D2 🔴 整體斷言：路人查自建場，同一份 JSON 裡**同時**沒有電話、沒有 ownerId、沒有地址。
func TestB5b_DetailView_StrangerSeesNoPrivateData(t *testing.T) {
	view := NewVenueDetailView(dvHomeVenue(), AddressEvidence{CallerUserID: "U-路人"}, 1000)
	if view == nil || !strings.HasPrefix(view.AddressReason, "deny:") {
		t.Fatalf("view=%+v", view)
	}
	raw, m := dvMarshal(t, view)
	for _, leak := range []string{dvPhone, dvOwner, dvAddr, dvHours, "deny:"} {
		if strings.Contains(raw, leak) {
			t.Fatalf("路人拿到了 %q：%s", leak, raw)
		}
	}
	for _, key := range []string{"ownerId", "phone", "businessHours", "exactAddress",
		"dojoPaidUntil", "certifiedRefereeCount", "createdAt", "updatedAt"} {
		if _, ok := m[key]; ok {
			t.Fatalf("路人回應裡有 %q 這個鍵：%s", key, raw)
		}
	}
	if string(m["isOwner"]) != "false" {
		t.Fatalf("路人的 isOwner 應該是 false：%s", raw)
	}
	// 公開的部分要在（不是整個空掉才叫安全）。
	for _, need := range []string{"小明家", "大安區", `"status":"active"`, `"type":"home"`} {
		if !strings.Contains(raw, need) {
			t.Fatalf("公開資訊 %q 不見了：%s", need, raw)
		}
	}

	// 正控：屋主本人查同一筆 ⇒ 地址在、isOwner 是 true。
	// 少了這條，「整個欄位永遠空」也會讓上面全綠。
	own := NewVenueDetailView(dvHomeVenue(), AddressEvidence{CallerUserID: dvOwner}, 1000)
	raw2, m2 := dvMarshal(t, own)
	if own.AddressReason != AddressAllowOwner || !strings.Contains(raw2, dvAddr) {
		t.Fatalf("正控失敗：屋主拿不到自己的地址（reason=%q）：%s", own.AddressReason, raw2)
	}
	if string(m2["isOwner"]) != "true" {
		t.Fatalf("正控失敗：屋主的 isOwner 不是 true：%s", raw2)
	}
	// 即使是屋主，ownerId 這個鍵也不存在 —— 它被 isOwner 取代了，不是「有條件給」。
	if _, ok := m2["ownerId"]; ok || strings.Contains(raw2, dvOwner) {
		t.Fatalf("屋主回應裡也不該有 ownerId：%s", raw2)
	}
}

// D3 phone／businessHours 只有 hall／event 才填；home 與認不得的 type 一律空。
// 反控（hall 要在）與正控（home 要不在）在同一張表裡，少任一邊都會有一種壞法看不到。
func TestB5b_DetailView_PhoneOnlyForPublicTypes(t *testing.T) {
	cases := []struct {
		typ  string
		want bool
	}{
		{VenueTypeHall, true},
		{VenueTypeEvent, true},
		{VenueTypeHome, false},
		{"dojo", false},
		{"", false},
		{"HALL", false},
	}
	for _, c := range cases {
		t.Run("type="+c.typ, func(t *testing.T) {
			v := dvHomeVenue()
			v.Type = c.typ
			raw, m := dvMarshal(t, NewVenueDetailView(v, AddressEvidence{CallerUserID: "U-路人"}, 1000))
			_, hasPhone := m["phone"]
			_, hasHours := m["businessHours"]
			if hasPhone != c.want || hasHours != c.want {
				t.Fatalf("type=%q phone=%v hours=%v，要 %v：%s", c.typ, hasPhone, hasHours, c.want, raw)
			}
			if c.want && (!strings.Contains(raw, dvPhone) || !strings.Contains(raw, dvHours)) {
				t.Fatalf("公開場的電話／營業時間值不對：%s", raw)
			}
			if VenueContactIsPublic(c.typ, v.Status) != c.want {
				t.Fatalf("VenueContactIsPublic(%q,%q) 與行為不一致", c.typ, v.Status)
			}
		})
	}
}

// D4 🔴 exactAddress 合約：沒授權時鍵**整個不存在**；放行時鍵一定存在，即使值是 ""。
func TestB5b_DetailView_ExactAddressContract(t *testing.T) {
	t.Run("granted_carries_address", func(t *testing.T) {
		_, m := dvMarshal(t, NewVenueDetailView(dvHomeVenue(), AddressEvidence{CallerUserID: dvOwner}, 1000))
		raw, ok := m["exactAddress"]
		if !ok {
			t.Fatal("授權後 exactAddress 鍵必須存在")
		}
		var got string
		if err := json.Unmarshal(raw, &got); err != nil || got != dvAddr {
			t.Fatalf("exactAddress=%s err=%v", raw, err)
		}
	})
	t.Run("granted_empty_address_keeps_key", func(t *testing.T) {
		v := dvHomeVenue()
		v.ExactAddress = ""
		_, m := dvMarshal(t, NewVenueDetailView(v, AddressEvidence{CallerUserID: dvOwner}, 1000))
		if raw, ok := m["exactAddress"]; !ok || string(raw) != `""` {
			t.Fatalf("exactAddress=%s ok=%v，要 \"\" 且鍵存在", raw, ok)
		}
	})
	t.Run("denied_omits_key", func(t *testing.T) {
		for _, ev := range []AddressEvidence{
			{CallerUserID: "U-路人"},
			{},
			{CallerUserID: "U-玩家", GameID: "G1", GameVenueID: "V_HOME",
				Registration: &Registration{UserID: "U-玩家", GameID: "G1", Status: "pending"}},
		} {
			raw, m := dvMarshal(t, NewVenueDetailView(dvHomeVenue(), ev, 1000))
			if _, ok := m["exactAddress"]; ok {
				t.Fatalf("沒授權時 exactAddress 鍵不可存在（連 null 都不行）：%s", raw)
			}
			if strings.Contains(raw, dvAddr) {
				t.Fatalf("地址字串出現在輸出裡：%s", raw)
			}
		}
	})
	// 結構尺：那個欄位必須是 *string ＋ omitempty。行為測試已經咬得到兩種改法，
	// 這條是讓錯誤訊息直接指到欄位宣告。
	f, ok := reflect.TypeOf(VenueDetailView{}).FieldByName("ExactAddress")
	if !ok || f.Type.Kind() != reflect.Ptr || f.Tag.Get("json") != "exactAddress,omitempty" {
		t.Fatalf("ExactAddress 必須是 *string 且 tag 為 exactAddress,omitempty（前端靠鍵在不在判授權）：%v %q", f.Type, f.Tag)
	}
}

// D5 IsOwner 只由 IsVenueOwner 決定：空字串兩邊都空也不可以變成 owner。
func TestB5b_DetailView_IsOwnerUsesIsVenueOwner(t *testing.T) {
	cases := []struct {
		name    string
		ownerID string
		caller  string
		want    bool
	}{
		{"正控：同一人", dvOwner, dvOwner, true},
		{"路人", dvOwner, "U-路人", false},
		{"匿名", dvOwner, "", false},
		{"🔴 兩邊都空", "", "", false},
		{"venue 沒 owner、呼叫者有身分", "", "U-x", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := dvHomeVenue()
			v.OwnerID = c.ownerID
			view := NewVenueDetailView(v, AddressEvidence{CallerUserID: c.caller}, 1000)
			if view.IsOwner != c.want {
				t.Fatalf("IsOwner=%v，要 %v", view.IsOwner, c.want)
			}
		})
	}
}

// D6 IsDojo 現算，不照抄：汙染值要歸零；真的道館要亮；過期要掉。
func TestB5b_DetailView_ResolvesIsDojo(t *testing.T) {
	v := dvHomeVenue()
	v.IsDojo = true // 汙染：home 永遠不是道館
	if NewVenueDetailView(v, AddressEvidence{CallerUserID: dvOwner}, 1000).IsDojo {
		t.Fatal("汙染的 isDojo 被照抄進詳情")
	}
	d := dvHomeVenue()
	d.Type, d.DojoPaidUntil, d.CertifiedRefereeCount = VenueTypeHall, 2000, 1
	if !NewVenueDetailView(d, AddressEvidence{CallerUserID: "U-x"}, 1000).IsDojo {
		t.Fatal("正控失敗：真的道館沒亮")
	}
	if NewVenueDetailView(d, AddressEvidence{CallerUserID: "U-x"}, 9999).IsDojo {
		t.Fatal("付費過期後徽章應該掉下來")
	}
}

func TestB5b_DetailView_NilVenue(t *testing.T) {
	if NewVenueDetailView(nil, AddressEvidence{CallerUserID: dvOwner}, 1) != nil {
		t.Fatal("nil venue 要回 nil view")
	}
}


// [B5-b2] 收 Codex 覆驗：聯絡資訊也要等 status==active。
//
// 🔴 這不是新的產品決定，是把既有的套用一致：§5.3 給 hall 訂 pending 的理由是
// 「未審核的店填的**地址**不該被當成真實店家地址發給玩家」，而地址那條**早就**
// 要求 active（CanSeeExactAddress 規則 4）。同一份未審核資料，地址擋住、電話照出，
// 兩者不一致沒有理由。
func TestB5b2_ContactRequiresActiveStatus(t *testing.T) {
	for _, st := range []string{VenueStatusPending, VenueStatusSuspended, VenueStatusRejected, "", "ACTIVE"} {
		t.Run("status="+st, func(t *testing.T) {
			v := dvHomeVenue()
			v.Type = VenueTypeHall
			v.Status = st
			raw, m := dvMarshal(t, NewVenueDetailView(v, AddressEvidence{CallerUserID: "U-路人"}, 1000))
			if _, ok := m["phone"]; ok {
				t.Errorf("status=%q 不該有 phone：%s", st, raw)
			}
			if _, ok := m["businessHours"]; ok {
				t.Errorf("status=%q 不該有 businessHours：%s", st, raw)
			}
			if VenueContactIsPublic(VenueTypeHall, st) {
				t.Errorf("VenueContactIsPublic(hall,%q) 應為 false", st)
			}
		})
	}
	// 🔴 反控：active 的 hall **要**有 —— 少了它，「一律不給聯絡資訊」也會讓上面全綠，
	//    而那會讓麻將館的詳情頁永遠看不到電話（症狀是「店家沒填」，不是「被擋」）。
	t.Run("active_hall_still_has_contact", func(t *testing.T) {
		v := dvHomeVenue()
		v.Type = VenueTypeHall
		v.Status = VenueStatusActive
		raw, m := dvMarshal(t, NewVenueDetailView(v, AddressEvidence{CallerUserID: "U-路人"}, 1000))
		if _, ok := m["phone"]; !ok {
			t.Fatalf("active 的 hall 必須有 phone：%s", raw)
		}
		if _, ok := m["businessHours"]; !ok {
			t.Fatalf("active 的 hall 必須有 businessHours：%s", raw)
		}
	})
	// 🔴 第二道反控：owner **不**特別放行（本函式不看呼叫者）。
	//    寫出來是因為「放行 owner」是很自然的下一步，而它會讓上面那批對 owner 全部失效。
	t.Run("owner_gets_no_special_pass", func(t *testing.T) {
		v := dvHomeVenue()
		v.Type = VenueTypeHall
		v.Status = VenueStatusPending
		_, m := dvMarshal(t, NewVenueDetailView(v, AddressEvidence{CallerUserID: dvOwner}, 1000))
		if _, ok := m["phone"]; ok {
			t.Error("pending 的 hall 對 owner 也不給聯絡資訊（刻意的取捨，見函式註解）")
		}
	})
}
