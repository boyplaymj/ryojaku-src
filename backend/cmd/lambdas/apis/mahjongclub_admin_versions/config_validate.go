package main

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// 這支端點只服務後台「App 版本控制」那一頁，允許寫入的 key 就是下面這張表。
//
// 表以外的 key 一律 400。這個嚴格度是刻意的：先前 forceUpdate / latestVersion /
// maintenanceMode 之所以能長成「存得進 DDB、按儲存跳成功、實際什麼都不做」的假旋鈕，
// 就是因為這裡對任何 key 都照單全收。改成白名單之後，新增一個旋鈕會**被迫**在這裡
// 補一條驗證 —— 沒補就寫不進去，而不是靜靜地寫進一個沒人讀也沒人驗的欄位。
var configValidators = map[string]func(string) error{
	"minVersion": validateMinVersion,
	"updateUrl":  validateUpdateUrl,
}

// 與 App 端 frontend/utils/versionGate.ts 的 VERSION_PATTERN 一致。
// App 端解析不出來時會 fail-open（不擋），所以無效版本在那裡是「靜靜地沒有閘門」，
// 唯一會出聲的地方就是這裡。
var versionPattern = regexp.MustCompile(`^\d+(?:\.\d+)*$`)

// 與 App 端 frontend/utils/versionGate.ts 的 ALLOWED_UPDATE_SCHEMES 一致。
var allowedUpdateSchemes = []string{"https", "market", "itms-apps", "itms"}

func validateMinVersion(value string) error {
	v := strings.TrimSpace(value)
	if v == "" {
		return fmt.Errorf("minVersion 不可為空")
	}
	if !versionPattern.MatchString(v) {
		return fmt.Errorf("minVersion 只接受 1 / 1.2 / 1.2.3 這種純數字版本，收到 %q", value)
	}
	return nil
}

func validateUpdateUrl(value string) error {
	v := strings.TrimSpace(value)
	// 空字串是合法的：app-version-config 只在值非空時才覆寫預設，所以清空＝退回預設值。
	if v == "" {
		return nil
	}
	parsed, err := url.Parse(v)
	if err != nil {
		return fmt.Errorf("updateUrl 不是合法網址：%v", err)
	}
	for _, scheme := range allowedUpdateSchemes {
		if parsed.Scheme == scheme {
			return nil
		}
	}
	return fmt.Errorf("updateUrl 的開頭只接受 %s，收到 %q", strings.Join(allowedUpdateSchemes, " / "), value)
}

// validateConfigUpdates 在**任何一次寫入之前**把整批檢查完。
// 逐筆邊驗邊寫的話，第 2 筆不合格時第 1 筆已經進 DDB，會留下半套設定。
func validateConfigUpdates(updates map[string]string) error {
	for k, v := range updates {
		validate, known := configValidators[k]
		if !known {
			return fmt.Errorf("不認得的設定項 %q（本端點只接受 minVersion / updateUrl）", k)
		}
		if err := validate(v); err != nil {
			return err
		}
	}
	return nil
}
