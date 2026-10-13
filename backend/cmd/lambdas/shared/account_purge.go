package shared

// 帳號刪除 —— 停用期滿之後的清除（刪除頁第四、五條）。
//
// 這一支只清「這個人自己的資料」：用 userId 當鍵就找得到的那幾張表，加上把 Users 那一列換成墓碑。
//
// 另一半 —— 別人紀錄裡**存下來的名字副本** —— 在 account_anonymize.go，由 RunAccountPurge 在墓碑寫上之後呼叫。
// 🔴 也沒清的：S3 上的大頭貼檔案。
// ⓘ 刻意保留的：RedeemCodes.usedBy。那是「這張兌換碼被用掉了」的庫存紀錄，不是這個人的資料；
//    它留下的 userId 之後只對得到墓碑，與別人牌局裡留下的 userId 同一種處理。
//
// 2026-10-13 Codex 覆驗後補的三件事（原本各自會造成清不乾淨或清錯）：
//   1. 用 GSI 找列的表（AuthIdentities／Notifications／ChatConnections）是最終一致的，
//      而且別人的動作隨時可能再替這個人寫進新的列（有人按他貼文的讚 ⇒ 一則新通知）
//      ⇒ 墓碑要一直被回頭清（ResweepAccount），沒有期限。原本墓碑一寫上就再也不會回來。
//      怎麼輪：每次挑最久沒掃的 accountResweepBatch 個（見那個變數的說明）。
//      ⚠️ 真正的解法是寫入端不要再替墓碑寫列，而通知的寫入散在九支 Lambda 裡，那是另一件事。
//         在那之前，墓碑越多、每個墓碑兩次回掃之間隔得越久。
//   4. 整表掃的兩張表原本「每個人各掃一次」。改成每次執行各掃一次、一次處理所有人（RunAccountPurge）。
//   2. AuthTokens、EventRedemptions 也存了 userId，原本不在清單裡。
//   3. 逐列刪除時帶條件「這一列現在還是這個人的」。原本只帶主鍵，查完之後那一列若換了主人照刪。

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// DeletedUserDisplayName 是清除後留在墓碑上的名字。與刪除頁第五條是同一個字串。
const DeletedUserDisplayName = "已刪除的使用者"

// AccountPurgeMargin：到期之後再多等這麼久才清。
// 登入端的撤回與這裡的清除各自拿自己那台機器的時間判定同一條 30 天的線；
// 留一段間隔，兩邊的時鐘差一點也不會出現「這邊剛撤回、那邊同時在清」。
const AccountPurgeMargin = time.Hour

// accountPurgeTable：一張「用 userId 找得到這個人全部資料列」的表。
type accountPurgeTable struct {
	name  string   // 不含前綴
	index string   // 空字串＝直接查主鍵
	pk    string   // 存使用者 id 的屬性名（各表大小寫不同）
	keys  []string // 這張表自己的主鍵屬性，刪除時要用
	scan  bool     // true＝這張表沒有依使用者查詢的鍵或索引，只能整表掃再過濾
}

// 🔴 鍵名是 2026-10-13 從 stg 的 describe-table 抄來的，不是從 Go struct（兩邊大小寫不一致）。
//
//	抄錯的後果是查不到或刪不掉而且不報錯，所以 verify_account_deletion_live.py 要有線上那一格。
var accountPurgeTables = []accountPurgeTable{
	{name: "AuthIdentities", index: "userId-index", pk: "userId", keys: []string{"identity"}},
	{name: "PushSubscriptions_MultiDevice", pk: "userId", keys: []string{"userId", "deviceId"}},
	{name: "Notifications", index: "userId-createdAt-index", pk: "userId", keys: []string{"notificationId"}},
	{name: "Ledger", pk: "userId", keys: []string{"userId", "sortKey"}},
	{name: "PointTransactions", pk: "userId", keys: []string{"userId", "sortKey"}},
	{name: "DailyClaims", pk: "userID", keys: []string{"userID", "claimDate"}},
	{name: "ChatUserMemberships", pk: "UserID", keys: []string{"UserID", "LastMessageTime#RoomID"}},
	{name: "ChatConnections", index: "UserID-index", pk: "UserID", keys: []string{"ConnectionID"}},
	// 下面兩張只能整表掃。量級：AuthTokens 有 TTL、列數很少；EventRedemptions 一人一活動一列。
	{name: "AuthTokens", pk: "userId", keys: []string{"tokenHash"}, scan: true},
	{name: "EventRedemptions", pk: "userId", keys: []string{"redemptionId"}, scan: true},
}

