// Package adminrole 是後台 admin 的 role 閘（設計冊 tools/ryojaku-admin-migration/DESIGN.md §3.1、決策 D4）。
//
// 修的是兩個並存的缺陷：
//  1. 有 4 支 admin 端點完全沒有 role 檢查 —— 普通使用者的 token 可直接讀後台資料。
//  2. 其餘各支寫成裸型別斷言 `claims["role"].(string)`，user token 沒有 role claim 時
//     直接 panic，回 502 而不是 403（任何人都能讓後台 Lambda crash）。
//
// 只負責「claims 層」的安全取值與角色比對，刻意不碰 token 驗簽 —— 各 lambda 目前仍各自 jwt.Parse。
// 路由層的硬閘是 P1 的 admin authorizer（決策 D3）；屆時本套檢查降為縱深防禦，但不移除。
//
// ⚠️ 刻意「不」放進 cmd/lambdas/shared：shared 有 package 級 init() 與推播／Firebase 相依，
// 實測把它加進原本沒引用的 admin lambda 會讓 binary 由 16MB 漲到 23MB。本包只相依 golang-jwt。
package adminrole

import "github.com/golang-jwt/jwt/v5"

const (
	Admin      = "admin"
	SuperAdmin = "super_admin"
)

// ClaimString：安全取出字串型 claim。缺 key 或型別不符一律回 ""，永不 panic。
func ClaimString(claims jwt.MapClaims, key string) string {
	s, _ := claims[key].(string)
	return s
}

// Of：取 role claim。user token 沒有這個 claim，會回 ""（→ Allows 一律不通過）。
func Of(claims jwt.MapClaims) string { return ClaimString(claims, "role") }

// SubjectOf：取 sub claim，用於稽核日誌的操作者欄位。
func SubjectOf(claims jwt.MapClaims) string { return ClaimString(claims, "sub") }

// Allows：claims 的 role 是否落在 allowed 內。
// role 為空字串一律 false，避免呼叫端把 "" 列進 allowed 時放行無 role claim 的 user token。
func Allows(claims jwt.MapClaims, allowed ...string) bool {
	return RoleAllows(Of(claims), allowed...)
}

// RoleAllows：已經手上有 role 字串時用（例如同一支要依 role 分支多次）。
func RoleAllows(role string, allowed ...string) bool {
	if role == "" {
		return false
	}
	for _, a := range allowed {
		if role == a {
			return true
		}
	}
	return false
}
