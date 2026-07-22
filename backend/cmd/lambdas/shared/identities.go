package shared

// 帳號系統 — 登入身分索引 (AuthIdentities)。
// 一帳號多鑰匙：canonical 帳號=userId，可掛多把登入身分(密碼/Google/LINE)。
// 詳 tools/ryojaku-webapp/AUTH_SYSTEM_DESIGN.md §2。

import (
	"context"
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Auth 系統共用 DynamoDB client（懶加載；identities.go 與 authtokens.go 共用）。
var authDDBClient *dynamodb.Client

func getAuthDDBClient() *dynamodb.Client {
	if authDDBClient == nil {
		cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion("ap-southeast-1"))
		if err != nil {
			log.Printf("[Auth] 無法載入 AWS 設定: %v", err)
			return nil
		}
		authDDBClient = dynamodb.NewFromConfig(cfg)
	}
	return authDDBClient
}

// tablePrefix 讀 TABLE_PREFIX（預設 prod 前綴以相容既有部署；staging 由 env 帶 MahjongClubStg_）。
func tablePrefix() string {
	if p := os.Getenv("TABLE_PREFIX"); p != "" {
		return p
	}
	return "MahjongClub_"
}

func authIdentitiesTable() string { return tablePrefix() + "AuthIdentities" }

// Identity provider 常數。
const (
	ProviderPassword = "password"
	ProviderGoogle   = "google"
	ProviderLine     = "line"
)

var (
	// ErrIdentityTaken：這把鑰匙已綁在別的帳號（防搶綁）。
	ErrIdentityTaken = errors.New("identity already bound to another account")
	// ErrLastIdentity：這是帳號最後一把可登入鑰匙，不准解綁（防孤兒帳號）。
	ErrLastIdentity = errors.New("cannot unbind the last login identity")
	// ErrAuthDDBUnavailable：DDB client 無法初始化。
	ErrAuthDDBUnavailable = errors.New("auth ddb client unavailable")
)

// IdentityKey 組出 AuthIdentities 的 PK：<provider>#<external>。
// password(email) 一律小寫去空白正規化，避免大小寫造成重複帳號。
func IdentityKey(provider, external string) string {
	if provider == ProviderPassword {
		external = strings.ToLower(strings.TrimSpace(external))
	}
	return provider + "#" + external
}

// ResolveIdentity：用一把鑰匙(identity PK)查出對應 userId。找不到回 ""、nil。
func ResolveIdentity(ctx context.Context, identity string) (string, error) {
	c := getAuthDDBClient()
	if c == nil {
		return "", ErrAuthDDBUnavailable
	}
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(authIdentitiesTable()),
		Key:       map[string]types.AttributeValue{"identity": &types.AttributeValueMemberS{Value: identity}},
	})
	if err != nil || out.Item == nil {
		return "", err
	}
	if v, ok := out.Item["userId"].(*types.AttributeValueMemberS); ok {
		return v.Value, nil
	}
	return "", nil
}

// BindIdentity：把一把鑰匙掛到 userId。若該鑰匙已存在 → ErrIdentityTaken（防搶綁）。
func BindIdentity(ctx context.Context, identity, userID, provider string) error {
	c := getAuthDDBClient()
	if c == nil {
		return ErrAuthDDBUnavailable
	}
	_, err := c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(authIdentitiesTable()),
		Item: map[string]types.AttributeValue{
			"identity":  &types.AttributeValueMemberS{Value: identity},
			"userId":    &types.AttributeValueMemberS{Value: userID},
			"provider":  &types.AttributeValueMemberS{Value: provider},
			"createdAt": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
		},
		ConditionExpression: aws.String("attribute_not_exists(identity)"),
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			return ErrIdentityTaken
		}
		return err
	}
	return nil
}

// CountIdentities：某 userId 目前綁了幾把鑰匙（走 userId-index GSI）。
// 一帳號鑰匙數極少（<10），單頁 Count 足夠、無需分頁。
func CountIdentities(ctx context.Context, userID string) (int, error) {
	c := getAuthDDBClient()
	if c == nil {
		return 0, ErrAuthDDBUnavailable
	}
	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:                 aws.String(authIdentitiesTable()),
		IndexName:                 aws.String("userId-index"),
		KeyConditionExpression:    aws.String("userId = :u"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":u": &types.AttributeValueMemberS{Value: userID}},
		Select:                    types.SelectCount,
	})
	if err != nil {
		return 0, err
	}
	return int(out.Count), nil
}

// UnbindIdentity：解綁一把鑰匙。守衛：若這是最後一把 → ErrLastIdentity（防孤兒帳號）。
// 註：count→delete 非單一原子；同一 user 同時解兩把的極端競態可能雙刪，屬低風險可接受。
func UnbindIdentity(ctx context.Context, identity, userID string) error {
	c := getAuthDDBClient()
	if c == nil {
		return ErrAuthDDBUnavailable
	}
	n, err := CountIdentities(ctx, userID)
	if err != nil {
		return err
	}
	if n <= 1 {
		return ErrLastIdentity
	}
	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName:                 aws.String(authIdentitiesTable()),
		Key:                       map[string]types.AttributeValue{"identity": &types.AttributeValueMemberS{Value: identity}},
		ConditionExpression:       aws.String("userId = :u"), // 只能解自己名下的鑰匙
		ExpressionAttributeValues: map[string]types.AttributeValue{":u": &types.AttributeValueMemberS{Value: userID}},
	})
	return err
}
