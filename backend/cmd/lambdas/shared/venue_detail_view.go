package shared

// [B5-b] 場地詳情的回應形狀 —— venue-detail 與 create-venue 兩支端點共用。
//
// 🔴 這是一個**獨立型別，刻意不嵌入 Venue**（與 PublicVenueCard 同一個道理）。
//
// 前身 VenueView 嵌入整個 Venue，於是「不會洩漏」依賴 `Venue.ExactAddress` 那個
// `json:"-"` 一直存在 —— 那是**否定式**保證，而它只守一個欄位：實測一個沒報名的
// 路人查自建場，拿到 `deny:no-registration`、沒有 exactAddress（授權閘門正常），
// 但同一份 JSON 裡有屋主的 `phone` 與 `ownerId`。列表端點（PublicVenueCard）擋住了，
// 詳情這條沒有。
//
// 白名單的判準：每一個欄位都要回答「路人拿到它會怎樣」。
//   - ownerId 不在：前端只需要「這是不是我的場地」（IsOwner），不需要知道是誰的。
//     洩出去等於把「誰家開放給人打牌」變成可枚舉的 —— §5.1 的同一族問題，換一個維度。
//   - phone／businessHours 只給 hall／event：home 的電話是屋主私人電話。
//     認不得的 type 也不給（fail-closed）。
//   - status 要給：前端靠它畫「審核中／已下架」橫幅。
//   - dojoPaidUntil／certifiedRefereeCount／createdAt／updatedAt 前端一個都沒讀，不給。
//
// 🔴 exactAddress 的合約**不可以動**：沒授權時整個鍵不存在（nil 指標＋omitempty），
// 放行時鍵一定存在、即使值是空字串。前端 `utils/venueView.ts` 的 readAddressState
// 就是靠「鍵在不在」判斷授權的（34 條測試釘著）。改成 string 或去掉 omitempty
// 會靜靜弄壞前端的五態判讀 —— 理由的全文見前身 VenueView 註解（git 歷史 e1f5917）。
type VenueDetailView struct {
	VenueID string `json:"venueId"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	// ApproxLocation 是**大概位置**（§5.1）。
	ApproxLocation VenueLocation `json:"approxLocation"`
	Features       []string      `json:"features,omitempty"`
	// IsDojo 由 EvaluateIsDojo 現算，不照抄記憶體裡的值（它不落地）。
	IsDojo         bool `json:"isDojo"`
	RatingPositive int  `json:"ratingPositive"`
	RatingCount    int  `json:"ratingCount"`
	// Status 給前端畫「審核中／已下架」橫幅。
	Status string `json:"status"`
	// Phone／BusinessHours 只有 hall／event 才填（見 VenueContactIsPublic）。
	Phone         string `json:"phone,omitempty"`
	BusinessHours string `json:"businessHours,omitempty"`
	// IsOwner 是伺服器算的布林，取代 ownerId。只由 IsVenueOwner 決定，不另寫比對。
	IsOwner bool `json:"isOwner"`
	// ExactAddress 只在授權後非 nil。omitempty 對 nil 指標會省略整個鍵。
	ExactAddress *string `json:"exactAddress,omitempty"`
	// AddressReason 是 CanSeeExactAddress 回的 reason，不上線（只給呼叫端記稽核行）。
	AddressReason string `json:"-"`
}

// venueDetailForbiddenFields 是**絕對不可以**出現在詳情回應上的欄位（測試用反射掃）。
//
// ⚠️ 與 publicCardForbiddenFields 不同：phone／businessHours／status／exactAddress
// 在詳情上是**有條件**允許的，所以不在這份清單裡 —— 它們各自有行為測試守著條件。
var venueDetailForbiddenFields = []string{
	"ownerId", "dojoPaidUntil", "certifiedRefereeCount", "createdAt", "updatedAt",
}

// VenueContactIsPublic 決定 phone／businessHours 可不可以隨詳情送出。
//
// 🔴 只有 hall／event 為 true。home 的電話是屋主私人電話；
// 認不得的 type 一律 false（fail-closed）—— 與 IsPubliclyListable 同一個形狀。
func VenueContactIsPublic(venueType string) bool {
	switch venueType {
	case VenueTypeHall, VenueTypeEvent:
		return true
	default:
		return false
	}
}

// NewVenueDetailView 是詳情回應的**唯一**建構點。v == nil 回 nil。
//
// 呼叫端只能用這個建構子；自己 `&VenueDetailView{...}` 填 ExactAddress 就繞過了授權 ——
// 這一點沒有編譯期的尺守著，只有 code review（另案 [B1-k]：欄位非導出＋手寫 MarshalJSON）。
func NewVenueDetailView(v *Venue, ev AddressEvidence, nowUnix int64) *VenueDetailView {
	if v == nil {
		return nil
	}
	view := &VenueDetailView{
		VenueID:        v.VenueID,
		Type:           v.Type,
		Name:           v.Name,
		ApproxLocation: v.ApproxLocation,
		Features:       v.Features,
		IsDojo:         EvaluateIsDojo(v, nowUnix),
		RatingPositive: v.RatingPositive,
		RatingCount:    v.RatingCount,
		Status:         v.Status,
		IsOwner:        IsVenueOwner(v, ev.CallerUserID),
	}
	if VenueContactIsPublic(v.Type) {
		view.Phone = v.Phone
		view.BusinessHours = v.BusinessHours
	}
	allowed, reason := CanSeeExactAddress(v, ev)
	view.AddressReason = reason
	if allowed {
		addr := v.ExactAddress
		view.ExactAddress = &addr
	}
	return view
}
