package main

import (
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// [A3-o1] 這一批釘的是「送出去的請求長什麼樣」與「收到取消原因後怎麼說話」。
//
// 🔴 界線寫在最前面，免得被引用成別的東西：交易本身、ConditionExpression 會不會真的
// 擋下來、ALL_OLD 回什麼，**都要真的 DynamoDB 才驗得到，這裡一條都沒有**。
// 這些測試能保證的是：條件確實被寫進請求、兩格沒有對調、佔位符對得起來、
// 以及擋下來之後那句話是依什麼決定的。

func newPlayerAV() map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"userId": &types.AttributeValueMemberS{Value: "APP_x"},
	}
}

func baseWrite() acceptWrite {
	return acceptWrite{
		RegistrationID:  "reg-1",
		GameID:          "game-1",
		NewPlayer:       newPlayerAV(),
		ExpectedPlayers: 1,
		Capacity:        4,
		Now:             "2026-09-07T00:00:00Z",
	}
}

// T1 釘住「第 0 格是報名列、第 1 格是團局」這條約定。decideAcceptConflict 全靠索引認人：
// 兩格對調的話，「團局已取消」與「此報名已經接受過了」會整個互換，而**兩句都是合法的
// 中文**⇒ 沒有這條，對調完全沒有徵兆。
//
// 🔴 這裡刻意寫**字面的 0 / 1**，不用 txIdx* 常數。用常數的話這條測試會被它要驗的東西
// 致盲：buildAcceptTransactItems 也是拿同一組常數當索引在組陣列，兩邊一起翻面就永遠相符。
// 這不是推理出來的 —— 第一版就是寫常數，把常數對調的那發突變**存活**（只有
// TestDecideAcceptConflict 紅，而那批的假件是字面順序），才照出這條是同義反覆。
func TestBuildAcceptTransactItems_格子順序即索引(t *testing.T) {
	items := buildAcceptTransactItems("P_Registrations", "P_Games", baseWrite())

	if len(items) != 2 {
		t.Fatalf("交易應該正好兩格，得到 %d", len(items))
	}
	if got := *items[0].Update.TableName; got != "P_Registrations" {
		t.Fatalf("第 0 格必須打在報名表，得到 %s", got)
	}
	if got := *items[1].Update.TableName; got != "P_Games" {
		t.Fatalf("第 1 格必須打在團局表，得到 %s", got)
	}
	if txIdxRegistration != 0 || txIdxGame != 1 {
		t.Fatalf("常數必須對得上實際順序：txIdxRegistration=%d txIdxGame=%d", txIdxRegistration, txIdxGame)
	}
	if got := items[1].Update.Key["gameId"].(*types.AttributeValueMemberS).Value; got != "game-1" {
		t.Fatalf("團局那一格的 key 不對：%s", got)
	}
	if got := items[0].Update.Key["registrationId"].(*types.AttributeValueMemberS).Value; got != "reg-1" {
		t.Fatalf("報名那一格的 key 不對：%s", got)
	}
}

// T2 條件式本身。這是 ③ 的核心：沒有 `#s = :recruiting` 這一段，
// 這支端點就會像以前那樣把 cancelled 的局寫回去。
func TestBuildAcceptTransactItems_條件擋住非招募中的局(t *testing.T) {
	items := buildAcceptTransactItems("R", "G", baseWrite())

	gameCond := *items[txIdxGame].Update.ConditionExpression
	if !strings.Contains(gameCond, "#s = :recruiting") {
		t.Fatalf("團局的條件必須要求 status = recruiting，得到 %q", gameCond)
	}
	if !strings.Contains(gameCond, "currentPlayers = :expected") {
		t.Fatalf("團局的條件必須帶樂觀鎖（currentPlayers 相等），得到 %q", gameCond)
	}
	if items[txIdxGame].Update.ExpressionAttributeNames["#s"] != "status" {
		t.Fatal("#s 必須對到 status")
	}
	if got := *items[txIdxRegistration].Update.ConditionExpression; got != "#s = :pending" {
		t.Fatalf("報名的條件必須是 pending（accepted/rejected 都不可再改一次），得到 %q", got)
	}
	for _, idx := range []int{txIdxRegistration, txIdxGame} {
		if items[idx].Update.ReturnValuesOnConditionCheckFailure != types.ReturnValuesOnConditionCheckFailureAllOld {
			t.Fatalf("第 %d 格少了 ALL_OLD ⇒ 擋下來時說不出是哪一種，只能給含糊的那句話", idx)
		}
	}
}

