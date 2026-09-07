package main

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// [A3-m] 界線先寫：這一批釘的是「SET 子句怎麼組」與「條件失敗後說什麼、回幾號」。
// DynamoDB 會不會真的擋下來、巢狀路徑會不會真的寫進 gameInfo.rules，
// **要真的 DynamoDB 才驗得到，這裡一條都沒有**。

func sp(v ...string) *[]string { s := append([]string{}, v...); return &s }

func TestBuildGameUpdate_白名單以外的欄位進不來(t *testing.T) {
	// 這條是整支端點的安全前提：第二段只能改補充設定，
	// 不能碰 status／hostUserId／currentPlayers —— 那三個是 A3-o1/o2/o3 鎖住的東西。
	expr, names, _ := buildGameUpdate(UpdateGameRequest{
		GameID: "g1", Rules: sp("a"), Features: sp("b"), Restrictions: sp("c"), Images: sp("d"),
	}, "NOW")

	for _, forbidden := range []string{"status", "hostUserId", "currentPlayers", "registrationCount", "playersNeeded", "joinedPlayers"} {
		for ref, actual := range names {
			if actual == forbidden {
				t.Fatalf("白名單破了：%s 對到了 %s（%q）", ref, forbidden, expr)
			}
		}
		if strings.Contains(expr, forbidden) {
			t.Fatalf("運算式裡出現 %s：%q", forbidden, expr)
		}
	}
	// 反控：白名單**內**的東西確實進得來（否則上面那圈在空的 names 上也會綠）
	got := map[string]bool{}
	for _, v := range names {
		got[v] = true
	}
	for _, want := range []string{"gameInfo", "rules", "venueFeatures", "restrictions", "images"} {
		if !got[want] {
			t.Fatalf("白名單內的 %s 沒有出現在 names：%v", want, names)
		}
	}
}

// 🔴 這條直接打在 updatableFields 這張表上，不經過 request struct。
// 理由是一發突變照出來的：我原本只驗「組出來的運算式沒有 status」，
// 而那條對「白名單表多一筆」**零鑑別力** —— 因為擋住它的其實是 request struct
// 只有四個欄位，不是這張表。表與 struct 是兩層，各自要有尺。
// （少了這條，有人日後加一個 `"notes": "status"` 的對應，測試全綠。）
func TestUpdatableFields_沒有任何一筆指向受保護的欄位(t *testing.T) {
	forbidden := map[string]bool{
		"status": true, "hostUserId": true, "currentPlayers": true,
		"registrationCount": true, "playersNeeded": true, "joinedPlayers": true,
		"gameId": true, "createdAt": true,
	}
	if len(updatableFields) == 0 {
		t.Fatal("白名單是空的 ⇒ 上面那圈檢查會恆綠")
	}
	for field, path := range updatableFields {
		for _, seg := range strings.Split(path, ".") {
			if forbidden[seg] {
				t.Fatalf("白名單的 %q 指向受保護的屬性 %q（完整路徑 %q）", field, seg, path)
			}
		}
	}
}

func TestBuildGameUpdate_沒送任何欄位回空字串(t *testing.T) {
	// DynamoDB 對空的 UpdateExpression 是 ValidationException ⇒ 會變成 500，
	// 而那其實是呼叫端沒送東西。這條釘住「呼叫端擋得下來」的那個訊號。
	expr, _, values := buildGameUpdate(UpdateGameRequest{GameID: "g1"}, "NOW")
	if expr != "" {
		t.Fatalf("一個欄位都沒送時應該回空字串，得到 %q", expr)
	}
	if _, ok := values[":now"]; ok {
		t.Fatal("沒有東西要寫的時候不可以宣告 :now —— 那會變成一個沒用到的佔位符")
	}
}

