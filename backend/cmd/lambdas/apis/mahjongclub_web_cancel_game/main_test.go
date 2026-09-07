package main

import (
	"errors"
	"fmt"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// [A3-l] isConditionalCheckFailed 是「重複取消不重複退點」那道的守門員：
// 條件沒過必須被認出來，否則會走進一般錯誤路徑、回 500，而使用者重試又被擋 —— 兩頭落空。
//
// 🔴 這條同時釘住「用 errors.As 認型別，不要比對錯誤字串」：
//
//	下面 T3 是一個**訊息裡帶著同樣字眼**、但型別不同的錯誤。
//	若哪天有人改成 strings.Contains(err.Error(), "ConditionalCheckFailed")，T3 會紅。
func TestIsConditionalCheckFailed(t *testing.T) {
	t.Run("T1 直接就是那個例外", func(t *testing.T) {
		if !isConditionalCheckFailed(&types.ConditionalCheckFailedException{}) {
			t.Fatal("應該認得出 ConditionalCheckFailedException")
		}
	})

	t.Run("T2 被包起來也要認得出（SDK 會包一層）", func(t *testing.T) {
		wrapped := fmt.Errorf("operation error DynamoDB: PutItem, %w", &types.ConditionalCheckFailedException{})
		if !isConditionalCheckFailed(wrapped) {
			t.Fatal("包過一層仍應認得出 —— SDK 實際回的就是包過的")
		}
	})

	t.Run("T3 反控：訊息像但型別不同 ⇒ 不可以認成條件失敗", func(t *testing.T) {
		if isConditionalCheckFailed(errors.New("ConditionalCheckFailedException: 這是別的錯誤")) {
			t.Fatal("只有字串像就認的話，任何含這串字的錯誤都會被當成冪等命中 ⇒ 該退的不退")
		}
	})

	t.Run("T4 反控：一般錯誤", func(t *testing.T) {
		if isConditionalCheckFailed(errors.New("throughput exceeded")) {
			t.Fatal("一般錯誤不可以被當成條件失敗（那會讓真正的失敗被吞掉）")
		}
		if isConditionalCheckFailed(nil) {
			t.Fatal("nil 不是條件失敗")
		}
	})
}

// [A3-o3] 從 ALL_OLD 的 item 讀計數。
//
// 🔴 這一組釘的是**唯一**能分開「值是 0」與「根本沒這個屬性」的地方。
//
//	A3-o2 之前建立的局都沒有 `registrationCount` ⇒ 第二個回傳值答錯的話，
//	**每一個舊局取消時都會退 120 點**，而 log 印出來是「報名 0 筆 ⇒ 退款」，完全正常。
func TestRegistrationCountFromItem(t *testing.T) {
	n := func(v string) types.AttributeValue { return &types.AttributeValueMemberN{Value: v} }

	t.Run("T1 有屬性且是 0 ⇒ (0, true)", func(t *testing.T) {
		got, ok := registrationCountFromItem(map[string]types.AttributeValue{"registrationCount": n("0")})
		if got != 0 || !ok {
			t.Fatalf("期望 (0,true)，得到 (%d,%v)", got, ok)
		}
	})

	t.Run("T2 有屬性且非 0", func(t *testing.T) {
		if got, ok := registrationCountFromItem(map[string]types.AttributeValue{"registrationCount": n("3")}); got != 3 || !ok {
			t.Fatalf("期望 (3,true)，得到 (%d,%v)", got, ok)
		}
	})

	t.Run("T3 🔴 沒有這個屬性 ⇒ (0, false)，不可以是 (0, true)", func(t *testing.T) {
		got, ok := registrationCountFromItem(map[string]types.AttributeValue{"currentPlayers": n("1")})
		if ok {
			t.Fatal("舊局沒有 registrationCount ⇒ 必須回 false（fail-closed），否則每個舊局都會被退款")
		}
		if got != 0 {
			t.Fatalf("讀不到時值應為 0，得到 %d", got)
		}
	})

	t.Run("T4 反控：屬性在但型別不對（S 而非 N）⇒ false", func(t *testing.T) {
		if _, ok := registrationCountFromItem(map[string]types.AttributeValue{
			"registrationCount": &types.AttributeValueMemberS{Value: "0"},
		}); ok {
			t.Fatal("型別不對時不可以宣稱讀到了")
		}
	})

	t.Run("T5 反控：空 item / nil", func(t *testing.T) {
		if _, ok := registrationCountFromItem(map[string]types.AttributeValue{}); ok {
			t.Fatal("空 item 不可以回 true")
		}
		if _, ok := registrationCountFromItem(nil); ok {
			t.Fatal("nil item 不可以回 true")
		}
	})
}

func TestCurrentPlayersFromItem(t *testing.T) {
	n := func(v string) types.AttributeValue { return &types.AttributeValueMemberN{Value: v} }

	// 🔴 這支是姊妹函式，同樣的坑。少了它，把 currentPlayers 那支寫成「缺屬性回 true」
	//    不會有任何測試紅 —— 而 DecideCancelRefund 的 countsKnown 是兩支的合取。
	if got, ok := currentPlayersFromItem(map[string]types.AttributeValue{"currentPlayers": n("1")}); got != 1 || !ok {
		t.Fatalf("期望 (1,true)，得到 (%d,%v)", got, ok)
	}
	if _, ok := currentPlayersFromItem(map[string]types.AttributeValue{"registrationCount": n("0")}); ok {
		t.Fatal("缺 currentPlayers 屬性時必須回 false")
	}
}

// [A3-o3] refundInputsFromItem —— 這一組是為了殺掉一發**存活過的**突變而加的：
// 兩個 known 旗標的合取原本寫在 handler 裡，`&&` 改 `||` 沒有任何測試會紅。
func TestRefundInputsFromItem(t *testing.T) {
	n := func(v string) types.AttributeValue { return &types.AttributeValueMemberN{Value: v} }

	t.Run("T1 兩個都在 ⇒ known", func(t *testing.T) {
		r, c, ok := refundInputsFromItem(map[string]types.AttributeValue{
			"registrationCount": n("0"), "currentPlayers": n("1"),
		})
		if r != 0 || c != 1 || !ok {
			t.Fatalf("期望 (0,1,true)，得到 (%d,%d,%v)", r, c, ok)
		}
	})

	t.Run("T2 🔴 只有 currentPlayers（＝A3-o2 之前的舊局）⇒ 必須 unknown", func(t *testing.T) {
		// 這一格就是 `||` 突變會通過、而現實中每天都會發生的那一格。
		if _, _, ok := refundInputsFromItem(map[string]types.AttributeValue{"currentPlayers": n("1")}); ok {
			t.Fatal("舊局只有 currentPlayers ⇒ 不可以宣稱讀到了（那會讓每個舊局都被退款）")
		}
	})

	t.Run("T3 只有 registrationCount ⇒ 也必須 unknown（另一半的反控）", func(t *testing.T) {
		if _, _, ok := refundInputsFromItem(map[string]types.AttributeValue{"registrationCount": n("0")}); ok {
			t.Fatal("少了 currentPlayers 一樣判不了")
		}
	})

	t.Run("T4 兩個都沒有 ⇒ unknown", func(t *testing.T) {
		if _, _, ok := refundInputsFromItem(map[string]types.AttributeValue{}); ok {
			t.Fatal("什麼都沒有不可以回 true")
		}
	})
}
