package shared

import (
	"math"
	"testing"
)

// [B5-a] 自建場座標位移（§5.1）的尺。
//
// 🔴 每一條承重斷言都配一條方向相反的反控：
//   home 會位移 ↔ hall／event 不位移；距離會變 ↔ 不是固定值；方位會變 ↔ 不是固定正北；
//   PlaceName 清空 ↔ hall 的 PlaceName 留著。少了反控那半，「一律位移」「一律清空」
//   這種壞掉的實作也會全綠。

// seqRnd 回一個依序吐出 vals 的注入器（用完就重頭）。
// BlurredApproxLocation 的呼叫順序是：第一次取距離、第二次取方位。
func seqRnd(vals ...float64) func() float64 {
	i := 0
	return func() float64 {
		v := vals[i%len(vals)]
		i++
		return v
	}
}

// haversineMeters 是測試自己的一把尺（球面距離），刻意不重用生產端的平面換算 ——
// 用同一條公式量自己，對「公式寫錯」零鑑別力。
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Asin(math.Sqrt(a))
}

var taipei = VenueLocation{Latitude: 25.0330, Longitude: 121.5654, PlaceName: "台北市某路9號", Geohash: "wsqqmp"}

// --- 規則 1／2：home 位移、hall／event 不位移 ---

// T1 承重：home 的座標會動，而且動的距離落在 [300,500] 公尺。
// 掃 41×41 個 (距離, 方位) 的 rnd 組合，不是只打一個點。
func TestB5a_Blur_HomeMovesWithinRange(t *testing.T) {
	for i := 0; i <= 40; i++ {
		for j := 0; j <= 40; j++ {
			rd := float64(i) / 40.0 // 0 … 1.0（1.0 靠 unit 夾回 <1）
			rb := float64(j) / 40.0
			out := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(rd, rb))
			d := haversineMeters(taipei.Latitude, taipei.Longitude, out.Latitude, out.Longitude)
			// 平面換算 vs 球面量測在 500m 尺度下差不到 1m；容差 2m。
			if d < HomeBlurMinMeters-2 || d > HomeBlurMaxMeters+2 {
				t.Fatalf("rnd=(%.3f,%.3f) 位移 %.1fm，不在 [%d,%d]", rd, rb, d, HomeBlurMinMeters, HomeBlurMaxMeters)
			}
		}
	}
}

// T2 反控：hall 與 event 一個字都不能動 —— 含 PlaceName 與 Geohash。
// 🔴 少了這條，「一律位移」的實作讓 T1 照樣全綠，而麻將館的圖釘會離店家 400 公尺。
func TestB5a_Blur_HallAndEventUnchanged(t *testing.T) {
	for _, typ := range []string{VenueTypeHall, VenueTypeEvent} {
		out := BlurredApproxLocation(typ, taipei, seqRnd(0.7, 0.3))
		if out != taipei {
			t.Fatalf("%s 被改了：%+v → %+v", typ, taipei, out)
		}
	}
}

// T3 fail-closed：認不得的 type 要當成 home 處理（位移＋清空）。
func TestB5a_Blur_UnknownTypeIsBlurred(t *testing.T) {
	for _, typ := range []string{"", "dojo", "HOME", "unknown"} {
		out := BlurredApproxLocation(typ, taipei, seqRnd(0.5, 0.5))
		d := haversineMeters(taipei.Latitude, taipei.Longitude, out.Latitude, out.Longitude)
		if d < HomeBlurMinMeters-2 || d > HomeBlurMaxMeters+2 {
			t.Fatalf("type=%q 沒被位移（%.1fm）⇒ 認不得的 type 放行了精確座標", typ, d)
		}
		if out.PlaceName != "" || out.Geohash != "" {
			t.Fatalf("type=%q 的 PlaceName／Geohash 沒清空：%+v", typ, out)
		}
	}
}

// --- 規則 3：home 清空 PlaceName／Geohash ---

