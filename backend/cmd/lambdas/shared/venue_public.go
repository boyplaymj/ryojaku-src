package shared

// [B1-c2c-3] 公開場地卡片。
//
// 🔴 這是一個**獨立型別，刻意不嵌入 Venue**。
//
// 嵌入的話，「不會洩漏地址」這件事就依賴 `Venue.ExactAddress` 那個 `json:"-"` 標籤
// 一直存在 —— 而那是一個**否定式**保證：任何人把 tag 改掉、或加一個新的敏感欄位，
// 這條路徑就跟著漏，而且沒有徵兆。獨立型別是**白名單**：欄位要一個一個加進來，
// 加的時候會看到自己在做什麼。
//
// ⇒ 判準：`PublicVenueCard` 的每一個欄位都必須是「路人看得到也無所謂」的。
// 有測試用反射掃它（不是手打清單），新增欄位時會被咬到。
type PublicVenueCard struct {
	VenueID string `json:"venueId"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	// ApproxLocation 是**大概位置**（§5.1）。自建場只有這個會出現在地圖上。
	ApproxLocation VenueLocation `json:"approxLocation"`
	Features       []string      `json:"features,omitempty"`
	IsDojo         bool          `json:"isDojo"`
	RatingPositive int           `json:"ratingPositive"`
	RatingCount    int           `json:"ratingCount"`
}

// publicCardForbiddenFields 是**絕對不可以**出現在公開卡片上的欄位（測試用反射掃）。
//
// ownerId 也在裡面：它是使用者 ID，公開列表不需要它，而洩出去等於把「誰家開放給人打牌」
// 這件事變成可枚舉的 —— 那正是 §5.1 想避免的（只是換一個維度）。
var publicCardForbiddenFields = []string{
	"exactAddress", "ownerId", "phone", "businessHours",
	"dojoPaidUntil", "certifiedRefereeCount", "status", "createdAt", "updatedAt",
}

// NewPublicVenueCard 是公開列表的**唯一**建構點。
//
// nowUnix 用來算 isDojo（它不落地）。與 detail／admin 兩條路徑同一個規矩：
// 回應前一定重算，不是照抄記憶體裡的值。
func NewPublicVenueCard(v *Venue, nowUnix int64) PublicVenueCard {
	if v == nil {
		return PublicVenueCard{}
	}
	return PublicVenueCard{
		VenueID:        v.VenueID,
		Type:           v.Type,
		Name:           v.Name,
		ApproxLocation: v.ApproxLocation,
		Features:       v.Features,
		IsDojo:         EvaluateIsDojo(v, nowUnix),
		RatingPositive: v.RatingPositive,
		RatingCount:    v.RatingCount,
	}
}

// IsPubliclyListable 決定一個 venue 該不該出現在公開列表。
//
// 🔴 自建場（home）**永遠不進公開列表**，即使它是 active。§5.1：
// 自建場「只在有場次時顯示」——「有沒有場次」是 game 那邊的事，不是 venue 的狀態，
// 所以這支端點不該自己判。把 home 整個排除是 fail-closed 的選擇：
// 少列一間自建場的代價是使用者看不到它；多列一間的代價是**某個人的住處出現在地圖上**。
// 兩者不對稱。
//
// ⇒ 自建場要上地圖，得由「有場次的局」那條路徑帶出來（另案）。
func IsPubliclyListable(v *Venue) bool {
	if v == nil {
		return false
	}
	if v.Status != VenueStatusActive {
		return false
	}
	switch v.Type {
	case VenueTypeHall, VenueTypeEvent:
		return true
	default:
		// home 與任何不認得的 type 都在這裡（fail-closed）。
		return false
	}
}
