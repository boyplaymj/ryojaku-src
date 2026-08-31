package main

// Handler 的 kill switch 接線測試。
// 透過覆寫 package 級 maintenanceCheck 注入旗標，全程不打 DDB。

import (
	"context"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

// withMaintenance 覆寫 maintenanceCheck 並在測試結束時還原。
func withMaintenance(t *testing.T, v bool) {
	t.Helper()
	orig := maintenanceCheck
	maintenanceCheck = func(ctx context.Context) bool { return v }
	t.Cleanup(func() { maintenanceCheck = orig })
}

const testArn = "arn:aws:execute-api:ap-southeast-1:123:api/prod/GET/foo"

// 旗標 on → 無條件拒絕（Deny policy → 對外 403），連 token 都不看。
//
// 🔴 這條測試真正在守的不是「有沒有擋」，是「**用哪種方式擋**」。
// 維護模式若回 errUnauthorized（401），App 端 apiService.ts 會把它當 session 過期，
// 清掉 JWT / USER / AUTH_TYPE / LINE_ID 並 reload ⇒ 拉一次開關＝全體使用者永久登出。
// 所以下面同時斷言「err 必須是 nil」與「Effect 必須是 Deny」——前者擋的就是
// 「有人順手把它統一回 401」這個改動，那個改動在功能上看起來完全正常。
func TestHandlerMaintenanceModeDeniesWith403NotUnauthorized(t *testing.T) {
	withMaintenance(t, true)

	resp, err := Handler(context.Background(), events.APIGatewayCustomAuthorizerRequestTypeRequest{
		MethodArn: testArn,
		Headers:   map[string]string{"Authorization": "Bearer some-token"},
	})

	// 🔴 這一行是本檔最重要的斷言：回 errUnauthorized 就是 401，就是全體登出。
	if err != nil {
		t.Fatalf("維護模式必須回 Deny policy（403）而不是 error（401）；err=%v —— "+
			"回 401 會讓 App 端清掉所有人的登入態，維護結束也回不來", err)
	}
	if len(resp.PolicyDocument.Statement) != 1 {
		t.Fatalf("policy 應正好一條 statement，實得 %d", len(resp.PolicyDocument.Statement))
	}
	st := resp.PolicyDocument.Statement[0]
	if st.Effect != "Deny" {
		t.Fatalf("維護模式的 Effect 應為 Deny，實得 %q", st.Effect)
	}
	if resp.PrincipalID == "" {
		t.Fatal("PrincipalID 不可為空：API Gateway 對空 principal 回 500，policy 根本不會被套用")
	}
	if len(st.Resource) != 1 || st.Resource[0] != testArn {
		t.Fatalf("Deny 的 Resource 應為本次請求的 methodArn %q，實得 %v", testArn, st.Resource)
	}
}

// 旗標 on 時不可以放行 —— 與上面那條分開，是為了讓「Effect 被改成 Allow」
// 這種變異有一條指名的測試會紅，而不是靠上面那條的附帶斷言。
func TestHandlerMaintenanceModeIsNotAllow(t *testing.T) {
	withMaintenance(t, true)

	resp, _ := Handler(context.Background(), events.APIGatewayCustomAuthorizerRequestTypeRequest{
		MethodArn: testArn,
		Headers:   map[string]string{"Authorization": "Bearer some-token"},
	})
	for _, st := range resp.PolicyDocument.Statement {
		if st.Effect == "Allow" {
			t.Fatal("維護模式竟然放行了 —— kill switch 反向失效")
		}
	}
}

// 旗標 off 且無 token → 仍回 errUnauthorized（確認接線沒把原有行為改掉）。
// 這條走不到 VerifyTokenWithUserPwGate（缺 token 就先擋），故不打 DDB。
func TestHandlerNoTokenStillUnauthorized(t *testing.T) {
	withMaintenance(t, false)

	_, err := Handler(context.Background(), events.APIGatewayCustomAuthorizerRequestTypeRequest{
		MethodArn: "arn:aws:execute-api:ap-southeast-1:123:api/prod/GET/foo",
	})
	if err != errUnauthorized {
		t.Fatalf("無 token 時 Handler 應回 errUnauthorized，實得 err=%v", err)
	}
}
