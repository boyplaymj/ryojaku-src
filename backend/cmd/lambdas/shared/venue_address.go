package shared

import "errors"

// [B1-b] 精確地址的授權判斷與安全序列化（正典：PLAYER_APP_REDESIGN.md §5.1）。
//
// §5.1 是硬規則：自建場（type=home）的精確地址**只在報名核准後才給該名玩家**，
// 而且不做成「使用者可以自己選要不要公開」。失效模式就是它的反面 ——
// 把某人家裡的門牌洩給不該拿到的人。
//
// 🔴 這個檔刻意不做任何 I/O。DDB 查詢由呼叫端做完，把結果包成 AddressEvidence
// 傳進來。理由：授權判斷要能被逐格窮舉測試；混進 I/O 就只能測「查得到／查不到」，
// 測不了「查到了但對不上」那些格 —— 而測不了的授權等於沒有。
//
// 🔴 fail-closed：任何看不懂、對不上、缺資料的情況一律「不給」。
// 每一條 deny 都有自己的 reason 常數，讓測試能斷言「是**哪一條**擋的」——
// 否則「被正確的規則擋下」與「被上一條規則順便擋下」在 bool 上逐字相同，
// 後者在那條規則被改掉時就會漏。

// AddressEvidence 是呼叫端查完 DDB 後交給授權判斷的證據。
//
// 所有欄位都是「呼叫端宣稱」；本檔只負責**交叉比對**它們與 venue 是否互相一致。
// 少一項就是「缺資料」⇒ 不給。
type AddressEvidence struct {
	// CallerUserID 是這次請求的使用者。空字串＝匿名。
	CallerUserID string

	// GameID 是呼叫者透過**哪一局**來要地址。
	// 自建場的地址只跟某一局的報名綁在一起，沒有局就沒有理由拿地址。
	GameID string

	// GameVenueID 是呼叫端從 GameID 那局讀到的 venueId。
	// 🔴 必須由呼叫端從 game 記錄讀出，不可以從前端請求體照抄 ——
	// 否則前端可以宣稱「我報名的那局在 V1」而實際那局在 V2。
	GameVenueID string

	// Registration 是「CallerUserID 對 GameID」那筆報名；查不到就傳 nil。
	// 本檔會再驗一次 UserID／GameID 對不對得上（不信任呼叫端的查詢條件）。
	Registration *Registration
}

// 授權結果的 reason。allow 系列以 "allow:" 開頭、deny 系列以 "deny:" 開頭，
// 方便日誌與測試分流。
const (
	AddressAllowOwner         = "allow:owner"        // 呼叫者就是 venue.OwnerID
	AddressAllowPublicVenue   = "allow:public-venue" // hall／event：營業／活動場所，地址本來就該公開
	AddressAllowAcceptedReg   = "allow:accepted-registration"
	AddressDenyNilVenue       = "deny:nil-venue"
	AddressDenyAnonymous      = "deny:anonymous"
	AddressDenyVenueNotActive = "deny:venue-not-active"
	AddressDenyUnknownType    = "deny:unknown-type"
	AddressDenyNoRegistration = "deny:no-registration"
	AddressDenyRegNotCaller   = "deny:registration-not-callers"
	AddressDenyRegOtherGame   = "deny:registration-other-game"
	AddressDenyGameOtherVenue = "deny:game-not-at-venue"
	AddressDenyRegNotAccepted = "deny:registration-not-accepted"
)

// registrationStatusAccepted 對應 models.go 裡 Registration.Status 的 "accepted"。
// models.go 只在註解列出四種值、沒有常數；這裡不去動既有檔，只在本檔用一份。
const registrationStatusAccepted = "accepted"

