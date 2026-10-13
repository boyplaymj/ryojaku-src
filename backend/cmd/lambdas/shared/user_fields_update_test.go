package shared

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func TestBuildUserFieldsUpdate(t *testing.T) {
	item, err := attributevalue.MarshalMap(&User{UserID: "u1", DisplayName: "阿明", Points: 30})
	if err != nil {
		t.Fatal(err)
	}
	in, err := BuildUserFieldsUpdate("P_", item)
	if err != nil {
		t.Fatal(err)
	}
	if *in.TableName != "P_Users" || in.Key["userId"].(*types.AttributeValueMemberS).Value != "u1" {
		t.Errorf("table／key 不對：%s %v", *in.TableName, in.Key)
	}
	expr := *in.UpdateExpression
	// 只可以有 SET：REMOVE 會清掉東西，而這支存在的理由就是「不動沒列出來的屬性」。
	if !strings.HasPrefix(expr, "SET ") || strings.Contains(expr, "REMOVE") || strings.Contains(expr, "DELETE") {
		t.Errorf("UpdateExpression = %s", expr)
	}
	// 鍵不可以出現在 SET 裡（DynamoDB 會拒絕），其餘每個欄位都要在、而且都用別名。
	set := map[string]bool{}
	for _, n := range in.ExpressionAttributeNames {
		set[n] = true
	}
	if set["userId"] || !set["displayName"] || !set["points"] || len(set) != len(item)-1 {
		t.Errorf("SET 的欄位不對：%v（item 有 %d 個屬性）", set, len(item))
	}
	if regexp.MustCompile(`[ ,]([a-zA-Z]+) = `).MatchString(expr) {
		t.Errorf("有欄位沒用別名（points／rating／stats 是保留字）：%s", expr)
	}
	// 墓碑不可以被寫回成活帳號；不存在的人不可以被憑空建出來。
	if got := *in.ConditionExpression; got != "attribute_exists(userId) AND attribute_not_exists(purgedAt)" {
		t.Errorf("condition = %s", got)
	}
	for _, bad := range []map[string]types.AttributeValue{{}, {"displayName": sAttr("x")}, {"userId": sAttr("")}, {"userId": sAttr("u1")}} {
		if _, err := BuildUserFieldsUpdate("P_", bad); err == nil {
			t.Errorf("%v 應該被拒絕", bad)
		}
	}
}

// TestNoWholeRowPutToUsers：除了「建立新帳號」（帶 attribute_not_exists(userId)）與清除寫墓碑那一處，
// 不可以再有對 Users 的 PutItem。
//
// PutItem 是整列換掉。shared.User 不認得 pwChangedAt、deleteRequestedAt、purgedAt 這些屬性，
// 所以「讀出來、改幾個欄位、PutItem 寫回去」會把它們洗掉 —— 2026-10-13 之前有兩處這樣寫
// （web_submit_rating 的 saveUser、web_create_game 的 SaveUser）。
//
// 🔴 照不到的：表名不是寫成 "Users" 字面、或 PutItem 與表名相隔超過 14 行的寫法；
//
//	以及 TransactWriteItems 裡不叫 Put 的寫入。
func TestNoWholeRowPutToUsers(t *testing.T) {
	root := ".."
	var files []string
	for _, pat := range []string{filepath.Join(root, "apis", "*", "*.go"), "*.go"} {
		m, err := filepath.Glob(pat)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, m...)
	}
	if len(files) < 80 {
		t.Fatalf("只掃到 %d 個檔 ⇒ 掃描範圍不對，下面的結論不算數", len(files))
	}
	usersRef := regexp.MustCompile(`Users"|usersTable\(\)|GetTableName\("Users"\)`)
	allowed := map[string]string{
		"account_purge.go": "清除寫墓碑：就是要整列換掉，而且帶條件",
	}
	creations, checked := 0, 0
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(string(b), "\n")
		for i, l := range lines {
			if !strings.Contains(l, "PutItem(") && !strings.Contains(l, "types.Put{") {
				continue
			}
			lo, hi := i-14, i+8
			if lo < 0 {
				lo = 0
			}
			if hi > len(lines) {
				hi = len(lines)
			}
			ctx := strings.Join(lines[lo:hi], "\n")
			if !usersRef.MatchString(ctx) {
				continue
			}
			checked++
			if _, ok := allowed[filepath.Base(path)]; ok {
				continue
			}
			if strings.Contains(ctx, "attribute_not_exists(userId)") {
				creations++
				continue
			}
			t.Errorf("%s:%d 對 Users 做 PutItem 而沒有 attribute_not_exists(userId) —— 整列寫回會洗掉 pwChangedAt／deleteRequestedAt；改用 shared.UpdateUserFields",
				filepath.ToSlash(path), i+1)
		}
	}
	// 今天的讀數：三個建帳號入口（註冊／Google／LINE）。一個都沒找到代表掃法已經照不到東西。
	if creations < 3 {
		t.Fatalf("只找到 %d 處建帳號的 PutItem（共檢查 %d 處）⇒ 這條的掃法可能已經失效", creations, checked)
	}
}

