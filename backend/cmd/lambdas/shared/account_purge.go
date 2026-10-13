package shared

// 帳號刪除 —— 停用期滿之後的清除（刪除頁第四、五條）。
//
// 這一支只清「這個人自己的資料」：用 userId 當鍵就找得到的那幾張表，加上把 Users 那一列換成墓碑。
//
// 🔴 還沒做的那一半：別人紀錄裡**存下來的副本** —— Games.hostDisplayName／joinedPlayers、
//    Registrations.displayName、Ratings.fromUserName、ChatMessages.SenderName、Community 的作者欄位。
//    那幾張表沒有依使用者查詢的索引，要整表掃。在那一半做完之前，刪除頁第五條的
//    「顯示名稱一律改為已刪除的使用者」只對**讀取時才去查 Users** 的畫面成立。
// 🔴 也沒清的：S3 上的大頭貼檔案。
// ⓘ 刻意保留的：RedeemCodes.usedBy。那是「這張兌換碼被用掉了」的庫存紀錄，不是這個人的資料；
//    它留下的 userId 之後只對得到墓碑，與別人牌局裡留下的 userId 同一種處理。
//
// 2026-10-13 Codex 覆驗後補的三件事（原本各自會造成清不乾淨或清錯）：
//   1. 用 GSI 找列的表（AuthIdentities／Notifications／ChatConnections）是最終一致的，
//      而且別人的動作隨時可能再替這個人寫進新的通知 ⇒ 墓碑寫上之後的七天內每次都回頭再掃一遍
//      （ResweepAccount）。原本墓碑一寫上就再也不會回來。
//   2. AuthTokens、EventRedemptions 也存了 userId，原本不在清單裡。
//   3. 逐列刪除時帶條件「這一列現在還是這個人的」。原本只帶主鍵，查完之後那一列若換了主人照刪。

import (
	"context"
	"errors"
	"fmt"
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

// AccountResweepWindow：墓碑寫上之後，這段時間內每次執行都回頭再清一遍各表。
const AccountResweepWindow = 7 * 24 * time.Hour

type accountPurgeDB interface {
	Scan(ctx context.Context, in *dynamodb.ScanInput, optFns ...func(*dynamodb.Options)) (*dynamodb.ScanOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	DeleteItem(ctx context.Context, in *dynamodb.DeleteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
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

// FindAccountsForResweep 回最近 AccountResweepWindow 內寫上墓碑的 userId（最多 limit 個）。
func FindAccountsForResweep(ctx context.Context, db accountPurgeDB, prefix string, now time.Time, limit int) ([]string, error) {
	var ids []string
	var startKey map[string]types.AttributeValue
	for len(ids) < limit {
		out, err := db.Scan(ctx, &dynamodb.ScanInput{
			TableName:            aws.String(prefix + "Users"),
			FilterExpression:     aws.String("purgedAt >= :since"),
			ProjectionExpression: aws.String("userId"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":since": &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Add(-AccountResweepWindow).Unix(), 10)},
			},
			ExclusiveStartKey: startKey,
		})
		if err != nil {
			return ids, err
		}
		for _, item := range out.Items {
			if id, ok := item["userId"].(*types.AttributeValueMemberS); ok && len(ids) < limit {
				ids = append(ids, id.Value)
			}
		}
		if len(out.LastEvaluatedKey) == 0 {
			break
		}
		startKey = out.LastEvaluatedKey
	}
	return ids, nil
}

// ResweepAccount：對一個**已經寫上墓碑**的人再清一遍各表。不碰 Users。
// 自己重讀一次確認真的是墓碑；不是的話一列都不動。
func ResweepAccount(ctx context.Context, db accountPurgeDB, prefix, userID string, dryRun bool) (AccountPurgeReport, error) {
	rep := AccountPurgeReport{UserID: userID, DryRun: dryRun, Rows: map[string]int{}}
	got, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(prefix + "Users"), ConsistentRead: aws.Bool(true),
		Key: map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
	})
	if err != nil {
		return rep, err
	}
	if _, purged := got.Item["purgedAt"].(*types.AttributeValueMemberN); !purged {
		rep.Skipped = "not a tombstone"
		return rep, nil
	}
	for _, t := range accountPurgeTables {
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