// T4 承重：home 回傳值的 PlaceName 與 Geohash 必須是空的。
// 反控在 T2（hall 的兩格要留著）。
func TestB5a_Blur_HomeClearsPlaceNameAndGeohash(t *testing.T) {
	out := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(0.5, 0.5))
	if out.PlaceName != "" {
		t.Fatalf("PlaceName 沒清空：%q（它可能帶著地址）", out.PlaceName)
	}
	if out.Geohash != "" {
		t.Fatalf("Geohash 沒清空：%q（可以反推原座標）", out.Geohash)
	}
	// 正控：輸入確實帶了這兩格，否則上面兩條是空對空。
	if taipei.PlaceName == "" || taipei.Geohash == "" {
		t.Fatal("正控失敗：測試輸入本身就沒有 PlaceName／Geohash")
	}
}

// --- 規則 4：rnd 可注入 ⇒ 距離與方位真的由它決定 ---

// T5 距離：rnd=0 → 剛好 300；rnd→1 → 逼近 500；兩者**不同**。
// 🔴 「固定 300」的實作會讓 T1 全綠（300 在區間內），只有這條抓得到。
func TestB5a_Blur_DistanceFollowsRnd(t *testing.T) {
	near := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(0, 0))
	far := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(0.999999, 0))
	dNear := haversineMeters(taipei.Latitude, taipei.Longitude, near.Latitude, near.Longitude)
	dFar := haversineMeters(taipei.Latitude, taipei.Longitude, far.Latitude, far.Longitude)
	if math.Abs(dNear-HomeBlurMinMeters) > 2 {
		t.Fatalf("rnd=0 應該剛好 %dm，得到 %.1fm", HomeBlurMinMeters, dNear)
	}
	if math.Abs(dFar-HomeBlurMaxMeters) > 2 {
		t.Fatalf("rnd→1 應該逼近 %dm，得到 %.1fm", HomeBlurMaxMeters, dFar)
	}
	if dFar-dNear < 100 {
		t.Fatalf("距離沒有跟著 rnd 變：%.1f vs %.1f", dNear, dFar)
	}
}

// T6 方位：rnd 取 0 → 正北（緯度增、經度不變）；取 0.25 → 正東（經度增、緯度不變）。
// 🔴 「固定正北」的實作會讓 T1／T5 全綠，只有這條抓得到。
func TestB5a_Blur_BearingFollowsRnd(t *testing.T) {
	north := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(0.5, 0))
	east := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(0.5, 0.25))
	const eps = 1e-9
	if north.Latitude <= taipei.Latitude || math.Abs(north.Longitude-taipei.Longitude) > eps {
		t.Fatalf("bearing=0 應該往正北：%+v", north)
	}
	if east.Longitude <= taipei.Longitude || math.Abs(east.Latitude-taipei.Latitude) > eps {
		t.Fatalf("bearing=π/2 應該往正東：%+v", east)
	}
	// 反控：兩個方位落點不同（否則上面兩條各自成立卻是同一個點的話，代表方位沒進公式）。
	if north == east {
		t.Fatal("正北與正東落到同一點 ⇒ 方位沒有進公式")
	}
}

// T7 rnd 越界（≥1 或負數／NaN）時距離仍落在區間內 —— 注入器壞了不該讓人跑出 500m 外或跑進 300m 內。
func TestB5a_Blur_RndOutOfContractIsClamped(t *testing.T) {
	for _, r := range []float64{1.0, 5.0, -1.0, math.NaN()} {
		out := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(r, r))
		d := haversineMeters(taipei.Latitude, taipei.Longitude, out.Latitude, out.Longitude)
		if d < HomeBlurMinMeters-2 || d > HomeBlurMaxMeters+2 {
			t.Fatalf("rnd=%v 時位移 %.1fm，跑出 [%d,%d]", r, d, HomeBlurMinMeters, HomeBlurMaxMeters)
		}
	}
}

// T8 rnd=nil 退回真隨機，而且**仍然位移**。忘了傳的後果必須是「照樣遮」，不是「不遮」。
func TestB5a_Blur_NilRndStillBlurs(t *testing.T) {
	for i := 0; i < 20; i++ {
		out := BlurredApproxLocation(VenueTypeHome, taipei, nil)
		d := haversineMeters(taipei.Latitude, taipei.Longitude, out.Latitude, out.Longitude)
		if d < HomeBlurMinMeters-2 || d > HomeBlurMaxMeters+2 {
			t.Fatalf("rnd=nil 第 %d 次位移 %.1fm，不在區間內", i, d)
		}
	}
}

