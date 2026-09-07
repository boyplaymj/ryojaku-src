package shared

// CreateGameCost 是發起一個團局要扣的點數。
//
// 🔴 這個常數搬進 shared 的理由是 [A3-l]：退點與扣點**必須是同一個數字**。
//
//	原本它是 `mahjongclub_web_create_game` 裡的一個 local const，
//	而退點寫在另一顆 lambda ⇒ 兩份各寫一次的話，改了其中一邊會出現
//	「扣 120 退 100」這種**帳面上永遠對不起來、而且沒有任何測試會紅**的漂移。
//	⚠️ 校準點：每日簽到基礎是 10 點 ⇒ 這是約 12 天簽到的量，不是零頭。
const CreateGameCost = 120

// ShouldRefundOnCancel 判斷主揪取消團局時該不該退還 CreateGameCost。
//
// 使用者拍板（2026-09-07）：**取消且「無人報名」⇒ 全額退；有人報名之後不退**
// （那時招募貼文已經產生效果）。
//
// 🔴 「無人報名」用**兩個獨立訊號的合取**，因為這個系統裡它們各自都不完整：
//   - `registrationCount`：`Registrations` 表裡屬於這個局的列數。**任何狀態都算** ——
//     被主揪拒絕過的報名也代表有人真的來申請過。
//   - `currentPlayers`：已核准加入的人數。**含主揪自己**（`create_game` 建局時就寫 1
//     並把主揪放進 `joinedPlayers`）⇒ 判準是 `<= 1` 而不是 `== 0`。
//
// 🔴 為什麼要兩個而不是挑一個：`web_register` 只寫 `Registrations`，
//
//	`web_accept_registration` 才動 `currentPlayers`／`joinedPlayers`
//	⇒ 只看後者的話，「已申請但主揪還沒核准」會被判成無人報名。
//	而只看前者的話，任何一條資料遺失都會讓已成團的局被退點。
//
// 🔴 方向是刻意不對稱的：兩個訊號**都**說空著才退。
//
//	少退的代價＝維持今天的行為（今天完全不退）；多退的代價＝把點數送出去而貼文
//	確實產生過效果。前者不比現況差，後者是新的損失 ⇒ 往「不退」那邊倒。
//	⚠️ 所以呼叫端**查不到報名清單時要傳一個非零的 registrationCount**（或直接不呼叫），
//	  不可以把「查詢失敗」當成「查到 0 筆」——那兩件事在數字上長得一樣。
func ShouldRefundOnCancel(registrationCount int, currentPlayers int) bool {
	return registrationCount == 0 && currentPlayers <= 1
}

// RefundReason 說明「這次為什麼退／為什麼不退」。它會進 log，是事後唯一的線索。
type RefundReason string

const (
	RefundYes              RefundReason = "refund:no-registrations"
	RefundSkipCountUnknown RefundReason = "skip:registration-count-unknown"
	RefundSkipAlreadyDone  RefundReason = "skip:already-cancelled"
	RefundSkipHasInterest  RefundReason = "skip:has-registration-or-player"
)

// DecideCancelRefund 是「取消團局要不要退點」的**完整**判斷。
//
// 🔴 抽出來的理由不是整齊：這三個分支在真實環境裡各自都難造
//
//	（要一個 Registrations 查詢失敗的局／要一個已取消又被再取消的局），
//	寫在 handler 裡就等於沒有尺，而其中兩個分支答錯的後果是**把點數送出去**。
//
// 參數的意義與陷阱：
//   - `countsKnown`：下面那兩個數字**讀得出來嗎**。🔴 這個布林不可以省 ——
//     讀不出來時它們都會是 0，而「真的是 0」與「根本沒讀到」在數字上逐字相同。
//     把後者當成前者，就是把「不知道」變成發錢。
//     ⚠️ 它涵蓋的情況隨呼叫端演進過：一開始是「GSI 查詢失敗」（A3-l），
//     現在是「Games 那一列上沒有 `registrationCount` 屬性」（A3-o3，舊局都沒有）。
//     **兩者是同一個判準的兩個實例**，所以參數留一個就夠。
//   - `prevStatus`：**這次呼叫之前**那顆局的狀態。已經是 cancelled 代表這一次
//     沒有造成任何狀態改變 ⇒ 不可以再退一次（重複呼叫在回應上長得一樣）。
//   - 其餘兩個交給 ShouldRefundOnCancel，判準與理由見該函式。
//
// 順序是有意義的：兩道「不知道／已經做過」排在「有沒有人」前面，
// 因為那兩種情況之下 registrationCount 根本不可信。
func DecideCancelRefund(countsKnown bool, prevStatus string, registrationCount, currentPlayers int) (bool, RefundReason) {
	if !countsKnown {
		return false, RefundSkipCountUnknown
	}
	if prevStatus == "cancelled" {
		return false, RefundSkipAlreadyDone
	}
	if !ShouldRefundOnCancel(registrationCount, currentPlayers) {
		return false, RefundSkipHasInterest
	}
	return true, RefundYes
}
