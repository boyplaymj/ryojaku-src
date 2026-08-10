package shared

// 信箱軟門檻的決策矩陣。八格全列，含「必須擋」的正控 —— 只驗放行案例的話，
// 一個永遠回 false 的門檻也會全過。
//
// 2026-08-10 新增 hasEmail 維度的緣由：LINE Login 建的帳號是 accountType=="app"
// 但沒有 email。在加這個維度之前，那種帳號會被永久擋住開團且無解。

import "testing"

func TestShouldBlockTrustAction_Matrix(t *testing.T) {
	cases := []struct {
		name                      string
		isApp, verified, hasEmail bool
		wantBlock                 bool
	}{
		// —— 必須擋（正控：門檻真的有在擋人）——
		{"app+有信箱+未驗證 → 擋", true, false, true, true},

		// —— 必須放行 ——
		{"app+有信箱+已驗證", true, true, true, false},
		{"app+無信箱+未驗證(LINE Login 帳號)", true, false, false, false},
		{"app+無信箱+已驗證", true, true, false, false},
		{"legacy linebot+無信箱+未驗證", false, false, false, false},
		{"legacy linebot+有信箱+未驗證", false, false, true, false},
		{"legacy linebot+無信箱+已驗證", false, true, false, false},
		{"legacy linebot+有信箱+已驗證", false, true, true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := shouldBlockTrustAction(c.isApp, c.verified, c.hasEmail); got != c.wantBlock {
				t.Fatalf("shouldBlockTrustAction(isApp=%v, verified=%v, hasEmail=%v) = %v，應為 %v",
					c.isApp, c.verified, c.hasEmail, got, c.wantBlock)
			}
		})
	}
}

func TestEmailGateEnabled(t *testing.T) {
	t.Setenv("EMAIL_VERIFY_GATE", "off")
	if EmailGateEnabled() {
		t.Error("EMAIL_VERIFY_GATE=off 應關閉門檻")
	}
	t.Setenv("EMAIL_VERIFY_GATE", "on")
	if !EmailGateEnabled() {
		t.Error("EMAIL_VERIFY_GATE=on 應啟用門檻")
	}
	// 未設 → 預設開（fail-closed）。
	t.Setenv("EMAIL_VERIFY_GATE", "")
	if !EmailGateEnabled() {
		t.Error("未設 EMAIL_VERIFY_GATE 應預設啟用")
	}
	// 拼錯的值也視為開，不可因為打錯字就靜默關掉整道門檻。
	t.Setenv("EMAIL_VERIFY_GATE", "OFF")
	if !EmailGateEnabled() {
		t.Error("非 'off' 的值(含大寫 OFF)應仍視為啟用")
	}
}
