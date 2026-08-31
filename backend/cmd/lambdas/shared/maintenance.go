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