// T3 這支端點**永遠不會**把 status 寫成 recruiting —— 那正是它以前復活已取消團局的手法。
func TestBuildAcceptTransactItems_只在填滿時寫full且從不寫recruiting(t *testing.T) {
	t.Run("還沒滿 ⇒ 完全不碰 status", func(t *testing.T) {
		w := baseWrite() // 1 + 1 < 4
		expr := *buildAcceptTransactItems("R", "G", w)[txIdxGame].Update.UpdateExpression
		if strings.Contains(expr, "#s") {
			t.Fatalf("還沒滿就不該動 status，得到 %q", expr)
		}
	})

	t.Run("這一筆剛好填滿 ⇒ 寫 full", func(t *testing.T) {
		w := baseWrite()
		w.ExpectedPlayers = 3 // 3 + 1 == Capacity 4
		expr := *buildAcceptTransactItems("R", "G", w)[txIdxGame].Update.UpdateExpression
		if !strings.Contains(expr, "#s = :full") {
			t.Fatalf("填滿時要寫 full，得到 %q", expr)
		}
	})

	t.Run("反控：任何情況都不可以寫 recruiting", func(t *testing.T) {
		for _, cur := range []int{0, 1, 2, 3, 4, 5} {
			w := baseWrite()
			w.ExpectedPlayers = cur
			g := buildAcceptTransactItems("R", "G", w)[txIdxGame].Update
			expr := *g.UpdateExpression
			setPart := expr
			if i := strings.Index(expr, " ADD "); i >= 0 {
				setPart = expr[:i]
			}
			if strings.Contains(setPart, ":recruiting") {
				t.Fatalf("currentPlayers=%d：SET 子句碰到 :recruiting ⇒ 這支又會復活已取消的局（%q）", cur, expr)
			}
			if n := strings.Count(expr, "#s"); n > 1 {
				t.Fatalf("currentPlayers=%d：status 被寫了不只一次（%q）", cur, expr)
			}
		}
	})

	t.Run("人數一律寫成讀到的值 +1", func(t *testing.T) {
		w := baseWrite()
		w.ExpectedPlayers = 2
		g := buildAcceptTransactItems("R", "G", w)[txIdxGame].Update
		if got := g.ExpressionAttributeValues[":next"].(*types.AttributeValueMemberN).Value; got != "3" {
			t.Fatalf(":next 應該是 3，得到 %s", got)
		}
		if got := g.ExpressionAttributeValues[":expected"].(*types.AttributeValueMemberN).Value; got != "2" {
			t.Fatalf(":expected 應該是讀到的 2，得到 %s", got)
		}
	})
}

var placeholderRe = regexp.MustCompile(`:[A-Za-z][A-Za-z0-9_]*`)
var nameRe = regexp.MustCompile(`#[A-Za-z][A-Za-z0-9_]*`)

