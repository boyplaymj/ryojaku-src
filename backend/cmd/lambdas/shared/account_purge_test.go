package shared

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// memDB：記憶體裡的假 DynamoDB，只懂 account_purge.go 用到的那幾種請求形狀。
type memDB struct {
	tables     map[string][]map[string]types.AttributeValue
	failDelete string                                                  // 刪到這張表時回錯誤
	beforeDel  func(table string, key map[string]types.AttributeValue) // 每次 DeleteItem 套用條件之前呼叫
	deletes    int
	puts       int
	scanCutoff int64
	scans      map[string]int // 每張表被 Scan 幾次（不含翻頁；memDB 一次回完）
	beforeGet  func(table string, key map[string]types.AttributeValue)
}

func sAttr(v string) types.AttributeValue { return &types.AttributeValueMemberS{Value: v} }

func attrEq(a, b types.AttributeValue) bool {
	as, ok1 := a.(*types.AttributeValueMemberS)
	bs, ok2 := b.(*types.AttributeValueMemberS)
	if ok1 && ok2 {
		return as.Value == bs.Value
	}
	an, ok1 := a.(*types.AttributeValueMemberN)
	bn, ok2 := b.(*types.AttributeValueMemberN)
	return ok1 && ok2 && an.Value == bn.Value
}

func (m *memDB) Scan(_ context.Context, in *dynamodb.ScanInput, _ ...func(*dynamodb.Options)) (*dynamodb.ScanOutput, error) {
	if m.scans == nil {
		m.scans = map[string]int{}
	}
	m.scans[*in.TableName]++
	// 只支援 account_purge.go 用到的幾種 Scan；換了寫法就要回來改這裡。
	if in.FilterExpression == nil {
		return &dynamodb.ScanOutput{Items: append([]map[string]types.AttributeValue(nil), m.tables[*in.TableName]...)}, nil
	}
	switch *in.FilterExpression {
	case "#pk = :u":
		pk := in.ExpressionAttributeNames["#pk"]
		out := &dynamodb.ScanOutput{}
		for _, item := range m.tables[*in.TableName] {
			if v, ok := item[pk]; ok && attrEq(v, in.ExpressionAttributeValues[":u"]) {
				out.Items = append(out.Items, item)
			}
		}
		return out, nil
	case "attribute_exists(purgedAt)":
		out := &dynamodb.ScanOutput{}
		for _, item := range m.tables[*in.TableName] {
			if _, ok := item["purgedAt"]; ok {
				out.Items = append(out.Items, item)
			}
		}
		return out, nil
	case "deleteRequestedAt <= :cutoff AND attribute_not_exists(purgedAt)":
	default:
		return nil, errors.New("memDB 不認得這條 FilterExpression：" + *in.FilterExpression)
	}
	cutoff, _ := strconv.ParseInt(in.ExpressionAttributeValues[":cutoff"].(*types.AttributeValueMemberN).Value, 10, 64)
	m.scanCutoff = cutoff
	out := &dynamodb.ScanOutput{}
	for _, item := range m.tables[*in.TableName] {
		n, ok := item["deleteRequestedAt"].(*types.AttributeValueMemberN)
		if !ok {
			continue
		}
		v, _ := strconv.ParseInt(n.Value, 10, 64)
		if _, purged := item["purgedAt"]; !purged && v <= cutoff {
			out.Items = append(out.Items, item)
		}
	}
	return out, nil
}

// 真的 DynamoDB 只能用鍵或索引 Query。這兩張表的 userId 不是鍵也沒有索引 ⇒ 對它們 Query 會被拒絕。
// 假件不學這一點的話，「該整表掃的表改成用 Query」在這裡照樣通過（實測過，只有線上那條會紅）。
var memDBNotQueryable = map[string]bool{"P_AuthTokens": true, "P_EventRedemptions": true}

