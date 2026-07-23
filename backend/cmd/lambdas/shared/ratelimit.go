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

// CheckRateLimit：固定窗口計數限流。
//   key      = 行為+識別（例 "login#email#a@b.com" / "register#ip#1.2.3.4"）
//   limit    = 窗口內允許次數
//   windowSec= 窗口秒數
// 回 (allowed, err)。**fail-open**：限流層故障(err!=nil)一律放行，避免擋死正常流量。
// 分桶：以 floor(now/window) 當桶號併入 key，每桶一個 item、窗口結束後 TTL 自清 → 天然固定窗口。
func CheckRateLimit(ctx context.Context, key string, limit int, windowSec int64) (bool, error) {
	c := getAuthDDBClient()
	if c == nil {
		return true, ErrAuthDDBUnavailable
	}
	now := time.Now().Unix()
	bucket := now / windowSec
	rlKey := fmt.Sprintf("%s#%d", key, bucket)
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
