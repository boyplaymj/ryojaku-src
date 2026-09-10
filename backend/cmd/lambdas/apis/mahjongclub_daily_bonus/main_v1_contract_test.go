package main

// 這支測的是「本 handler 是 REST_V1 (payload v1) 的」這個契約本身,不是每日獎勵的算法。
//
// 為什麼要有它:2026-09-10 把 /daily-bonus 由 HTTP_V2 搬到 REST_V1 時,
// 只搬了路由沒轉 handler,而**兩半的失敗都沒有錯誤訊號**:
//   ① 回應端:v2 結構多一個 `cookies` 欄位,REST proxy integration 只認
//      statusCode/headers/multiValueHeaders/body/isBase64Encoded ⇒ 判 malformed ⇒ 502,
//      而 Lambda 端 END 正常、零錯誤日誌、2.21ms。
//   ② 請求端:RequestContext.HTTP.Method 與 AuthorizerUserIDV2 讀的是 v2 專屬欄位,
//      餵 v1 事件時**靜靜取到零值** ⇒ 每個請求都被判成未授權。
// 在此之前這條的 v1 行為只由線上四格驗收支撐(`go test` 是 `[no test files]`)——
// 那把尺要真的部署上去才動得了,救不了「改回 v2 就靜靜壞掉」。
//
// 正典:infra/PATH_RECONCILE.md §4b。剩下七條要搬時,每一條都該複製一份這個測試。
//
// ── 突變測試:第一輪(2026-09-10 早上,手動 4 發)────────────────────────
// 🔴 3 殺、**1 發存活,而存活的那發是最重要的那個形狀**。原文留著不改寫 ——
//    改寫的話「當初就沒問題」與「後來補起來了」會分不出來。
//   M1 把 cookies 加進 restLegalKeys(讓 T3 恆真)      → T4 殺
//   M2 OPTIONS 判斷永遠不成立                          → T1 殺
//   M3 errorResponse 一律回 200                        → T2 殺
//   M4 `userID := ""`(身分永遠讀不到)                  → **存活**
//
// M4 為什麼存活:T5 測的是 shared.AuthorizerUserID 這支**函式**,不是 handler
// 有沒有真的用它的結果;而 T2 斷言「沒有 authorizer ⇒ 401」,在 M4 之下照樣成立。
// ⇒ **「身分讀得到的時候不會被判 401」這條線,目前沒有任何單元尺。**
// 要補它必須讓 handler 在帶合法 authorizer 時走得完而不碰真表 —— 那需要把
// dynamoClient 換成可注入的介面,是另一個決定,不在本次範圍內。
//
// ── ✅ 第二輪(2026-09-10 下午):M4 已補上,並改成可重跑 ─────────────────
// 做法就是上面那句「另一個決定」:main.go 的 dynamoClient 改成 `ddbAPI` 介面,
// 影子帳本那一步抽成 `recordShadowLog` 變數 ⇒ handler 帶著合法身分走得完而不碰真表。
// 新增 T6～T10(見下方那段分隔線)。
//
// 🔴 突變**改由腳本跑**:`bash backend/mutation_daily_bonus.sh`,15 發全殺、逐發指名
//    該紅的那一條。上一輪那 4 發只活在 commit 訊息裡 —— **只寫在訊息裡的預期
//    永遠不會失敗**,所以這次留腳本。
// 🔴 M4 之外另加的重點是 M5～M9:M4 只打「有沒有被判 401」,那條線通過之後,
//    「handler 拿讀到的身分去做什麼」仍然可以整個寫錯(查別人的連續天數、
//    把點數加到別人頭上)。那是同一個洞的另外幾面。
// ⚠️ 仍然沒有尺的三處寫在 mutation_daily_bonus.sh 檔頭,不要讀成「都測過了」。
//
// ⚠️ 但 M4 **不是**當初那個 bug 的形狀。當初是 handler 讀 v2 專屬欄位;
//    那種寫法在 v1 簽章下**編譯不過**(型別不符)⇒ 那條的尺是編譯器,不是這裡。
//    M4 模擬的是「有人手動寫死空字串」——真的有洞,但沒發生過。
//    這兩者不要互相推論:編譯器擋得住型別走錯,擋不住值被寫死。

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// REST proxy integration 允許的鍵。多一個就是 malformed ⇒ 502。
var restLegalKeys = map[string]bool{
	"statusCode": true, "headers": true, "multiValueHeaders": true,
	"body": true, "isBase64Encoded": true,
}

func keysOf(t *testing.T, v interface{}) map[string]bool {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	out := map[string]bool{}
	for k := range m {
		out[k] = true
	}
	return out
}

