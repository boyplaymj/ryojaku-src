package shared

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// dojoVenue 回傳一個三條件**全部成立**的 venue，測試各自破壞其中一條。
func dojoVenue() *Venue {
	return &Venue{
		VenueID:               "V1",
		Type:                  VenueTypeHall,
		DojoPaidUntil:         2000,
		CertifiedRefereeCount: 1,
	}
}

// T1 正控：三條全成立 ⇒ true。
// 少了它，EvaluateIsDojo 直接 `return false` 也會讓底下所有反控變綠。
func TestEvaluateIsDojo_AllThreeHold(t *testing.T) {
	if !EvaluateIsDojo(dojoVenue(), 1000) {
		t.Fatal("三條件全成立時應該是道館")
	}
}

// T2 逐條反控：每次只破壞一條，其餘維持成立。
func TestEvaluateIsDojo_EachConditionAlone(t *testing.T) {
	cases := []struct {
		name   string
		break_ func(*Venue)
	}{
		{"type=home 不是麻將館", func(v *Venue) { v.Type = VenueTypeHome }},
		{"type=event 不是麻將館", func(v *Venue) { v.Type = VenueTypeEvent }},
		{"type=dojo 是不合法的值，也不該讓徽章亮", func(v *Venue) { v.Type = "dojo" }},
		{"付費過期", func(v *Venue) { v.DojoPaidUntil = 500 }},
		{"從未付費（0）", func(v *Venue) { v.DojoPaidUntil = 0 }},
		{"沒有已認證裁判", func(v *Venue) { v.CertifiedRefereeCount = 0 }},
		{"裁判數是負的（髒資料）", func(v *Venue) { v.CertifiedRefereeCount = -3 }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := dojoVenue()
			c.break_(v)
			if EvaluateIsDojo(v, 1000) {
				t.Fatalf("%s ⇒ 不應該是道館", c.name)
			}
		})
	}
}

// T3 到期邊界：DojoPaidUntil == now 已經過期（嚴格大於才算有效）。
// 這條盯的是 `<=` vs `<` 那一個字元。
func TestEvaluateIsDojo_ExpiryBoundary(t *testing.T) {
	v := dojoVenue()
	v.DojoPaidUntil = 1000
	if EvaluateIsDojo(v, 1000) {
		t.Fatal("到期時刻本身應該算過期")
	}
	v.DojoPaidUntil = 1001
	if !EvaluateIsDojo(v, 1000) {
		t.Fatal("到期時刻之前應該仍有效")
	}
}

// T4 nil 不可 panic，且 fail-closed。
func TestEvaluateIsDojo_Nil(t *testing.T) {
	if EvaluateIsDojo(nil, 1000) {
		t.Fatal("nil 不應該是道館")
	}
	var v *Venue
	v.ResolveIsDojo(1000) // 不可 panic
}

// T5 ResolveIsDojo 兩個方向都要對。
func TestResolveIsDojo(t *testing.T) {
	v := dojoVenue()
	if v.IsDojo {
		t.Fatal("預設值應該是 false（IsDojo 不落地）")
	}
	v.ResolveIsDojo(1000)
	if !v.IsDojo {
		t.Fatal("ResolveIsDojo 應該把 true 寫進去")
	}
	v.ResolveIsDojo(9999) // 已過期
	if v.IsDojo {
		t.Fatal("ResolveIsDojo 也必須能把 true 改回 false —— 只會設 true 的話，過期的徽章永遠掉不下來")
	}
}

// T6 type enum：dojo 必須不合法。這是 §5.2/§5.3 訂正的承重斷言。
func TestIsValidVenueType(t *testing.T) {
	for _, ok := range []string{VenueTypeHall, VenueTypeHome, VenueTypeEvent} {
		if !IsValidVenueType(ok) {
			t.Fatalf("%q 應該合法", ok)
		}
	}
	for _, bad := range []string{"dojo", "", "HALL", "hall ", "home2"} {
		if IsValidVenueType(bad) {
			t.Fatalf("%q 不應該合法", bad)
		}
	}
}

// --- 序列化守衛（§5.1 硬規則）---