func (m *memDB) Query(_ context.Context, in *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	if memDBNotQueryable[*in.TableName] {
		return nil, errors.New("ValidationException: Query condition missed key schema element（memDB）")
	}
	pk := in.ExpressionAttributeNames["#pk"]
	out := &dynamodb.QueryOutput{}
	for _, item := range m.tables[*in.TableName] {
		if v, ok := item[pk]; ok && attrEq(v, in.ExpressionAttributeValues[":u"]) {
			out.Items = append(out.Items, item)
		}
	}
	return out, nil
}

func (m *memDB) find(table string, key map[string]types.AttributeValue) int {
	for i, item := range m.tables[table] {
		match := true
		for k, v := range key {
			if got, ok := item[k]; !ok || !attrEq(got, v) {
				match = false
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func (m *memDB) GetItem(_ context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	if m.beforeGet != nil {
		m.beforeGet(*in.TableName, in.Key)
	}
	if i := m.find(*in.TableName, in.Key); i >= 0 {
		return &dynamodb.GetItemOutput{Item: m.tables[*in.TableName][i]}, nil
	}
	return &dynamodb.GetItemOutput{}, nil
}

func (m *memDB) DeleteItem(_ context.Context, in *dynamodb.DeleteItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error) {
	if m.failDelete != "" && strings.HasSuffix(*in.TableName, m.failDelete) {
		return nil, errors.New("boom")
	}
	if m.beforeDel != nil {
		m.beforeDel(*in.TableName, in.Key)
	}
	if i := m.find(*in.TableName, in.Key); i >= 0 {
		t := m.tables[*in.TableName]
		if in.ConditionExpression != nil {
			if *in.ConditionExpression != "#pk = :u" {
				return nil, errors.New("memDB 不認得這條 ConditionExpression：" + *in.ConditionExpression)
			}
			if v, ok := t[i][in.ExpressionAttributeNames["#pk"]]; !ok || !attrEq(v, in.ExpressionAttributeValues[":u"]) {
				return nil, &types.ConditionalCheckFailedException{}
			}
		}
		m.tables[*in.TableName] = append(t[:i:i], t[i+1:]...)
		m.deletes++
	}
	return &dynamodb.DeleteItemOutput{}, nil
}

func (m *memDB) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	key := map[string]types.AttributeValue{"userId": in.Item["userId"]}
	i := m.find(*in.TableName, key)
	if i < 0 {
		return nil, &types.ConditionalCheckFailedException{}
	}
	cur := m.tables[*in.TableName][i]
	if _, purged := cur["purgedAt"]; purged || !attrEq(cur["deleteRequestedAt"], in.ExpressionAttributeValues[":req"]) {
		return nil, &types.ConditionalCheckFailedException{}
	}
	m.tables[*in.TableName][i] = in.Item
	m.puts++
	return &dynamodb.PutItemOutput{}, nil
}

const purgeNow = int64(1_900_000_000)

func dueAt() int64 { return purgeNow - int64((AccountDeletionGrace+AccountPurgeMargin)/time.Second) }

// 兩個人各有一整套資料：u-del 該清，u-keep 是旁邊的正常人，一列都不可以少。
func seedPurgeDB(requestedAt int64) *memDB {
	m := &memDB{tables: map[string][]map[string]types.AttributeValue{}}
	for _, u := range []string{"u-del", "u-keep"} {
		user := map[string]types.AttributeValue{
			"userId": sAttr(u), "displayName": sAttr("名字-" + u), "email": sAttr(u + "@example.invalid"),
			"passwordHash": sAttr("hash"), "pictureUrl": sAttr("https://x/" + u), "points": nAttr(500),
			"lineId": sAttr("line-" + u), "someFutureField": sAttr("以後才加的個資欄位"),
		}
		if u == "u-del" {
			user["deleteRequestedAt"] = nAttr(requestedAt)
		}
		m.tables["P_Users"] = append(m.tables["P_Users"], user)
		for _, t := range accountPurgeTables {
			for i := 0; i < 2; i++ {
				row := map[string]types.AttributeValue{t.pk: sAttr(u)}
				for _, k := range t.keys {
					if k != t.pk {
						row[k] = sAttr(u + "-" + t.name + "-" + strconv.Itoa(i))
					}
				}
				m.tables["P_"+t.name] = append(m.tables["P_"+t.name], row)
			}
		}
	}
	return m
}

func rowsOf(m *memDB, table, pk, user string) int {
	n := 0
	for _, item := range m.tables[table] {
		if v, ok := item[pk].(*types.AttributeValueMemberS); ok && v.Value == user {
			n++
		}
	}
	return n
}

func userRow(m *memDB, user string) map[string]types.AttributeValue {
	return m.tables["P_Users"][m.find("P_Users", map[string]types.AttributeValue{"userId": sAttr(user)})]
}

func attrNames(item map[string]types.AttributeValue) string {
	var ks []string
	for k := range item {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return strings.Join(ks, ",")
}

func TestPurgeAccount_DueUser(t *testing.T) {
	m := seedPurgeDB(dueAt())
	keepBefore := attrNames(userRow(m, "u-keep"))
	rep, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), false)
	if err != nil || rep.Skipped != "" {
		t.Fatalf("rep=%+v err=%v", rep, err)
	}
	for _, tb := range accountPurgeTables {
		if got := rowsOf(m, "P_"+tb.name, tb.pk, "u-del"); got != 0 {
			t.Errorf("%s：被刪的人還剩 %d 列", tb.name, got)
		}
		if got := rowsOf(m, "P_"+tb.name, tb.pk, "u-keep"); got != 2 {
			t.Errorf("%s：旁邊那個人剩 %d 列，應該原封不動是 2", tb.name, got)
		}
		if rep.Rows[tb.name] != 2 {
			t.Errorf("%s：回報刪了 %d 列，應為 2", tb.name, rep.Rows[tb.name])
		}
	}
	// 墓碑：只剩這四個屬性 —— 連測試資料裡那個「以後才加的欄位」也不可以留下。
	tomb := userRow(m, "u-del")
	if got := attrNames(tomb); got != "deleteRequestedAt,displayName,purgedAt,userId" {
		t.Errorf("墓碑的屬性是 %s", got)
	}
	if v := tomb["displayName"].(*types.AttributeValueMemberS).Value; v != "已刪除的使用者" {
		t.Errorf("墓碑的名字是 %q", v)
	}
	if got := attrNames(userRow(m, "u-keep")); got != keepBefore {
		t.Errorf("旁邊那個人的 Users 列被動到了：%s", got)
	}
	// 清完的人不會再被找出來，而且仍然對別人隱藏。
	due, _ := FindAccountsDueForPurge(context.Background(), m, "P_", time.Unix(purgeNow, 0), 10)
	if len(due) != 0 {
		t.Errorf("清完之後還被列為待清：%v", due)
	}
	hidden, _ := accountHiddenFromOthers(context.Background(), purgeHiddenAdapter{m}, "P_", "u-del")
	if !hidden {
		t.Errorf("墓碑應該繼續對別人隱藏")
	}
}

// accountHiddenFromOthers 要的介面多一個 UpdateItem，這裡用不到。
type purgeHiddenAdapter struct{ *memDB }

func (purgeHiddenAdapter) UpdateItem(context.Context, *dynamodb.UpdateItemInput, ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	return nil, errors.New("not used")
}

func TestPurgeAccount_NotDueIsUntouched(t *testing.T) {
	cases := map[string]int64{
		"差一秒到清除時間":          dueAt() + 1,
		"剛滿 30 天、還在緩衝的一小時內": purgeNow - int64(AccountDeletionGrace/time.Second),
		"昨天才提出":             purgeNow - 86400,
	}
	for name, requestedAt := range cases {
		m := seedPurgeDB(requestedAt)
		before := attrNames(userRow(m, "u-del"))
		rep, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), false)
		if err != nil || rep.Skipped != "not due" {
			t.Errorf("%s：rep=%+v err=%v", name, rep, err)
		}
		if m.deletes != 0 || m.puts != 0 || attrNames(userRow(m, "u-del")) != before {
			t.Errorf("%s：不該動任何東西（deletes=%d puts=%d）", name, m.deletes, m.puts)
		}
		if due, _ := FindAccountsDueForPurge(context.Background(), m, "P_", time.Unix(purgeNow, 0), 10); len(due) != 0 {
			t.Errorf("%s：不該被列為待清：%v", name, due)
		}
	}
}