// T1 請求端:OPTIONS 走 v1 的 HTTPMethod 欄位。
// 若 handler 退回 v2 型別,這個事件的 RequestContext.HTTP.Method 會是空字串 ⇒ 不會回 200。
func TestT1_OptionsReadsV1HTTPMethod(t *testing.T) {
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "OPTIONS"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("OPTIONS 應回 200,實得 %d", resp.StatusCode)
	}
}

// T2【T1 的反控】非 OPTIONS 且沒有 authorizer ⇒ 401。
// 少了它,T1 的 200 與「這支永遠回 200」逐字相同。
func TestT2_NoAuthorizerIs401(t *testing.T) {
	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "POST"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if resp.StatusCode != 401 {
		t.Fatalf("無 authorizer 應回 401(fail-closed),實得 %d", resp.StatusCode)
	}
}

// T3 回應端:marshal 出來的鍵必須全部落在 REST 允許的集合裡(尤其不可以有 cookies)。
func TestT3_ResponseHasOnlyRestLegalKeys(t *testing.T) {
	resp, _ := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "POST"})
	for k := range keysOf(t, resp) {
		if !restLegalKeys[k] {
			t.Fatalf("回應含 REST 不認得的鍵 %q ⇒ malformed ⇒ 502", k)
		}
	}
}

// T4【T3 的反控】v2 的回應型別**確實**會吐 cookies。
// 少了它,T3 可能只是因為我把判準寫成恆真而通過 —— 那與「尺看得見差別」逐字相同。
func TestT4_V2ResponseTypeDoesEmitCookies(t *testing.T) {
	ks := keysOf(t, events.APIGatewayV2HTTPResponse{StatusCode: 200})
	if !ks["cookies"] {
		t.Fatalf("反控失效:v2 回應型別沒有吐 cookies ⇒ T3 證明不了任何事(鍵集=%v)", ks)
	}
	if restLegalKeys["cookies"] {
		t.Fatal("反控失效:cookies 被列進 REST 合法鍵,T3 恆真")
	}
}

// T5 身分讀取走 v1 的 RequestContext.Authorizer(扁平 map),不是 v2 的 .Lambda 子層。
// 這條讓 T2 的 401 不會被讀成「它永遠 401」。
func TestT5_AuthorizerUserIDReadsV1Shape(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		HTTPMethod: "POST",
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{"userId": "APP_TEST_ONLY"},
		},
	}
	if got := shared.AuthorizerUserID(req); got != "APP_TEST_ONLY" {
		t.Fatalf("v1 authorizer 應讀到 APP_TEST_ONLY,實得 %q", got)
	}
	// fail-closed:沒有 authorizer 時必須是空字串,不是 panic 也不是預設值。
	if got := shared.AuthorizerUserID(events.APIGatewayProxyRequest{}); got != "" {
		t.Fatalf("無 authorizer 應為空字串,實得 %q", got)
	}
}

// ════════════════════════════════════════════════════════════════════════
// T6～T10：補上 M4 那個洞（2026-09-10）
//
// M4（`userID := ""`）之所以存活，是因為 T1～T5 沒有一條讓 handler 帶著**合法身分**
// 走過 401 那道閘 —— 而在此之前它走不過去：下一步就是碰真表。
// 現在 dynamoClient 是 ddbAPI 介面（main.go），注入假件之後這條線才量得到。
//
// 🔴 這幾條承重的不是「回了 200」，是「handler 拿**讀到的那個身分**去問／去寫」：
//    T7 讓身分的**值**承重（用錯身分 ⇒ 昨天那筆撈不到 ⇒ 連續天數變 1，加碼消失），
//    T8 是它的反控（換一個身分就真的撈不到 ⇒ 證明假件不是對任何 key 都回同一筆）。
//    只斷言 200 的話，「身分讀對了」與「身分是空的但表恰好也回答了」分不出來。
// ⚠️ 界線：這裡量的是 handler 主線。影子帳本那一步（recordShadowLog）在測試裡被
//    整個換掉 ⇒ 它的函式本體仍然零覆蓋，見 main.go 那段註解，不要讀成有尺。
// ════════════════════════════════════════════════════════════════════════

const testUserID = "APP_TEST_ONLY"

// fixedNow：台北 2026-09-10 12:00（=UTC 04:00）。凍住時鐘不是為了好看 ——
// 昨天那筆的 key 是日期字串，用真時鐘跑會在午夜前後拿到差一天的 key ⇒ 間歇假紅。
var fixedNow = time.Date(2026, 9, 10, 4, 0, 0, 0, time.UTC)

