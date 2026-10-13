package shared

// 帳號刪除 —— 把別人紀錄裡「存下來的名字副本」改成「已刪除的使用者」（刪除頁第五條）。
//
// 哪些是副本（2026-10-13 逐個 struct 查的）：
//
//	Games.hostDisplayName、Games.joinedPlayers[].displayName／pictureUrl／lineId
//	Registrations.displayName
//	Ratings.fromDisplayName、RatingComments.fromDisplayName
//	ChatMessages.SenderName
//
// 哪些不是副本、所以不必處理：貼文與留言的作者名字／大頭貼、報名與團局主辦人的大頭貼
// （struct 上是 dynamodbav:"-"，讀的時候才去查 Users ⇒ 墓碑一寫上就自動變成「已刪除的使用者」）。
//
// 這幾張表都沒有依使用者查詢的索引，只能整表掃。所以：
//   - 每張表每次只掃一遍，一次處理名單上所有人；
//   - 每個人只做一次：做完在墓碑上記 anonymizedAt，之後不再掃。
//     墓碑寫上之後不會再有人把他的舊名字抄進新的列（抄的來源就是 Users，那裡已經是墓碑）。
//
// 🔴 userId 本身沒有換掉。別人的紀錄仍然留著這個人的系統代號，只是它對不到名字了。

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// nameCopyTable：一張「某個欄位存使用者 id、另一個欄位存他名字的副本」的表。
type nameCopyTable struct {
	name     string
	keys     []string
	userAttr string
	nameAttr string
}

// 🔴 表名與鍵名抄自 stg 的 describe-table，欄位名抄自各自的 struct tag。
var nameCopyTables = []nameCopyTable{
	{"Registrations", []string{"registrationId"}, "userId", "displayName"},
	{"Ratings", []string{"gameId", "fromUserId"}, "fromUserId", "fromDisplayName"},
	{"RatingComments", []string{"gameId", "fromUserId"}, "fromUserId", "fromDisplayName"},
	{"ChatMessages", []string{"RoomID", "Timestamp#MessageID"}, "SenderID", "SenderName"},
	{"Games", []string{"gameId"}, "hostUserId", "hostDisplayName"},
}

// anonymizeNameCopiesFor 把 users 裡每個人在別人紀錄中的名字副本改掉。
// 回 userId → 「表.欄位」→ 改了幾列，以及 incomplete：這次有列因為同時被別人改動而沒改成的人
// （他們這次不可以被記成做完）。
func anonymizeNameCopiesFor(ctx context.Context, db accountPurgeDB, prefix string, users map[string]bool, dryRun bool) (counts map[string]map[string]int, incomplete map[string]bool, err error) {
	counts, incomplete = map[string]map[string]int{}, map[string]bool{}
	if len(users) == 0 {
		return counts, incomplete, nil
	}
	bump := func(user, what string) {
		if counts[user] == nil {
			counts[user] = map[string]int{}
		}
		counts[user][what]++
	}
	tomb := &types.AttributeValueMemberS{Value: DeletedUserDisplayName}

	for _, t := range nameCopyTables {
		table := prefix + t.name
		var startKey map[string]types.AttributeValue
		for {
			out, serr := db.Scan(ctx, &dynamodb.ScanInput{TableName: aws.String(table), ExclusiveStartKey: startKey})
			if serr != nil {
				return counts, incomplete, fmt.Errorf("%s: %w", t.name, serr)
			}
			for _, item := range out.Items {
				key := map[string]types.AttributeValue{}
				for _, k := range t.keys {
					v, has := item[k]
					if !has {
						return counts, incomplete, fmt.Errorf("%s: row is missing key attribute %q", t.name, k)
					}
					key[k] = v
				}

				// ① 這一列「是這個人的」：把名字欄位換掉。
				if owner, ok := item[t.userAttr].(*types.AttributeValueMemberS); ok && users[owner.Value] {
					if cur, isS := item[t.nameAttr].(*types.AttributeValueMemberS); !isS || cur.Value != DeletedUserDisplayName {
						done, uerr := updateIfUnchanged(ctx, db, dryRun, &dynamodb.UpdateItemInput{
							TableName: aws.String(table), Key: key,
							UpdateExpression:          aws.String("SET #n = :name"),
							ConditionExpression:       aws.String("#u = :u"),
							ExpressionAttributeNames:  map[string]string{"#n": t.nameAttr, "#u": t.userAttr},
							ExpressionAttributeValues: map[string]types.AttributeValue{":name": tomb, ":u": owner},
						})
						if uerr != nil {
							return counts, incomplete, fmt.Errorf("%s: %w", t.name, uerr)
						}
						if done {
							bump(owner.Value, t.name+"."+t.nameAttr)
						} else {
							incomplete[owner.Value] = true
						}
					}
				}

				// ② 團局的成員名單：一列裡面可能有好幾個人。
				if t.name == "Games" {
					oldList, ok := item["joinedPlayers"].(*types.AttributeValueMemberL)
					if !ok {
						continue
					}
					newList, touched := anonymizePlayers(oldList, users)
					if len(touched) == 0 {
						continue
					}
					done, uerr := updateIfUnchanged(ctx, db, dryRun, &dynamodb.UpdateItemInput{
						TableName: aws.String(table), Key: key,
						UpdateExpression: aws.String("SET joinedPlayers = :new"),
						// 整份名單換掉，所以條件是「名單還是我讀到的那一份」：
						// 這中間有人加入或退出的話不換，留到下一次。
						ConditionExpression:       aws.String("joinedPlayers = :old"),
						ExpressionAttributeValues: map[string]types.AttributeValue{":new": newList, ":old": oldList},
					})
					if uerr != nil {
						return counts, incomplete, fmt.Errorf("Games.joinedPlayers: %w", uerr)
					}
					for _, u := range touched {
						if done {
							bump(u, "Games.joinedPlayers")
						} else {
							incomplete[u] = true
						}
					}
				}
			}
			if len(out.LastEvaluatedKey) == 0 {
				break
			}
			startKey = out.LastEvaluatedKey
		}
	}
	return counts, incomplete, nil
}