func TestPurgeAccount_NeverTouchesSomeoneWhoDidNotAsk(t *testing.T) {
	m := seedPurgeDB(dueAt())
	rep, err := PurgeAccount(context.Background(), m, "P_", "u-keep", time.Unix(purgeNow, 0), false)
	if err != nil || rep.Skipped == "" || m.deletes != 0 || m.puts != 0 {
		t.Errorf("沒提出刪除的人被動到了：rep=%+v err=%v deletes=%d puts=%d", rep, err, m.deletes, m.puts)
	}
	rep, _ = PurgeAccount(context.Background(), m, "P_", "nobody", time.Unix(purgeNow, 0), false)
	if rep.Skipped != "user not found" {
		t.Errorf("查無此人：%+v", rep)
	}
}

func TestPurgeAccount_DryRunChangesNothing(t *testing.T) {
	m := seedPurgeDB(dueAt())
	rep, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), true)
	if err != nil || rep.Skipped != "" || !rep.DryRun {
		t.Fatalf("rep=%+v err=%v", rep, err)
	}
	if m.deletes != 0 || m.puts != 0 {
		t.Errorf("dry run 動了資料：deletes=%d puts=%d", m.deletes, m.puts)
	}
	// dry run 仍然要講得出「會刪幾列」，否則它什麼都沒預告。
	if rep.Rows["Ledger"] != 2 || rep.Rows["Users"] != 0 {
		t.Errorf("dry run 的回報：%v", rep.Rows)
	}
}

