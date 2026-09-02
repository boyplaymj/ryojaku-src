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
// 第三輪：可逆性走完整條迴路（admin 豁免的端到端半，同日）
//
// 前兩輪只驗到「admin authorizer 不因維護而拒絕」。那是結構半 —— 它答的是
// 「有沒有被擋」，而這顆開關真正的問題是**「拉下去之後關不關得掉」**。
// 故本輪把開關的**開與關都走 admin API**（POST /admin/config/version），
// 不再直接戳 DDB：戳 DDB 會繞過正要驗的那條通道，量到的東西就不是可逆性。
// admin token 以 SSM 的 ADMIN_JWT_SECRET 現簽（HS256，role=super_admin，10 分鐘）。
// ⚠️ handler 比 authorizer 嚴：authorizer 收 admin/super_admin，
//    admin_versions 的 handler 只收 super_admin，否則 403（main.go 內 adminrole.Allows）。
//
//   相 0 基線（旗標不存在）
//     量到 | admin GET /admin/config/version        → 200（正控：token 真的有效）
//     量到 | 同上但不帶 token                        → 401（反控：沒 token 擋得住）
//     量到 | user GET /chat/rooms                    → 401
//   相 1 用 admin API 開啟 kill switch
//     量到 | POST {"maintenanceMode":"true"}         → 200，DDB 旗標 → "true"
//   相 2 維護中
//     量到 | user  GET /chat/rooms                   → 403（使用者被擋）
//     量到 | admin GET /admin/config/version         → 200（豁免・端到端成立）
//   相 3 🔴 維護中用 admin API 關掉開關（＝可逆性本身）
//     量到 | POST {"maintenanceMode":"false"}        → 200，DDB 旗標 → "false"
//     量到 | user  GET /chat/rooms                   → 401（使用者恢復）
//   還原 | delete-item → get-item 回 None、user 回 401（回到原始「item 不存在」）
//
// ⇒ 檔頭「管理員豁免是結構性的、封鎖期間人仍進得去後台把開關關掉」那句宣稱，
//   兩半都已實打。這顆 kill switch 的可逆性成立 —— 它敢拉。
//
// 順帶驗到稽核路徑：兩次 POST 都寫進了 AdminAuditLogs
// （action=UPDATE_CONFIG、target=AdminConfigs、details 帶新值，admin=claude-b3a-verify，
// 相隔 1 秒兩筆）。⚠️ 該表的操作者欄位叫 **admin** 不是 admin_user —— 我第一次用錯欄名
// 查到空陣列，而「查錯欄位」與「稽核根本沒寫」在輸出上逐字相同，是靠隨手撈幾筆
// 看實際欄名才戳破的。要查稽核先看 schema，別憑欄名猜。
//
// 第四輪：WS 既有連線的 503（同日）—— 這一項的判準不在 wire 上
//
// 上面自陳過「WS route 的整合回應不會送回瀏覽器」⇒ 503 在 client 端根本觀察不到。
// 所以量測要對著真正承載它的通道：**Lambda 的 CloudWatch log**。
// 探針同樣不需要真實房間：maintenanceCheck 是 Handler 的第一件事，排在
// json.Unmarshal / getUserIDByConnection / IsRoomMember 之前。
//
// (a) 結構前提，對**線上部署**查（不是讀模板）：
//     量到 | apigatewayv2 get-routes → $connect = CUSTOM(tgl00y)、
//            sendMessage = **NONE**、$disconnect = NONE
//     ⇒ 「authorizer 掛不上 sendMessage、擋不到這條路」成立，本段補丁的前提為真。
//
// (b) 已部署 handler 對真旗標的差分（直接 invoke Lambda，同一個 event 只改旗標）：
//     量到 | 旗標 OFF   → statusCode 403（走到辨識連線那步才被擋）
//     量到 | 旗標 true  → statusCode **503**（維護分支）
//     量到 | 旗標 false → statusCode 403（回到原本那條路）
//
// (c) 🔴 真・既有連線端到端（websockets 連上 stg，token 以 SSM JWT_SECRET 現簽，
//     iat 需晚於該 user 的 pwChangedAt）。連線建立後**保持開著**才翻旗標：
//       20:19:09  ConnectionID=gZHYyo4PMkhoKEh2-A==  Body=…PHASE-OFF
//       20:19:09  [chat-ws-send-message] 非成員遭拒 user=APP_1keifs5e846ao6pD …
//       ── 此時才把旗標翻成 true，連線不動 ──
//       20:19:15  ConnectionID=gZHYyo4PMkhoKEh2-A==  Body=…PHASE-ON
//       20:19:15  [chat-ws-send-message] 維護模式（kill switch）開啟，拒絕發言 conn=同一個
//     ⇒ **同一個 connectionId**、相隔 6 秒、只有旗標變 ⇒ 這條連線確實建立在翻旗標之前，
//       「既有連線」是字面意義上的既有，不是重連。
//     ⇒ 而 OFF 那次走的是**不同的分支**（非成員遭拒），證明差分乾淨 ——
//       不是「反正都會被拒」，是維護分支真的接管了。
//     ⇒ 順帶驗到：OFF 那次走得到成員資格檢查 ⇒ $connect authorizer 存下的身分正確，
//       且房間層授權（水平越權補丁）在線上有效。
//     ⇒ client 端在整個過程中**沒收到任何回應**，與上面自陳的落差一致：
//       使用者看到的是「訊息送不出去」，不是維護提示。這是已知且未修的。
//
// ⚠️ 環境地雷（浪費了一次）：本機 /tmp 是所有 session 共用的，裡面有別條 session 留下的
//    /tmp/queue.py，會遮蔽標準函式庫（Python 把腳本所在目錄排在 sys.path 最前）。
//    在 /tmp 下跑腳本會炸在毫不相關的地方。要在專屬子目錄執行。
//
// 第五輪：合法 user token 打 REST —— 前四輪全是拿 garbage token 量的
//
// 🔴 這一格補的是一個容易被忽略的鑑別力缺口：前面所有 REST 量測的翻轉都是 401→403，
// 而**兩者都是「被拒」**，只差在理由。那證明得了「維護分支改變了拒絕的方式」，
// 證明不了「原本用得好好的人會被擋下來」—— 而後者才是這顆開關對外的實際語意。
// 故以現簽的合法 user token（SSM JWT_SECRET，iat 晚於該 user 的 pwChangedAt）重量：
//
//   量到 | 旗標 OFF  ・合法 token → **200**（正控：真使用者原本用得了）／garbage → 401
//   量到 | 旗標 ON   ・合法 token → **403**（被擋）           ／garbage → 403
//   量到 | 還原後    ・合法 token → **200**（回來了）
//
// ⇒ 200 → 403 → 200。使用者側的可逆性閉環，不只是管理員側。
//
// 第六輪：真瀏覽器端到端（同日）—— 上一輪標為「最大的一塊未驗」的那塊
//
// 探針：infra/maintenance_browser_e2e.mjs（Playwright + chromium-1228，rc 0/1/2）。
// 對著**已部署的 stg 前端** https://ryojaku-stg.boyplaymj.com 跑，不是本機 dev server：
// origin 換掉的話 CORS 就不是同一件事，而「前端讀不讀得到 403」整個掛在 CORS 上。
// 全程真・UI 登入（填表單按「通行證核准」），不塞 localStorage —— 塞的話就繞過了
// 「session 長什麼樣」這件事本身。連續兩輪（n=2）逐項相同。
//
//   量到 | P2 正控 ・旗標 OFF ・GET /ledger  → 200
//   量到 | P3 主判 ・旗標 ON  ・GET /ledger  → **403**，且 403 帶
//          access-control-allow-origin: * ⇒ 前端確實讀得到這個狀態碼
//   量到 | P3 🔴 三把鑰匙（mahjongclub_jwt_token / _user_session / _auth_type）
//          **逐字未變**；load 事件數未增（沒有被強制 reload）；沒被導去 ?expired=true
//   量到 | P4 維護中按重新整理 → 三把鑰匙仍在，人還登入著
//   量到 | P5 還原旗標 → GET /ledger 回 200，且 JWT 與 P1 逐字相同（沒有重新登入過）
//   量到 | P6 反控   → 見下
//
// ⇒ 檔頭「刻意不是 401、拉開關不會把使用者永久登出」那句宣稱，**不再是推論**。
//   200→403→200 這次是在瀏覽器裡走完的，判準落在 localStorage 上，不在狀態碼上。
//
// 🔴 P6 反控是這支腳本的鑑別力本身，不是裝飾。少了它，「403 沒清 session」與
//    「這支腳本根本偵測不到清 session」在輸出上逐字相同 —— 兩者都是「鑰匙還在」。
//    故對**同一份線上產物**、同一條 /ledger 注入 401（page.route fulfill）：
//      量到 | 三把鑰匙被清光 ＋ 頁面被強制 reload ＋ console 印出
//             「[AUTH] 401 Unauthorized - 清除登入狀態並重新載入頁面」
//    ⇒ 尺會動。P3 的綠燈是量出來的，不是尺壞掉的假象。
//    順帶：401 reload 而 403 不 reload ⇒ 兩條分支的差分乾淨，不是「反正都沒事」。
//
// 覆驗（Codex，同日）：抓到探針自己的鑑別力缺口 —— 腳本宣稱驗「三把鑰匙」，
// 而 P1 的前置只要求 jwt/user 存在、P6 反控也只要求這兩把被清 ⇒ authType 那把
// **沒有任何一格在守**。若它從頭到尾是 null，P3 的「逐字未變」會拿 null === null
// 比出 true，整支照樣全綠。⚠️ 上面那批數字沒有因此失效（P1 有印出 authType=app、
// P3 確實比了三把），失效的是**未來的**鑑別力：那格是剛好成立，不是被保證。
// 已把 P1/P4/P6 三處都補成三把，重跑仍全綠 —— 並因此多量到一件原本沒斷言過的事：
// 401 分支確實把 authType 也一起清掉了（apiService.ts:77，先前只讀碼沒量）。
// 🔴 這是「宣稱 N 個載體、驗收只涵蓋 N-1 個」的又一例，而這次那個沒人守的載體
//    就寫在同一句話裡。列出載體清單時，逐一問「這一把有沒有人在守」。
//
// 🔴 順手訂正檔頭的涵蓋範圍數字（對線上 REST API 9mu0vajn38 逐 method 查 authorizerId，
//    不是讀模板）：**user authorizer（eyi8av）24 條 ・ 公開 24 條 ・ admin（pkgo0a）17 條**。
//    上面「約 47 條 / 22 條公開」對不上 —— 可能是 ANY 展開成多個動詞後的計數，
//    也可能是模板與線上漂了。⚠️ 我沒查出差額的來源，只確定線上的數字是上面這組。
//
// 🔴 而這件事有實際後果，不只是數字：`/user-info`（App 首頁 fetchData 打的那條）
//    的 authorizationType 是 **NONE** ⇒ kill switch 擋不到它。挑觸發器時若拿首頁當
//    受測動作，整支腳本會「全綠而什麼都沒驗到」。本輪因此改打 GET /ledger。
//
// ⚠️ 使用者實際看到什麼（量到，且比「沒有提示」更糟）：維護中的計帳頁**渲染成一個
//    完全正常的空帳本** ——「+0 PT ・場數 0 ・勝率 0% ・請從上方日曆中點選一個有紀錄
//    的日期」，畫面上沒有出現 apiService 翻好的「服務維護中」。apiService 那層翻譯是
//    對的，但呼叫端（Ledger.tsx）沒把 error 畫出來，於是使用者讀到的是「我這個月沒有
//    紀錄」而不是「服務在維護」。這與 WS 那條「使用者看到的是訊息送不出去」同一個形狀：
//    **修法保住了 session，但沒有保住「使用者知道發生什麼事」**。已知、未修。
//    （本項不影響本輪的主張 —— 主張是 session 不被清，那格是綠的。）
//
// 仍是推論（未實打，不要當成已驗）：
//   - 公開 route 只打了 app-version-config（GET）；app-login／app-register（POST）未逐一打。
//     ⚠️ 附帶一提，authService.adoptSession 登入後會打 /user-profile（**受保護**）⇒
//     維護中「登入」這條路會走進它的 catch 把剛寫入的半套 session 清掉。那是新登入，
//     不是既有 session，與本輪主張不衝突；但沒實打過，別當已驗。
//   - 後台 UI 的按鈕本身沒點過：前面幾輪打的是它背後的 API。
//   - 只驗了 REST。WS 既有連線那條見第四輪，client 端仍收不到任何提示。
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
