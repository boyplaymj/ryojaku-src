package shared

// 帳號刪除 —— 「先停用、30 天後清除」的共用核心（使用者 2026-10-11 拍板）。
// 對外承諾寫在 frontend/legal/delete-account.txt；這裡的數字與那一頁對不上就是違約。
//
// 狀態只有一個欄位：Users.deleteRequestedAt（Unix 秒，Number）。
//   沒有           ⇒ 正常帳號
//   有，未滿 30 天 ⇒ 停用中；這段期間重新登入＝撤回
//   有，已滿 30 天 ⇒ 該清除了；**不可以**再被登入救回來（清除工作可能還沒輪到它）
//
// 🔴 這個檔只有判定與 UpdateItem 的組法，沒有接上任何端點。
//    還沒做的：提出刪除的端點、三個登入入口（app_login／auth_google／auth_line）的撤回、
//    個人檔案對外隱藏、到期清除的排程工作。

import (
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
