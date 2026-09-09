package shared

import (
	"math"
	"math/rand"
)

// [B5-a] 自建場的公開座標**由後端自己位移**（正典 PLAYER_APP_REDESIGN.md §5.1）。
//
// 🔴 為什麼要在後端做：§5.1 寫的是硬規則 —— 自建場「地圖上只顯示大概位置
// （隨機位移 300–500m）」，而且「不要做成使用者可以自己選要不要公開」。
// 前端有位移，但那是客戶端自律：任何人直接打 POST /create-venue 就能把精確座標
// 塞進 approxLocation。在 2026-09-09 之前，`ApproxLocation: r.ApproxLocation` 是
// 原樣照抄 —— 那個欄位**只有名字是「大概」**。
//
// 位移範圍（公尺）。上下界都是**含**的：rnd=0 剛好 300，rnd→1 逼近 500。
const (
	HomeBlurMinMeters = 300
	HomeBlurMaxMeters = 500
)

// metersPerDegree 是赤道上一度緯度／經度的公尺數（WGS84 近似）。
const metersPerDegree = 111320.0

// minAbsCosLat 是經度換算時 |cos(lat)| 的下限。
//
// 🔴 它擋的**不是 NaN**：Go 的 math.Cos(math.Pi/2) 是 6.1e-17、不是 0，
// 所以除下去不會得到 Inf 或 NaN —— 得到的是 7.4e13 這種**有限但不是座標**的數字。
// 測試要斷言的是「經度落在 [-180,180] 而且位移沒有大到離譜」，
// 不是「不是 NaN」。後者對這個缺陷零鑑別力（前端那版就是突變測試才逼出來的）。
const minAbsCosLat = 0.01

// IsSelfServeVenueType 回報這種 type 是不是玩家可以**自己**建的。
//
// event 不是：§5.1 說活動場是官方建的，而它 status 直接 active、進公開列表、
// 地址走 allow:public-venue 對所有登入者公開 ⇒ 玩家自己建得出「活動場」
// 就等於免審、立刻公開一個地址。
//
// 🔴 這不是「type 合不合法」—— 那是 IsValidVenueType 的事，event 仍然是合法 type
// （將來會有官方建立的路徑）。這一支擋的是**自助路徑**這一條。
// 認不得的 type 一律 false（fail-closed）。
func IsSelfServeVenueType(t string) bool {
	switch t {
	case VenueTypeHall, VenueTypeHome:
		return true
	default:
		return false
	}
}

// BlurredApproxLocation 是自建場座標位移的**唯一求值點**。
//
// 規則：
//   - hall／event：原樣回傳。麻將館的圖釘不可以離店家 400 公尺。
//   - home 與**任何認不得的 type**（fail-closed）：隨機方位 ＋ 距離落在
//     [HomeBlurMinMeters, HomeBlurMaxMeters]，而且 PlaceName 與 Geohash 一律清空 ——
//     PlaceName 可能帶著地址字串、Geohash 可以反推原座標，留著等於模糊化白做。
//   - 座標本身壞掉（NaN／±Inf）：座標原樣回傳，不憑空生一個看起來合理的點。
//     ⚠️ 但 home 的 PlaceName／Geohash **仍然清空** —— 那兩格的洩漏與座標好不好無關。
//
// rnd 回 [0,1)，可注入：測試才問得出「距離真的落在 300–500 嗎」「方位真的會變嗎」。
// 生產路徑傳 rand.Float64。傳 nil 時退回 rand.Float64 —— 忘了傳的後果必須是
// 「照樣位移」，不是「不位移」也不是 panic。
//
// 換算：dLat = d·cos(bearing)/111320；dLng = d·sin(bearing)/(111320·max(|cos(lat)|, 0.01))。
// 位移後緯度夾在 [-90,90]、經度環繞到 [-180,180]。
func BlurredApproxLocation(venueType string, loc VenueLocation, rnd func() float64) VenueLocation {
	switch venueType {
	case VenueTypeHall, VenueTypeEvent:
		return loc
	}
	// 走到這裡：home，或認不得的 type（fail-closed，一律當成要遮）。
	out := VenueLocation{Latitude: loc.Latitude, Longitude: loc.Longitude}
	if !isFiniteCoord(loc.Latitude) || !isFiniteCoord(loc.Longitude) {
		return out
	}
	if rnd == nil {
		rnd = rand.Float64
	}
	distance := HomeBlurMinMeters + float64(HomeBlurMaxMeters-HomeBlurMinMeters)*unit(rnd())
	bearing := 2 * math.Pi * unit(rnd())

	dLat := distance * math.Cos(bearing) / metersPerDegree
	cosLat := math.Abs(math.Cos(loc.Latitude * math.Pi / 180))
	if cosLat < minAbsCosLat {
		cosLat = minAbsCosLat
	}
	dLng := distance * math.Sin(bearing) / (metersPerDegree * cosLat)

	out.Latitude = clampLat(loc.Latitude + dLat)
	out.Longitude = wrapLng(loc.Longitude + dLng)
	return out
}

// unit 把 rnd 的回傳值夾到 [0,1)。rnd 的合約是 [0,1)，但一個回 1.0 或負數的
// 注入器不該讓距離跑出 [300,500]。
func unit(r float64) float64 {
	if r != r || r < 0 { // NaN 或負數
		return 0
	}
	if r >= 1 {
		return math.Nextafter(1, 0)
	}
	return r
}

func isFiniteCoord(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

func clampLat(lat float64) float64 {
	if lat > 90 {
		return 90
	}
	if lat < -90 {
		return -90
	}
	return lat
}

func wrapLng(lng float64) float64 {
	if lng >= -180 && lng <= 180 {
		return lng
	}
	lng = math.Mod(lng+180, 360)
	if lng < 0 {
		lng += 360
	}
	return lng - 180
}