// T4 佔位符對帳。DynamoDB 對「宣告了卻沒用到的 ExpressionAttributeValues」是**直接
// ValidationException**，整筆交易掛掉；而那是本檔完全沒有整合測試的那一側 ——
// 只在真的送出去時才會炸。這條是我在沒有真 DynamoDB 的情況下唯一擋得住它的東西。
func TestBuildAcceptTransactItems_佔位符兩邊對得起來(t *testing.T) {
	for _, cur := range []int{0, 1, 2, 3} { // 涵蓋「有 :full」與「沒有 :full」兩種形狀
		w := baseWrite()
		w.ExpectedPlayers = cur
		for _, idx := range []int{txIdxRegistration, txIdxGame} {
			u := buildAcceptTransactItems("R", "G", w)[idx].Update
			expr := *u.UpdateExpression + " " + *u.ConditionExpression

			used := uniqueSorted(placeholderRe.FindAllString(expr, -1))
			declared := []string{}
			for k := range u.ExpressionAttributeValues {
				declared = append(declared, k)
			}
			declared = uniqueSorted(declared)
			if strings.Join(used, ",") != strings.Join(declared, ",") {
				t.Fatalf("cur=%d 第 %d 格佔位符對不上：運算式用了 %v，宣告了 %v", cur, idx, used, declared)
			}

			usedNames := uniqueSorted(nameRe.FindAllString(expr, -1))
			declaredNames := []string{}
			for k := range u.ExpressionAttributeNames {
				declaredNames = append(declaredNames, k)
			}
			declaredNames = uniqueSorted(declaredNames)
			if strings.Join(usedNames, ",") != strings.Join(declaredNames, ",") {
				t.Fatalf("cur=%d 第 %d 格名稱對不上：運算式用了 %v，宣告了 %v", cur, idx, usedNames, declaredNames)
			}
		}
	}
}