// 中途失敗：Users 不可以先變成墓碑，否則下一次再也找不到這個人，其他表的資料永遠留著。
func TestPurgeAccount_FailureLeavesUserFindable(t *testing.T) {
	m := seedPurgeDB(dueAt())
	m.failDelete = "Ledger"
	_, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), false)
	if err == nil {
		t.Fatal("應該回錯誤")
	}
	if m.puts != 0 {
		t.Errorf("中途失敗卻已經寫了墓碑")
	}
	due, _ := FindAccountsDueForPurge(context.Background(), m, "P_", time.Unix(purgeNow, 0), 10)
	if len(due) != 1 || due[0] != "u-del" {
		t.Errorf("失敗之後應該仍被列為待清：%v", due)
	}
	// 修好之後再跑一次要能收尾。
	m.failDelete = ""
	rep, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), false)
	if err != nil || rep.Rows["Users"] != 1 {
		t.Errorf("重跑沒有收尾：rep=%+v err=%v", rep, err)
	}
}

func TestPurgeAccount_SecondRunIsNoOp(t *testing.T) {
	m := seedPurgeDB(dueAt())
	if _, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), false); err != nil {
		t.Fatal(err)
	}
	d, p := m.deletes, m.puts
	rep, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), false)
	if err != nil || rep.Skipped != "already purged" || m.deletes != d || m.puts != p {
		t.Errorf("第二次不該再動：rep=%+v err=%v", rep, err)
	}
}