// --- 規則 5：極區的經度換算 ---

// T9 承重：lat=±90 附近、lng 貼近 180 時，經度要落在 [-180,180]，**而且位移不可以離譜**。
//
// 🔴 為什麼不只斷言「不是 NaN」：math.Cos(π/2)=6.1e-17 不是 0 ⇒ 沒有夾制時得到的
// 是 7e13 度這種有限數，環繞回 [-180,180] 之後看起來像個座標 —— 兩個斷言都要有。
// 夾制 0.01 之下 |dLng| 最多 500/(111320×0.01)≈0.45 度，斷言上限取 0.5。
func TestB5a_Blur_PolarLongitudeStaysSane(t *testing.T) {
	cases := []VenueLocation{
		{Latitude: 90, Longitude: 179.9},
		{Latitude: -90, Longitude: -179.9},
		{Latitude: 89.999, Longitude: 0},
		{Latitude: 90, Longitude: 0},
	}
	for _, loc := range cases {
		for _, rb := range []float64{0.25, 0.75, 0.1, 0.6} { // 含正東／正西
			out := BlurredApproxLocation(VenueTypeHome, loc, seqRnd(0.5, rb))
			if math.IsNaN(out.Longitude) || math.IsNaN(out.Latitude) {
				t.Fatalf("%+v rb=%.2f → NaN：%+v", loc, rb, out)
			}
			if out.Longitude < -180 || out.Longitude > 180 {
				t.Fatalf("%+v rb=%.2f → 經度 %v 不在 [-180,180]", loc, rb, out.Longitude)
			}
			if out.Latitude < -90 || out.Latitude > 90 {
				t.Fatalf("%+v rb=%.2f → 緯度 %v 不在 [-90,90]", loc, rb, out.Latitude)
			}
			// 環繞後的最短經度差
			diff := math.Abs(out.Longitude - loc.Longitude)
			if diff > 180 {
				diff = 360 - diff
			}
			if diff > 0.5 {
				t.Fatalf("%+v rb=%.2f → 經度位移 %.4f 度，離譜（夾制沒生效）", loc, rb, diff)
			}
		}
	}
}

// T10 反控：赤道附近**沒有**被夾制影響 —— 夾制常數若寫太大（例如 1），
// 緯度 25 度的經度位移會被壓扁，T9 照樣綠。這條要求 25°N 的正東位移接近理論值。
func TestB5a_Blur_MidLatitudeNotClamped(t *testing.T) {
	east := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(0, 0.25)) // 300m 正東
	want := 300.0 / (111320.0 * math.Cos(taipei.Latitude*math.Pi/180))
	got := east.Longitude - taipei.Longitude
	if math.Abs(got-want) > 1e-6 {
		t.Fatalf("25°N 正東 300m 的經度位移 = %.8f，want %.8f（夾制在不該生效的緯度生效了）", got, want)
	}
}

// --- 規則 6：座標壞掉時原樣回傳 ---