func TestBuildGameUpdate_空陣列與沒送是兩件事(t *testing.T) {
	// 🔴 使用者把規則刪光 ⇒ 送 []。若把它當成「沒送」，那一項就永遠清不掉，
	// 而症狀是「我刪掉了但它還在」—— 使用者只會覺得存檔壞了。
	expr, _, values := buildGameUpdate(UpdateGameRequest{GameID: "g1", Rules: sp()}, "NOW")
	if expr == "" {
		t.Fatal("送空陣列是「清空」，不是「沒送」")
	}
	l, ok := values[":f0"].(*types.AttributeValueMemberL)
	if !ok || len(l.Value) != 0 {
		t.Fatalf("清空應該寫入空 list，得到 %#v", values[":f0"])
	}

	expr2, _, _ := buildGameUpdate(UpdateGameRequest{GameID: "g1"}, "NOW")
	if expr2 == expr {
		t.Fatal("「送空陣列」與「沒送」組出來的運算式相同 ⇒ 這個區別根本沒有被表示出來")
	}
}

func TestBuildGameUpdate_巢狀路徑逐段換成name(t *testing.T) {
	// gameInfo.rules 整串當一個名字的話，DynamoDB 會把它當成**含點的屬性名**，
	// 於是在頂層寫出一個叫 "gameInfo.rules" 的新欄位 —— 寫入會成功，
	// 而畫面上規則完全沒變。這種失敗不會有任何錯誤訊息。
	expr, names, _ := buildGameUpdate(UpdateGameRequest{GameID: "g1", Rules: sp("x")}, "NOW")
	if strings.Contains(expr, "gameInfo.rules") {
		t.Fatalf("巢狀路徑沒有換成 name placeholder：%q", expr)
	}
	if !regexp.MustCompile(`#f\d+_0\.#f\d+_1 = :f\d+`).MatchString(expr) {
		t.Fatalf("巢狀路徑應該長成 #a.#b = :v，得到 %q", expr)
	}
	joined := []string{}
	for _, v := range names {
		joined = append(joined, v)
	}
	sort.Strings(joined)
	if strings.Join(joined, ",") != "gameInfo,rules" {
		t.Fatalf("names 應該正好是 gameInfo 與 rules 兩段，得到 %v", joined)
	}
}

func TestBuildGameUpdate_輸出有決定性(t *testing.T) {
	// map 走訪在 Go 是隨機的。不排序的話同一個輸入每次組出不同字串，
	// 之後任何「運算式應該長怎樣」的斷言都只能鬆到失去鑑別力。
	req := UpdateGameRequest{GameID: "g1", Rules: sp("a"), Images: sp("b"), Features: sp("c")}
	first, _, _ := buildGameUpdate(req, "NOW")
	for i := 0; i < 30; i++ {
		got, _, _ := buildGameUpdate(req, "NOW")
		if got != first {
			t.Fatalf("第 %d 次組出不同的運算式：\n%q\n%q", i, first, got)
		}
	}
}

var phRe = regexp.MustCompile(`:[A-Za-z][A-Za-z0-9_]*`)
var nmRe = regexp.MustCompile(`#[A-Za-z0-9_]+`)

// 宣告了卻沒用到的佔位符 ⇒ DynamoDB 直接 ValidationException。
// 那是這支端點完全沒有整合測試的那一側，只在真的送出時才炸。
func TestBuildGameUpdate_佔位符兩邊對得起來(t *testing.T) {
	cases := []UpdateGameRequest{
		{GameID: "g", Rules: sp("a")},
		{GameID: "g", Images: sp()},
		{GameID: "g", Rules: sp("a"), Features: sp("b")},
		{GameID: "g", Rules: sp("a"), Features: sp("b"), Restrictions: sp("c"), Images: sp("d")},
	}
	for i, req := range cases {
		expr, names, values := buildGameUpdate(req, "NOW")
		// handler 會再補這幾個（條件式用的），比照辦理
		full := expr + " attribute_exists(gameId) AND hostUserId = :uid AND (#s = :recruiting OR #s = :full)"
		names["#s"] = "status"
		values[":uid"] = &types.AttributeValueMemberS{Value: "u"}
		values[":recruiting"] = &types.AttributeValueMemberS{Value: "recruiting"}
		values[":full"] = &types.AttributeValueMemberS{Value: "full"}

		if strings.Join(uniqSorted(phRe.FindAllString(full, -1)), ",") != strings.Join(uniqSorted(keysOfAV(values)), ",") {
			t.Fatalf("case %d 值佔位符對不上：用了 %v，宣告了 %v", i, uniqSorted(phRe.FindAllString(full, -1)), uniqSorted(keysOfAV(values)))
		}
		if strings.Join(uniqSorted(nmRe.FindAllString(full, -1)), ",") != strings.Join(uniqSorted(keysOfS(names)), ",") {
			t.Fatalf("case %d 名稱對不上：用了 %v，宣告了 %v", i, uniqSorted(nmRe.FindAllString(full, -1)), uniqSorted(keysOfS(names)))
		}
	}
}

