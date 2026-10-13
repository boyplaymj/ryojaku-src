package shared

import (
	"context"
	"fmt"
	"sort"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// GetUserInfo fetches a user record from DynamoDB
func GetUserInfo(ctx context.Context, apiDB *dynamodb.Client, tablePrefix string, userID string) (*User, error) {
	tableName := tablePrefix + "Users"
	result, err := apiDB.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		return nil, err
	}

	if result.Item == nil {
		return nil, nil
	}

	var user User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// BuildUserFieldsUpdate 組出「把這個 User 結構上有的欄位寫回去」的 UpdateItem。
//
// 為什麼不用 PutItem（2026-10-13，Codex 覆驗帳號刪除時指出）：
// 原本有兩處是「GetItem → 改幾個欄位 → 整列 PutItem」。PutItem 會把同鍵的舊列**整列換掉**，
// 而 shared.User 這個結構不認得的屬性（pwChangedAt、deleteRequestedAt、purgedAt…）不會被寫回去
// ⇒ 那些屬性靜靜消失：
//   - pwChangedAt 沒了 ⇒ 改密碼／登出所有裝置所作廢的舊 JWT 又變回有效；
//   - deleteRequestedAt 沒了 ⇒ 提出刪除的帳號被悄悄救回來；
//   - 對墓碑做這件事 ⇒ 墓碑被寫回成一列看起來像活帳號的資料。
//
// UpdateItem 的 SET 只動列出來的屬性，其餘原封不動。
//
// ⚠️ 與 PutItem 的一個差別：結構上是 omitempty 而這次是空值的欄位**不會被清掉**（PutItem 會）。
//
//	原本那兩處都只是加減點數與統計，不靠「寫回空值來清欄位」。
//
// 條件：這個人存在，而且不是已清除的墓碑。對墓碑一律不寫（回 ConditionalCheckFailedException）。
func BuildUserFieldsUpdate(tablePrefix string, item map[string]types.AttributeValue) (*dynamodb.UpdateItemInput, error) {
	id, ok := item["userId"].(*types.AttributeValueMemberS)
	if !ok || id.Value == "" {
		return nil, fmt.Errorf("user item has no userId")
	}
	keys := make([]string, 0, len(item))
	for k := range item {
		if k != "userId" {
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("user item has no fields to write")
	}
	sort.Strings(keys)
	expr := "SET "
	names := map[string]string{}
	values := map[string]types.AttributeValue{}
	for i, k := range keys {
		if i > 0 {
			expr += ", "
		}
		// 一律用別名：points、rating、stats、platform 這些名字有的是 DynamoDB 的保留字。
		n, v := fmt.Sprintf("#f%d", i), fmt.Sprintf(":v%d", i)
		expr += n + " = " + v
		names[n] = k
		values[v] = item[k]
	}
	return &dynamodb.UpdateItemInput{
		TableName:                 aws.String(tablePrefix + "Users"),
		Key:                       map[string]types.AttributeValue{"userId": id},
		UpdateExpression:          aws.String(expr),
		ConditionExpression:       aws.String("attribute_exists(userId) AND attribute_not_exists(purgedAt)"),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	}, nil
}

// UpdateUserFields：把 user 結構上有的欄位寫回 Users，不動其他屬性。見 BuildUserFieldsUpdate。
func UpdateUserFields(ctx context.Context, apiDB *dynamodb.Client, tablePrefix string, user *User) error {
	item, err := attributevalue.MarshalMap(user)
	if err != nil {
		return err
	}
	in, err := BuildUserFieldsUpdate(tablePrefix, item)
	if err != nil {
		return err
	}
	_, err = apiDB.UpdateItem(ctx, in)
	return err
}