type accountPurgeDB interface {
	Scan(ctx context.Context, in *dynamodb.ScanInput, optFns ...func(*dynamodb.Options)) (*dynamodb.ScanOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	DeleteItem(ctx context.Context, in *dynamodb.DeleteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// accountResweepBatch：一次執行最多回掃幾個墓碑。
//
// 第三輪覆驗（2026-10-13）指出「每次把所有墓碑從頭掃到尾」在墓碑夠多時會超過 Lambda 的時間上限，
// 而下一次又從頭開始 ⇒ 排在後面的永遠輪不到（與第二輪「只取前 50 個」是同一個形狀，只是把 50 換成了時間）。
// 改成：每個墓碑記著自己上次被回掃的時間（sweptAt），每次挑**最久沒掃的**這麼多個。
// 不需要另外存游標，也沒有人會被餓死 —— N 個墓碑每 ceil(N/batch) 次執行輪到一次。
// 是 var 不是 const：測試要把它調小。
var accountResweepBatch = 200

// accountPurgeDeadlineMargin：離 ctx 的期限剩不到這麼久就不再開始處理下一個人。
const accountPurgeDeadlineMargin = 30 * time.Second

// accountPurgeOutOfTime：是 var，測試才換得掉（真的去等期限的測試在忙碌的機器上會抖）。
var accountPurgeOutOfTime = func(ctx context.Context) bool {
	if deadline, ok := ctx.Deadline(); ok {
		return time.Until(deadline) < accountPurgeDeadlineMargin
	}
	return false
}

// accountPurgeCutoff：deleteRequestedAt 不晚於這個值的才清。
func accountPurgeCutoff(now time.Time) int64 {
	return now.Add(-AccountDeletionGrace - AccountPurgeMargin).Unix()
}

// FindAccountsDueForPurge 掃 Users，回最多 limit 個該清的 userId。
// Users 沒有 deleteRequestedAt 的索引，所以是整表掃 —— 一天跑一次的量級可以接受。
func FindAccountsDueForPurge(ctx context.Context, db accountPurgeDB, prefix string, now time.Time, limit int) ([]string, error) {
	var due []string
	var startKey map[string]types.AttributeValue
	for len(due) < limit {
		out, err := db.Scan(ctx, &dynamodb.ScanInput{
			TableName:            aws.String(prefix + "Users"),
			FilterExpression:     aws.String("deleteRequestedAt <= :cutoff AND attribute_not_exists(purgedAt)"),
			ProjectionExpression: aws.String("userId"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":cutoff": &types.AttributeValueMemberN{Value: strconv.FormatInt(accountPurgeCutoff(now), 10)},
			},
			ExclusiveStartKey: startKey,
		})
		if err != nil {
			return due, err
		}
		for _, item := range out.Items {
			if id, ok := item["userId"].(*types.AttributeValueMemberS); ok && len(due) < limit {
				due = append(due, id.Value)
			}
		}
		if len(out.LastEvaluatedKey) == 0 {
			break
		}
		startKey = out.LastEvaluatedKey
	}
	return due, nil
}

// AccountPurgeReport：清一個人的結果。
type AccountPurgeReport struct {
	UserID  string         `json:"userId"`
	Skipped string         `json:"skipped,omitempty"` // 非空＝這個人沒有被清，值是原因
	DryRun  bool           `json:"dryRun"`
	Rows    map[string]int `json:"rows"` // 各表找到（dryRun）或刪掉的列數
}

// PurgeAccount 清掉一個人的資料。可以重複執行：中途失敗的話 Users 那一列還沒換成墓碑，
// 下一次會再被 FindAccountsDueForPurge 找到，從頭再清一次。
//
// 順序是刻意的：先清各表，**最後**才把 Users 換成墓碑。反過來的話，墓碑一寫上就再也
// 找不到這個人，而他在其他表的資料會永遠留著。
func PurgeAccount(ctx context.Context, db accountPurgeDB, prefix, userID string, now time.Time, dryRun bool) (AccountPurgeReport, error) {
	return purgeAccount(ctx, db, prefix, userID, now, dryRun, false)
}

// skipScan＝整表掃的那幾張已經由呼叫端（RunAccountPurge）一次掃完，這裡不要每個人再掃一次。
func purgeAccount(ctx context.Context, db accountPurgeDB, prefix, userID string, now time.Time, dryRun, skipScan bool) (AccountPurgeReport, error) {
	rep := AccountPurgeReport{UserID: userID, DryRun: dryRun, Rows: map[string]int{}}
	usersTable := prefix + "Users"
	userKey := map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}}

	// 清之前自己再讀一次、自己再判一次。清單是幾秒前掃出來的，而這一步之後的事情收不回來。
	got, err := db.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(usersTable), Key: userKey, ConsistentRead: aws.Bool(true)})
	if err != nil {
		return rep, err
	}
	if len(got.Item) == 0 {
		rep.Skipped = "user not found"
		return rep, nil
	}
	if _, purged := got.Item["purgedAt"]; purged {
		rep.Skipped = "already purged"
		return rep, nil
	}
	reqAttr, ok := got.Item["deleteRequestedAt"].(*types.AttributeValueMemberN)
	if !ok {
		rep.Skipped = "no numeric deleteRequestedAt"
		return rep, nil
	}
	requestedAt, err := strconv.ParseInt(reqAttr.Value, 10, 64)
	if err != nil || requestedAt <= 0 || requestedAt > accountPurgeCutoff(now) {
		rep.Skipped = "not due"
		return rep, nil
	}

	for _, t := range accountPurgeTables {
		if t.scan && skipScan {
			continue
		}
		n, err := purgeRowsOf(ctx, db, prefix+t.name, t, userID, dryRun)
		rep.Rows[t.name] = n
		if err != nil {
			return rep, fmt.Errorf("%s: %w", t.name, err)
		}
	}

	if dryRun {
		return rep, nil
	}
	// 墓碑：整列換掉，只留這四個屬性。用「整列換掉」而不是逐欄移除，
	// 是因為以後 Users 多了新的個資欄位時，逐欄移除的清單會漏掉它而沒有任何徵兆。
	// 留著 deleteRequestedAt：AccountHiddenFromOthers 靠它繼續把這個人對外隱藏。
	_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(usersTable),
		Item: map[string]types.AttributeValue{
			"userId":            &types.AttributeValueMemberS{Value: userID},
			"displayName":       &types.AttributeValueMemberS{Value: DeletedUserDisplayName},
			"deleteRequestedAt": &types.AttributeValueMemberN{Value: reqAttr.Value},
			"purgedAt":          &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
		},
		// 讀完到現在之間這一列被動過（例如有人手動撤銷刪除）就不換。
		ConditionExpression:       aws.String("deleteRequestedAt = :req AND attribute_not_exists(purgedAt)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":req": reqAttr},
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			rep.Skipped = "user row changed during purge"
			return rep, nil
		}
		return rep, fmt.Errorf("Users: %w", err)
	}
	rep.Rows["Users"] = 1
	return rep, nil
}

