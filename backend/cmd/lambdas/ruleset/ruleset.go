// Package ruleset 是「後台那一列家規表」的**契約**——只有這一份。
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5a／§5c。
//
// 🔴 這個套件存在的理由，是 D5-e 需要第二個讀取端（後台唯讀檢視頁）。
// 兩支 lambda 各寫一份「這一列合不合法」的話，兩份會漂 —— 而漂掉之後，
// 後台頁會說「這一列沒問題」而 App 端拿到的是 502，**兩邊都不會報錯**。
// ⇒ 判準只有一份，兩支 lambda 都 import 它。
// （這正是 mahjongclub_admin_voice_corrections 檔頭那段「不要把飛輪邏輯重寫一份」
// 的同一條理由，只是那次的兩份實作跨語言、沒辦法共用，這次可以。）
package ruleset

import (
	"encoding/json"
	"errors"
)

// InfoKey 是 <TABLE_PREFIX>AdminConfigs 裡承載這份表的那一列的 hash key。
//
// 🔴 一列不是三列：fans／combos／ignores 合成一份 JSON ⇒「表下發了、略過詞沒有」
// 那個失效模式（§0.2 的 bug 根因）在**載體形狀上**就不存在。
const InfoKey = "VoiceTai:Ruleset"

// TableSuffix：表名是 <TABLE_PREFIX> + 這個。
const TableSuffix = "AdminConfigs"

// payload 是 info_value 的形狀。四個表鍵用 json.RawMessage 承接：
// 🔴 原封不動轉出去，不重新塑形、不挑鍵。
// json.RawMessage 同時讓「鍵缺席」（nil）與「鍵存在但值是 null」（"null"）
// 與「空陣列」（"[]"）三者在解析後仍然分得開。
type payload struct {
	Version *string         `json:"version"`
	Fans    json.RawMessage `json:"fans"`
	Combos  json.RawMessage `json:"combos"`
	Ignores json.RawMessage `json:"ignores"`
	Config  json.RawMessage `json:"config"`
}

// Response 是 GET /ruleset 的 200 形狀。
// ⚠️ 後台端（GET /admin/voice-tai/ruleset）**不回傳這個結構**，它回的是
// 「那一列的事實」；共用的是下面的 Parse，不是回應形狀。
type Response struct {
	Success bool            `json:"success"`
	Version string          `json:"version"`
	Fans    json.RawMessage `json:"fans"`
	Combos  json.RawMessage `json:"combos"`
	Ignores json.RawMessage `json:"ignores"`
	Config  json.RawMessage `json:"config"`
}

// IsAbsentOrNull：鍵缺席（RawMessage 為 nil）或值為 JSON null。
// 🔴 `[]`／`{}` 都不算 —— 「空」與「沒有」在這裡是兩件事。
func IsAbsentOrNull(raw json.RawMessage) bool {
	return raw == nil || string(raw) == "null"
}

// Parse 把 info_value 解析成下發回應；純函式，不碰網路。
// 任何一種缺損都回 error（下發端一律 502），不會回半份表。
//
// 🔴 錯誤訊息會指名**是哪一鍵**壞了。這不是文案：
//   - 下發端的測試用 assert502Because 斷言「502 的原因是哪一鍵」，
//     少了它，檢查順序一改（一個很合理的重構）就會讓一批 fixture
//     因為另一個原因而 502，而狀態碼逐字相同（M7 那發突變）。
//   - 後台頁把這句話原樣顯示出來 —— 「那一列壞了」對運維沒有用，
//     「壞在 ignores 這一鍵」才有。
//
// 🔴 界線：不看 config 裡面有什麼，`config: {}` 是合法的。
// 唯一有計分作用的欄位是 config.base_di，而 scoring.js:165
// `if (cfg.base_di) total += cfg.base_di` 讓「缺席」與「0」逐值相同
// ⇒ 缺席是「這家沒有底」的合法表示法，不是遺失。
func Parse(raw string) (Response, error) {
	var p payload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return Response{}, err
	}
	if p.Version == nil || *p.Version == "" {
		return Response{}, errors.New("ruleset version missing or empty")
	}
	if IsAbsentOrNull(p.Fans) {
		return Response{}, errors.New("ruleset fans missing")
	}
	if IsAbsentOrNull(p.Combos) {
		return Response{}, errors.New("ruleset combos missing")
	}
	if IsAbsentOrNull(p.Ignores) {
		return Response{}, errors.New("ruleset ignores missing")
	}
	if IsAbsentOrNull(p.Config) {
		return Response{}, errors.New("ruleset config missing")
	}
	return Response{
		Success: true,
		Version: *p.Version,
		Fans:    p.Fans,
		Combos:  p.Combos,
		Ignores: p.Ignores,
		Config:  p.Config,
	}, nil
}

// VersionOf 只回答「它自稱幾版」，不問合不合法。
//
// 🔴 這是**另一把尺**，刻意與 Parse 分開（check_ruleset_seeded.py 的
// version_of_raw 同一個理由）：那一列壞掉時，後台仍然要說得出
// 「壞掉的那一份自稱是 0.2.0」—— 否則「壞掉」與「不存在」在畫面上
// 會少掉唯一能分辨它們的線索。取不到回空字串。
func VersionOf(raw string) string {
	var probe struct {
		Version *string `json:"version"`
	}
	if err := json.Unmarshal([]byte(raw), &probe); err != nil {
		return ""
	}
	if probe.Version == nil {
		return ""
	}
	return *probe.Version
}
