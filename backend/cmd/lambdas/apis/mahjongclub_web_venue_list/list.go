package main

// [B1-c2c-3] 公開場地列表的**決策層**（不碰 I/O）。
//
// 這支端點是 auth:"public" —— 任何人都打得到，而它底下是 Scan。
// 兩件事因此變成承重的：**掃描上限**（成本）與**分頁終止條件**（正確性）。

import (
	"encoding/base64"
	"encoding/json"
	"errors"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// 掃描上限。
//
// 🔴 這不是「效能調校」，是公開端點的成本護欄：這支沒有 authorizer，
// 任何人都能連打，而每一次 Scan 都按掃過的量計費（不是回傳的量）。
const (
	defaultScanLimit = 50
	maxScanLimit     = 100
)

// capScanLimit 把客戶端要求的 limit 夾在合法範圍。
//
// 🔴 0 與負數走**預設值**而不是「不限」—— 若讓它變成不限，
// 一個漏傳參數的前端就會變成全表掃描，而那在小表上完全看不出來，
// 要等資料長大才會出現在帳單上。
func capScanLimit(requested int) int32 {
	if requested <= 0 {
		return defaultScanLimit
	}
	if requested > maxScanLimit {
		return maxScanLimit
	}
	return int32(requested)
}

var errBadPageToken = errors.New("分頁 token 不合法")

// encodePageToken 把 DDB 的 LastEvaluatedKey 包成可以放進 JSON 的字串。
//
// ⚠️ 這個 token 內含 venueId，那是**公開**的（它出現在每張卡片上）
// ⇒ 不需要簽章。若哪天 key schema 改成含私密欄位，這個假設就不成立，
// 屆時要改成伺服器端 cursor 而不是把 key 交給客戶端。
func encodePageToken(lastKey map[string]string) string {
	if len(lastKey) == 0 {
		return ""
	}
	b, err := json.Marshal(lastKey)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodePageToken 解回來。空字串＝第一頁。
// fail-closed：解不出來就報錯，不要當成第一頁 ——
// 靜靜從頭開始的話，客戶端會拿到重複資料而完全不知道自己的 token 壞了。
func decodePageToken(tok string) (map[string]string, error) {
	if tok == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(tok)
	if err != nil {
		return nil, errBadPageToken
	}
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, errBadPageToken
	}
	if len(m) == 0 {
		return nil, errBadPageToken
	}
	return m, nil
}

// ListPage 是一頁的結果。
type ListPage struct {
	Venues []shared.PublicVenueCard `json:"venues"`
	// NextToken 非空 ⇒ 還有下一頁。
	//
	// 🔴 **不可以用 len(Venues)==0 判斷「沒有更多了」**。DDB 的 Limit 限制的是
	// **掃描的項目數**，不是回傳的項目數；配上 FilterExpression（或像這裡在程式端
	// 篩 IsPubliclyListable），一頁完全可能回 0 筆卡片而底下還有幾百筆沒掃到。
	// 終止條件只有一個：**LastEvaluatedKey 是空的**。
	NextToken string `json:"nextToken,omitempty"`
}

// buildListPage 把掃到的 venue 轉成公開卡片。
//
// lastKey 直接來自 DDB 的 LastEvaluatedKey（空 map ⇒ 掃完了）。
func buildListPage(scanned []shared.Venue, lastKey map[string]string, nowUnix int64) ListPage {
	cards := make([]shared.PublicVenueCard, 0, len(scanned))
	for i := range scanned {
		v := &scanned[i]
		// 🔴 篩選走 shared 那個**單一判斷點**，不要在這裡另外寫一次條件。
		if !shared.IsPubliclyListable(v) {
			continue
		}
		cards = append(cards, shared.NewPublicVenueCard(v, nowUnix))
	}
	return ListPage{Venues: cards, NextToken: encodePageToken(lastKey)}
}
