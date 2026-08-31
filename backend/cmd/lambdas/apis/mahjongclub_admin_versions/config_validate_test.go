// 跑法：ADMIN_JWT_SECRET=dummy-for-test go test ./cmd/lambdas/apis/mahjongclub_admin_versions/
//
// 為什麼要帶那個環境變數：本 package 的 init()（main.go:39）在缺少 ADMIN_JWT_SECRET 時
// 會刻意 panic（AUTH_SYSTEM_DESIGN §6.1），而 init 在 TestMain 之前就跑了，程式內補不了。
// 不帶的話會看到 panic 而不是測試結果 —— 那不是測試壞了。
package main

import (
	"strings"
	"testing"
)

func TestValidateMinVersion(t *testing.T) {
	valid := []string{"1", "1.0", "2.0.4", "10.20.30", "  2.0.4  "}
	for _, v := range valid {
		if err := validateMinVersion(v); err != nil {
			t.Errorf("validateMinVersion(%q) 應該通過，卻回 %v", v, err)
		}
	}

	// 這些字串在 App 端會讓 parseVersion 回 nil ⇒ isOutdated fail-open ⇒ 閘門靜靜消失。
	// 所以它們必須在這裡就被擋下來。
	invalid := []string{"", "   ", "2.0.4-beta", "latest", "v2.0.4", "2..4", "2.0.x", "2,0,4"}
	for _, v := range invalid {
		if err := validateMinVersion(v); err == nil {
			t.Errorf("validateMinVersion(%q) 應該被擋，卻通過了", v)
		}
	}
}

func TestValidateUpdateUrl(t *testing.T) {
	valid := []string{
		"",  // 清空＝退回 app-version-config 的預設值，是合法操作
		"   ",
		"https://apps.apple.com/app/id123",
		"market://details?id=com.boyplaymj.ryojaku",
		"itms-apps://itunes.apple.com/app/id123",
		"itms://x.test/app",
	}
	for _, v := range valid {
		if err := validateUpdateUrl(v); err != nil {
			t.Errorf("validateUpdateUrl(%q) 應該通過，卻回 %v", v, err)
		}
	}

	invalid := []string{
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"http://apps.apple.com/app/id123", // 商店連結沒有理由降級成 http
		"apps.apple.com/app/id123",        // 沒有 scheme
		"ftp://x.test/app",
	}
	for _, v := range invalid {
		if err := validateUpdateUrl(v); err == nil {
			t.Errorf("validateUpdateUrl(%q) 應該被擋，卻通過了", v)
		}
	}
}

func TestValidateConfigUpdatesRejectsUnknownKeys(t *testing.T) {
	// forceUpdate / latestVersion 是被拆掉的假旋鈕，至今無人讀，要繼續擋。
	// ⚠️ maintenanceMode 已從本清單移出 —— 它在 f1d667e / 9870d34 接上真正的
	// 讀取端，不再是假旋鈕。移出的是「未知 key」這一條，它的合法值範圍改由
	// TestValidateMaintenanceMode 守（見下）。
	for _, k := range []string{"forceUpdate", "latestVersion", "隨便什麼"} {
		if err := validateConfigUpdates(map[string]string{k: "true"}); err == nil {
			t.Errorf("未知設定項 %q 應該被擋，卻通過了", k)
		}
	}
}

// 🔴 這條守的是「寫得進去 ≠ 開得起來」。
// 讀取端 shared.maintenanceModeFromItem 的判讀是「等於 true 才封鎖，其餘一律 false」，
// 所以放行 "yes" / "1" / "on" 不會出錯，而是靜靜地等於關閉 —— 後台跳「已儲存」、
// 值也真的存進 DDB，但開關沒開。那正是 maintenanceMode 上一輩子的死法。
func TestValidateMaintenanceMode(t *testing.T) {
	for _, v := range []string{"true", "false", "TRUE", "False", " true ", "  false"} {
		if err := validateMaintenanceMode(v); err != nil {
			t.Errorf("validateMaintenanceMode(%q) 應該通過，卻回 %v", v, err)
		}
	}
	// 這些「看起來像 true」的值必須被擋：它們會被讀取端當成 false。
	for _, v := range []string{"yes", "1", "on", "y", "開", "enabled", "", "truthy", "ture"} {
		if err := validateMaintenanceMode(v); err == nil {
			t.Errorf("validateMaintenanceMode(%q) 應該被擋（讀取端會當成 false，等於靜靜地沒開），卻通過了", v)
		}
	}
}

// maintenanceMode 現在必須走得通 —— 否則後台那顆開關按下去會拿到 400，
// 而「開關壞了」與「維護模式沒開」在畫面上是同一件事。
func TestValidateConfigUpdatesAcceptsMaintenanceMode(t *testing.T) {
	for _, v := range []string{"true", "false"} {
		if err := validateConfigUpdates(map[string]string{"maintenanceMode": v}); err != nil {
			t.Errorf("maintenanceMode=%q 應該被接受，卻回 %v", v, err)
		}
	}
}

// 錯誤訊息裡的可用 key 清單必須是現算的，不是手打的。
// 手打的那份在本次加 maintenanceMode 時不會有人被逼著回來改，它會靜靜地開始說謊。
func TestUnknownKeyErrorListsAllKnownKeys(t *testing.T) {
	err := validateConfigUpdates(map[string]string{"隨便什麼": "x"})
	if err == nil {
		t.Fatal("未知 key 應該被擋")
	}
	for k := range configValidators {
		if !strings.Contains(err.Error(), k) {
			t.Errorf("錯誤訊息應列出可用 key %q，實際訊息：%s", k, err.Error())
		}
	}
}

func TestValidateConfigUpdatesHappyPath(t *testing.T) {
	err := validateConfigUpdates(map[string]string{
		"minVersion": "2.0.4",
		"updateUrl":  "https://apps.apple.com/app/id123",
	})
	if err != nil {
		t.Errorf("合法的整批更新不該被擋，卻回 %v", err)
	}
}

func TestValidateConfigUpdatesIsAllOrNothing(t *testing.T) {
	// 一批裡只要有一項不合格，整批就要在任何寫入之前失敗。
	err := validateConfigUpdates(map[string]string{
		"minVersion": "2.0.4",
		"updateUrl":  "javascript:alert(1)",
	})
	if err == nil {
		t.Error("整批裡有一項不合格時應該失敗，卻通過了")
	}
}
