package shared

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// 清除核心對**真的 stg DynamoDB** 跑一次。預設不跑：
//
//	RYO_PURGE_LIVE=1 go test ./cmd/lambdas/shared/ -run TestPurgeAccountLive -count=1 -v
//
// 為什麼需要：accountPurgeTables 的表名、索引名、鍵名是從 describe-table 抄來的。
// 抄錯的後果是「查不到所以沒刪」而不是錯誤，記憶體假件完全照我寫的鍵名回答，量不到這件事。
//
// ⚠️ 這條量得到的：表與索引存在、照那份鍵名查得到並刪得掉「使用者 id 放在 liveSchema 那個欄位」的列。
//
//	量不到的：線上真實資料是不是真的把使用者 id 放在那個欄位（liveSchema 也是我抄的）；
//	以及 accountPurgeTables **漏列**了哪張表。
//
// 只碰兩個合成帳號（PURGEPROBE-DELETEME-…）：一個到期該清，一個是旁邊的正常人。
// 🔴 寫死只認 Stg 前綴；跑完兩個人的資料全部刪掉並讀回。
func TestPurgeAccountLive(t *testing.T) {
	if os.Getenv("RYO_PURGE_LIVE") != "1" {
		t.Skip("沒設 RYO_PURGE_LIVE=1 ⇒ 不碰線上")
	}
	const prefix = "MahjongClubStg_"
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-southeast-1"))
	if err != nil {
		t.Fatalf("設備：載不到 AWS 設定：%v", err)
	}
	db := dynamodb.NewFromConfig(cfg)

	now := time.Now()
	tag := strconv.FormatInt(now.UnixNano(), 10)
	del, keep := "PURGEPROBE-DELETEME-"+tag+"-DEL", "PURGEPROBE-DELETEME-"+tag+"-KEEP"
	requestedAt := accountPurgeCutoff(now) - 60

	// 🔴 測試列**不可以**照 accountPurgeTables 的 pk 來長。第一版就是那樣寫的，結果把
	//    Notifications 的 pk 故意改成 notificationId（另一個合法的鍵）時這條照樣通過 ——
	//    測試資料跟著被測的那份表一起錯。所以「使用者 id 放在哪個欄位」「主鍵有哪些」
	//    在這裡各寫一份獨立的（2026-10-13 抄自 stg 的 describe-table），兩份對不上才會紅。
	liveSchema := map[string]struct {
		userAttr string
		keys     []string
	}{
		"AuthIdentities":                {"userId", []string{"identity"}},
		"PushSubscriptions_MultiDevice": {"userId", []string{"userId", "deviceId"}},
		"Notifications":                 {"userId", []string{"notificationId"}},
		"Ledger":                        {"userId", []string{"userId", "sortKey"}},
		"PointTransactions":             {"userId", []string{"userId", "sortKey"}},
		"DailyClaims":                   {"userID", []string{"userID", "claimDate"}},
		"ChatUserMemberships":           {"UserID", []string{"UserID", "LastMessageTime#RoomID"}},
		"ChatConnections":               {"UserID", []string{"ConnectionID"}},
		"AuthTokens":                    {"userId", []string{"tokenHash"}},
		"EventRedemptions":              {"userId", []string{"redemptionId"}},
	}
	if len(liveSchema) != len(accountPurgeTables) {
		t.Fatalf("liveSchema 有 %d 張表、accountPurgeTables 有 %d 張 ⇒ 有表沒被這條量到", len(liveSchema), len(accountPurgeTables))
	}
	rowFor := func(tb accountPurgeTable, user string) map[string]types.AttributeValue {
		sc, ok := liveSchema[tb.name]
		if !ok {
			t.Fatalf("liveSchema 沒有 %s", tb.name)
		}
		row := map[string]types.AttributeValue{sc.userAttr: sAttr(user)}
		for _, k := range sc.keys {
			if k != sc.userAttr {
				row[k] = sAttr(user + "-" + tb.name)
			}
		}
		if tb.name == "Notifications" {
			// userId-createdAt-index 的排序鍵是 Number；少了它這一列不會進索引，查不到。
			row["createdAt"] = nAttr(now.Unix())
		}
		return row
	}
	keyOf := func(tb accountPurgeTable, row map[string]types.AttributeValue) map[string]types.AttributeValue {
		key := map[string]types.AttributeValue{}
		for _, k := range liveSchema[tb.name].keys {
			key[k] = row[k]
		}
		return key
	}
	userKey := func(u string) map[string]types.AttributeValue {
		return map[string]types.AttributeValue{"userId": sAttr(u)}
	}
	// 收尾：每一列都刪、刪除的錯誤要看、刪完每一列都讀回。
	// 第一版只讀回 Users、而且把八張表的刪除錯誤吞掉（2026-10-13 Codex 覆驗指出）——
	// 那樣寫的話「清乾淨了」這句話只對 Users 成立。
	defer func() {
		for _, u := range []string{del, keep} {
			for _, tb := range accountPurgeTables {
				key := keyOf(tb, rowFor(tb, u))
				if _, err := db.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: aws.String(prefix + tb.name), Key: key}); err != nil {
					t.Errorf("🔴 清理：%s／%s 刪除失敗：%v", tb.name, u, err)
				}
				out, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(prefix + tb.name), Key: key, ConsistentRead: aws.Bool(true)})
				if err != nil || len(out.Item) != 0 {
					t.Errorf("🔴 清理：%s／%s 仍有殘留（err=%v）", tb.name, u, err)
				}
			}
			if _, err := db.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: aws.String(prefix + "Users"), Key: userKey(u)}); err != nil {
				t.Errorf("🔴 清理：Users／%s 刪除失敗：%v", u, err)
			}
			out, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(prefix + "Users"), Key: userKey(u), ConsistentRead: aws.Bool(true)})
			if err != nil || len(out.Item) != 0 {
				t.Errorf("🔴 清理：Users 殘留 %s（err=%v）", u, err)
			}
		}
	}()

	for _, u := range []string{del, keep} {
		user := map[string]types.AttributeValue{"userId": sAttr(u), "displayName": sAttr("probe"),
			"email": sAttr(strings.ToLower(u) + "@example.invalid"), "passwordHash": sAttr("x"), "points": nAttr(7)}
		if u == del {
			user["deleteRequestedAt"] = nAttr(requestedAt)
		}
		if _, err := db.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(prefix + "Users"), Item: user}); err != nil {
			t.Fatalf("設備：建不出 %s：%v", u, err)
		}
		for _, tb := range accountPurgeTables {
			if _, err := db.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(prefix + tb.name), Item: rowFor(tb, u)}); err != nil {
				t.Fatalf("設備：%s 寫不進測試列（鍵名或型別與線上不符？）：%v", tb.name, err)
			}
		}
	}
	// GSI 是最終一致的；剛寫進去的列要等一下才查得到。
	time.Sleep(3 * time.Second)

	due, err := FindAccountsDueForPurge(ctx, db, prefix, now, 50)
	if err != nil {
		t.Fatalf("Find：%v", err)
	}
	found := map[string]bool{}
	for _, u := range due {
		found[u] = true
	}
	if !found[del] || found[keep] {
		t.Errorf("Find 的結果不對：到期的在不在=%v、正常人在不在=%v（全部 %v）", found[del], found[keep], due)
	}

	dry, err := PurgeAccount(ctx, db, prefix, del, now, true)
	if err != nil || dry.Skipped != "" {
		t.Fatalf("dry run：rep=%+v err=%v", dry, err)
	}
	for _, tb := range accountPurgeTables {
		// 這一格就是在量「鍵名抄對了沒」：抄錯的話這裡是 0。
		if dry.Rows[tb.name] != 1 {
			t.Errorf("dry run 在 %s 找到 %d 列，應為 1", tb.name, dry.Rows[tb.name])
		}
	}

	// 走排程實際走的那條路：整表掃的表先各掃一次（只給它這一個合成帳號），再清其餘各表並寫墓碑。
	// 🔴 刻意不直接呼叫 RunAccountPurge：它會處理 stg 上**所有**到期的帳號，不只我的合成帳號。
	scanned, err := purgeScanTablesFor(ctx, db, prefix, map[string]bool{del: true}, false)
	if err != nil || scanned[del]["AuthTokens"] != 1 || scanned[del]["EventRedemptions"] != 1 {
		t.Fatalf("整表掃：%v err=%v（兩張表各應刪 1 列）", scanned, err)
	}
	rep, err := purgeAccount(ctx, db, prefix, del, now, false, true)
	if err != nil || rep.Skipped != "" || rep.Rows["Users"] != 1 {
		t.Fatalf("清除：rep=%+v err=%v", rep, err)
	}
	for _, tb := range accountPurgeTables {
		for u, want := range map[string]int{del: 0, keep: 1} {
			out, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(prefix + tb.name), Key: keyOf(tb, rowFor(tb, u)), ConsistentRead: aws.Bool(true)})
			got := 0
			if err == nil && len(out.Item) > 0 {
				got = 1
			}
			if err != nil || got != want {
				t.Errorf("%s／%s：剩 %d 列，應為 %d（err=%v）", tb.name, u, got, want, err)
			}
		}
	}
	tomb, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(prefix + "Users"), Key: userKey(del), ConsistentRead: aws.Bool(true)})
	if err != nil || attrNames(tomb.Item) != "deleteRequestedAt,displayName,purgedAt,userId" {
		t.Errorf("墓碑的屬性是 %s（err=%v）", attrNames(tomb.Item), err)
	}
	kept, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(prefix + "Users"), Key: userKey(keep), ConsistentRead: aws.Bool(true)})
	if err != nil || attrNames(kept.Item) != "displayName,email,passwordHash,points,userId" {
		t.Errorf("旁邊那個人的 Users 列被動到了：%s（err=%v）", attrNames(kept.Item), err)
	}
}

