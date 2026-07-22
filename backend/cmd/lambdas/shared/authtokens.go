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

// ConsumeToken：驗一個明碼 token(限定用途)。通過→回 userId 並原子標記 usedAt(單次)。
// 失敗：不存在 / 用途不符 / 已過期 / 已用過 → 回 ""+err。
func ConsumeToken(ctx context.Context, raw, purpose string) (string, error) {
	c := getAuthDDBClient()
	if c == nil {
		return "", ErrAuthDDBUnavailable
	}
	h := hashToken(raw)
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(authTokensTable()),
		Key:       map[string]types.AttributeValue{"tokenHash": &types.AttributeValueMemberS{Value: h}},
	})
	if err != nil {
		return "", err
	}
	if out.Item == nil {
		return "", errors.New("invalid token")
	}
	if p, ok := out.Item["purpose"].(*types.AttributeValueMemberS); !ok || p.Value != purpose {
		return "", errors.New("invalid token")
	}
	if _, used := out.Item["usedAt"]; used {
		return "", errors.New("token already used")
	}
	// TTL 刪除有延遲，程式端再驗一次過期。
	if e, ok := out.Item["expiresAt"].(*types.AttributeValueMemberN); ok {
		var exp int64
		fmt.Sscanf(e.Value, "%d", &exp)
		if time.Now().Unix() > exp {
			return "", errors.New("token expired")
		}
	}
	uid := ""
	if u, ok := out.Item["userId"].(*types.AttributeValueMemberS); ok {
		uid = u.Value
	}
	// 原子標記單次使用：usedAt 不存在才寫，防同一 token 併發雙用。
	_, err = c.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(authTokensTable()),
		Key:                       map[string]types.AttributeValue{"tokenHash": &types.AttributeValueMemberS{Value: h}},
		UpdateExpression:          aws.String("SET usedAt = :t"),
		ConditionExpression:       aws.String("attribute_not_exists(usedAt)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":t": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", time.Now().Unix())}},
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			return "", errors.New("token already used")
		}
		return "", err
	}
	return uid, nil
}
