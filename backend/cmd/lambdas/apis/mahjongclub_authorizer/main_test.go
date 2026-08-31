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

// 旗標 on → 無條件拒絕（errUnauthorized，對外 401），連 token 都不看。
func TestHandlerMaintenanceModeBlocks(t *testing.T) {
	withMaintenance(t, true)

	_, err := Handler(context.Background(), events.APIGatewayCustomAuthorizerRequestTypeRequest{
		MethodArn: "arn:aws:execute-api:ap-southeast-1:123:api/prod/GET/foo",
		Headers:   map[string]string{"Authorization": "Bearer some-token"},
	})
	if err != errUnauthorized {
		t.Fatalf("維護模式開啟時 Handler 應回 errUnauthorized，實得 err=%v", err)
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