// CanSeeExactAddress 決定 ev 描述的呼叫者能不能拿到 v 的精確地址。
//
// 授權矩陣（由上到下，第一個命中的規則決定）：
//
//  1. v == nil                                  ⇒ 不給（nil-venue）
//  2. 匿名（CallerUserID == ""）                 ⇒ 不給（anonymous）
//     🔴 這條必須排在 owner 比對**之前**：v.OwnerID 若是空字串（髒資料／尚未填），
//     `"" == ""` 會讓匿名者變成 owner。owner 比對本身也另外擋了 OwnerID == ""，
//     兩道各自獨立成立（見測試 TestCanSeeExactAddress_AnonymousVsEmptyOwner）。
//  3. 呼叫者 == v.OwnerID（且 OwnerID 非空）      ⇒ 給（owner）—— 自己家的地址自己當然看得到，
//     不看 venue.Status（被停權的主揪仍然知道自己住哪）
//  4. v.Status != active                        ⇒ 不給（venue-not-active）
//     pending 的 hall 資料未經審核、suspended 可能正是隱私申訴的結果，非 owner 一律不給
//  5. v.Type ∈ {hall, event}                     ⇒ 給（public-venue）
//  6. v.Type == home ⇒ 逐項對報名：
//     a. Registration == nil                     ⇒ 不給（no-registration）
//     b. reg.UserID != 呼叫者                     ⇒ 不給（registration-not-callers）
//     c. reg.GameID == "" 或 != ev.GameID         ⇒ 不給（registration-other-game）
//     d. ev.GameVenueID == "" 或 != v.VenueID     ⇒ 不給（game-not-at-venue）
//     （v.VenueID == "" 也落在這格：空對空不算對上）
//     e. reg.Status != accepted                   ⇒ 不給（registration-not-accepted）
//     pending／rejected／cancelled／空字串／其他都在這格
//     f. 全部對上                                 ⇒ 給（accepted-registration）
//  7. 其他 type（含 "dojo"、空字串）              ⇒ 不給（unknown-type）
//
// 🔴 匿名者連 hall 的地址都不給。hall 的地址在產品上確實是公開的，但那應該由
// 「公開場地列表」那條路徑明確決定要不要帶地址，不是靠放鬆這個閘門 ——
// 本函式是「精確地址」的唯一閘門，閘門的預設方向只能是關。
func CanSeeExactAddress(v *Venue, ev AddressEvidence) (bool, string) {
	if v == nil {
		return false, AddressDenyNilVenue
	}
	if ev.CallerUserID == "" {
		return false, AddressDenyAnonymous
	}
	if IsVenueOwner(v, ev.CallerUserID) {
		return true, AddressAllowOwner
	}
	if v.Status != VenueStatusActive {
		return false, AddressDenyVenueNotActive
	}
	switch v.Type {
	case VenueTypeHall, VenueTypeEvent:
		return true, AddressAllowPublicVenue
	case VenueTypeHome:
		return canSeeHomeAddress(v, ev)
	default:
		return false, AddressDenyUnknownType
	}
}

// IsVenueOwner 是 owner 比對的**第二道**空字串守衛，抽成獨立函式是為了讓它有尺。
//
// 🔴 這不是重構潔癖。它原本內聯在 CanSeeExactAddress 裡寫成
// `v.OwnerID != "" && v.OwnerID == ev.CallerUserID`，而那個 `!= ""` 是**等價突變**：
// 匿名守衛排在它前面，所以在目前的規則順序下，沒有任何輸入到得了「caller 為空」
// 那一格 ⇒ 拔掉它，全部測試照樣綠（實測過）。
//
// 而它承重的時機是「有人調換規則順序」—— 那一維也沒有尺（把 owner 比對搬到匿名
// 守衛之前，全部測試同樣照樣綠，也實測過）。兩個各自無害的改動疊起來就是
// **匿名者拿到 OwnerID 為空的自建場地址**。
//
// ⇒ 抽成獨立函式之後，測試可以**直接打它**，不必繞過上游的規則順序。
// 這把尺盯的是「第二道防線本身還在不在」，與規則順序無關。
func IsVenueOwner(v *Venue, userID string) bool {
	if v == nil || v.OwnerID == "" || userID == "" {
		return false
	}
	return v.OwnerID == userID
}