const addrSentinel = "SENTINEL_EXACT_ADDR_台北市大安區某路99號5樓"
const nameSentinel = "SENTINEL_PUBLIC_NAME"

// T7 🔴 承重：Venue 直接 json.Marshal **不可以**帶出精確地址。
// 比對的是**值**不是欄位名 —— 欄位改名／被搬進巢狀結構都仍然咬得住。
func TestVenueJSON_NeverLeaksExactAddress(t *testing.T) {
	v := dojoVenue()
	v.Name = nameSentinel
	v.ExactAddress = addrSentinel

	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)

	if strings.Contains(got, addrSentinel) {
		t.Fatalf("精確地址洩漏到 JSON：%s", got)
	}
	// 正控：證明這把尺不是恆綠 —— 沒被 json:"-" 擋的字串**確實**會出現。
	// 少了這一半，把整個 Marshal 換成回傳 "{}" 也會讓上面那條變綠。
	if !strings.Contains(got, nameSentinel) {
		t.Fatalf("正控失敗：公開欄位也沒出現在 JSON 裡 ⇒ 上面那條斷言證明不了任何事：%s", got)
	}
}

// T8 🔴 IsDojo 不可落地：DDB marshal 的 key 集合不得含它。
func TestVenueDDB_IsDojoNotPersisted(t *testing.T) {
	v := dojoVenue()
	v.IsDojo = true // 就算有人在記憶體裡設了，也不該寫進表
	v.Name = nameSentinel

	m, err := attributevalue.MarshalMap(v)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := m["isDojo"]; ok {
		t.Fatal("isDojo 被寫進 DDB ⇒ 它就成了可以直接勾的欄位，§5.2 的三條件會被繞過")
	}
	// 正控：三條件的**原料**必須都在，否則 EvaluateIsDojo 讀回來永遠算不出 true。
	for _, k := range []string{"type", "dojoPaidUntil", "certifiedRefereeCount"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("原料欄位 %q 沒有落地 ⇒ 讀回來之後徽章永遠不會亮", k)
		}
	}
}

// T9 exactAddress **要**落地（它只是不外送）。
// 這條與 T7 方向相反，兩條一起才把「不外洩」與「有存」分開。
func TestVenueDDB_ExactAddressIsPersisted(t *testing.T) {
	v := dojoVenue()
	v.ExactAddress = addrSentinel
	m, err := attributevalue.MarshalMap(v)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := m["exactAddress"]; !ok {
		t.Fatal("exactAddress 沒有落地 ⇒ 核准後也拿不出來給玩家")
	}
}

// T10 🔴 機械掃描：**任何**帶 `dynamodbav:"exactAddress` 的欄位都不得有可外送的 json tag。
// 用反射掃整個 struct，不是手打欄位清單 —— 之後新增欄位時它自動涵蓋。
// （[A2] 那次的教訓：手打的兩個檔名清單漏掉第三處，而測試照樣全綠。）
func TestVenueStruct_NoPrivateFieldIsJSONExported(t *testing.T) {
	private := map[string]bool{"exactAddress": true}
	rt := reflect.TypeOf(Venue{})
	checked := 0
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		dav := strings.Split(f.Tag.Get("dynamodbav"), ",")[0]
		if !private[dav] {
			continue
		}
		checked++
		jt := strings.Split(f.Tag.Get("json"), ",")[0]
		if jt != "-" {
			t.Fatalf("欄位 %s（dynamodbav=%q）的 json tag 是 %q，應該是 \"-\"", f.Name, dav, jt)
		}
	}
	// 反控：掃不到任何私密欄位時不可以算通過 —— 欄位改名／被刪掉會讓迴圈空轉，
	// 而空轉與「每個都合格」在結果上逐字相同。
	if checked != len(private) {
		t.Fatalf("只掃到 %d 個私密欄位，預期 %d ⇒ 這把尺失明了", checked, len(private))
	}
}

// --- [B1-c] Game.VenueID：可為空、不做資料遷移（§5.3）---

