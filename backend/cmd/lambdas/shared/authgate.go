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

// userGateStatus：查帳號的 accountType 與 emailVerified（投影只讀，輕量）。
// 回 (isAppAccount, verified, err)：isAppAccount 表示這是 email/密碼帳號(accountType=="app")。
// ⚠️ email 軟門檻「只管 app 帳號」——既有 LINE-only / legacy(accountType 非 app)不受管、一律放行，
// 否則沒有 emailVerified 的既有用戶會被誤擋開團/報名(Codex P2 High)。
func userGateStatus(ctx context.Context, userID string) (bool, bool, error) {
	c := getAuthDDBClient()
	if c == nil {
		return false, false, ErrAuthDDBUnavailable
	}
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(usersTable()),
		Key:                  map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		ProjectionExpression: aws.String("accountType, emailVerified"),
	})
	if err != nil {
		return false, false, err
	}
	isApp := false
	if v, ok := out.Item["accountType"].(*types.AttributeValueMemberS); ok {
		isApp = v.Value == "app"
	}
	verified := false
	if v, ok := out.Item["emailVerified"].(*types.AttributeValueMemberBOOL); ok {
		verified = v.Value
	}
	return isApp, verified, nil
}

// BlockUnverifiedTrustAction：信任行為(開團/入團)前的軟門檻檢查。
// 回 (blocked, err)：blocked=true 表示應擋下。只擋「app 帳號且未驗證」；
// 非 app 帳號(LINE-only/legacy)一律放行。err != nil(查詢失敗) 採 fail-open(不擋)避免資料層抖動誤傷。
func BlockUnverifiedTrustAction(ctx context.Context, userID string) (bool, error) {
	if !EmailGateEnabled() {
		return false, nil
	}
	isApp, verified, err := userGateStatus(ctx, userID)
	if err != nil {
		return false, err // fail-open：呼叫端只在 err==nil && blocked 時擋
	}
	if !isApp {
		return false, nil // 非 email/密碼帳號不受 email 門檻管轄
	}
	return !verified, nil
}