// 對真的 stg DynamoDB：UpdateUserFields 寫回之後，結構不認得的屬性都還在；對墓碑則一個字都不寫。
// （同樣要 RYO_PURGE_LIVE=1。量的是那條 UpdateExpression 在真的 DynamoDB 上收不收，
//
//	以及「其他屬性原封不動」這件事 —— 假件量不到前者。）
func TestUpdateUserFieldsLive(t *testing.T) {
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
	live, tomb := "USERFIELDS-DELETEME-"+tag+"-LIVE", "USERFIELDS-DELETEME-"+tag+"-TOMB"
	key := func(u string) map[string]types.AttributeValue {
		return map[string]types.AttributeValue{"userId": sAttr(u)}
	}
	get := func(u string) map[string]types.AttributeValue {
		out, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(prefix + "Users"), Key: key(u), ConsistentRead: aws.Bool(true)})
		if err != nil {
			t.Fatalf("讀回 %s：%v", u, err)
		}
		return out.Item
	}
	defer func() {
		for _, u := range []string{live, tomb} {
			if _, err := db.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: aws.String(prefix + "Users"), Key: key(u)}); err != nil {
				t.Errorf("🔴 清理：%s 刪除失敗：%v", u, err)
			}
			if len(get(u)) != 0 {
				t.Errorf("🔴 清理：%s 仍有殘留", u)
			}
		}
	}()
	seed := map[string]map[string]types.AttributeValue{
		live: {"userId": sAttr(live), "displayName": sAttr("舊名字"), "points": nAttr(100),
			"pwChangedAt": nAttr(1_800_000_000), "deleteRequestedAt": nAttr(1_800_000_001), "someFutureField": sAttr("結構不認得的欄位")},
		tomb: {"userId": sAttr(tomb), "displayName": sAttr(DeletedUserDisplayName), "deleteRequestedAt": nAttr(1), "purgedAt": nAttr(2)},
	}
	for u, item := range seed {
		if _, err := db.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(prefix + "Users"), Item: item}); err != nil {
			t.Fatalf("設備：建不出 %s：%v", u, err)
		}
	}

	// 活帳號：模擬「讀出來、扣點數、寫回去」。
	if err := UpdateUserFields(ctx, db, prefix, &User{UserID: live, DisplayName: "舊名字", Points: 70, Stats: &UserStats{GamesHosted: 1}}); err != nil {
		t.Fatalf("UpdateUserFields：%v（UpdateExpression 在真的 DynamoDB 上不收？）", err)
	}
	got := get(live)
	if n, _ := got["points"].(*types.AttributeValueMemberN); n == nil || n.Value != "70" {
		t.Errorf("points 沒有寫進去：%v", got["points"])
	}
	for attr, want := range map[string]string{"pwChangedAt": "1800000000", "deleteRequestedAt": "1800000001"} {
		if n, _ := got[attr].(*types.AttributeValueMemberN); n == nil || n.Value != want {
			t.Errorf("%s 被洗掉或改掉了：%v", attr, got[attr])
		}
	}
	if strOf(got, "someFutureField") != "結構不認得的欄位" {
		t.Errorf("結構不認得的欄位被洗掉了：%v", got["someFutureField"])
	}

	// 墓碑：不寫，而且回的是條件不成立。
	err = UpdateUserFields(ctx, db, prefix, &User{UserID: tomb, DisplayName: "想寫回來的名字", Points: 5})
	var ccf *types.ConditionalCheckFailedException
	if err == nil || !errorsAs(err, &ccf) {
		t.Errorf("對墓碑應該回 ConditionalCheckFailedException，得到 %v", err)
	}
	if got := attrNames(get(tomb)); got != "deleteRequestedAt,displayName,purgedAt,userId" {
		t.Errorf("墓碑被寫到了：%s", got)
	}
}

func errorsAs(err error, target **types.ConditionalCheckFailedException) bool {
	for err != nil {
		if e, ok := err.(*types.ConditionalCheckFailedException); ok {
			*target = e
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