// ── 假 DDB ──────────────────────────────────────────────────────────
// 它**不模擬 DynamoDB 的語意**，只回答「這個 key 有沒有我事先放進去的東西」，
// 並把問過的 key 與寫入的內容記下來。承重的斷言是「handler 拿什麼 key 去問／去寫」。
type fakeDDB struct {
	mu    sync.Mutex
	items map[string]map[string]types.AttributeValue
	asked []string
	txIn  []*dynamodb.TransactWriteItemsInput
	txErr error
}

// ddbKey 把 (表名, key map) 壓成一個可比對的字串。排序過，否則 map 迭代順序會讓它不穩。
func ddbKey(table string, key map[string]types.AttributeValue) string {
	parts := make([]string, 0, len(key))
	for k, v := range key {
		if s, ok := v.(*types.AttributeValueMemberS); ok {
			parts = append(parts, k+"="+s.Value)
		} else {
			parts = append(parts, k+"=<非字串>")
		}
	}
	sort.Strings(parts)
	return table + "|" + strings.Join(parts, "&")
}

func (f *fakeDDB) GetItem(ctx context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	k := ddbKey(aws.ToString(in.TableName), in.Key)
	f.asked = append(f.asked, k)
	return &dynamodb.GetItemOutput{Item: f.items[k]}, nil
}

func (f *fakeDDB) TransactWriteItems(ctx context.Context, in *dynamodb.TransactWriteItemsInput, _ ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.txIn = append(f.txIn, in)
	if f.txErr != nil {
		return nil, f.txErr
	}
	return &dynamodb.TransactWriteItemsOutput{}, nil
}

func (f *fakeDDB) put(table string, key map[string]types.AttributeValue, item map[string]types.AttributeValue) {
	f.items[ddbKey(table, key)] = item
}

func (f *fakeDDB) askedKeys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.asked...)
}

func (f *fakeDDB) txCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.txIn)
}

// refusingDDB：一律報錯。給 TestMain 當安全帶用（見那裡的說明）。
type refusingDDB struct{}

func (refusingDDB) GetItem(context.Context, *dynamodb.GetItemInput, ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	return nil, fmt.Errorf("測試沒有注入假 DDB，這一步被擋下來了")
}
func (refusingDDB) TransactWriteItems(context.Context, *dynamodb.TransactWriteItemsInput, ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error) {
	return nil, fmt.Errorf("測試沒有注入假 DDB，這一步被擋下來了")
}

// 🔴 TestMain 不是方便，是安全帶：init() 裝的是**正式** client（ap-southeast-1），
// 少了這裡的覆寫，任何一條忘記注入的測試都會真的打到線上表 ——
// 而它打成功的時候，畫面上跟「通過」一模一樣。
// tablePrefix 也一起換掉：萬一真的漏出去，打的也不會是 MahjongClub_*。
func TestMain(m *testing.M) {
	dynamoClient = refusingDDB{}
	recordShadowLog = func(string, int) {}
	tablePrefix = "TEST_"
	os.Exit(m.Run())
}

// newFake 預設塞好兩顆設定值（base=7、streak=100）。刻意**不用**程式裡的預設 10／50 ——
// 否則「設定真的讀到了」與「設定沒讀到而退回預設」在讀數上逐字相同。
func newFake() *fakeDDB {
	f := &fakeDDB{items: map[string]map[string]types.AttributeValue{}}
	f.put("TEST_AdminConfigs",
		map[string]types.AttributeValue{"info_key": &types.AttributeValueMemberS{Value: "Activity:DailyBonusBase"}},
		map[string]types.AttributeValue{"info_value": &types.AttributeValueMemberS{Value: "7"}})
	f.put("TEST_AdminConfigs",
		map[string]types.AttributeValue{"info_key": &types.AttributeValueMemberS{Value: "Activity:DailyBonusStreak"}},
		map[string]types.AttributeValue{"info_value": &types.AttributeValueMemberS{Value: "100"}})
	return f
}

func installFake(t *testing.T, f *fakeDDB) {
	t.Helper()
	prev := dynamoClient
	dynamoClient = f
	t.Cleanup(func() { dynamoClient = prev })
}

func freezeClock(t *testing.T, ts time.Time) {
	t.Helper()
	prev := nowFunc
	nowFunc = func() time.Time { return ts }
	t.Cleanup(func() { nowFunc = prev })
}