// 名字副本處理對**真的 stg DynamoDB** 跑一次（同樣要 RYO_PURGE_LIVE=1）。
//
// 量的是 nameCopyTables 的表名、鍵名、欄位名在線上的表上行得通：整表掃得到、條件式更新寫得進去，
// 包括 ChatMessages 那個帶 # 的鍵名與 Games 的成員名單（List of Map 的整份比對）。
// 測試列照下面這份獨立的對照產生，不是照 nameCopyTables（理由同上一條測試）。
// ⚠️ 量不到：線上真實資料的欄位是不是真的長這樣（這份對照也是我照 struct 抄的）。
func TestAnonymizeNameCopiesLive(t *testing.T) {
	if os.Getenv("RYO_PURGE_LIVE") != "1" {
		t.Skip("沒設 RYO_PURGE_LIVE=1 ⇒ 不碰線上")
	}
	const prefix = "MahjongClubStg_"
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-southeast-1"))
	if err != nil {
		t.Fatalf("設備：載不到 AWS 設定：%v", err)
	}
	db := dynamodb.NewFromConfig(cfg)
	tag := strconv.FormatInt(time.Now().UnixNano(), 10)
	del, keep := "ANONPROBE-DELETEME-"+tag+"-DEL", "ANONPROBE-DELETEME-"+tag+"-KEEP"

	type liveRow struct {
		table string
		key   map[string]types.AttributeValue
		item  map[string]types.AttributeValue
	}
	var rows []liveRow
	add := func(table string, key, rest map[string]types.AttributeValue) {
		item := map[string]types.AttributeValue{}
		for k, v := range key {
			item[k] = v
		}
		for k, v := range rest {
			item[k] = v
		}
		rows = append(rows, liveRow{prefix + table, key, item})
	}
	for _, u := range []string{del, keep} {
		add("Registrations", map[string]types.AttributeValue{"registrationId": sAttr("reg-" + u)},
			map[string]types.AttributeValue{"userId": sAttr(u), "displayName": sAttr("名字-" + u)})
		for _, tb := range []string{"Ratings", "RatingComments"} {
			add(tb, map[string]types.AttributeValue{"gameId": sAttr("anonprobe-" + tag), "fromUserId": sAttr(u)},
				map[string]types.AttributeValue{"fromDisplayName": sAttr("名字-" + u)})
		}
		add("ChatMessages", map[string]types.AttributeValue{"RoomID": sAttr("anonprobe-" + tag), "Timestamp#MessageID": sAttr("t-" + u)},
			map[string]types.AttributeValue{"SenderID": sAttr(u), "SenderName": sAttr("名字-" + u)})
	}
	add("Games", map[string]types.AttributeValue{"gameId": sAttr("anonprobe-host-del-" + tag)}, map[string]types.AttributeValue{
		"hostUserId": sAttr(del), "hostDisplayName": sAttr("名字-" + del), "joinedPlayers": playerList(player(keep, "名字-"+keep))})
	add("Games", map[string]types.AttributeValue{"gameId": sAttr("anonprobe-host-keep-" + tag)}, map[string]types.AttributeValue{
		"hostUserId": sAttr(keep), "hostDisplayName": sAttr("名字-" + keep),
		"joinedPlayers": playerList(player(del, "名字-"+del), player(keep, "名字-"+keep))})

	defer func() {
		for _, r := range rows {
			if _, err := db.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: aws.String(r.table), Key: r.key}); err != nil {
				t.Errorf("🔴 清理：%s 刪除失敗：%v", r.table, err)
			}
			out, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(r.table), Key: r.key, ConsistentRead: aws.Bool(true)})
			if err != nil || len(out.Item) != 0 {
				t.Errorf("🔴 清理：%s 仍有殘留（err=%v）", r.table, err)
			}
		}
	}()
	for _, r := range rows {
		if _, err := db.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(r.table), Item: r.item}); err != nil {
			t.Fatalf("設備：%s 寫不進測試列（鍵名或型別與線上不符？）：%v", r.table, err)
		}
	}

	counts, incomplete, err := anonymizeNameCopiesFor(ctx, db, prefix, map[string]bool{del: true}, false)
	if err != nil || len(incomplete) != 0 {
		t.Fatalf("anonymize：counts=%v incomplete=%v err=%v", counts, incomplete, err)
	}
	for _, what := range []string{"Registrations.displayName", "Ratings.fromDisplayName", "RatingComments.fromDisplayName",
		"ChatMessages.SenderName", "Games.hostDisplayName", "Games.joinedPlayers"} {
		if counts[del][what] != 1 {
			t.Errorf("%s 改了 %d 列，應為 1（全部：%v）", what, counts[del][what], counts[del])
		}
	}
	if len(counts) != 1 {
		t.Errorf("回報裡出現了別人：%v", counts)
	}
	// 讀回每一列：被刪的人的名字欄位都換了、旁邊那個人的都沒動。
	nameAttrOf := map[string][2]string{"Registrations": {"userId", "displayName"}, "Ratings": {"fromUserId", "fromDisplayName"},
		"RatingComments": {"fromUserId", "fromDisplayName"}, "ChatMessages": {"SenderID", "SenderName"}, "Games": {"hostUserId", "hostDisplayName"}}
	for _, r := range rows {
		out, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(r.table), Key: r.key, ConsistentRead: aws.Bool(true)})
		if err != nil {
			t.Fatalf("讀回 %s：%v", r.table, err)
		}
		cols := nameAttrOf[strings.TrimPrefix(r.table, prefix)]
		owner := strOf(out.Item, cols[0])
		want := "名字-" + owner
		if owner == del {
			want = DeletedUserDisplayName
		}
		if got := strOf(out.Item, cols[1]); got != want {
			t.Errorf("%s／%s：%s=%q，應為 %q", r.table, owner, cols[1], got, want)
		}
		if _, isGame := out.Item["joinedPlayers"]; isGame {
			for _, p := range playersOf(out.Item) {
				id, _, hasLine := strOf(p, "userId"), 0, p["lineId"] != nil
				wantName, wantLine := "名字-"+id, true
				if id == del {
					wantName, wantLine = DeletedUserDisplayName, false
				}
				if strOf(p, "displayName") != wantName || hasLine != wantLine {
					t.Errorf("%s 的成員 %s：displayName=%q lineId 在不在=%v", r.table, id, strOf(p, "displayName"), hasLine)
				}
			}
		}
	}
}
