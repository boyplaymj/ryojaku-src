package shared

// 帳號系統 — 信箱認證「軟門檻」閘。
// 未驗證信箱者可登入、可逛，但不可做信任行為(開團/入團)。詳 AUTH_SYSTEM_DESIGN §5.A。
// 後台可切：env EMAIL_VERIFY_GATE=off 關閉整個軟門檻(預設開)。

import (
	"context"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// EmailGateEnabled：軟門檻是否啟用。env EMAIL_VERIFY_GATE=off → 關；其餘(含未設)→ 開。
func EmailGateEnabled() bool {
	return os.Getenv("EMAIL_VERIFY_GATE") != "off"
}

// IsEmailVerified：查某帳號信箱是否已驗證（投影只讀 emailVerified，輕量）。
// 缺欄位/查無 → 視為未驗證(false)。信任行為屬冷路徑，多一次 GetItem 可接受。
func IsEmailVerified(ctx context.Context, userID string) (bool, error) {
	c := getAuthDDBClient()
	if c == nil {
		return false, ErrAuthDDBUnavailable
	}
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(usersTable()),
		Key:                  map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		ProjectionExpression: aws.String("emailVerified"),
	})
	if err != nil {
		return false, err
	}
	if v, ok := out.Item["emailVerified"].(*types.AttributeValueMemberBOOL); ok {
		return v.Value, nil
	}
	return false, nil
}

// BlockUnverifiedTrustAction：信任行為(開團/入團)前的軟門檻檢查。
// 回 (blocked, err)：blocked=true 表示應擋下(未驗證且閘開啟)。
// err != nil(查詢失敗)時採 fail-open(不擋)以免登入資料層抖動誤傷；純未驗證才擋。
func BlockUnverifiedTrustAction(ctx context.Context, userID string) (bool, error) {
	if !EmailGateEnabled() {
		return false, nil
	}
	verified, err := IsEmailVerified(ctx, userID)
	if err != nil {
		return false, err // fail-open：查詢失敗不擋(呼叫端可只在 err==nil && blocked 時擋)
	}
	return !verified, nil
}
