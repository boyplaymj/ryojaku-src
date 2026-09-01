package shared

// 維護模式（kill switch）— 緊急封鎖用戶流量。
//
// 語意承接後台被拆掉的 maintenanceMode 旋鈕（UI 原文：「開啟後除管理員外所有 API
// 將回傳 503」）：旗標開啟時，user authorizer 直接拒絕所有請求。管理員豁免不是
// 靠白名單，而是結構性的 —— admin API 走另一顆 authorizer（mahjongclub_admin_authorizer，
// ADMIN_JWT_SECRET，與 user token 完全分離），本檔對它零影響，封鎖期間管理員
// 仍進得去後台把開關關掉。
//
// 🔴 拉下去會發生什麼（讀這檔前先讀這段）：
//   - REST / HTTP：user authorizer 回 **Deny policy → 403**，App 端顯示「服務維護中」。
//     🔴 刻意不是 401。走 401 的話 frontend/services/apiService.ts 會把它當成 session
//     過期，清掉 JWT / USER / AUTH_TYPE / LINE_ID 並強制 reload ⇒ 拉一次開關就是把所有
//     線上使用者**永久登出**，維護結束也不會回來。理由詳見 authorizer 的 deny()。
//   - WebSocket 新連線：$connect 掛同一顆 authorizer，Deny ⇒ 連不上。
//   - WebSocket 既有連線：**authorizer 擋不到**（WS 只有 $connect 掛得了 authorizer），
//     故另外在 mahjongclub_chat_ws_send_message 的 handler 補了一道，回 503。
//     沒有那道的話，開關拉下去的當下已連上的人可以一直發言到自己斷線為止。
//
// 🔴 它涵蓋不到什麼：
//   - 只蓋「掛了 user authorizer」的約 47 條 route。22 條公開 route
//     （login / register / app-version-config 等 auth:public）沒有 authorizer，
//     本開關對它們完全無效 —— 開了 kill switch，登入與註冊照常可用。
//   - authorizer 這側只能回 401 或 403，給不出 UI 當初承諾的 503；503 只有走一般
//     handler 的 WS sendMessage 那道做得到。兩側狀態碼不一致是 transport 限制，不是疏忽。
//   - 不會主動中斷既有 WS 連線，只是擋住發言；本開關不做強制踢線。
//
// fail-open 的取捨（與 token 驗證的 fail-closed 是兩件事，別搞混）：
//   - 本旗標讀取失敗 → 回 false（不封鎖）。DDB 抖一下不可以把全站鎖死；
//     kill switch 是給人手動拉的，不是給故障自動觸發的。
//   - token 驗證（VerifyTokenWithUserPwGate）維持 fail-closed：撤銷語意不可
//     因故障被繞過。兩者方向相反，各自有理，不要互相「統一」。
//
// 成本：三處 authorizer 都設 Identity.ReauthorizeEvery: 0（不快取），
// 代價是每個帶 token 的請求 +1 次 DDB 讀 —— 這是刻意的：開關要能秒開也要能秒關。
//
// ─────────────────────────────────────────────────────────────────────────────
// 實打驗證紀錄（2026-09-01，stg，CFN ryojaku-app-stg UPDATE_COMPLETE 19:19:15Z）
//
// 上面「回 403 不是 401」那段原本是**推論**：從 API Gateway 的 Deny 語義推出來的，
// 而單元測試斷言的是 authorizer 回傳的 policy 物件，對「瀏覽器實際收到什麼」零鑑別力。
// 推論若不成立，f1d667e 那個「拉一次開關把所有人永久登出」的缺陷會原封不動回來，
// 且所有測試照樣全綠。故實際拉了一次開關量狀態碼。以下標「量到」與「仍是推論」。
//
// 探針不需要真實帳號：Handler 把 maintenanceCheck 擺在 extractBearer 之前，
// 故 garbage token 即可分辨兩條路 —— OFF→401（token 無效）、ON→403（Deny）。
// OFF 那格同時是正控：它證明請求真的到得了 authorizer，少了它「403 沒出現」
// 與「請求根本沒到」長得一模一樣。
//
//   量到 | 旗標 OFF ・ REST auth:user（GET /chat/rooms）      → 401（正控）
//   量到 | 旗標 ON  ・ 同上                                    → 403 ×4/4
//   量到 | 旗標 ON  ・ 公開 route（GET /app-version-config）   → 200 ＋正常 payload
//                     ⇒ 上面「擋不到公開 route」那條宣稱**成立**，不是紙上談兵
//   量到 | 旗標 ON  ・ WS $connect（?token=garbage）           → 403 explicit-deny
//   量到 | 還原後   ・ REST 與 WS 同探針                       → 雙雙回到 401
//
// 403 的來源有指紋，不只是「狀態碼剛好相同」（403 也可能來自 CDN／WAF）：
// body 為 API Gateway 制式的 "...explicit deny in an identity-based policy"，
// header 帶 x-amzn-errortype: AccessDeniedException，WS 那發還帶 connectionId。
// 且同一把 garbage token 在 OFF→401 / ON→403 ⇒ 該 403 確實來自維護分支，
// 不是「爛 token 反正都會被拒」。
//
// 🔴 順帶量到一件沒人問但會致命的事：ON 的 403 **帶完整 CORS header**
// （access-control-allow-origin 等）。02-app.generated.yaml:92-94 警告過
// 「gateway 自產的錯誤回應沒有 CORS header ⇒ 瀏覽器只看到 CORS 失敗」——
// 若這裡沒帶，前端 apiService 根本讀不到 403 這個狀態碼，403 分支形同不存在，
// 而 curl 完全量不出這個差別。實測有帶。
//
// 第二輪：獨立複製 ＋ admin 豁免（同日稍晚，由另一個人重跑，非轉述上一輪）
//
// 上面那批數字第一輪只有一個目擊者。核心宣稱靠 n=1 太薄，而複製成本是
// 「翻一次旗標 ＋ 兩發 curl」，故重跑。同一次翻轉裡多打一發 admin route ——
// 這樣 admin 豁免就有了**差分**，不必靠 admin 帳號：
//
//   旗標 OFF → user /chat/rooms = 401 ・ admin /admin/stats = 401
//   旗標 ON  → user /chat/rooms = 403 ・ admin /admin/stats = 401 ・ public = 200
//   還原後   → 三者回到 401 / 401 / 200（get-item consistent read 回 None）
//
// 🔴 admin 那格在同一次翻轉裡**紋風不動（401，x-amzn-errortype: UnauthorizedException）**，
// 而 user 那格 401→403。同一個旗標、同一把 garbage token、同一秒 ——
// ⇒ admin authorizer 確實不看維護旗標，檔頭「管理員豁免是結構性的」那句宣稱**成立**。
// 這是差分不是單點：若 admin 也被擋，它會跟 user 一起轉 403。
// ⚠️ 但這只驗到**結構的那一半**（admin authorizer 不因維護而拒絕）。
// 「合法 admin token 真的走完後台、按得到那顆開關」仍未驗 —— 需要真實 admin 帳號。
//
// Codex 獨立佐證（同日，未重跑旗標，它自己明說了）：CFN 狀態與時間戳、旗標已還原、
// OFF 基線 401、branch ahead 1。並多給一個我沒量的：user/admin 兩顆 authorizer
// 都在 19:19:26–27Z 更新 ⇒ 換到新碼的是 authorizer 函式本身，不只是 stack 層級。
//
// 仍是推論（未實打，不要當成已驗）：
//   - 真瀏覽器端到端：curl 不執行 CORS、也不跑 apiService.ts。「瀏覽器收到 403
//     且不清 session」是「量到的 403 ＋ 量到的 CORS header ＋ 讀碼」三者的組合推論。
//     apiService.ts 的 403 分支已讀碼確認獨立於 401 分支、不碰 localStorage、不 reload。
//   - WS 既有連線的 sendMessage 503（本檔上面提到的那道 handler 補丁）：需先建立
//     合法連線，無便宜測法，**未測**。
//   - admin 豁免的**端到端那一半**：合法 admin token 在 ON 時能否走完後台關掉開關。
//     結構半已驗（見上），這半未驗。可逆性要兩半都成立才算數。
//   - 合法 user token 在 ON 時的行為：無真實帳號，未測。
//   - 公開 route 只打了 app-version-config（GET）；app-login／app-register（POST）未逐一打。
// ─────────────────────────────────────────────────────────────────────────────