func purgeRowsOf(ctx context.Context, db accountPurgeDB, table string, t accountPurgeTable, userID string, dryRun bool) (int, error) {
	n := 0
	names := map[string]string{"#pk": t.pk}
	values := map[string]types.AttributeValue{":u": &types.AttributeValueMemberS{Value: userID}}
	var startKey map[string]types.AttributeValue
	for {
		var items []map[string]types.AttributeValue
		var lastKey map[string]types.AttributeValue
		if t.scan {
			out, err := db.Scan(ctx, &dynamodb.ScanInput{
				TableName: aws.String(table), FilterExpression: aws.String("#pk = :u"),
				ExpressionAttributeNames: names, ExpressionAttributeValues: values, ExclusiveStartKey: startKey,
			})
			if err != nil {
				return n, err
			}
			items, lastKey = out.Items, out.LastEvaluatedKey
		} else {
			in := &dynamodb.QueryInput{
				TableName: aws.String(table), KeyConditionExpression: aws.String("#pk = :u"),
				ExpressionAttributeNames: names, ExpressionAttributeValues: values, ExclusiveStartKey: startKey,
			}
			if t.index != "" {
				in.IndexName = aws.String(t.index)
			}
			out, err := db.Query(ctx, in)
			if err != nil {
				return n, err
			}
			items, lastKey = out.Items, out.LastEvaluatedKey
		}
		for _, item := range items {
			key := map[string]types.AttributeValue{}
			for _, k := range t.keys {
				v, ok := item[k]
				if !ok {
					return n, fmt.Errorf("row is missing key attribute %q", k)
				}
				key[k] = v
			}
			if !dryRun {
				// 條件：刪的那一刻這一列還是這個人的。查到與刪掉之間它可能已經換了主人
				// （例如同一條連線、同一張 token 的鍵被別人重用），那種就不刪、也不算數。
				_, err := db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
					TableName: aws.String(table), Key: key, ConditionExpression: aws.String("#pk = :u"),
					ExpressionAttributeNames: names, ExpressionAttributeValues: values,
				})
				if err != nil {
					var ccf *types.ConditionalCheckFailedException
					if errors.As(err, &ccf) {
						continue
					}
					return n, err
				}
			}
			n++
		}
		if len(lastKey) == 0 {
			return n, nil
		}
		startKey = lastKey
	}
}

