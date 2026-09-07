package shared

import "testing"

// [A3-l] ShouldRefundOnCancel 的判準測試。
//
// 🔴 這一組存在的理由：退點是**把點數送出去**，而它的兩個輸入在真實環境裡很難湊齊
//    （要一個「有人申請但主揪還沒核准」的局）。沒有這份的話，把 `&&` 寫成 `||`
//    或把 `<= 1` 寫成 `== 0`，在任何一次手動測試裡都看不出來。

func TestShouldRefundOnCancel_NobodyRegistered(t *testing.T) {
	// 建局當下：Registrations 空、currentPlayers=1（那個 1 是主揪自己）
	if !ShouldRefundOnCancel(0, 1) {
		t.Fatal("剛建好、沒人報名的局取消時應該全額退")
	}
	// 防禦性：currentPlayers=0 的舊資料也算沒人
	if !ShouldRefundOnCancel(0, 0) {
		t.Fatal("currentPlayers=0 也應該算無人報名")
	}
}

func TestShouldRefundOnCancel_HasRegistration(t *testing.T) {
	// 🔴 有人申請、但主揪還沒核准 ⇒ currentPlayers 仍是 1。
	//    這一格就是「只看 currentPlayers」會判錯的那一格 ——
	//    少了它，把判準寫成 `currentPlayers <= 1` 單條也會全綠。
	if ShouldRefundOnCancel(1, 1) {
		t.Fatal("已有人報名（尚未核准）就不該退")
	}
	if ShouldRefundOnCancel(3, 1) {
		t.Fatal("多筆報名更不該退")
	}
}

func TestShouldRefundOnCancel_HasJoinedPlayer(t *testing.T) {
	// 🔴 反向的那一格：報名列不知為何是 0，但已經有人在局裡。
	//    少了它，把判準寫成 `registrationCount == 0` 單條也會全綠。
	if ShouldRefundOnCancel(0, 2) {
		t.Fatal("已有人加入就不該退")
	}
}

func TestShouldRefundOnCancel_IsConjunctionNotDisjunction(t *testing.T) {
	// 上面兩條各自釘住一個合取項；這條直接把 `||` 釘死：
	// 若寫成 `||`，(1,1) 與 (0,2) 都會回 true，而那正是上面兩條在測的。
	// 這裡再加一格「兩個都不空」，讓「永遠回 false」也不會被誤判成正確。
	if ShouldRefundOnCancel(2, 3) {
		t.Fatal("兩個訊號都說有人時當然不該退")
	}
	// 正控：必須存在**至少一種**會回 true 的輸入，否則上面全部可以靠 `return false` 通過。
	if !ShouldRefundOnCancel(0, 1) {
		t.Fatal("正控：無人報名那一格必須回 true，否則整組測試對『永遠不退』零鑑別力")
	}
}

func TestCreateGameCost_MatchesDeductedAmount(t *testing.T) {
	// 🔴 這條釘的不是「120 對不對」，是「退的與扣的是同一個常數」。
	//    數字本身要改是產品決定；會出事的是兩邊各改一半。
	if CreateGameCost != 120 {
		t.Fatalf("CreateGameCost 改動了（%d）——"+
			" 若這是刻意的，請一併確認 web_create_game 的扣點與本檔的退點都走這個常數，"+
			" 並更新 PLAYER_APP_REDESIGN §15.2 那句「120 點 ≈ 12 天簽到」的校準", CreateGameCost)
	}
}

// ── DecideCancelRefund：三個分支各有各的「答錯就送錢」

func TestDecideCancelRefund_RefundsWhenTrulyEmpty(t *testing.T) {
	ok, reason := DecideCancelRefund(true, "recruiting", 0, 1)
	if !ok || reason != RefundYes {
		t.Fatalf("無人報名的局應該退，得到 ok=%v reason=%s", ok, reason)
	}
}

func TestDecideCancelRefund_QueryFailureIsNotZero(t *testing.T) {
	// 🔴 這一格是整組最重要的：查詢失敗時 registrationCount 一定是 0，
	//    與「真的沒人報名」在數字上逐字相同。少了 regQueryOK 這個參數，
	//    DynamoDB 一抖就變成發錢，而 log 上看起來完全正常。
	ok, reason := DecideCancelRefund(false, "recruiting", 0, 1)
	if ok || reason != RefundSkipRegQueryFail {
		t.Fatalf("報名清單查不到時不可以退，得到 ok=%v reason=%s", ok, reason)
	}
}

func TestDecideCancelRefund_AlreadyCancelledDoesNotRefundAgain(t *testing.T) {
	// 重複呼叫取消 API：第二次不可以再退一次 120。
	ok, reason := DecideCancelRefund(true, "cancelled", 0, 1)
	if ok || reason != RefundSkipAlreadyDone {
		t.Fatalf("已取消過的局不可以再退，得到 ok=%v reason=%s", ok, reason)
	}
}

func TestDecideCancelRefund_HasInterest(t *testing.T) {
	if ok, reason := DecideCancelRefund(true, "recruiting", 1, 1); ok || reason != RefundSkipHasInterest {
		t.Fatalf("有人報名不該退，得到 ok=%v reason=%s", ok, reason)
	}
	if ok, reason := DecideCancelRefund(true, "recruiting", 0, 3); ok || reason != RefundSkipHasInterest {
		t.Fatalf("有人加入不該退，得到 ok=%v reason=%s", ok, reason)
	}
}

func TestDecideCancelRefund_ReasonsAreDistinct(t *testing.T) {
	// 🔴 四個 reason 若有兩個撞在一起，上面那些測試會互相冒充通過，
	//    而 log 也就答不出「這次為什麼沒退」——那是事後唯一的線索。
	seen := map[RefundReason]bool{}
	for _, r := range []RefundReason{RefundYes, RefundSkipRegQueryFail, RefundSkipAlreadyDone, RefundSkipHasInterest} {
		if r == "" {
			t.Fatal("reason 不可以是空字串（空字串在 log 裡與「沒印」分不出來）")
		}
		if seen[r] {
			t.Fatalf("reason 重複：%s", r)
		}
		seen[r] = true
	}
}
