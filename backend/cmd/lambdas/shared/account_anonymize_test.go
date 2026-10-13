package shared

import (
	"context"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func player(id, name string) types.AttributeValue {
	return &types.AttributeValueMemberM{Value: map[string]types.AttributeValue{
		"userId": sAttr(id), "displayName": sAttr(name), "pictureUrl": sAttr("https://x/" + id), "lineId": sAttr("line-" + id)}}
}

func playerList(ps ...types.AttributeValue) types.AttributeValue {
	return &types.AttributeValueMemberL{Value: ps}
}

// 一個到期的人（u-del）與旁邊的正常人（u-keep），在別人的紀錄裡各留了名字副本。
func seedNameCopies(m *memDB) {
	for _, u := range []string{"u-del", "u-keep"} {
		name := "名字-" + u
		m.tables["P_Registrations"] = append(m.tables["P_Registrations"],
			map[string]types.AttributeValue{"registrationId": sAttr("reg-" + u), "userId": sAttr(u), "displayName": sAttr(name)})
		for _, tb := range []string{"P_Ratings", "P_RatingComments"} {
			m.tables[tb] = append(m.tables[tb],
				map[string]types.AttributeValue{"gameId": sAttr("g1"), "fromUserId": sAttr(u), "fromDisplayName": sAttr(name)})
		}
		m.tables["P_ChatMessages"] = append(m.tables["P_ChatMessages"],
			map[string]types.AttributeValue{"RoomID": sAttr("r1"), "Timestamp#MessageID": sAttr("t-" + u), "SenderID": sAttr(u), "SenderName": sAttr(name)})
	}
	m.tables["P_Games"] = []map[string]types.AttributeValue{
		// 被刪的人主辦、正常人參加
		{"gameId": sAttr("g-host-del"), "hostUserId": sAttr("u-del"), "hostDisplayName": sAttr("名字-u-del"),
			"joinedPlayers": playerList(player("u-keep", "名字-u-keep"))},
		// 正常人主辦、兩個人都參加
		{"gameId": sAttr("g-host-keep"), "hostUserId": sAttr("u-keep"), "hostDisplayName": sAttr("名字-u-keep"),
			"joinedPlayers": playerList(player("u-del", "名字-u-del"), player("u-keep", "名字-u-keep"))},
	}
}

func strOf(item map[string]types.AttributeValue, k string) string {
	if v, ok := item[k].(*types.AttributeValueMemberS); ok {
		return v.Value
	}
	return "<無>"
}

func playersOf(row map[string]types.AttributeValue) []map[string]types.AttributeValue {
	var out []map[string]types.AttributeValue
	for _, el := range row["joinedPlayers"].(*types.AttributeValueMemberL).Value {
		out = append(out, el.(*types.AttributeValueMemberM).Value)
	}
	return out
}

func checkNameCopies(t *testing.T, m *memDB, wantDelName string) {
	t.Helper()
	for tb, cols := range map[string][2]string{
		"P_Registrations": {"userId", "displayName"}, "P_Ratings": {"fromUserId", "fromDisplayName"},
		"P_RatingComments": {"fromUserId", "fromDisplayName"}, "P_ChatMessages": {"SenderID", "SenderName"},
	} {
		for _, row := range m.tables[tb] {
			want := "名字-u-keep"
			if strOf(row, cols[0]) == "u-del" {
				want = wantDelName
			}
			if got := strOf(row, cols[1]); got != want {
				t.Errorf("%s：%s 的名字是 %q，應為 %q", tb, strOf(row, cols[0]), got, want)
			}
		}
	}
	g1, g2 := m.tables["P_Games"][0], m.tables["P_Games"][1]
	if got := strOf(g1, "hostDisplayName"); got != wantDelName {
		t.Errorf("被刪的人主辦的團：hostDisplayName=%q，應為 %q", got, wantDelName)
	}
	if got := strOf(g2, "hostDisplayName"); got != "名字-u-keep" {
		t.Errorf("正常人主辦的團：hostDisplayName 被動到了：%q", got)
	}
	// 正常人在兩份成員名單裡都要原封不動（名字、大頭貼、lineId）。
	for _, p := range append(playersOf(g1), playersOf(g2)...) {
		if strOf(p, "userId") != "u-keep" {
			continue
		}
		if strOf(p, "displayName") != "名字-u-keep" || strOf(p, "pictureUrl") != "https://x/u-keep" || strOf(p, "lineId") != "line-u-keep" {
			t.Errorf("成員名單裡的正常人被動到了：%v", p)
		}
	}
}

func TestRunAccountPurge_AnonymizesNameCopies(t *testing.T) {
	m := seedPurgeDB(dueAt())
	seedNameCopies(m)
	now := time.Unix(purgeNow, 0)

	// 試跑：講得出會改幾處，但一個字都不改。
	run, err := RunAccountPurge(context.Background(), m, "P_", now, 20, true)
	if err != nil || m.updates != 0 {
		t.Fatalf("試跑：run=%+v err=%v updates=%d", run, err, m.updates)
	}
	checkNameCopies(t, m, "名字-u-del")
	if run.NameCopies["u-del"]["Registrations.displayName"] != 1 || run.NameCopies["u-del"]["Games.joinedPlayers"] != 1 {
		t.Errorf("試跑沒有預告名字副本：%v", run.NameCopies)
	}

	run, err = RunAccountPurge(context.Background(), m, "P_", now, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	checkNameCopies(t, m, DeletedUserDisplayName)
	var del map[string]types.AttributeValue
	for _, p := range playersOf(m.tables["P_Games"][1]) {
		if strOf(p, "userId") == "u-del" {
			del = p
		}
	}
	if strOf(del, "displayName") != DeletedUserDisplayName || strOf(del, "pictureUrl") != "" {
		t.Errorf("成員名單裡被刪的人：%v", del)
	}
	if _, has := del["lineId"]; has {
		t.Errorf("成員名單裡被刪的人還留著 lineId")
	}
	want := map[string]int{"Registrations.displayName": 1, "Ratings.fromDisplayName": 1, "RatingComments.fromDisplayName": 1,
		"ChatMessages.SenderName": 1, "Games.hostDisplayName": 1, "Games.joinedPlayers": 1}
	for k, n := range want {
		if run.NameCopies["u-del"][k] != n {
			t.Errorf("回報 %s=%d，應為 %d（全部：%v）", k, run.NameCopies["u-del"][k], n, run.NameCopies)
		}
	}
	if len(run.NameCopies) != 1 {
		t.Errorf("回報裡出現了別人：%v", run.NameCopies)
	}
	if _, has := userRow(m, "u-del")["anonymizedAt"]; !has {
		t.Errorf("做完沒有在墓碑上記 anonymizedAt")
	}

	// 做過的人不再掃：第二次執行那幾張表一次都不可以被 Scan。
	before := m.scans["P_Games"] + m.scans["P_ChatMessages"] + m.scans["P_Registrations"]
	if _, err := RunAccountPurge(context.Background(), m, "P_", now, 20, false); err != nil {
		t.Fatal(err)
	}
	if after := m.scans["P_Games"] + m.scans["P_ChatMessages"] + m.scans["P_Registrations"]; after != before {
		t.Errorf("沒有新清除的人，名字副本那幾張表卻又被整表掃了（%d → %d）", before, after)
	}
}

// 成員名單在我讀到之後被別人改了（有人加入）⇒ 這一列這次不換，那個人不可以被記成做完，下一次補上。
func TestAnonymize_ListChangedUnderneathIsRetriedNextRun(t *testing.T) {
	m := seedPurgeDB(dueAt())
	seedNameCopies(m)
	now := time.Unix(purgeNow, 0)
	raced := false
	m.beforeUpd = func(table string, key map[string]types.AttributeValue) {
		if table == "P_Games" && !raced && strOf(key, "gameId") == "g-host-keep" {
			row := m.tables["P_Games"][1]
			old := row["joinedPlayers"].(*types.AttributeValueMemberL).Value
			row["joinedPlayers"] = playerList(append(append([]types.AttributeValue{}, old...), player("u-new", "新來的"))...)
			raced = true
		}
	}
	if _, err := RunAccountPurge(context.Background(), m, "P_", now, 20, false); err != nil {
		t.Fatal(err)
	}
	if !raced {
		t.Fatal("測試沒有真的製造出並行修改 ⇒ 下面的讀數不算數")
	}
	if len(playersOf(m.tables["P_Games"][1])) != 3 {
		t.Fatalf("別人剛加入的那個人被蓋掉了")
	}
	if _, has := userRow(m, "u-del")["anonymizedAt"]; has {
		t.Errorf("有一列沒改成，卻被記成做完")
	}
	// 下一次補上。
	if _, err := RunAccountPurge(context.Background(), m, "P_", now, 20, false); err != nil {
		t.Fatal(err)
	}
	for _, p := range playersOf(m.tables["P_Games"][1]) {
		if strOf(p, "userId") == "u-del" && strOf(p, "displayName") != DeletedUserDisplayName {
			t.Errorf("下一次執行沒有補上：%v", p)
		}
	}
	if _, has := userRow(m, "u-del")["anonymizedAt"]; !has {
		t.Errorf("補完之後應該記 anonymizedAt")
	}
}