func TestFindAccountsDueForPurge_CutoffAndLimit(t *testing.T) {
	m := &memDB{tables: map[string][]map[string]types.AttributeValue{}}
	for i := 0; i < 5; i++ {
		m.tables["P_Users"] = append(m.tables["P_Users"], map[string]types.AttributeValue{
			"userId": sAttr("u" + strconv.Itoa(i)), "deleteRequestedAt": nAttr(dueAt() - int64(i))})
	}
	due, err := FindAccountsDueForPurge(context.Background(), m, "P_", time.Unix(purgeNow, 0), 3)
	if err != nil || len(due) != 3 {
		t.Errorf("limit=3 得到 %v err=%v", due, err)
	}
	// 送出去的 cutoff 必須是「現在 − 30 天 − 緩衝」。
	if want := dueAt(); m.scanCutoff != want {
		t.Errorf("cutoff = %d，應為 %d", m.scanCutoff, want)
	}
}

// 查到之後、刪掉之前，那一列換了主人 ⇒ 不可以刪。
// 用 ChatConnections 與 AuthTokens 各做一次：一張走索引、一張走整表掃，兩條路都要帶條件。
func TestPurgeAccount_DoesNotDeleteRowThatChangedOwner(t *testing.T) {
	for _, table := range []string{"ChatConnections", "AuthTokens"} {
		m := seedPurgeDB(dueAt())
		var pk string
		for _, tb := range accountPurgeTables {
			if tb.name == table {
				pk = tb.pk
			}
		}
		stolen := false
		m.beforeDel = func(tbl string, key map[string]types.AttributeValue) {
			if tbl == "P_"+table && !stolen {
				m.tables[tbl][m.find(tbl, key)][pk] = sAttr("u-keep")
				stolen = true
			}
		}
		rep, err := PurgeAccount(context.Background(), m, "P_", "u-del", time.Unix(purgeNow, 0), false)
		if err != nil {
			t.Fatalf("%s：%v", table, err)
		}
		if !stolen {
			t.Fatalf("%s：測試沒有真的換到主人 ⇒ 下面的讀數不算數", table)
		}
		// 旁邊那個人原本 2 列，加上換過來的 1 列。
		if got := rowsOf(m, "P_"+table, pk, "u-keep"); got != 3 {
			t.Errorf("%s：旁邊那個人剩 %d 列，應為 3（換了主人的那一列被刪掉了）", table, got)
		}
		if rep.Rows[table] != 1 {
			t.Errorf("%s：回報刪了 %d 列，應為 1（沒刪成的不算）", table, rep.Rows[table])
		}
	}
}

// 墓碑寫上之後才出現的列（GSI 當時還沒同步、或別人後來才寫進來的通知）要被回掃清掉。
func TestResweepAccount(t *testing.T) {
	m := seedPurgeDB(dueAt())
	now := time.Unix(purgeNow, 0)
	if _, err := PurgeAccount(context.Background(), m, "P_", "u-del", now, false); err != nil {
		t.Fatal(err)
	}
	m.tables["P_Notifications"] = append(m.tables["P_Notifications"],
		map[string]types.AttributeValue{"userId": sAttr("u-del"), "notificationId": sAttr("late-1")})

	rep, err := ResweepAccount(context.Background(), m, "P_", "u-del", false)
	if err != nil || rep.Rows["Notifications"] != 1 || rowsOf(m, "P_Notifications", "userId", "u-del") != 0 {
		t.Errorf("回掃沒有清掉後來才出現的那一列：rep=%+v err=%v", rep, err)
	}
	if got := attrNames(userRow(m, "u-del")); got != "deleteRequestedAt,displayName,purgedAt,userId" {
		t.Errorf("回掃動到了墓碑：%s", got)
	}
	// 不是墓碑的人，回掃一列都不可以動 —— 這支沒有「到期」那道檢查，靠的就是這一條。
	d := m.deletes
	rep, err = ResweepAccount(context.Background(), m, "P_", "u-keep", false)
	if err != nil || rep.Skipped != "not a tombstone" || m.deletes != d {
		t.Errorf("對正常人回掃卻動了資料：rep=%+v err=%v", rep, err)
	}
	// 有人手動把同一個 userId 救回成活帳號、卻沒把 purgedAt 拿掉：不可以當成墓碑。
	row := userRow(m, "u-del")
	row["email"] = sAttr("back@example.invalid")
	m.tables["P_Ledger"] = append(m.tables["P_Ledger"], map[string]types.AttributeValue{"userId": sAttr("u-del"), "sortKey": sAttr("new")})
	rep, err = ResweepAccount(context.Background(), m, "P_", "u-del", false)
	if err != nil || rep.Skipped != "not a tombstone" || rowsOf(m, "P_Ledger", "userId", "u-del") != 1 {
		t.Errorf("被救回來的帳號被當成墓碑清了：rep=%+v err=%v", rep, err)
	}
}