// canSeeHomeAddress 是矩陣第 6 條。抽出來只是為了讓每一格的 return 各自獨立、
// 好做突變測試；不要從別處呼叫它（它假設 nil／匿名／owner 已經在上層判掉）。
func canSeeHomeAddress(v *Venue, ev AddressEvidence) (bool, string) {
	reg := ev.Registration
	if reg == nil {
		return false, AddressDenyNoRegistration
	}
	if reg.UserID != ev.CallerUserID {
		return false, AddressDenyRegNotCaller
	}
	if reg.GameID == "" || reg.GameID != ev.GameID {
		return false, AddressDenyRegOtherGame
	}
	if ev.GameVenueID == "" || ev.GameVenueID != v.VenueID {
		return false, AddressDenyGameOtherVenue
	}
	if reg.Status != registrationStatusAccepted {
		return false, AddressDenyRegNotAccepted
	}
	return true, AddressAllowAcceptedReg
}

// VenueView 是要送給前端的形狀。
//
// 嵌入的 Venue 把 ExactAddress 標成 json:"-"，所以嵌入本身**永遠不會**帶出地址；
// 唯一會帶出地址的是外層這個 ExactAddress 指標欄位，而它只由 NewVenueView 在
// CanSeeExactAddress 放行時填。
//
// 🔴 取捨：沒授權時 `exactAddress` 這個鍵**整個不存在**，不是空字串。
//   - 空字串對前端是歧義的：「沒地址」「被擋了」「主揪還沒填」三種在線上長得一樣，
//     前端會被迫用 `=== ""` 去猜，猜錯就會把「被擋」畫成「地址空白」的輸入框。
//   - 鍵不存在 ⇒ 與「根本沒接授權邏輯」（只 marshal Venue）在線上**逐字相同**。
//     這是刻意的：fail-closed 的兩種來源（沒接／被擋）長得一樣，前端只需要處理一種形狀。
//   - 放行時鍵一定存在，即使 venue 的地址本身是空字串（`"exactAddress": ""`）——
//     所以「鍵在不在」就是「有沒有授權」，不需要第二個布林欄位來說明。
type VenueView struct {
	Venue
	// ExactAddress 只在授權後非 nil。omitempty 對 nil 指標會省略整個鍵。
	ExactAddress *string `json:"exactAddress,omitempty"`
	// AddressReason 是 CanSeeExactAddress 回的 reason，不上線（只給呼叫端記日誌用）。
	AddressReason string `json:"-"`
}

// NewVenueView 用 ev 判斷授權後組出回應形狀。v == nil 回 nil。
//
// 呼叫端**只能**用這個建構子產生 VenueView；自己 `&VenueView{...}` 填 ExactAddress
// 就繞過了授權 —— 這一點沒有編譯期的尺守著，只有 code review。
// UnmarshalJSON 明確拒絕：VenueView 是**輸出專用**的形狀，不要拿它讀回來。
//
// 🔴 理由是一個實測到的靜默陷阱：Venue 有了自己的 UnmarshalJSON（擋 inbound isDojo）
// 之後，那個方法被**提升**成 VenueView 的方法 ⇒ 外層的 ExactAddress 欄位不再被解析。
// 實測：同一份 `{"exactAddress":"…"}`，加 Venue.UnmarshalJSON 之前讀得到、之後是 nil。
// 方向雖然是 fail-closed（讀不到地址，不是洩漏），但它**零徵兆** ——
// 未來有人寫整合測試比對回應，會看到 exactAddress 讀不回來，然後去懷疑授權壞了。
//
// ⇒ 與其讓它靜靜少讀一個欄位，不如讓它響亮地失敗。要解析回應請自己定一份 DTO。
func (vw *VenueView) UnmarshalJSON([]byte) error {
	return errors.New("VenueView 是輸出專用形狀，不支援 UnmarshalJSON：" +
		"嵌入的 Venue.UnmarshalJSON 會被提升，導致外層 exactAddress 靜靜讀不進來。請自訂 DTO")
}

func NewVenueView(v *Venue, ev AddressEvidence) *VenueView {
	if v == nil {
		return nil
	}
	view := &VenueView{Venue: *v}
	allowed, reason := CanSeeExactAddress(v, ev)
	view.AddressReason = reason
	if allowed {
		addr := v.ExactAddress
		view.ExactAddress = &addr
	}
	return view
}