import (
	"context"
	"log"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// adminConfigsTable 對齊 identities.go 的表名慣例。
// item 形狀：info_key(S) / info_value(S)，見 mahjongclub_admin_versions/main.go。
func adminConfigsTable() string { return tablePrefix() + "AdminConfigs" }

// maintenanceModeFromItem 是純函式：把 GetItem 的 item 判讀成「要不要封鎖」。
// 切成純函式是為了能在沒有 AWS 的環境下對決策表做測試。
// nil / 空 item / 缺 info_value / 型別不對 / 值不是 "true" → false。
// 後台存值走 fmt.Sprintf("%v")，bool true 會存成 "true"；trim + 不分大小寫
// 是為了容忍手動改 DDB 時打出 "TRUE" / " true " 這類值。
func maintenanceModeFromItem(item map[string]types.AttributeValue) bool {
	if item == nil {
		return false
	}
	v, ok := item["info_value"].(*types.AttributeValueMemberS)
	if !ok {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(v.Value), "true")
}

// IsMaintenanceMode 讀 AdminConfigs 的 maintenanceMode 旗標。
// 讀取失敗一律 fail-open（回 false，理由見檔頭）—— 只記 log，不把故障變成封鎖。
// ConsistentRead 必須開：開關要秒生效，最終一致會讓「我明明關掉了還在鎖」
// 變成一個查不出來的鬼。
func IsMaintenanceMode(ctx context.Context) bool {
	c := getAuthDDBClient()
	if c == nil {
		log.Printf("[MAINT] DDB client 不可用，fail-open（不封鎖）")
		return false
	}
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(adminConfigsTable()),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "maintenanceMode"},
		},
		ProjectionExpression: aws.String("info_value"),
		ConsistentRead:       aws.Bool(true),
	})
	if err != nil {
		log.Printf("[MAINT] 讀取 maintenanceMode 失敗，fail-open（不封鎖）: %v", err)
		return false
	}
	return maintenanceModeFromItem(out.Item)
}