func uniqueSorted(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

func reason(code string, item map[string]types.AttributeValue) types.CancellationReason {
	c := code
	return types.CancellationReason{Code: &c, Item: item}
}

func gameItem(status string, cur, needed int) map[string]types.AttributeValue {
	it := map[string]types.AttributeValue{
		"status":         &types.AttributeValueMemberS{Value: status},
		"currentPlayers": &types.AttributeValueMemberN{Value: itoa(cur)},
		"playersNeeded":  &types.AttributeValueMemberN{Value: itoa(needed)},
	}
	return it
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	b := []byte{}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}

func TestDecideAcceptConflict(t *testing.T) {
	// 🔴 這條是整批裡最重要的一條：只有它分得出「條件沒過」與「伺服器端出事」。
	// 少了它，ProvisionedThroughputExceeded 會被回成 400「請重新整理」——
	// 對使用者說謊，而且真正的失敗會消失在那句話裡。
	t.Run("反控：不是條件失敗 ⇒ 不給訊息（讓呼叫端回 500）", func(t *testing.T) {
		for _, code := range []string{"None", "TransactionConflict", "ProvisionedThroughputExceeded", "ThrottlingError"} {
			if msg, ok := decideAcceptConflict([]types.CancellationReason{reason("None", nil), reason(code, nil)}); ok {
				t.Fatalf("code=%s 不是條件失敗，卻回了 %q", code, msg)
			}
		}
	})

	// 索引越界不可以 panic，也不可以把「不存在的那一格」讀成失敗。
	// ⚠️ 只有一格時走到的是報名那格（索引 0 就是它），回它的答案是對的 ——
	// 這條釘的是「不 panic、不無中生有」，不是「短陣列要沉默」。
	t.Run("反控：沒有取消原因 ⇒ 不給訊息；短陣列不 panic", func(t *testing.T) {
		if _, ok := decideAcceptConflict(nil); ok {
			t.Fatal("nil 不該被當成條件失敗")
		}
		if _, ok := decideAcceptConflict([]types.CancellationReason{}); ok {
			t.Fatal("空陣列不該被當成條件失敗")
		}
		if _, ok := decideAcceptConflict([]types.CancellationReason{reason("None", nil)}); ok {
			t.Fatal("唯一那格是 None ⇒ 不是條件失敗")
		}
		msg, ok := decideAcceptConflict([]types.CancellationReason{reason("ConditionalCheckFailed", nil)})
		if !ok || msg != msgRegStatusChanged {
			t.Fatalf("只有一格時應該答報名那格（索引 0），得到 %q (ok=%v)", msg, ok)
		}
	})

	t.Run("團局被取消 ⇒ 講取消", func(t *testing.T) {
		msg, ok := decideAcceptConflict([]types.CancellationReason{
			reason("None", nil),
			reason("ConditionalCheckFailed", gameItem("cancelled", 1, 3)),
		})
		if !ok || msg != msgGameCancelled {
			t.Fatalf("應該是「%s」，得到 %q (ok=%v)", msgGameCancelled, msg, ok)
		}
	})

	t.Run("局還在招募但人數對不上且已達上限 ⇒ 講滿了", func(t *testing.T) {
		msg, ok := decideAcceptConflict([]types.CancellationReason{
			reason("None", nil),
			reason("ConditionalCheckFailed", gameItem("recruiting", 4, 3)), // 4 >= 3+1
		})
		if !ok || msg != msgGameFull {
			t.Fatalf("應該是「%s」，得到 %q", msgGameFull, msg)
		}
	})

	t.Run("局還在招募、也還沒滿 ⇒ 只能講狀態變動（不可以猜一個具體理由）", func(t *testing.T) {
		msg, ok := decideAcceptConflict([]types.CancellationReason{
			reason("None", nil),
			reason("ConditionalCheckFailed", gameItem("recruiting", 2, 3)),
		})
		if !ok || msg != msgGameChanged {
			t.Fatalf("應該是「%s」，得到 %q", msgGameChanged, msg)
		}
	})

	t.Run("ALL_OLD 沒回東西 ⇒ 含糊那句，不是猜的那句", func(t *testing.T) {
		msg, ok := decideAcceptConflict([]types.CancellationReason{
			reason("None", nil),
			reason("ConditionalCheckFailed", nil),
		})
		if !ok || msg != msgGameChanged {
			t.Fatalf("應該是「%s」，得到 %q", msgGameChanged, msg)
		}
	})

	t.Run("報名已處理過 ⇒ 依它當時的狀態講話", func(t *testing.T) {
		cases := map[string]string{
			"accepted": msgRegAccepted,
			"rejected": msgRegRejected,
			"weird":    msgRegStatusChanged,
			"":         msgRegStatusChanged,
		}
		for status, want := range cases {
			item := map[string]types.AttributeValue{}
			if status != "" {
				item["status"] = &types.AttributeValueMemberS{Value: status}
			}
			msg, ok := decideAcceptConflict([]types.CancellationReason{
				reason("ConditionalCheckFailed", item),
				reason("None", nil),
			})
			if !ok || msg != want {
				t.Fatalf("status=%q 應該是「%s」，得到 %q", status, want, msg)
			}
		}
	})

	// 兩格同時失敗（重複點擊剛好撞上取消）。團局那格答得出「為什麼」，
	// 報名那格只答得出「已處理過」—— 後者會把主揪引去查錯的東西。
	t.Run("兩格都失敗 ⇒ 團局那格優先", func(t *testing.T) {
		msg, ok := decideAcceptConflict([]types.CancellationReason{
			reason("ConditionalCheckFailed", map[string]types.AttributeValue{
				"status": &types.AttributeValueMemberS{Value: "accepted"},
			}),
			reason("ConditionalCheckFailed", gameItem("cancelled", 1, 3)),
		})
		if !ok || msg != msgGameCancelled {
			t.Fatalf("應該優先講「%s」，得到 %q", msgGameCancelled, msg)
		}
	})
}

// gameNotRecruitingMessage 被兩條路徑共用（讀出來先擋的那道／條件失敗後的那道），
// 所以它自己要有尺。
func TestGameNotRecruitingMessage(t *testing.T) {
	if got := gameNotRecruitingMessage("cancelled"); got != msgGameCancelled {
		t.Fatalf("cancelled 應該講取消，得到 %q", got)
	}
	for _, s := range []string{"full", "completed", "", "recruiting"} {
		if got := gameNotRecruitingMessage(s); got != msgGameNotOpen {
			t.Fatalf("status=%q 應該講「%s」，得到 %q", s, msgGameNotOpen, got)
		}
	}
}
