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
func usersTable() string           { return tablePrefix() + "Users" }

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
	// ErrIdentityNotOwned：要解綁的鑰匙不屬於這個帳號。
	ErrIdentityNotOwned = errors.New("identity not owned by this account")
	// ErrUserNotFound：目標 userId 在 Users 表不存在（防綁鑰匙時建出骷髏帳號）。
	ErrUserNotFound = errors.New("target user does not exist")
	// ErrAuthDDBUnavailable：DDB client 無法初始化。
	ErrAuthDDBUnavailable = errors.New("auth ddb client unavailable")
)

// IdentityKey 組出 AuthIdentities 的 PK。
// 對齊 AUTH_SYSTEM_DESIGN §2：google#<sub> / email#<lowercased> / line#<encId>。
// password 登入身分以 email 為外部識別，PK 前綴用 email#（非 password#），並小寫去空白正規化。
func IdentityKey(provider, external string) string {
	if provider == ProviderPassword {
		return "email#" + strings.ToLower(strings.TrimSpace(external))
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

// ResolveEmailToUserID：email → userId 的統一解析（只回 userId、只讀不寫）。
// AuthIdentities(email#lower) 權威優先；查無則 fallback Users email-index（相容未 backfill 的既有 13k）。
// email-index 以「原輸入去空白」比對，與 login 的 GetUserByEmail 語意一致 → 能登入者即能收重設信。
// 查無 → 回 ("", nil)；呼叫端(如 forgot)據此決定要不要寄信，且不論如何都回防枚舉的統一訊息。
func ResolveEmailToUserID(ctx context.Context, rawEmail string) (string, error) {
	if uid, err := ResolveIdentity(ctx, IdentityKey(ProviderPassword, rawEmail)); err == nil && uid != "" {
		return uid, nil
	}
	c := getAuthDDBClient()
	if c == nil {
		return "", ErrAuthDDBUnavailable
	}
	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:                 aws.String(usersTable()),
		IndexName:                 aws.String("email-index"),
		KeyConditionExpression:    aws.String("email = :e"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":e": &types.AttributeValueMemberS{Value: strings.TrimSpace(rawEmail)}},
		ProjectionExpression:      aws.String("userId"),
		Limit:                     aws.Int32(1),
	})
	if err != nil {
		return "", err
	}
	if len(out.Items) > 0 {
		if v, ok := out.Items[0]["userId"].(*types.AttributeValueMemberS); ok {
			return v.Value, nil
		}
	}
	return "", nil
}

// FindIdentityByProvider：查某帳號某 provider 的 identity PK（走 userId-index，Projection=ALL）。
// 查無回 ("", nil)。用於解綁(需先知道要刪哪把 identity)。
func FindIdentityByProvider(ctx context.Context, userID, provider string) (string, error) {
	c := getAuthDDBClient()
	if c == nil {
		return "", ErrAuthDDBUnavailable
	}
	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(authIdentitiesTable()),
		IndexName:              aws.String("userId-index"),
		KeyConditionExpression: aws.String("userId = :u"),
		FilterExpression:       aws.String("provider = :p"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":u": &types.AttributeValueMemberS{Value: userID},
			":p": &types.AttributeValueMemberS{Value: provider},
		},
	})
	if err != nil {
		return "", err
	}
	if len(out.Items) > 0 {
		if v, ok := out.Items[0]["identity"].(*types.AttributeValueMemberS); ok {
			return v.Value, nil
		}
	}
	return "", nil
}

