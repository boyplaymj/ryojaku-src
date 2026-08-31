// 跑法：ADMIN_JWT_SECRET=dummy-for-test go test ./cmd/lambdas/apis/mahjongclub_admin_versions/
//
// 為什麼要帶那個環境變數：本 package 的 init()（main.go:39）在缺少 ADMIN_JWT_SECRET 時
// 會刻意 panic（AUTH_SYSTEM_DESIGN §6.1），而 init 在 TestMain 之前就跑了，程式內補不了。
// 不帶的話會看到 panic 而不是測試結果 —— 那不是測試壞了。
package main

import "testing"

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
	// 這三個正是被拆掉的假旋鈕。若有人繞過後台直接打 API，要在這裡就失敗。
	for _, k := range []string{"forceUpdate", "maintenanceMode", "latestVersion", "隨便什麼"} {
		if err := validateConfigUpdates(map[string]string{k: "true"}); err == nil {
			t.Errorf("未知設定項 %q 應該被擋，卻通過了", k)
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
