package shared

// 帳號刪除 —— 「先停用、30 天後清除」的共用核心（使用者 2026-10-11 拍板）。
// 對外承諾寫在 frontend/legal/delete-account.txt；這裡的數字與那一頁對不上就是違約。
//
// 狀態只有一個欄位：Users.deleteRequestedAt（Unix 秒，Number）。
//   沒有           ⇒ 正常帳號
//   有，未滿 30 天 ⇒ 停用中；這段期間重新登入＝撤回
//   有，已滿 30 天 ⇒ 該清除了；**不可以**再被登入救回來（清除工作可能還沒輪到它）
//
// 接上的地方：
//   提出  apis/mahjongclub_auth_delete_account
//   撤回  每一個發 JWT 的登入入口，發之前先呼叫 ResolveAccountDeletionOnLogin
//         （哪幾支由 account_deletion_wiring_test.go 掃出來，不是手列的）
// 🔴 還沒做的：個人檔案對外隱藏、到期清除的排程工作、推播訂閱的清除、
//    「主辦人有未舉行的團局要先取消」的檢查。

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

// AccountDeletionGrace 是停用期。與刪除頁第三條的「三十日」是同一個數字。
const AccountDeletionGrace = 30 * 24 * time.Hour

type AccountDeletionStatus int

const (
	// DeletionNone：沒有提出過刪除。
	DeletionNone AccountDeletionStatus = iota
	// DeletionPending：停用期內，重新登入可撤回。
	DeletionPending
	// DeletionExpired：停用期已滿，等清除。
	DeletionExpired
)

// AccountDeletionStatusAt 判定帳號在 now 這一刻的刪除狀態。
// requestedAt 是 Users.deleteRequestedAt；0（欄位不存在）＝沒有提出過。
// 剛好滿 30 天算已到期 —— 刪除頁寫的是「滿三十日」。
func AccountDeletionStatusAt(requestedAt int64, now time.Time) AccountDeletionStatus {
	if requestedAt <= 0 {
		return DeletionNone
	}
	if now.Unix() >= accountDeletionDeadline(requestedAt) {
		return DeletionExpired
	}
	return DeletionPending
}

func accountDeletionDeadline(requestedAt int64) int64 {
	return requestedAt + int64(AccountDeletionGrace/time.Second)
}

// BuildAccountDeletionRequest 組出「提出刪除」那一筆 UpdateItem。
//
// 同時寫 pwChangedAt：簽發時間不晚於此刻的 JWT 全部作廢（＝登出所有裝置，同 logout-all）。
// deleteRequestedAt 用 if_not_exists：重複提出不會把 30 天往後延。
func BuildAccountDeletionRequest(tablePrefix, userID string, now time.Time) *dynamodb.UpdateItemInput {
	ts := strconv.FormatInt(now.Unix(), 10)
	return &dynamodb.UpdateItemInput{
		TableName: aws.String(tablePrefix + "Users"),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression: aws.String(
			"SET deleteRequestedAt = if_not_exists(deleteRequestedAt, :t), pwChangedAt = :t, updatedAt = :now"),
		ConditionExpression: aws.String("attribute_exists(userId)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t":   &types.AttributeValueMemberN{Value: ts},
			":now": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		},
	}
}

// BuildAccountDeletionCancel 組出「重新登入＝撤回」那一筆 UpdateItem。
//
// 🔴 條件式是承重的：只有「還在停用期內」才撤得掉。
//
//	少了它，清除工作還沒輪到的過期帳號會被一次登入救回來，而刪除頁承諾的是滿三十日即清除。
//	條件不成立時 DynamoDB 回 ConditionalCheckFailedException —— 呼叫端要把它當成
//	「這個帳號已經不能登入」，不是當成暫時性錯誤重試。
func BuildAccountDeletionCancel(tablePrefix, userID string, now time.Time) *dynamodb.UpdateItemInput {
	// deleteRequestedAt > now - grace  ⟺  now < deleteRequestedAt + grace（與 AccountDeletionStatusAt 同一條線）
	cutoff := now.Unix() - int64(AccountDeletionGrace/time.Second)
	return &dynamodb.UpdateItemInput{
		TableName: aws.String(tablePrefix + "Users"),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression:    aws.String("REMOVE deleteRequestedAt SET updatedAt = :now"),
		ConditionExpression: aws.String("attribute_exists(deleteRequestedAt) AND deleteRequestedAt > :cutoff"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":cutoff": &types.AttributeValueMemberN{Value: strconv.FormatInt(cutoff, 10)},
			":now":    &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		},
	}
}