// 一次排程執行：到期的清掉並寫墓碑、所有舊墓碑回掃、旁邊的人不動；
// 整表掃的那幾張不管處理幾個人，每張只掃一次。
func TestRunAccountPurge(t *testing.T) {
	m := seedPurgeDB(dueAt())
	now := time.Unix(purgeNow, 0)
	// 60 個很久以前的墓碑（超過第一版「一次只取 50 個、只看七天」的兩個限制），
	// 每個都有一則後來才被別人寫進來的通知；最後一個另有一列在整表掃的表裡。
	for i := 0; i < 60; i++ {
		id := "tomb-" + strconv.Itoa(i)
		m.tables["P_Users"] = append(m.tables["P_Users"], map[string]types.AttributeValue{
			"userId": sAttr(id), "displayName": sAttr(DeletedUserDisplayName),
			"deleteRequestedAt": nAttr(1), "purgedAt": nAttr(purgeNow - 400*86400)})
		m.tables["P_Notifications"] = append(m.tables["P_Notifications"],
			map[string]types.AttributeValue{"userId": sAttr(id), "notificationId": sAttr("n-" + id)})
	}
	m.tables["P_EventRedemptions"] = append(m.tables["P_EventRedemptions"],
		map[string]types.AttributeValue{"userId": sAttr("tomb-59"), "redemptionId": sAttr("r-tomb-59")})

	run, err := RunAccountPurge(context.Background(), m, "P_", now, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	if run.Due != 1 || run.Purged != 1 || run.Failed != 0 || run.Reswept != 60 {
		t.Errorf("run=%+v（應為 due=1 purged=1 reswept=60）", run)
	}
	for i := 0; i < 60; i++ {
		if n := rowsOf(m, "P_Notifications", "userId", "tomb-"+strconv.Itoa(i)); n != 0 {
			t.Errorf("tomb-%d 的通知沒有被回掃清掉", i)
		}
	}
	if rowsOf(m, "P_EventRedemptions", "userId", "tomb-59") != 0 {
		t.Errorf("整表掃的表裡，舊墓碑的列沒有被清掉")
	}
	for _, tb := range accountPurgeTables {
		if got := rowsOf(m, "P_"+tb.name, tb.pk, "u-del"); got != 0 {
			t.Errorf("%s：到期的人還剩 %d 列", tb.name, got)
		}
		if got := rowsOf(m, "P_"+tb.name, tb.pk, "u-keep"); got != 2 {
			t.Errorf("%s：旁邊那個人剩 %d 列，應為 2", tb.name, got)
		}
		if tb.scan && m.scans["P_"+tb.name] != 1 {
			t.Errorf("%s 被整表掃了 %d 次，應為 1（處理了 61 個人）", tb.name, m.scans["P_"+tb.name])
		}
	}
	if got := attrNames(userRow(m, "u-del")); got != "deleteRequestedAt,displayName,purgedAt,userId" {
		t.Errorf("到期的人沒有變成墓碑：%s", got)
	}

	// 第二次執行：沒有新到期的人、沒有新殘留 ⇒ 什麼都不刪。
	d := m.deletes
	run, err = RunAccountPurge(context.Background(), m, "P_", now, 20, false)
	if err != nil || run.Due != 0 || run.Reswept != 0 || m.deletes != d {
		t.Errorf("第二次不該再刪任何東西：run=%+v err=%v", run, err)
	}
}

// maxUsers 限制的是「這次新清幾個人」；試跑模式整次不動資料。
func TestRunAccountPurge_LimitAndDryRun(t *testing.T) {
	m := &memDB{tables: map[string][]map[string]types.AttributeValue{}}
	for i := 0; i < 5; i++ {
		m.tables["P_Users"] = append(m.tables["P_Users"], map[string]types.AttributeValue{
			"userId": sAttr("d" + strconv.Itoa(i)), "email": sAttr("x"), "deleteRequestedAt": nAttr(dueAt())})
		m.tables["P_AuthTokens"] = append(m.tables["P_AuthTokens"], map[string]types.AttributeValue{
			"userId": sAttr("d" + strconv.Itoa(i)), "tokenHash": sAttr("h" + strconv.Itoa(i))})
	}
	now := time.Unix(purgeNow, 0)
	run, err := RunAccountPurge(context.Background(), m, "P_", now, 2, true)
	if err != nil || run.Purged != 2 || m.deletes != 0 || m.puts != 0 {
		t.Errorf("試跑：run=%+v err=%v deletes=%d puts=%d", run, err, m.deletes, m.puts)
	}
	run, err = RunAccountPurge(context.Background(), m, "P_", now, 2, false)
	if err != nil || run.Purged != 2 || m.puts != 2 || len(m.tables["P_AuthTokens"]) != 3 {
		t.Errorf("limit=2：run=%+v err=%v puts=%d 剩餘 token=%d（應為 3）", run, err, m.puts, len(m.tables["P_AuthTokens"]))
	}
}

// 名單是掃出來的，掃完到動手之間那個人可能已經不該清了（例如被手動撤銷刪除）。
// 整表掃那一步是「照名單刪」，所以名單上每個人都要先重讀確認 —— 沒確認的話他的列會先被刪掉，
// 而後面 PurgeAccount 自己的重讀只擋得住墓碑，擋不住這一步。
func TestRunAccountPurge_RechecksEachUserBeforeScanTables(t *testing.T) {
	m := &memDB{tables: map[string][]map[string]types.AttributeValue{}}
	m.tables["P_Users"] = []map[string]types.AttributeValue{
		{"userId": sAttr("d0"), "email": sAttr("x"), "deleteRequestedAt": nAttr(dueAt())}}
	m.tables["P_AuthTokens"] = []map[string]types.AttributeValue{{"userId": sAttr("d0"), "tokenHash": sAttr("h0")}}
	m.tables["P_Ledger"] = []map[string]types.AttributeValue{{"userId": sAttr("d0"), "sortKey": sAttr("s0")}}
	restored := false
	m.beforeGet = func(table string, _ map[string]types.AttributeValue) {
		if table == "P_Users" && !restored {
			delete(m.tables["P_Users"][0], "deleteRequestedAt")
			restored = true
		}
	}
	run, err := RunAccountPurge(context.Background(), m, "P_", time.Unix(purgeNow, 0), 20, false)
	if err != nil || !restored {
		t.Fatalf("run=%+v err=%v restored=%v", run, err, restored)
	}
	if len(m.tables["P_AuthTokens"]) != 1 || len(m.tables["P_Ledger"]) != 1 || m.puts != 0 {
		t.Errorf("已經被救回來的人被清了：AuthTokens=%d Ledger=%d puts=%d", len(m.tables["P_AuthTokens"]), len(m.tables["P_Ledger"]), m.puts)
	}
	if run.Purged != 0 || run.Skipped != 1 {
		t.Errorf("run=%+v（應為 purged=0 skipped=1）", run)
	}
}