// captureShadow 換掉影子帳本那一步，並把它收到的 (userID, 點數) 送進 channel。
func captureShadow(t *testing.T) <-chan string {
	t.Helper()
	ch := make(chan string, 4)
	prev := recordShadowLog
	recordShadowLog = func(uid string, amt int) { ch <- fmt.Sprintf("%s|%d", uid, amt) }
	t.Cleanup(func() { recordShadowLog = prev })
	return ch
}

func authorizedReq(userID string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{
		HTTPMethod: "POST",
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{"userId": userID},
		},
	}
}

// claimItem 造一筆「昨天領過」的紀錄。
func claimItem(t *testing.T, userID, date string, consecutive int) map[string]types.AttributeValue {
	t.Helper()
	av, err := attributevalue.MarshalMap(DailyClaim{
		UserID: userID, ClaimDate: date, Points: 7,
		ConsecutiveDays: consecutive, ClaimedAt: date + "T12:00:00+08:00",
	})
	if err != nil {
		t.Fatalf("marshal claim: %v", err)
	}
	return av
}

func decodeData(t *testing.T, resp events.APIGatewayProxyResponse) map[string]interface{} {
	t.Helper()
	var r struct {
		Success bool                   `json:"success"`
		Data    map[string]interface{} `json:"data"`
		Error   string                 `json:"error"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &r); err != nil {
		t.Fatalf("回應不是合法 JSON：%v（body=%s）", err, resp.Body)
	}
	if !r.Success {
		t.Fatalf("success=false，error=%q", r.Error)
	}
	return r.Data
}

func num(t *testing.T, data map[string]interface{}, field string) int {
	t.Helper()
	v, ok := data[field].(float64)
	if !ok {
		t.Fatalf("欄位 %s 不是數字（實得 %#v）", field, data[field])
	}
	return int(v)
}

// T6【M4 的尺】帶合法 authorizer ⇒ 走得完，而且寫進去的身分就是讀到的那一個。
// 🔴 M4（handler 裡 `userID := ""`）在這條下面必然轉紅：它會在 401 那道閘就回頭，
// 連 TransactWriteItems 都不會發生。
func TestT6_ValidAuthorizerClaimsAsThatUser(t *testing.T) {
	f := newFake()
	installFake(t, f)
	freezeClock(t, fixedNow)
	shadow := captureShadow(t)

	resp, err := handler(context.Background(), authorizedReq(testUserID))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("帶合法身分應回 200，實得 %d（body=%s）", resp.StatusCode, resp.Body)
	}

	data := decodeData(t, resp)
	if got := num(t, data, "pointsEarned"); got != 7 {
		t.Fatalf("pointsEarned 應為設定值 7（不是程式預設 10），實得 %d", got)
	}
	if got := num(t, data, "consecutiveDays"); got != 1 {
		t.Fatalf("沒有昨天的紀錄時連續天數應為 1，實得 %d", got)
	}
	if data["today"] != "2026-09-10" {
		t.Fatalf("today 應為台北的 2026-09-10，實得 %#v", data["today"])
	}

	// 寫入端：Put 的 item 與 Update 的 key 都必須是那個身分。
	if f.txCount() != 1 {
		t.Fatalf("應該剛好寫一次交易，實得 %d 次", f.txCount())
	}
	in := f.txIn[0]
	if len(in.TransactItems) != 2 {
		t.Fatalf("交易應含 2 個項目（DailyClaims Put ＋ Users Update），實得 %d", len(in.TransactItems))
	}
	putUser := in.TransactItems[0].Put.Item["userID"].(*types.AttributeValueMemberS).Value
	if putUser != testUserID {
		t.Fatalf("DailyClaims 寫入的 userID 應為 %q，實得 %q", testUserID, putUser)
	}
	updUser := in.TransactItems[1].Update.Key["userId"].(*types.AttributeValueMemberS).Value
	if updUser != testUserID {
		t.Fatalf("Users 加點的 userId 應為 %q，實得 %q", testUserID, updUser)
	}

	select {
	case got := <-shadow:
		if got != testUserID+"|7" {
			t.Fatalf("影子帳本收到的應為 %q，實得 %q", testUserID+"|7", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("影子帳本那一步沒有被呼叫（它是 goroutine，逾時＝沒發生，不是還在飛）")
	}
}

// T7【身分的「值」承重】昨天那筆要拿**讀到的身分**當 key 才撈得到 ⇒ 連續第 7 天有加碼。
// 用錯身分（空字串、寫死別人）時這筆會撈不到 ⇒ 連續天數退回 1、加碼消失。
func TestT7_StreakLookupUsesTheAuthorizedUserID(t *testing.T) {
	f := newFake()
	f.put("TEST_DailyClaims", map[string]types.AttributeValue{
		"userID":    &types.AttributeValueMemberS{Value: testUserID},
		"claimDate": &types.AttributeValueMemberS{Value: "2026-09-09"},
	}, claimItem(t, testUserID, "2026-09-09", 6))
	installFake(t, f)
	freezeClock(t, fixedNow)
	captureShadow(t)

	resp, err := handler(context.Background(), authorizedReq(testUserID))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	data := decodeData(t, resp)
	if got := num(t, data, "consecutiveDays"); got != 7 {
		t.Fatalf("昨天是第 6 天 ⇒ 今天應為 7，實得 %d（＝handler 沒用讀到的身分去查昨天）", got)
	}
	if data["isStreakBonus"] != true {
		t.Fatalf("第 7 天應有加碼，實得 %#v", data["isStreakBonus"])
	}
	if got := num(t, data, "pointsEarned"); got != 107 {
		t.Fatalf("第 7 天應為 7+100=107，實得 %d", got)
	}
}

// T8【T7 的反控】換一個身分 ⇒ 昨天那筆真的撈不到 ⇒ 退回 1、無加碼。
// 少了它，T7 的 7 與「假件對任何 key 都回同一筆」逐字相同 —— 那樣 T7 對身分零鑑別力。
func TestT8_DifferentUserDoesNotInheritTheStreak(t *testing.T) {
	f := newFake()
	f.put("TEST_DailyClaims", map[string]types.AttributeValue{
		"userID":    &types.AttributeValueMemberS{Value: testUserID},
		"claimDate": &types.AttributeValueMemberS{Value: "2026-09-09"},
	}, claimItem(t, testUserID, "2026-09-09", 6))
	installFake(t, f)
	freezeClock(t, fixedNow)
	captureShadow(t)

	resp, err := handler(context.Background(), authorizedReq("APP_SOMEONE_ELSE"))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	data := decodeData(t, resp)
	if got := num(t, data, "consecutiveDays"); got != 1 {
		t.Fatalf("反控失效：別人的連續紀錄被接收了（連續天數 %d）⇒ T7 對身分零鑑別力", got)
	}
	if data["isStreakBonus"] != false {
		t.Fatalf("反控失效：別人的加碼也拿到了（%#v）", data["isStreakBonus"])
	}
}

// T9【401 那條路不可以先寫再回】沒有 authorizer ⇒ 401，而且假件一次都沒被碰過。
// 少了它，T2 的 401 與「該寫的都寫了才回 401」分不出來。
func TestT9_UnauthorizedTouchesNoTable(t *testing.T) {
	f := newFake()
	installFake(t, f)
	freezeClock(t, fixedNow)
	captureShadow(t)

	resp, err := handler(context.Background(), events.APIGatewayProxyRequest{HTTPMethod: "POST"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if resp.StatusCode != 401 {
		t.Fatalf("無 authorizer 應回 401，實得 %d", resp.StatusCode)
	}
	if keys := f.askedKeys(); len(keys) != 0 {
		t.Fatalf("401 之前不該讀任何表，實得問了 %v", keys)
	}
	if f.txCount() != 0 {
		t.Fatalf("401 之前不該寫任何表，實得寫了 %d 次", f.txCount())
	}
}

// T10 日期是**台北**的日期，不是 UTC 的。
// 凍在 UTC 2026-09-10 17:30 ⇒ 台北已經是 09-11 01:30。
// 少了它，`LoadLocation("Asia/Taipei")` 被改成 UTC 也全綠（Lambda 執行環境 TZ=UTC，
// 一整天裡只有 16:00Z 之後那 8 小時看得出差別）。
func TestT10_DateIsTaipeiNotUTC(t *testing.T) {
	f := newFake()
	installFake(t, f)
	freezeClock(t, time.Date(2026, 9, 10, 17, 30, 0, 0, time.UTC))
	captureShadow(t)

	resp, err := handler(context.Background(), authorizedReq(testUserID))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	data := decodeData(t, resp)
	if data["today"] != "2026-09-11" {
		t.Fatalf("UTC 17:30 在台北是 09-11，實得 %#v（⇒ 用的是 UTC 日期）", data["today"])
	}
	want := ddbKey("TEST_DailyClaims", map[string]types.AttributeValue{
		"userID":    &types.AttributeValueMemberS{Value: testUserID},
		"claimDate": &types.AttributeValueMemberS{Value: "2026-09-10"},
	})
	found := false
	for _, k := range f.askedKeys() {
		if k == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("昨天應為台北的 2026-09-10，實際問過的 key 是 %v", f.askedKeys())
	}
}