// 既有局在 DDB 裡**沒有** venueId 這個屬性。讀回來不可以爆，且必須是「沒綁 venue」。
func TestGameVenueID_LegacyItemWithoutAttribute(t *testing.T) {
	legacy := map[string]types.AttributeValue{
		"gameId": &types.AttributeValueMemberS{Value: "G-old"},
	}
	var g Game
	if err := attributevalue.UnmarshalMap(legacy, &g); err != nil {
		t.Fatalf("既有局讀不回來：%v", err)
	}
	if g.VenueID != "" {
		t.Fatalf("沒有 venueId 屬性的既有局應該是空字串，得到 %q", g.VenueID)
	}
	// 正控：證明這份 fixture 真的被解析了，不是整個 UnmarshalMap 沒作用。
	if g.GameID != "G-old" {
		t.Fatalf("正控失敗：連 gameId 都沒讀進來 ⇒ 上面那條斷言證明不了任何事")
	}
}

// 空的 VenueID 不落地（omitempty）；有值時要落地，否則綁了也讀不回來。
func TestGameVenueID_MarshalRoundTrip(t *testing.T) {
	m, err := attributevalue.MarshalMap(Game{GameID: "G1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := m["venueId"]; ok {
		t.Fatal("空的 venueId 不該落地 —— 「屬性不存在」與「空字串」都只是「沒綁 venue」，留一種形狀就好")
	}
	m2, err := attributevalue.MarshalMap(Game{GameID: "G1", VenueID: "V1"})
	if err != nil {
		t.Fatal(err)
	}
	av, ok := m2["venueId"]
	if !ok {
		t.Fatal("有值的 venueId 沒有落地 ⇒ 綁了也讀不回來")
	}
	if s, ok := av.(*types.AttributeValueMemberS); !ok || s.Value != "V1" {
		t.Fatalf("venueId 落地成了 %#v", av)
	}
}

// --- [B1-a 補・收 Codex 覆驗] inbound isDojo（傳輸層那一半）---
//
// 🔴 `dynamodbav:"-"` 擋的是**落地**，擋不住「這一次回應」。IsDojo 仍是
// json:"isDojo" 的公開欄位 ⇒ 端點若直接把 request body decode 進 Venue，
// {"isDojo":true} 會留在記憶體再被原樣送回去。實測確認過（見 commit 訊息）。
func TestVenueUnmarshalJSON_DropsInboundIsDojo(t *testing.T) {
	var v Venue
	body := `{"venueId":"V1","type":"home","name":"某人家","isDojo":true,"certifiedRefereeCount":0}`
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatal(err)
	}
	if v.IsDojo {
		t.Fatal("請求裡的 isDojo:true 被留下來了 ⇒ 它會被原樣回傳，而這個 venue 三條認證一條都不成立")
	}
	// 正控（兩條）：證明這份 body 真的被解析了，不是 UnmarshalJSON 把整個物件丟掉。
	// 少了它們，`func (v *Venue) UnmarshalJSON(...) error { return nil }` 也會全綠。
	if v.VenueID != "V1" {
		t.Fatalf("正控失敗：venueId 沒讀進來（%q）⇒ 上面那條斷言證明不了任何事", v.VenueID)
	}
	if v.Name != "某人家" {
		t.Fatalf("正控失敗：name 沒讀進來（%q）", v.Name)
	}
}

// 送 isDojo:false 也一樣（不是只擋 true —— 這條讓「照抄輸入」與「一律歸零」分得出來）。
func TestVenueUnmarshalJSON_ResolveStillWorksAfterDecode(t *testing.T) {
	var v Venue
	body := `{"venueId":"V1","type":"hall","isDojo":true,"dojoPaidUntil":2000,"certifiedRefereeCount":2}`
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatal(err)
	}
	if v.IsDojo {
		t.Fatal("decode 之後應該一律是 false")
	}
	// 三條原料都讀進來了 ⇒ 求值之後才會是 true。這條盯的是「歸零」沒有連原料一起清掉。
	v.ResolveIsDojo(1000)
	if !v.IsDojo {
		t.Fatal("原料齊全時 ResolveIsDojo 應該算出 true —— 若這裡是 false，代表歸零把原料也清掉了")
	}
}
