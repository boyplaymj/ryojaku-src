package shared

import (
	"errors"
	"strings"
)

// [B1-c2a] 建立 venue 的**窄 DTO**（正典 §5.3 的三條接線驗收之第 ①）。
//
// 🔴 端點不可以直接把 request body decode 進 Venue。Venue.UnmarshalJSON 雖然已經
// 會把 IsDojo 歸零（第二道），但那只涵蓋 IsDojo 一個欄位 —— OwnerID、Status、
// RatingCount、DojoPaidUntil、CertifiedRefereeCount 全都還是可寫的公開欄位。
// 直接 decode Venue ＝ 前端可以宣稱自己是別人的場地、自己是 active、自己有 99 好評。
//
// ⇒ 窄 DTO 的價值在於「**沒有那個欄位**」是編譯期事實，不是執行期檢查：
// 前端送 {"ownerId":"別人"} 進來，那個鍵在這個型別上根本不存在 ⇒ 被 json 丟掉。
type CreateVenueRequest struct {
	Type           string        `json:"type"`
	Name           string        `json:"name"`
	Phone          string        `json:"phone,omitempty"`
	BusinessHours  string        `json:"businessHours,omitempty"`
	ApproxLocation VenueLocation `json:"approxLocation"`
	ExactAddress   string        `json:"exactAddress,omitempty"`
	Features       []string      `json:"features,omitempty"`
}

// venueServerOwnedFields 是**絕對不可以**出現在任何建立／更新 DTO 上的欄位。
// 測試用反射拿這份清單去掃 DTO（不是手打欄位比對）——
// 之後有人往 DTO 加欄位，加到這裡面任何一個就會紅。
//
// 分三類，理由各不相同：
//   - 身分與生命週期：venueId（伺服器產）、ownerId（從 JWT 取）、status（審核流程定）、
//     createdAt／updatedAt（伺服器時鐘）
//   - isDojo 三條件的原料：dojoPaidUntil（付費流程）、certifiedRefereeCount（裁判系統彙總）、
//     isDojo（算出來的，§5.2）
//   - 評價彙總：ratingPositive／ratingCount（§7 由評價寫入端維護）
var venueServerOwnedFields = []string{
	"venueId", "ownerId", "status", "createdAt", "updatedAt",
	"isDojo", "dojoPaidUntil", "certifiedRefereeCount",
	"ratingPositive", "ratingCount",
}

// 建立請求的驗證錯誤。分開命名讓端點能回不同訊息，也讓測試斷言得到「是哪一條擋的」。
var (
	ErrVenueTypeInvalid  = errors.New("venue: type 必須是 hall／home／event 之一")
	ErrVenueNameRequired = errors.New("venue: name 不可為空")
	ErrVenueLatLngRange  = errors.New("venue: approxLocation 超出合法經緯度範圍")
	ErrVenueHomeNeedAddr = errors.New("venue: 自建場必須填 exactAddress")
)

// Validate 檢查建立請求。fail-closed：看不懂就擋。
func (r *CreateVenueRequest) Validate() error {
	if r == nil {
		return ErrVenueTypeInvalid
	}
	if !IsValidVenueType(r.Type) {
		return ErrVenueTypeInvalid
	}
	if strings.TrimSpace(r.Name) == "" {
		return ErrVenueNameRequired
	}
	lat, lng := r.ApproxLocation.Latitude, r.ApproxLocation.Longitude
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return ErrVenueLatLngRange
	}
	// 🔴 自建場沒有精確地址的話，報名核准之後也沒東西可以給玩家 ——
	// 而那個失敗會發生在「玩家已經被核准、正要出門」的時候，不是建立的時候。
	if r.Type == VenueTypeHome && strings.TrimSpace(r.ExactAddress) == "" {
		return ErrVenueHomeNeedAddr
	}
	return nil
}