// T11 承重：NaN／±Inf 的座標不可以被「修」成一個看起來合理的點。
// 但 home 的 PlaceName／Geohash 仍要清空（那兩格的洩漏與座標好不好無關）。
func TestB5a_Blur_BrokenCoordsPassThrough(t *testing.T) {
	broken := []VenueLocation{
		{Latitude: math.NaN(), Longitude: 121.5, PlaceName: "地址", Geohash: "g"},
		{Latitude: 25, Longitude: math.Inf(1), PlaceName: "地址", Geohash: "g"},
		{Latitude: math.Inf(-1), Longitude: 121.5, PlaceName: "地址", Geohash: "g"},
	}
	for _, loc := range broken {
		out := BlurredApproxLocation(VenueTypeHome, loc, seqRnd(0.5, 0.5))
		sameLat := out.Latitude == loc.Latitude || (math.IsNaN(out.Latitude) && math.IsNaN(loc.Latitude))
		sameLng := out.Longitude == loc.Longitude || (math.IsNaN(out.Longitude) && math.IsNaN(loc.Longitude))
		if !sameLat || !sameLng {
			t.Fatalf("壞座標被改了：%+v → %+v", loc, out)
		}
		if out.PlaceName != "" || out.Geohash != "" {
			t.Fatalf("壞座標的 home 仍要清空 PlaceName／Geohash：%+v", out)
		}
	}
	// 反控：同一個 rnd、座標正常時要動 —— 否則上面那條可能只是「什麼都沒做」。
	ok := BlurredApproxLocation(VenueTypeHome, taipei, seqRnd(0.5, 0.5))
	if ok.Latitude == taipei.Latitude && ok.Longitude == taipei.Longitude {
		t.Fatal("正控失敗：正常座標也沒動 ⇒ 上面那條證明不了任何事")
	}
}

// --- 接線：NewVenueFromCreateRequest 真的經過位移 ---

// T12 承重：home 請求建出來的 Venue，ApproxLocation 已位移且 PlaceName／Geohash 清空。
// 函式寫對但沒接上，在上面那些純函式測試裡看不出來。
func TestB5a_NewVenueFromCreateRequest_BlursHome(t *testing.T) {
	r := &CreateVenueRequest{Type: VenueTypeHome, Name: "家", ExactAddress: "台北市某路9號", ApproxLocation: taipei}
	v := NewVenueFromCreateRequest(r, "V1", "U1", 1, seqRnd(0.5, 0.5))
	d := haversineMeters(taipei.Latitude, taipei.Longitude, v.ApproxLocation.Latitude, v.ApproxLocation.Longitude)
	if d < HomeBlurMinMeters-2 || d > HomeBlurMaxMeters+2 {
		t.Fatalf("home 建立後 approxLocation 位移 %.1fm ⇒ 沒接上 BlurredApproxLocation", d)
	}
	if v.ApproxLocation.PlaceName != "" || v.ApproxLocation.Geohash != "" {
		t.Fatalf("home 建立後 PlaceName／Geohash 仍在：%+v", v.ApproxLocation)
	}
	// ExactAddress 不受影響（它有自己的 json:"-" 閘）。
	if v.ExactAddress != "台北市某路9號" {
		t.Fatalf("ExactAddress 被動到：%q", v.ExactAddress)
	}
}

// T13 反控：hall 請求建出來的 Venue，ApproxLocation 逐格相同。
func TestB5a_NewVenueFromCreateRequest_KeepsHallExact(t *testing.T) {
	r := &CreateVenueRequest{Type: VenueTypeHall, Name: "館", ApproxLocation: taipei}
	v := NewVenueFromCreateRequest(r, "V1", "U1", 1, seqRnd(0.5, 0.5))
	if v.ApproxLocation != taipei {
		t.Fatalf("hall 的 approxLocation 被改了：%+v", v.ApproxLocation)
	}
}

// --- IsSelfServeVenueType ---

// T14 hall／home 可自助；event 與認不得的 type 不可。
// 反控：三種合法 type 不可以全部回同一個值。
func TestB5a_IsSelfServeVenueType(t *testing.T) {
	cases := map[string]bool{
		VenueTypeHall: true, VenueTypeHome: true,
		VenueTypeEvent: false, "": false, "dojo": false, "EVENT": false,
	}
	for typ, want := range cases {
		if got := IsSelfServeVenueType(typ); got != want {
			t.Errorf("IsSelfServeVenueType(%q) = %v, want %v", typ, got, want)
		}
	}
	if IsSelfServeVenueType(VenueTypeHall) == IsSelfServeVenueType(VenueTypeEvent) {
		t.Fatal("hall 與 event 結果相同 ⇒ 這支沒有在分辨 type")
	}
	// event 仍然是**合法** type —— 這支擋的是自助路徑，不是合法性。
	if !IsValidVenueType(VenueTypeEvent) {
		t.Fatal("event 不再是合法 type ⇒ 改錯地方了（該擋的是自助路徑）")
	}
}
