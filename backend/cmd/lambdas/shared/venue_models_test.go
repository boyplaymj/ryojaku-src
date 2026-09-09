package shared

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
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