// updateIfUnchanged：條件不成立（那一列在我讀到之後被別人改了）回 (false, nil)，不算錯誤。
func updateIfUnchanged(ctx context.Context, db accountPurgeDB, dryRun bool, in *dynamodb.UpdateItemInput) (bool, error) {
	if dryRun {
		return true, nil
	}
	_, err := db.UpdateItem(ctx, in)
	if err == nil {
		return true, nil
	}
	var ccf *types.ConditionalCheckFailedException
	if errors.As(err, &ccf) {
		return false, nil
	}
	return false, err
}

// anonymizePlayers 回一份新的成員名單：屬於 users 的人名字改掉、大頭貼清空、lineId 拿掉，其他人原封不動。
// touched 是這一列裡真的被改到的 userId（已經改過的不算）。
func anonymizePlayers(list *types.AttributeValueMemberL, users map[string]bool) (*types.AttributeValueMemberL, []string) {
	out := &types.AttributeValueMemberL{Value: make([]types.AttributeValue, len(list.Value))}
	var touched []string
	for i, el := range list.Value {
		out.Value[i] = el
		m, ok := el.(*types.AttributeValueMemberM)
		if !ok {
			continue
		}
		id, ok := m.Value["userId"].(*types.AttributeValueMemberS)
		if !ok || !users[id.Value] {
			continue
		}
		next := map[string]types.AttributeValue{}
		for k, v := range m.Value {
			if k != "lineId" {
				next[k] = v
			}
		}
		next["displayName"] = &types.AttributeValueMemberS{Value: DeletedUserDisplayName}
		next["pictureUrl"] = &types.AttributeValueMemberS{Value: ""}
		if reflect.DeepEqual(next, m.Value) {
			continue
		}
		out.Value[i] = &types.AttributeValueMemberM{Value: next}
		touched = append(touched, id.Value)
	}
	return out, touched
}

// findTombstonesNotAnonymized 回還沒做過名字副本處理的墓碑。
func findTombstonesNotAnonymized(ctx context.Context, db accountPurgeDB, prefix string) ([]string, error) {
	var ids []string
	var startKey map[string]types.AttributeValue
	for {
		out, err := db.Scan(ctx, &dynamodb.ScanInput{
			TableName:            aws.String(prefix + "Users"),
			FilterExpression:     aws.String("attribute_exists(purgedAt) AND attribute_not_exists(anonymizedAt)"),
			ProjectionExpression: aws.String("userId"),
			ExclusiveStartKey:    startKey,
		})
		if err != nil {
			return nil, err
		}
		for _, item := range out.Items {
			if id, ok := item["userId"].(*types.AttributeValueMemberS); ok {
				ids = append(ids, id.Value)
			}
		}
		if len(out.LastEvaluatedKey) == 0 {
			return ids, nil
		}
		startKey = out.LastEvaluatedKey
	}
}

// AnonymizePurgedAccounts：對所有「已是墓碑、還沒處理過名字副本」的人做一次。
// 要在墓碑寫上**之後**呼叫 —— 之前做的話，別人的動作還會從 Users 抄到舊名字。
//
// previewAlso 只在試跑時有用：試跑不會寫墓碑，所以「這次到期的人」還不是墓碑、不會被找到 ——
// 不把他們帶進來的話，試跑對名字副本什麼都預告不了（第一版就是這樣，測試還寫著「講得出會改幾處」）。
func AnonymizePurgedAccounts(ctx context.Context, db accountPurgeDB, prefix string, now time.Time, dryRun bool, previewAlso []string) (map[string]map[string]int, error) {
	ids, err := findTombstonesNotAnonymized(ctx, db, prefix)
	if err != nil {
		return nil, err
	}
	users := map[string]bool{}
	if dryRun {
		for _, id := range previewAlso {
			users[id] = true
		}
	}
	if len(ids) == 0 && len(users) == 0 {
		return nil, nil
	}
	for _, id := range ids {
		got, err := db.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: aws.String(prefix + "Users"), ConsistentRead: aws.Bool(true),
			Key: map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: id}},
		})
		if err != nil {
			return nil, err
		}
		if isTombstone(got.Item) {
			users[id] = true
		}
	}
	counts, incomplete, err := anonymizeNameCopiesFor(ctx, db, prefix, users, dryRun)
	if err != nil || dryRun {
		return counts, err
	}
	for id := range users {
		if incomplete[id] {
			continue
		}
		_, err := db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName:           aws.String(prefix + "Users"),
			Key:                 map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: id}},
			UpdateExpression:    aws.String("SET anonymizedAt = :now"),
			ConditionExpression: aws.String("attribute_exists(purgedAt)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":now": &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
			},
		})
		if err != nil {
			return counts, fmt.Errorf("mark anonymized %s: %w", id, err)
		}
	}
	return counts, nil
}
