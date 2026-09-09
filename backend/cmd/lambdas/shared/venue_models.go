package shared

import "encoding/json"

// Venue 是場地主表（正典：PLAYER_APP_REDESIGN.md §5）。
//
// 🔴 三個結構上的決定，各自擋掉一種「外觀正常但錯了」的失效模式：
//
//  1. Type 只有三種，**沒有 dojo**。道館是 hall 的一種狀態（§5.2 拍板），
//     不是第四種 type。若 enum 裡留著 dojo，寫進去之後 EvaluateIsDojo 的
//     第一條（Type == VenueTypeHall）永遠不成立 ⇒ 徽章就是不亮，
//     而程式不報錯、測試不紅、後台看起來完全正常。
//
//  2. IsDojo 標 `dynamodbav:"-"` ⇒ **它不落地**。§5.2 寫明它是「已付費 ＋ 已認證」
//     的結果、不是可以自己勾的欄位；只要表上有那一格就一定有人寫得進去。
//     持久層只存三條的原料（Type / DojoPaidUntil / CertifiedRefereeCount），
//     IsDojo 只由 EvaluateIsDojo 這**一個**求值點填。
//
//  3. ExactAddress 標 `json:"-"` ⇒ **預設絕不外洩**（§5.1 硬規則：自建場的精確地址
//     只在報名核准後才給該名玩家）。授權後要回給玩家的路徑走另一個明確的欄位，
//     由 [B1-b] 的授權判斷填。fail-closed：忘了接授權邏輯的後果是「地址沒回」，
//     不是「地址回給所有人」。
type Venue struct {
	VenueID string `dynamodbav:"venueId" json:"venueId"`

	// Type：hall | home | event。🔴 沒有 dojo，理由見上方 (1)。
	Type string `dynamodbav:"type" json:"type"`

	Name          string `dynamodbav:"name" json:"name"`
	Phone         string `dynamodbav:"phone,omitempty" json:"phone,omitempty"`
	BusinessHours string `dynamodbav:"businessHours,omitempty" json:"businessHours,omitempty"`

	// ApproxLocation 是**公開**的大概位置（§5.1）。自建場只有這個會出現在地圖上。
	ApproxLocation VenueLocation `dynamodbav:"approxLocation" json:"approxLocation"`

	// ExactAddress 是精確地址。🔴 json:"-" 不可拿掉，理由見上方 (3)。
	ExactAddress string `dynamodbav:"exactAddress,omitempty" json:"-"`

	Features []string `dynamodbav:"features,omitempty" json:"features,omitempty"`

	// OwnerID：自建場＝主揪；麻將館＝館方帳號。
	OwnerID string `dynamodbav:"ownerId" json:"ownerId"`

	// --- isDojo 三條件的原料（§5.2）---

	// DojoPaidUntil 是認證付費到期時間（epoch 秒）。0 ＝ 從未付費。
	// ⚠️ 不加 omitempty：「屬性不存在」與「值是 0」都必須是「沒付費」，
	//    而 fail-closed 的方向本來就相同 ⇒ 這裡加不加不影響正確性，
	//    但留著讓兩者在 DDB 裡長得一樣、少一種要分辨的形狀。
	DojoPaidUntil int64 `dynamodbav:"dojoPaidUntil" json:"dojoPaidUntil,omitempty"`

	// CertifiedRefereeCount 是掛在這間店的已認證裁判數（彙總，§6.6）。
	// ⚠️ 裁判系統尚未實作 ⇒ 目前恆為 0 ⇒ **現階段沒有任何 venue 會是道館**。
	//    這是刻意的 fail-closed，不是 bug。
	CertifiedRefereeCount int `dynamodbav:"certifiedRefereeCount" json:"certifiedRefereeCount"`

	// IsDojo 是**算出來的**，不落地。只由 EvaluateIsDojo 填。
	IsDojo bool `dynamodbav:"-" json:"isDojo"`

	// --- 評價彙總（§7）---
	RatingPositive int `dynamodbav:"ratingPositive" json:"ratingPositive"`
	RatingCount    int `dynamodbav:"ratingCount" json:"ratingCount"`

	CreatedAt int64  `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt int64  `dynamodbav:"updatedAt" json:"updatedAt"`
	Status    string `dynamodbav:"status" json:"status"` // pending | active | suspended
}

// VenueLocation 是場地座標。刻意不重用 Location：
// Location 帶 Address 欄位，而 Venue 的公開座標**不可以**夾帶地址字串（§5.1）。
type VenueLocation struct {
	Latitude  float64 `dynamodbav:"latitude" json:"latitude"`
	Longitude float64 `dynamodbav:"longitude" json:"longitude"`
	// PlaceName 是可公開的稱呼（店名／「大安區」），**不是**門牌。
	PlaceName string `dynamodbav:"placeName,omitempty" json:"placeName,omitempty"`
	// Geohash 供地圖範圍查詢用。
	Geohash string `dynamodbav:"geohash,omitempty" json:"geohash,omitempty"`
}

// VenueType constants（§5.1／§5.2）
const (
	VenueTypeHall  = "hall"  // 🏛 麻將館：館方付費建立，常駐地圖
	VenueTypeHome  = "home"  // 🏠 自建場（家場）：用戶免費，只在有場次時顯示大概位置
	VenueTypeEvent = "event" // 🎪 活動場：官方，活動期間顯示
)

// VenueStatus constants
const (
	VenueStatusPending   = "pending"
	VenueStatusActive    = "active"
	VenueStatusSuspended = "suspended"
)

// IsValidVenueType 回報 t 是不是三種合法 type 之一。
// 🔴 "dojo" 在這裡回 false 是**刻意的**，見 Venue 註解 (1)。
func IsValidVenueType(t string) bool {
	switch t {
	case VenueTypeHall, VenueTypeHome, VenueTypeEvent:
		return true
	default:
		return false
	}
}

// EvaluateIsDojo 是 §5.2 三條認證條件的**唯一求值點**。
//
// 🔴 不要在別處各判一次。§5.2 寫明理由：分散判斷的話，「付費過期了但徽章還在」
// 跟「徽章掉了但實際還在合約內」都會發生，而兩者在後台看起來一樣。
//
// 三條（全部要成立）：
//  1. v.Type == hall          —— 自建場／活動場不可能是道館
//  2. 付費狀態 active         —— 認證是收費項目
//  3. 至少一位已認證裁判       —— 沒有裁判就辦不了天梯場次
//
// nowUnix 由呼叫端傳入（epoch 秒），不在函式內讀時鐘 —— 否則「到期那一刻」測不了。
func EvaluateIsDojo(v *Venue, nowUnix int64) bool {
	if v == nil {
		return false
	}
	if v.Type != VenueTypeHall {
		return false
	}
	// 嚴格大於：DojoPaidUntil 是「到期時刻」，到了那一秒就算過期。
	// 0（從未付費）在任何正的 nowUnix 之下都不成立。
	if v.DojoPaidUntil <= nowUnix {
		return false
	}
	if v.CertifiedRefereeCount < 1 {
		return false
	}
	return true
}

// UnmarshalJSON 是 IsDojo 的**第二道**：把外部 JSON 送進來的 isDojo 一律丟掉。
//
// 🔴 為什麼需要它（Codex 覆驗 2026-09-09 指出，我實測確認）：
// 第一道 `dynamodbav:"-"` 擋的是**落地**，擋不住「這一次回應」。IsDojo 仍是
// `json:"isDojo"` 的公開欄位 ⇒ 端點若直接把 request body decode 進 Venue，
// `{"isDojo":true}` 會留在記憶體，再被原樣 marshal 回去。實測過：
// 一個 type=home、三條認證一條都不成立的 venue，回應裡是 "isDojo":true。
//
// ⇒ 我原本寫的「直接把 isDojo 寫成 true 在結構上不可能」**範圍寫過頭了**。
// 那句話只對「持久層」成立。這道補上「傳輸層」那一半。
//
// ⚠️ 這不取代窄 DTO（端點本來就不該直接 decode 領域模型）。兩道各自獨立：
// 忘了用窄 DTO 時這道還在，而這道被拿掉時窄 DTO 還在。
func (v *Venue) UnmarshalJSON(data []byte) error {
	// venueJSON 是 Venue 的別名，沒有 UnmarshalJSON 方法 ⇒ 走預設解析、不會無限遞迴。
	type venueJSON Venue
	var raw venueJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*v = Venue(raw)
	// 🔴 不論外面送什麼，IsDojo 一律歸零。它只能由 EvaluateIsDojo 產生。
	// fail-closed 的方向：漏了 ResolveIsDojo 的後果是「徽章不亮」，不是「亂亮」。
	v.IsDojo = false
	return nil
}

// ResolveIsDojo 把求值結果寫進 v.IsDojo。
// 從 DDB 讀出 Venue 之後、序列化回應之前呼叫；因為 IsDojo 不落地，
// **不呼叫它的話 IsDojo 恆為 false** —— 漏接的方向是「徽章不亮」而不是「亂亮」。
func (v *Venue) ResolveIsDojo(nowUnix int64) {
	if v == nil {
		return
	}
	v.IsDojo = EvaluateIsDojo(v, nowUnix)
}