// isTombstone：這一列是不是清除寫下的墓碑。
//
// 🔴 承重的不變式只有一條：**purgedAt 只由清除寫上，寫上之後這個 userId 永遠不再是活帳號。**
//
//	清除不可逆；要「救回」已清除的人，做法是請他重新註冊，不是手動改這一列。
//	下面那四個欄位的檢查只是順手多擋一種手動改壞的形狀（把 email 填回去卻沒拿掉 purgedAt），
//	**它不是保護**：純 LINE 帳號本來就四個欄位都沒有（第三輪覆驗指出），那種形狀它分不出來。
//	沒有任何檢查分得出「墓碑」與「被手動改回活帳號、卻留著 purgedAt 的列」—— 兩者的差別不在資料裡。
func isTombstone(item map[string]types.AttributeValue) bool {
	if _, ok := item["purgedAt"].(*types.AttributeValueMemberN); !ok {
		return false
	}
	for _, live := range []string{"email", "passwordHash", "lineId", "encryptedLineId"} {
		if _, has := item[live]; has {
			return false
		}
	}
	return true
}

// findTombstonesOldestSweptFirst 回所有墓碑的 userId，最久沒被回掃的排前面（沒掃過的最前）。
// 會把 Users 掃到底 —— 那是一次讀取，量級與 FindAccountsDueForPurge 相同。
func findTombstonesOldestSweptFirst(ctx context.Context, db accountPurgeDB, prefix string) ([]string, error) {
	type ref struct {
		id      string
		sweptAt int64
	}
	var refs []ref
	var startKey map[string]types.AttributeValue
	for {
		out, err := db.Scan(ctx, &dynamodb.ScanInput{
			TableName:            aws.String(prefix + "Users"),
			FilterExpression:     aws.String("attribute_exists(purgedAt)"),
			ProjectionExpression: aws.String("userId, sweptAt"),
			ExclusiveStartKey:    startKey,
		})
		if err != nil {
			return nil, err
		}
		for _, item := range out.Items {
			id, ok := item["userId"].(*types.AttributeValueMemberS)
			if !ok {
				continue
			}
			r := ref{id: id.Value}
			if n, ok := item["sweptAt"].(*types.AttributeValueMemberN); ok {
				r.sweptAt, _ = strconv.ParseInt(n.Value, 10, 64)
			}
			refs = append(refs, r)
		}
		if len(out.LastEvaluatedKey) == 0 {
			break
		}
		startKey = out.LastEvaluatedKey
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].sweptAt != refs[j].sweptAt {
			return refs[i].sweptAt < refs[j].sweptAt
		}
		return refs[i].id < refs[j].id
	})
	ids := make([]string, len(refs))
	for i, r := range refs {
		ids[i] = r.id
	}
	return ids, nil
}

// markSwept 在墓碑上記下這次回掃的時間。條件：它還是墓碑。
func markSwept(ctx context.Context, db accountPurgeDB, prefix, userID string, now time.Time) error {
	_, err := db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:           aws.String(prefix + "Users"),
		Key:                 map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		UpdateExpression:    aws.String("SET sweptAt = :now"),
		ConditionExpression: aws.String("attribute_exists(purgedAt)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":now": &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
		},
	})
	return err
}

// ResweepAccount：對一個**已經寫上墓碑**的人再清一遍各表。不碰 Users。
// 自己重讀一次確認真的是墓碑；不是的話一列都不動。
func ResweepAccount(ctx context.Context, db accountPurgeDB, prefix, userID string, dryRun bool) (AccountPurgeReport, error) {
	return resweepAccount(ctx, db, prefix, userID, dryRun, false)
}

