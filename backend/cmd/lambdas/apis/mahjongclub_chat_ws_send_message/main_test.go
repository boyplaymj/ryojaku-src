package main

// kill switch 在 WebSocket sendMessage 這條路上的接線測試。
// 透過覆寫 package 級 maintenanceCheck 注入旗標，全程不打 DDB
// （維護模式的分支擺在所有 DDB 呼叫之前，旗標 on 時 Handler 直接返回）。

import (
	"context"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func withMaintenance(t *testing.T, v bool) {
	t.Helper()
	orig := maintenanceCheck
	maintenanceCheck = func(ctx context.Context) bool { return v }
	t.Cleanup(func() { maintenanceCheck = orig })
}

// captureNotify 攔下維護提示的推送。兩個用途：
// ①讓測試斷言「有沒有推、推給哪個連線」②避免單元測試打真的 API Gateway
// （WS_API_ENDPOINT 在測試環境是空的，真打會變成一次慢且不穩的網路呼叫）。
func captureNotify(t *testing.T) *[]string {
	t.Helper()
	got := []string{}
	orig := notifySenderBlocked
	notifySenderBlocked = func(ctx context.Context, connID string) { got = append(got, connID) }
	t.Cleanup(func() { notifySenderBlocked = orig })
	return &got
}

// 🔴 這條測試存在的理由：WebSocket 只有 $connect 掛得了 authorizer，
// 所以 authorizer 那道 kill switch 對「開關拉下去時已經連著的人」完全無效。
// 少了本 handler 這道，那批人可以一直發言到自己斷線為止 —— 而他們正是維護時
// 最該停下來的那批。這條紅了代表既有連線又漏出去了。
func TestHandlerMaintenanceModeBlocksExistingConnection(t *testing.T) {
	withMaintenance(t, true)
	notified := captureNotify(t)

	resp, err := Handler(context.Background(), events.APIGatewayWebsocketProxyRequest{
		RequestContext: events.APIGatewayWebsocketProxyRequestContext{
			ConnectionID: "conn-already-open",
		},
		// 刻意給一個合法 payload：要證明的是「連正常的發言也擋」，
		// 而不是「因為 body 壞掉所以剛好失敗」。
		Body: `{"action":"sendMessage","roomId":"room-1","content":"hi","type":"text"}`,
	})
	if err != nil {
		t.Fatalf("維護模式不應回 error（走正常回應路徑），實得 %v", err)
	}
	if resp.StatusCode != 503 {
		t.Fatalf("維護模式應回 503（服務暫時不可用），實得 %d", resp.StatusCode)
	}

	// 🔴 這個 503 瀏覽器收不到（110d9bc 實測：同一連線翻旗標，client 端全程沒有任何回應）
	//    ⇒「有沒有推那一幀」才是使用者看不看得到提示的唯一決定因素。
	//    少了以下兩項，把 notifySenderBlocked 整行刪掉，上面的 503 斷言仍然全綠。
	if len(*notified) != 1 {
		t.Fatalf("維護模式應推一幀提示給發話者，實得 %d 次", len(*notified))
	}
	if (*notified)[0] != "conn-already-open" {
		t.Fatalf("提示應推回發話者自己的連線，實得 %q", (*notified)[0])
	}
}

// 旗標 off 時不可以停在維護分支 —— 否則「開關永遠是開的」與「開關正常」
// 在上面那條測試裡長得一模一樣（兩者都回 503）。
//
// ⚠️ 這條只驗「有沒有越過維護分支」，不驗後續業務邏輯：旗標 off 時 Handler 會往下
// 打 DDB，本測試環境沒有憑證與表，所以只要求「結果不是維護模式那個 503」。
// 越過之後的行為由該 handler 既有的授權檢查負責，不在本測試範圍。
func TestHandlerMaintenanceOffFallsThrough(t *testing.T) {
	withMaintenance(t, false)
	notified := captureNotify(t)

	resp, _ := Handler(context.Background(), events.APIGatewayWebsocketProxyRequest{
		RequestContext: events.APIGatewayWebsocketProxyRequestContext{
			ConnectionID: "conn-normal",
		},
		Body: `not-json`, // 走到 json.Unmarshal 就會回 400 → 證明已越過維護分支
	})
	if resp.StatusCode == 503 {
		t.Fatal("旗標 off 時仍回 503 —— 維護分支沒有被跳過，開關等於永遠開著")
	}
	if resp.StatusCode != 400 {
		t.Fatalf("預期越過維護分支後因 body 非 JSON 回 400，實得 %d", resp.StatusCode)
	}

	// 對照組。少了這條，把 notifySenderBlocked 移到維護分支**外面**（每則訊息都推）
	// 也會全綠 —— 而那會讓所有人的聊天室無條件掛上「服務維護中」。
	if len(*notified) != 0 {
		t.Fatalf("非維護狀態不應推維護提示，實得 %d 次", len(*notified))
	}
}
