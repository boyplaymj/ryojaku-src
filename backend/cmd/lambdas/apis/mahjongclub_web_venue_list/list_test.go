package main

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// 🔴 界線：這一批只驗決策層。DDB Scan 真的回什麼、Limit 的實際計費、
// authorizer 有沒有正確地「沒掛」，一條都沒驗到。

func hall(id string) shared.Venue {
	return shared.Venue{VenueID: id, Type: shared.VenueTypeHall, Name: "館" + id,
		Status: shared.VenueStatusActive, ExactAddress: "台北市某路9號", OwnerID: "U1"}
}

// --- 掃描上限（公開端點的成本護欄）---

func TestCapScanLimit(t *testing.T) {
	if got := capScanLimit(20); got != 20 {
		t.Fatalf("合法值應該原樣通過，得到 %d", got)
	}
	if got := capScanLimit(maxScanLimit + 1); got != maxScanLimit {
		t.Fatalf("超過上限應該夾到 %d，得到 %d", maxScanLimit, got)
	}
	if got := capScanLimit(999999); got != maxScanLimit {
		t.Fatalf("極大值應該夾到 %d，得到 %d", maxScanLimit, got)
	}
	// 🔴 承重：0／負數走**預設值**，不是「不限」。
	// 若變成不限，一個漏傳參數的前端就是全表掃描 —— 而那在小表上完全看不出來，
	// 要等資料長大才會出現在帳單上。
	for _, bad := range []int{0, -1, -999} {
		if got := capScanLimit(bad); got != defaultScanLimit {
			t.Fatalf("limit=%d 應該回預設值 %d，得到 %d", bad, defaultScanLimit, got)
		}
	}
	// 反控：預設值與上限不可以相等，否則上面那組斷言有一半自動成立。
	if defaultScanLimit == maxScanLimit {
		t.Fatal("預設值與上限相同 ⇒ 分不出「夾到上限」與「退回預設」")
	}
}

// --- 分頁 ---

func TestPageToken_RoundTrip(t *testing.T) {
	in := map[string]string{"venueId": "V-123"}
	tok := encodePageToken(in)
	if tok == "" {
		t.Fatal("非空 key 應該編得出 token")
	}
	got, err := decodePageToken(tok)
	if err != nil {
		t.Fatal(err)
	}
	if got["venueId"] != "V-123" {
		t.Fatalf("往返之後變成 %v", got)
	}
	// 空 key ⇒ 空 token（＝掃完了）
	if encodePageToken(nil) != "" || encodePageToken(map[string]string{}) != "" {
		t.Fatal("空 key 應該回空 token")
	}
	// 空 token ⇒ 第一頁，不是錯誤
	m, err := decodePageToken("")
	if err != nil || m != nil {
		t.Fatalf("空 token 應該是 (nil, nil)，得到 (%v, %v)", m, err)
	}
}

// 🔴 壞掉的 token 要報錯，不可以靜靜當成第一頁 ——
// 那樣客戶端會拿到重複資料而完全不知道自己的 token 壞了。
func TestPageToken_BadTokenFailsLoudly(t *testing.T) {
	for _, bad := range []string{"!!!not-base64!!!", "eyJ9", "e30", "bnVsbA"} {
		if _, err := decodePageToken(bad); !errors.Is(err, errBadPageToken) {
			t.Errorf("token=%q 應該報 errBadPageToken，得到 %v", bad, err)
		}
	}
}

// --- 這一支最重要的那條 ---

// 🔴 **一頁回 0 筆卡片，不代表沒有下一頁。**
// DDB 的 Limit 限制的是「掃描的項目數」不是「回傳的項目數」；一整頁都被
// IsPubliclyListable 篩掉時，Venues 是空的而底下還有幾百筆沒掃到。
// 終止條件只有一個：LastEvaluatedKey 是空的。
func TestBuildListPage_EmptyPageStillHasNextToken(t *testing.T) {
	// 整頁都是自建場（永遠不進公開列表）
	scanned := []shared.Venue{
		{VenueID: "H1", Type: shared.VenueTypeHome, Status: shared.VenueStatusActive},
		{VenueID: "H2", Type: shared.VenueTypeHome, Status: shared.VenueStatusActive},
	}
	page := buildListPage(scanned, map[string]string{"venueId": "H2"}, 1000)
	if len(page.Venues) != 0 {
		t.Fatalf("自建場不該出現在公開列表，得到 %d 筆", len(page.Venues))
	}
	if page.NextToken == "" {
		t.Fatal("🔴 回 0 筆但還有 LastEvaluatedKey ⇒ 必須給 nextToken，否則客戶端會以為掃完了")
	}
	// 正控（方向相反）：真的掃完時不可以給 nextToken，否則客戶端永遠停不下來。
	done := buildListPage(scanned, nil, 1000)
	if done.NextToken != "" {
		t.Fatal("LastEvaluatedKey 為空時不該給 nextToken —— 客戶端會無限翻頁")
	}
}

// 篩選走 shared 的單一判斷點，且輸出是白名單型別。
func TestBuildListPage_FiltersAndNeverLeaks(t *testing.T) {
	scanned := []shared.Venue{
		hall("A"),
		{VenueID: "P", Type: shared.VenueTypeHall, Status: shared.VenueStatusPending,
			ExactAddress: "台北市某路9號"}, // 未審核
		{VenueID: "H", Type: shared.VenueTypeHome, Status: shared.VenueStatusActive,
			ExactAddress: "台北市某路9號"}, // 自建場
	}
	page := buildListPage(scanned, nil, 1000)
	if len(page.Venues) != 1 || page.Venues[0].VenueID != "A" {
		t.Fatalf("只有 active 的 hall 該出現，得到 %+v", page.Venues)
	}
	b, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "台北市某路9號") {
		t.Fatalf("列表洩漏精確地址：%s", b)
	}
	// 正控：公開資訊要在，否則上一條可能只是「整個空的」。
	if !strings.Contains(string(b), "館A") {
		t.Fatalf("正控失敗：連店名都沒有：%s", b)
	}
}