func uniqSorted(in []string) []string {
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
func keysOfAV(m map[string]types.AttributeValue) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}
func keysOfS(m map[string]string) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}

func item(kv map[string]string) map[string]types.AttributeValue {
	out := map[string]types.AttributeValue{}
	for k, v := range kv {
		out[k] = &types.AttributeValueMemberS{Value: v}
	}
	return out
}

func TestDecideUpdateConflict(t *testing.T) {
	// 🔴 這條是順序本身：先分「不是你的局」，再分狀態。
	// 反過來的話，別人的已取消團局會回「此團局已取消」——
	// 那等於對外確認了一個不屬於你的 gameId 存在。
	t.Run("別人的局(且已取消) ⇒ 只能講不是主揪，不可以洩漏它的狀態", func(t *testing.T) {
		msg, code := decideUpdateConflict(item(map[string]string{"hostUserId": "OTHER", "status": "cancelled"}), "ME")
		if msg != msgNotHost || code != http.StatusForbidden {
			t.Fatalf("應該是 403「%s」，得到 %q/%d", msgNotHost, msg, code)
		}
	})

	t.Run("自己的局已取消 ⇒ 講取消", func(t *testing.T) {
		msg, code := decideUpdateConflict(item(map[string]string{"hostUserId": "ME", "status": "cancelled"}), "ME")
		if msg != msgGameCancel || code != http.StatusBadRequest {
			t.Fatalf("應該是 400「%s」，得到 %q/%d", msgGameCancel, msg, code)
		}
	})

	t.Run("自己的局但狀態不在白名單(closed/completed/空) ⇒ 講無法修改", func(t *testing.T) {
		for _, st := range []string{"closed", "completed", "", "weird"} {
			msg, code := decideUpdateConflict(item(map[string]string{"hostUserId": "ME", "status": st}), "ME")
			if msg != msgGameNotOpen || code != http.StatusBadRequest {
				t.Fatalf("status=%q 應該是「%s」，得到 %q/%d", st, msgGameNotOpen, msg, code)
			}
		}
	})

	t.Run("自己的局、狀態也還開著 ⇒ 只能講狀態變動（不可以猜）", func(t *testing.T) {
		for _, st := range []string{"recruiting", "full"} {
			msg, code := decideUpdateConflict(item(map[string]string{"hostUserId": "ME", "status": st}), "ME")
			if msg != msgGameChanged || code != http.StatusBadRequest {
				t.Fatalf("status=%q 應該是「%s」，得到 %q/%d", st, msgGameChanged, msg, code)
			}
		}
	})

	t.Run("ALL_OLD 沒回東西 ⇒ 含糊那句，不是猜的那句", func(t *testing.T) {
		msg, code := decideUpdateConflict(nil, "ME")
		if msg != msgGameChanged || code != http.StatusBadRequest {
			t.Fatalf("應該是「%s」，得到 %q/%d", msgGameChanged, msg, code)
		}
	})

	t.Run("反控：hostUserId 欄位缺失不可以被讀成「就是你」", func(t *testing.T) {
		msg, code := decideUpdateConflict(item(map[string]string{"status": "recruiting"}), "ME")
		if msg != msgNotHost || code != http.StatusForbidden {
			t.Fatalf("缺 hostUserId 要 fail-closed 成 403，得到 %q/%d", msg, code)
		}
	})

	t.Run("反控：空字串使用者不可以配上空的 hostUserId 就放行", func(t *testing.T) {
		// userID 為空時 handler 早就回 401 了；但這支自己也不該把「兩邊都空」當成相等。
		msg, _ := decideUpdateConflict(item(map[string]string{"status": "recruiting"}), "")
		if msg == msgGameChanged {
			t.Fatal("空 uid 對上缺失的 hostUserId 被判成主揪 ⇒ 這是 fail-open")
		}
	})
}