// ErrAccountDeleted：停用期已滿，這個帳號不可以再登入。
var ErrAccountDeleted = errors.New("account deleted")

// ErrLoginTooSoonAfterDeletionRequest：剛提出刪除的同一秒內登入。不是「已刪除」，隔一秒再試就會成功。
var ErrLoginTooSoonAfterDeletionRequest = errors.New("login within the same second as the deletion request")

// accountDeletionDB 是 ResolveAccountDeletionOnLogin 用到的那兩個 DynamoDB 動作（測試用假件替換）。
type accountDeletionDB interface {
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// ResolveAccountDeletionOnLogin 要在「身分已經驗過、JWT 還沒發」的那一刻呼叫。
//
//	nil               ⇒ 可以發 JWT（沒提出過刪除，或還在停用期內而這次登入已經把它撤回）
//	ErrAccountDeleted ⇒ 停用期已滿，不可登入
//	其他 error        ⇒ 判不出來。呼叫端**必須拒絕這次登入**：照樣發 JWT 的話，
//	                    使用者以為帳號救回來了，而它仍掛著刪除、到期照樣被清掉。
func ResolveAccountDeletionOnLogin(ctx context.Context, userID string) error {
	c := getAuthDDBClient()
	if c == nil {
		return ErrAuthDDBUnavailable
	}
	return resolveAccountDeletionOnLogin(ctx, c, tablePrefix(), userID, time.Now, true)
}

// clock 是函式不是時間點：判定用的「現在」要在讀完之後才取（2026-10-12 Codex 覆驗）。
// 先取再讀的話，讀取花掉的時間會讓一個已經到期的帳號照舊的時間被撤回。
// ⚠️ 仍然留著的窗：取完時間到 DynamoDB 套用條件式之間的那一次網路往返。條件式的 cutoff
//
//	是這一端算好送過去的，DynamoDB 沒有伺服器時間可比 ⇒ 這個窗關不掉，只能縮到一次請求。
func resolveAccountDeletionOnLogin(ctx context.Context, db accountDeletionDB, prefix, userID string, clock func() time.Time, retry bool) error {
	// ConsistentRead：剛提出刪除就登入時不可以讀到舊值（理由同 auth.go 的 getUserPwChangedAt）。
	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(prefix + "Users"),
		Key:                  map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		ProjectionExpression: aws.String("userId, deleteRequestedAt, pwChangedAt"),
		ConsistentRead:       aws.Bool(true),
	})
	if err != nil {
		return err
	}
	if len(out.Item) == 0 {
		return errors.New("user not found")
	}
	raw, present := out.Item["deleteRequestedAt"]
	if !present {
		return nil
	}
	// 型別不對不可以當成「沒提出過」：條件式對字串與數字的比較永遠不成立，
	// 那會讓一個掛著刪除的帳號看起來像正常帳號。
	num, ok := raw.(*types.AttributeValueMemberN)
	if !ok {
		return fmt.Errorf("deleteRequestedAt has unexpected type %T", raw)
	}
	requestedAt, err := strconv.ParseInt(num.Value, 10, 64)
	if err != nil {
		return fmt.Errorf("deleteRequestedAt is not an integer: %w", err)
	}

	now := clock()
	switch AccountDeletionStatusAt(requestedAt, now) {
	case DeletionNone:
		return nil
	case DeletionExpired:
		return ErrAccountDeleted
	}

	// 提出刪除時寫了 pwChangedAt，而 JWT 的閘是 iat <= pwChangedAt 就作廢（auth.go，秒精度）。
	// 同一秒內就登入的話，這次會撤回刪除、回 200，發出去的卻是一張當場作廢的 JWT
	// （2026-10-12 Codex 覆驗）。⇒ 還沒過那一秒就不撤回、不發，讓呼叫端回「稍後再試」。
	if pw, ok := out.Item["pwChangedAt"].(*types.AttributeValueMemberN); ok {
		if sec, perr := strconv.ParseInt(pw.Value, 10, 64); perr == nil && now.Unix() <= sec {
			return ErrLoginTooSoonAfterDeletionRequest
		}
	}

	_, err = db.UpdateItem(ctx, BuildAccountDeletionCancel(prefix, userID, now))
	if err == nil {
		return nil
	}
	var ccf *types.ConditionalCheckFailedException
	if !errors.As(err, &ccf) {
		return err
	}
	// 條件不成立有兩種：剛好在這一瞬間到期，或同一個人的另一個登入搶先撤回了。
	// 重讀一次分得開；只重讀一次。
	if retry {
		return resolveAccountDeletionOnLogin(ctx, db, prefix, userID, clock, false)
	}
	return ErrAccountDeleted
}

