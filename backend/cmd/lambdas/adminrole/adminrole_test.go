package adminrole

import (
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

// userToken：一般使用者 token 的 claims 形狀（shared.GenerateToken：userId/email/sub/exp/iat，
// 沒有 role）。P0 要擋的就是拿這種 claims 去打 admin 端點。
var userToken = jwt.MapClaims{
	"userId": "u-1",
	"email":  "u1@example.com",
	"sub":    "u-1",
}

// adminToken：admin_login 簽發的 claims 形狀（sub/role/exp）。
func adminToken(role string) jwt.MapClaims {
	return jwt.MapClaims{"sub": "s2admin", "role": role}
}

func TestAllowsRejectsUserToken(t *testing.T) {
	// 缺 role claim 必須是「不通過」，而不是 panic —— 原本的裸斷言在這裡會 panic 成 502。
	if Allows(userToken, Admin, SuperAdmin) {
		t.Fatal("沒有 role claim 的 user token 不該通過")
	}
	if got := Of(userToken); got != "" {
		t.Fatalf("Of(user token) = %q, want \"\"", got)
	}
}

func TestAllowsRejectsWrongTypeAndEmptyRole(t *testing.T) {
	cases := []struct {
		name   string
		claims jwt.MapClaims
	}{
		{"role 是數字", jwt.MapClaims{"sub": "x", "role": 42}},
		{"role 是 nil", jwt.MapClaims{"sub": "x", "role": nil}},
		{"role 是空字串", jwt.MapClaims{"sub": "x", "role": ""}},
		{"claims 全空", jwt.MapClaims{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if Allows(c.claims, Admin, SuperAdmin) {
				t.Error("不該通過")
			}
		})
	}
}

// 呼叫端若不小心把 "" 列進 allowed，也不能讓沒有 role 的 token 溜過去。
func TestEmptyRoleNeverMatchesEvenIfListed(t *testing.T) {
	if Allows(userToken, "") {
		t.Fatal("allowed 含空字串時仍不得放行無 role claim 的 token")
	}
}

func TestAllowsAcceptsListedRoles(t *testing.T) {
	if !Allows(adminToken(SuperAdmin), SuperAdmin) {
		t.Error("super_admin 應通過只允許 super_admin 的閘")
	}
	if !Allows(adminToken(Admin), SuperAdmin, Admin) {
		t.Error("admin 應通過允許 admin 的閘")
	}
	if Allows(adminToken(Admin), SuperAdmin) {
		t.Error("admin 不該通過只允許 super_admin 的閘")
	}
}

func TestSubjectOf(t *testing.T) {
	if got := SubjectOf(adminToken(SuperAdmin)); got != "s2admin" {
		t.Fatalf("SubjectOf = %q, want s2admin", got)
	}
	// 缺 sub 時回空字串而非 panic（稽核日誌的操作者欄位會是空的，但不會打掛 Lambda）。
	if got := SubjectOf(jwt.MapClaims{}); got != "" {
		t.Fatalf("SubjectOf(空 claims) = %q, want \"\"", got)
	}
}
