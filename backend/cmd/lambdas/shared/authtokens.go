package shared

// 帳號系統 — 一次性 token (AuthTokens)：認證信 / 重設密碼。
// DB 只存 token 的 SHA-256，明碼只出現在寄出的信裡；TTL 自動清、usedAt 單次。
// 詳 tools/ryojaku-webapp/AUTH_SYSTEM_DESIGN.md §4.2。

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// token 用途常數。
const (
	PurposeVerifyEmail   = "verify_email"
	PurposeResetPassword = "reset_password"
)

// 建議 TTL。
const (
	TTLVerifyEmail   = 24 * time.Hour
	TTLResetPassword = 30 * time.Minute
)

func authTokensTable() string { return tablePrefix() + "AuthTokens" }

// hashToken：明碼 → SHA-256 hex。DB 只存這個雜湊。
func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// IssueToken：產一次性明碼 token(256-bit)，存其雜湊+TTL，回明碼供放進信裡的連結。
func IssueToken(ctx context.Context, userID, purpose string, ttl time.Duration) (string, error) {
	c := getAuthDDBClient()
	if c == nil {
		return "", ErrAuthDDBUnavailable
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	raw := base64.RawURLEncoding.EncodeToString(b)
	now := time.Now()
	_, err := c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(authTokensTable()),
		Item: map[string]types.AttributeValue{
			"tokenHash": &types.AttributeValueMemberS{Value: hashToken(raw)},
			"userId":    &types.AttributeValueMemberS{Value: userID},
			"purpose":   &types.AttributeValueMemberS{Value: purpose},
			"expiresAt": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", now.Add(ttl).Unix())},
			"createdAt": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", now.Unix())},
		},
	})
	if err != nil {
		return "", err
	}
	return raw, nil
}

// ConsumeToken：驗一個明碼 token(限定用途)並原子消耗。單一 conditional UpdateItem 完成：
// 存在 + 用途相符 + 未過期 + 未用過（全放進同一 ConditionExpression）→ 標記 usedAt，回 userId。
// 避免「GetItem 檢查後才標記」之間的 stale 窗口/TTL 邊界誤放行。
// 任一條件不符 → ConditionalCheckFailed，統一回不洩漏細節的錯誤。
func ConsumeToken(ctx context.Context, raw, purpose string) (string, error) {
	c := getAuthDDBClient()
	if c == nil {
		return "", ErrAuthDDBUnavailable
	}
	now := fmt.Sprintf("%d", time.Now().Unix())
	out, err := c.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:           aws.String(authTokensTable()),
		Key:                 map[string]types.AttributeValue{"tokenHash": &types.AttributeValueMemberS{Value: hashToken(raw)}},
		UpdateExpression:    aws.String("SET usedAt = :now"),
		ConditionExpression: aws.String("attribute_exists(tokenHash) AND purpose = :p AND expiresAt > :now AND attribute_not_exists(usedAt)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":now": &types.AttributeValueMemberN{Value: now},
			":p":   &types.AttributeValueMemberS{Value: purpose},
		},
		ReturnValues: types.ReturnValueAllOld, // 取回消耗前的 userId
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			return "", errors.New("invalid, expired, or used token")
		}
		return "", err
	}
	if u, ok := out.Attributes["userId"].(*types.AttributeValueMemberS); ok {
		return u.Value, nil
	}
	return "", errors.New("invalid token")
}