// ── 對別人隱藏 ──────────────────────────────────────────────

// AccountHiddenFromOthers：這個帳號是否已提出刪除（停用中或已到期）⇒ 不可以再被別人查看。
// 給「拿別人的 userId 當查詢對象」的讀取端用（評價、評語、個人貼文）。
//
//	(true, nil)  ⇒ 當成查無此人
//	(false, nil) ⇒ 照常
//	(_, err)     ⇒ 判不出來。呼叫端要拒絕這次查詢，不可以照常回資料。
//
// ⚠️ 管不到的：團局、聊天、貼文列表裡**已經寫進去**的顯示名稱與大頭貼。那些是各筆紀錄自己存的副本，
//
//	停用期間照舊顯示，要等到期清除時才會改成「已刪除的使用者」。
func AccountHiddenFromOthers(ctx context.Context, userID string) (bool, error) {
	c := getAuthDDBClient()
	if c == nil {
		return false, ErrAuthDDBUnavailable
	}
	return accountHiddenFromOthers(ctx, c, tablePrefix(), userID)
}

func accountHiddenFromOthers(ctx context.Context, db accountDeletionDB, prefix, userID string) (bool, error) {
	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(prefix + "Users"),
		Key:                  map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		ProjectionExpression: aws.String("userId, deleteRequestedAt"),
		ConsistentRead:       aws.Bool(true),
	})
	if err != nil {
		return false, err
	}
	// 查無此人不是這支要管的事，交回給端點原本的處理。
	if len(out.Item) == 0 {
		return false, nil
	}
	raw, present := out.Item["deleteRequestedAt"]
	if !present {
		return false, nil
	}
	// 欄位在、但不是正整數（型別不對、寫壞了）也一律隱藏：這裡猜錯的代價是把一個要求刪除的人繼續秀給別人看。
	if num, ok := raw.(*types.AttributeValueMemberN); ok {
		if v, perr := strconv.ParseInt(num.Value, 10, 64); perr == nil && v <= 0 {
			return false, nil
		}
	}
	return true, nil
}

// ── 停掉推播 ────────────────────────────────────────────────

type pushSubscriptionDB interface {
	Query(ctx context.Context, in *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// DeactivateAllPushSubscriptions 把這個人每一台裝置的推播訂閱設成 isActive=false
// （與 web_unsubscribe_push 同一個做法；發送端 push_notification.go 會跳過 isActive=false）。
// 回傳停掉幾台。中途失敗就回錯誤與已停掉的台數 —— 呼叫端自己決定要不要讓整個請求失敗。
//
// ⚠️ 管不到的：舊的單裝置表 PushSubscriptions（發送端在多裝置表查無資料時會退回去讀它，
//
//	而且一律當成有效）；以及不經過 push_notification.go 的發送路徑。
func DeactivateAllPushSubscriptions(ctx context.Context, db pushSubscriptionDB, prefix, userID string, now time.Time) (int, error) {
	table := prefix + "PushSubscriptions_MultiDevice"
	done := 0
	var startKey map[string]types.AttributeValue
	for {
		out, err := db.Query(ctx, &dynamodb.QueryInput{
			TableName:                 aws.String(table),
			KeyConditionExpression:    aws.String("userId = :u"),
			ExpressionAttributeValues: map[string]types.AttributeValue{":u": &types.AttributeValueMemberS{Value: userID}},
			ProjectionExpression:      aws.String("userId, deviceId"),
			ExclusiveStartKey:         startKey,
		})
		if err != nil {
			return done, err
		}
		for _, item := range out.Items {
			dev, ok := item["deviceId"].(*types.AttributeValueMemberS)
			if !ok {
				continue
			}
			_, err := db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
				TableName: aws.String(table),
				Key: map[string]types.AttributeValue{
					"userId":   &types.AttributeValueMemberS{Value: userID},
					"deviceId": &types.AttributeValueMemberS{Value: dev.Value},
				},
				UpdateExpression: aws.String("SET isActive = :false, updatedAt = :now"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":false": &types.AttributeValueMemberBOOL{Value: false},
					":now":   &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
				},
			})
			if err != nil {
				return done, err
			}
			done++
		}
		if len(out.LastEvaluatedKey) == 0 {
			return done, nil
		}
		startKey = out.LastEvaluatedKey
	}
}