func resweepAccount(ctx context.Context, db accountPurgeDB, prefix, userID string, dryRun, skipScan bool) (AccountPurgeReport, error) {
	rep := AccountPurgeReport{UserID: userID, DryRun: dryRun, Rows: map[string]int{}}
	got, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(prefix + "Users"), ConsistentRead: aws.Bool(true),
		Key: map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
	})
	if err != nil {
		return rep, err
	}
	if !isTombstone(got.Item) {
		rep.Skipped = "not a tombstone"
		return rep, nil
	}
	for _, t := range accountPurgeTables {
		if t.scan && skipScan {
			continue
		}
		n, err := purgeRowsOf(ctx, db, prefix+t.name, t, userID, dryRun)
		if n > 0 {
			rep.Rows[t.name] = n
		}
		if err != nil {
			return rep, fmt.Errorf("%s: %w", t.name, err)
		}
	}
	return rep, nil
}

// purgeScanTablesFor：整表掃的那幾張，每張掃一次，把屬於 users 裡任何一個人的列刪掉。
// 回 userId → 表名 → 列數。
func purgeScanTablesFor(ctx context.Context, db accountPurgeDB, prefix string, users map[string]bool, dryRun bool) (map[string]map[string]int, error) {
	counts := map[string]map[string]int{}
	if len(users) == 0 {
		return counts, nil
	}
	for _, t := range accountPurgeTables {
		if !t.scan {
			continue
		}
		table := prefix + t.name
		var startKey map[string]types.AttributeValue
		for {
			out, err := db.Scan(ctx, &dynamodb.ScanInput{TableName: aws.String(table), ExclusiveStartKey: startKey, ConsistentRead: aws.Bool(true)})
			if err != nil {
				return counts, fmt.Errorf("%s: %w", t.name, err)
			}
			for _, item := range out.Items {
				owner, ok := item[t.pk].(*types.AttributeValueMemberS)
				if !ok || !users[owner.Value] {
					continue
				}
				key := map[string]types.AttributeValue{}
				for _, k := range t.keys {
					v, has := item[k]
					if !has {
						return counts, fmt.Errorf("%s: row is missing key attribute %q", t.name, k)
					}
					key[k] = v
				}
				if !dryRun {
					_, err := db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
						TableName: aws.String(table), Key: key, ConditionExpression: aws.String("#pk = :u"),
						ExpressionAttributeNames:  map[string]string{"#pk": t.pk},
						ExpressionAttributeValues: map[string]types.AttributeValue{":u": owner},
					})
					if err != nil {
						var ccf *types.ConditionalCheckFailedException
						if errors.As(err, &ccf) {
							continue
						}
						return counts, fmt.Errorf("%s: %w", t.name, err)
					}
				}
				if counts[owner.Value] == nil {
					counts[owner.Value] = map[string]int{}
				}
				counts[owner.Value][t.name]++
			}
			if len(out.LastEvaluatedKey) == 0 {
				break
			}
			startKey = out.LastEvaluatedKey
		}
	}
	return counts, nil
}

// AccountPurgeRun：一次排程執行的總結。
type AccountPurgeRun struct {
	DryRun     bool `json:"dryRun"`
	Due        int  `json:"due"`
	Purged     int  `json:"purged"`
	Skipped    int  `json:"skipped"`
	Failed     int  `json:"failed"`
	Reswept    int  `json:"reswept"`    // 已是墓碑、這次回頭又清到東西的人數
	Swept      int  `json:"swept"`      // 這次回掃了幾個墓碑（不論有沒有清到東西）
	Tombstones int  `json:"tombstones"` // 墓碑總數；遠大於 swept 代表一輪要好幾天
	OutOfTime  bool `json:"outOfTime"`  // 時間不夠、沒做完就停了
	// NameCopies：這次在別人紀錄裡改掉的名字副本，userId → 「表.欄位」→ 列數（account_anonymize.go）。
	NameCopies map[string]map[string]int `json:"nameCopies,omitempty"`
	Reports    []AccountPurgeReport      `json:"reports"`
}