// initialVenueStatus 決定新建 venue 的初始狀態（✅ 2026-09-09 使用者拍板選項 B）。
//
// 🔴 這條規則的效果**只有一個**：pending 的 venue，非 owner 拿不到它的
// `exactAddress`（CanSeeExactAddress 規則 4）。它**擋不住「出現在地圖上」**——
// 那是列表端點的事，而 status 目前在生產程式裡只被授權判斷讀。
// 不要把 pending 讀成「這間店不會被看到」。
//
//   - hall  → pending：麻將館是付費建立的，但**付費 ≠ 是真店主**。
//     未審核的店填的地址不該被當成真實店家地址發給玩家。
//     ⚠️ 代價是館方付了錢之後功能是壞的，直到有人去審 ⇒ 審核介面是這個選擇的
//     **前提**，不是配套。少了它，這一格就是「收了錢不給用」。
//   - home  → active：自建場免費、量會多，人工審每一個不可行；
//     而且它的地址已經有第二道閘（只有報名核准的玩家拿得到，§5.1）。
//   - event → active：官方建的，沒有審的對象。
//
// default 走 pending 是 fail-closed。⚠️ 它在**目前的呼叫路徑上是死碼**
// （Validate 已經擋掉不合法 type），留著是為了「有人忘了先 Validate」那條路徑；
// 測試直接打這個函式，所以它不是沒有尺的死碼。
func initialVenueStatus(venueType string) string {
	switch venueType {
	case VenueTypeHome, VenueTypeEvent:
		return VenueStatusActive
	case VenueTypeHall:
		return VenueStatusPending
	default:
		return VenueStatusPending
	}
}

// NewVenueFromCreateRequest 把驗證過的請求變成 Venue。
//
// 🔴 ownerID 與 venueID 是**參數**，不是從 r 讀 —— 呼叫端必須從 authorizer
// （shared.AuthorizerUserID）取 ownerID，不可以信任 body。DTO 上根本沒有那個欄位，
// 所以「不小心讀了 body 的 ownerId」在這條路徑上寫不出來。
//
// 三條認證的原料一律零值：新建的 venue 不可能已付費、也不可能已經有裁判。
//
// 🔴 [B5-a] rnd 是**簽章參數**而不是可選項：ApproxLocation 在這裡經過
// BlurredApproxLocation（§5.1 自建場位移 300–500m），而每一個呼叫端都被編譯器逼著
// 對「隨機來源是什麼」做一次決定。生產傳 rand.Float64；測試傳固定序列。
func NewVenueFromCreateRequest(r *CreateVenueRequest, venueID, ownerID string, nowUnix int64, rnd func() float64) *Venue {
	if r == nil {
		return nil
	}
	return &Venue{
		VenueID:        venueID,
		Type:           r.Type,
		Name:           strings.TrimSpace(r.Name),
		Phone:          r.Phone,
		BusinessHours:  r.BusinessHours,
		ApproxLocation: BlurredApproxLocation(r.Type, r.ApproxLocation, rnd),
		ExactAddress:   strings.TrimSpace(r.ExactAddress),
		Features:       r.Features,
		OwnerID:        ownerID,
		// 三條認證的原料：全部零值，只能由付費流程與裁判系統改。
		DojoPaidUntil:         0,
		CertifiedRefereeCount: 0,
		// 評價彙總：從零開始，§7 的寫入端維護。
		RatingPositive: 0,
		RatingCount:    0,
		Status:         initialVenueStatus(r.Type),
		CreatedAt:      nowUnix,
		UpdatedAt:      nowUnix,
	}
}

// venuesTable 回傳 venue 主表名。表名慣例與既有表一致（複數）：
// MahjongClub_Venues／MahjongClubStg_Venues。
//
// ⚠️ 它用的是 shared 既有的 tablePrefix()，與 Users／AuthTokens 同一個來源 ——
// 不要在這裡另外讀一次 env，否則 stg／prod 的判斷會有兩個地方，而它們遲早會不一致。
func venuesTable() string { return tablePrefix() + "Venues" }

// VenuesTableName 是給 lambda 用的匯出版本（shared 內部用小寫那個）。
func VenuesTableName() string { return venuesTable() }

// TablePrefix 匯出 shared 內部的 tablePrefix()，給 lambda 組其他表名用。
//
// 🔴 匯出而不是讓 lambda 自己 os.Getenv("TABLE_PREFIX")：既有 lambda 各自讀了一次，
// 於是 stg／prod 的判斷散在 80 個地方。新的一律走這裡 —— 兩個來源遲早會不一致，
// 而不一致的症狀是「打到不存在的表」，錯誤訊息是 ResourceNotFound，
// 不會告訴你環境搞錯了。
func TablePrefix() string { return tablePrefix() }
