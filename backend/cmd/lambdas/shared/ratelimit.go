package shared

// 帳號系統 — 限流（AUTH_SYSTEM_DESIGN §6.4 / BUILD_PLAN 6.1）。
// 固定窗口計數，backed by AuthRateLimit 表（PK=rlKey，TTL 自清）。
// 用於 login/register/forgot/resend 防暴力與寄信轟炸。

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func authRateLimitTable() string { return tablePrefix() + "AuthRateLimit" }

// rateLimitBucketKey：固定窗口分桶的**唯一**來源。
// CheckRateLimit（加一）與 PeekRateLimit（只讀）都必須經過這支算 rlKey ——
// 兩邊若各寫一份、算到不同的桶，peek 永遠讀到空 item ⇒ 限流變成永遠放行的
// no-op，而且每個呼叫都回 ok、外觀完全正常。所以這裡不准有第二份。
//
//	now 以參數傳入（Unix 秒），讓純函式測試能釘住「跨窗口換桶、同窗口同桶」。
func rateLimitBucketKey(key string, windowSec int64, now int64) string {
	return fmt.Sprintf("%s#%d", key, now/windowSec)
}

// CheckRateLimit：固定窗口計數限流。
//
//	key      = 行為+識別（例 "login#email#a@b.com" / "register#ip#1.2.3.4"）
//	limit    = 窗口內允許次數
//	windowSec= 窗口秒數
//
// 回 (allowed, err)。**fail-open**：限流層故障(err!=nil)一律放行，避免擋死正常流量。
// 分桶：以 floor(now/window) 當桶號併入 key，每桶一個 item、窗口結束後 TTL 自清 → 天然固定窗口。
func CheckRateLimit(ctx context.Context, key string, limit int, windowSec int64) (bool, error) {
	c := getAuthDDBClient()
	if c == nil {
		return true, ErrAuthDDBUnavailable
	}
	now := time.Now().Unix()
	bucket := now / windowSec
	rlKey := rateLimitBucketKey(key, windowSec, now)
	expiresAt := (bucket+1)*windowSec + 60 // 窗口結束後 60s 清

	out, err := c.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                aws.String(authRateLimitTable()),
		Key:                      map[string]types.AttributeValue{"rlKey": &types.AttributeValueMemberS{Value: rlKey}},
		UpdateExpression:         aws.String("SET expiresAt = if_not_exists(expiresAt, :exp) ADD #c :one"),
		ExpressionAttributeNames: map[string]string{"#c": "count"}, // count 是 DynamoDB 保留字
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":one": &types.AttributeValueMemberN{Value: "1"},
			":exp": &types.AttributeValueMemberN{Value: strconv.FormatInt(expiresAt, 10)},
		},
		ReturnValues: types.ReturnValueUpdatedNew,
	})
	if err != nil {
		return true, err // fail-open
	}
	if v, ok := out.Attributes["count"].(*types.AttributeValueMemberN); ok {
		n, _ := strconv.Atoi(v.Value)
		return n <= limit, nil
	}
	return true, nil
}

// PeekRateLimit：**只讀、不加一**的限流查詢。
// 用途：只計失敗的限流桶 —— 認證前先 peek（不加一），認證失敗才呼叫 CheckRateLimit 加一。
// 回 (allowed, err)。allowed 的定義是「**再加一次還在額度內嗎**」＝ count < limit
// （對照 CheckRateLimit 是先加一再看 n <= limit；limit=10 時，已計 9 → true、已計 10 → false）。
// item 不存在 → count 視為 0 → 放行。
// **fail-open** 與 CheckRateLimit 一致：client 拿不到或 GetItem 出錯一律放行並回 err。
// 分桶一律經 rateLimitBucketKey，與 CheckRateLimit 逐字同桶。
func PeekRateLimit(ctx context.Context, key string, limit int, windowSec int64) (bool, error) {
	c := getAuthDDBClient()
	if c == nil {
		return true, ErrAuthDDBUnavailable
	}
	rlKey := rateLimitBucketKey(key, windowSec, time.Now().Unix())

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(authRateLimitTable()),
		Key:       map[string]types.AttributeValue{"rlKey": &types.AttributeValueMemberS{Value: rlKey}},
		// 這支是准入閘：最終一致的讀會讀到落後的計數 ⇒ 低估 ⇒ 多放行。
		// 強一致讀多花一點 RCU，換的是「剛被 CheckRateLimit 加到 limit 的那次，peek 立刻看得到」。
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return true, err // fail-open
	}
	if v, ok := out.Item["count"].(*types.AttributeValueMemberN); ok {
		n, _ := strconv.Atoi(v.Value)
		return n < limit, nil
	}
	return true, nil // item 不存在或沒有 count ⇒ 視為 0
}