// RunAccountPurge：一次排程執行。排程只該呼叫這一支。
//
//  1. 找出到期的人（最多 maxUsers 個），與最久沒回掃的墓碑（最多 accountResweepBatch 個）。
//  2. 整表掃的那幾張各掃一次，把這些人的列清掉。這一步失敗就整次中止 —— 還沒有任何人被寫上墓碑。
//  3. 到期的人：清其餘各表，最後寫墓碑（PurgeAccount 自己會再讀一次、再判一次到期）。
//  4. 墓碑：其餘各表回頭再清一遍，清完記下 sweptAt。
//
// 新到期的人排在回掃前面：時間不夠時被犧牲的是回掃（下次從最久沒掃的接著來），不是新的清除。
//
// ⚠️ 第 1 步的重讀到第 2 步的刪除之間有窗。這個窗裡唯一會出事的情形是有人**手動**把一個
//
//	已過期的帳號改回活的 —— 一般的撤回只在 30 天內可用，清除從 30 天又一小時後才開始，兩者不重疊。
//	手動救回已到期的帳號不是支援的操作（見 isTombstone 的說明）；這個窗關不掉，只寫清楚。
func RunAccountPurge(ctx context.Context, db accountPurgeDB, prefix string, now time.Time, maxUsers int, dryRun bool) (AccountPurgeRun, error) {
	run := AccountPurgeRun{DryRun: dryRun}
	due, err := FindAccountsDueForPurge(ctx, db, prefix, now, maxUsers)
	if err != nil {
		return run, err
	}
	run.Due = len(due)
	tombs, err := findTombstonesOldestSweptFirst(ctx, db, prefix)
	if err != nil {
		return run, err
	}
	run.Tombstones = len(tombs)
	if len(tombs) > accountResweepBatch {
		tombs = tombs[:accountResweepBatch]
	}

	// 整表掃那一步是照名單刪的，所以名單上的每個人都要先各自重讀確認過。
	users := map[string]bool{}
	for _, list := range [][]string{due, tombs} {
		for _, id := range list {
			got, err := db.GetItem(ctx, &dynamodb.GetItemInput{
				TableName: aws.String(prefix + "Users"), ConsistentRead: aws.Bool(true),
				Key: map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: id}},
			})
			if err != nil {
				return run, err
			}
			if isTombstone(got.Item) || accountDueForPurge(got.Item, now) {
				users[id] = true
			}
		}
	}
	scanCounts, err := purgeScanTablesFor(ctx, db, prefix, users, dryRun)
	if err != nil {
		return run, err
	}
	// 整表掃刪掉的列數一律掛回那個人的報告上 —— 包括他後來被跳過的情形。
	// 「被跳過」而整表掃已經刪了他的列，正是最需要被看見的那一種。
	withScan := func(rep *AccountPurgeReport) {
		for table, n := range scanCounts[rep.UserID] {
			rep.Rows[table] = n
		}
	}
	outOfTime := func() bool { return accountPurgeOutOfTime(ctx) }

	for _, id := range due {
		if outOfTime() {
			run.OutOfTime = true
			break
		}
		rep, perr := purgeAccount(ctx, db, prefix, id, now, dryRun, true)
		withScan(&rep)
		run.Reports = append(run.Reports, rep)
		switch {
		case perr != nil:
			run.Failed++
		case rep.Skipped != "":
			run.Skipped++
		default:
			run.Purged++
		}
	}
	// 名字副本：一定在墓碑寫上之後（理由見 AnonymizePurgedAccounts）。失敗不擋後面的回掃，但這次執行算失敗。
	var anonErr error
	if outOfTime() {
		run.OutOfTime = true
	} else {
		var wouldPurge []string
		for _, rep := range run.Reports {
			if rep.Skipped == "" {
				wouldPurge = append(wouldPurge, rep.UserID)
			}
		}
		run.NameCopies, anonErr = AnonymizePurgedAccounts(ctx, db, prefix, now, dryRun, wouldPurge)
	}

	for _, id := range tombs {
		if outOfTime() {
			run.OutOfTime = true
			break
		}
		rep, rerr := resweepAccount(ctx, db, prefix, id, dryRun, true)
		withScan(&rep)
		if rerr == nil && rep.Skipped == "" && !dryRun {
			rerr = markSwept(ctx, db, prefix, id, now)
		}
		if rerr != nil {
			run.Failed++
			run.Reports = append(run.Reports, rep)
			continue
		}
		run.Swept++
		if len(rep.Rows) > 0 {
			run.Reswept++
			run.Reports = append(run.Reports, rep)
		}
	}
	if run.Failed > 0 {
		return run, fmt.Errorf("%d 個帳號清除失敗", run.Failed)
	}
	if anonErr != nil {
		return run, fmt.Errorf("名字副本處理失敗：%w", anonErr)
	}
	return run, nil
}

// accountDueForPurge：與 PurgeAccount 裡那段判定同一條線，給 RunAccountPurge 建名單用。
func accountDueForPurge(item map[string]types.AttributeValue, now time.Time) bool {
	if _, purged := item["purgedAt"]; purged {
		return false
	}
	n, ok := item["deleteRequestedAt"].(*types.AttributeValueMemberN)
	if !ok {
		return false
	}
	v, err := strconv.ParseInt(n.Value, 10, 64)
	return err == nil && v > 0 && v <= accountPurgeCutoff(now)
}