// BindIdentity：把一把鑰匙掛到 userId，並在同一交易遞增 Users.identityCount（供孤兒守衛）。
// 若該鑰匙已存在 → ErrIdentityTaken（防搶綁，attribute_not_exists 條件）。
// 原子性：Put 身分 + Update 計數器合為單一 TransactWriteItems，兩者同生同滅。
func BindIdentity(ctx context.Context, identity, userID, provider string) error {
	c := getAuthDDBClient()
	if c == nil {
		return ErrAuthDDBUnavailable
	}
	_, err := c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{
				TableName: aws.String(authIdentitiesTable()),
				Item: map[string]types.AttributeValue{
					"identity":  &types.AttributeValueMemberS{Value: identity},
					"userId":    &types.AttributeValueMemberS{Value: userID},
					"provider":  &types.AttributeValueMemberS{Value: provider},
					"createdAt": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
				},
				ConditionExpression: aws.String("attribute_not_exists(identity)"),
			}},
			{Update: &types.Update{ // 計數器 +1（ADD 對缺屬性視為 0 起算）
				TableName:                 aws.String(usersTable()),
				Key:                       map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
				UpdateExpression:          aws.String("ADD identityCount :one"),
				ConditionExpression:       aws.String("attribute_exists(userId)"), // 目標帳號須已存在，否則 Update 會建骷髏帳號
				ExpressionAttributeValues: map[string]types.AttributeValue{":one": &types.AttributeValueMemberN{Value: "1"}},
			}},
		},
	})
	if err != nil {
		var tce *types.TransactionCanceledException
		if errors.As(err, &tce) && len(tce.CancellationReasons) == 2 {
			if r := tce.CancellationReasons[0].Code; r != nil && *r == "ConditionalCheckFailed" {
				return ErrIdentityTaken // ①失敗：該鑰匙已綁在別的帳號
			}
			if r := tce.CancellationReasons[1].Code; r != nil && *r == "ConditionalCheckFailed" {
				return ErrUserNotFound // ②失敗：目標 userId 不存在
			}
		}
		return err
	}
	return nil
}

// CountIdentities：某 userId 目前綁了幾把鑰匙（走 userId-index GSI）。唯讀用途（顯示/後台）。
// 孤兒守衛不靠這個（改用交易計數器，見 UnbindIdentity）；此處單頁 Count 對極少鑰匙足夠。
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

// UnbindIdentity：解綁一把鑰匙。單一 TransactWriteItems 原子完成：
//   ① Delete 身分（條件 userId=自己 → 只能解自己的鑰匙）
//   ② Update 計數器 -1（條件 identityCount > 1 → 最後一把擋下，防孤兒）
// 兩條件哪個失敗都會取消整筆交易，用 CancellationReasons 分辨回對應錯誤。
func UnbindIdentity(ctx context.Context, identity, userID string) error {
	c := getAuthDDBClient()
	if c == nil {
		return ErrAuthDDBUnavailable
	}
	_, err := c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Delete: &types.Delete{
				TableName:                 aws.String(authIdentitiesTable()),
				Key:                       map[string]types.AttributeValue{"identity": &types.AttributeValueMemberS{Value: identity}},
				ConditionExpression:       aws.String("userId = :u"),
				ExpressionAttributeValues: map[string]types.AttributeValue{":u": &types.AttributeValueMemberS{Value: userID}},
			}},
			{Update: &types.Update{
				TableName:                 aws.String(usersTable()),
				Key:                       map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
				UpdateExpression:          aws.String("SET identityCount = identityCount - :one"),
				ConditionExpression:       aws.String("identityCount > :one"),
				ExpressionAttributeValues: map[string]types.AttributeValue{":one": &types.AttributeValueMemberN{Value: "1"}},
			}},
		},
	})
	if err != nil {
		var tce *types.TransactionCanceledException
		if errors.As(err, &tce) && len(tce.CancellationReasons) == 2 {
			if r := tce.CancellationReasons[0].Code; r != nil && *r == "ConditionalCheckFailed" {
				return ErrIdentityNotOwned // ①失敗：鑰匙不屬於此帳號（或已不存在）
			}
			if r := tce.CancellationReasons[1].Code; r != nil && *r == "ConditionalCheckFailed" {
				return ErrLastIdentity // ②失敗：只剩最後一把
			}
		}
		return err
	}
	return nil
}
