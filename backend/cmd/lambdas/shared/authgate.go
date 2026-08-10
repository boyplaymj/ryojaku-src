package shared

// 帳號系統 — 信箱認證「軟門檻」閘。
// 未驗證信箱者可登入、可逛，但不可做信任行為(開團/入團)。詳 AUTH_SYSTEM_DESIGN §5.A。
// 後台可切：env EMAIL_VERIFY_GATE=off 關閉整個軟門檻(預設開)。

import (
	"context"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// EmailGateEnabled：軟門檻是否啟用。env EMAIL_VERIFY_GATE=off → 關；其餘(含未設)→ 開。
func EmailGateEnabled() bool {
	return os.Getenv("EMAIL_VERIFY_GATE") != "off"
}

// userGateStatus：查帳號的 accountType / emailVerified / 有沒有 email（投影只讀，輕量）。
// 回 (isAppAccount, verified, hasEmail, err)：isAppAccount 表示這是 app 帳號(accountType=="app")。
// ⚠️ email 軟門檻「只管 app 帳號」——既有 LINE-only / legacy(accountType 非 app)不受管、一律放行，
// 否則沒有 emailVerified 的既有用戶會被誤擋開團/報名(Codex P2 High)。
func userGateStatus(ctx context.Context, userID string) (bool, bool, bool, error) {
	c := getAuthDDBClient()
	if c == nil {
		return false, false, false, ErrAuthDDBUnavailable
	}
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:                aws.String(usersTable()),
		Key:                      map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		ProjectionExpression:     aws.String("accountType, emailVerified, #em"),
		ExpressionAttributeNames: map[string]string{"#em": "email"},
	})
	if err != nil {
		return false, false, false, err
	}
	isApp := false
	if v, ok := out.Item["accountType"].(*types.AttributeValueMemberS); ok {
		isApp = v.Value == "app"
	}
	verified := false
	if v, ok := out.Item["emailVerified"].(*types.AttributeValueMemberBOOL); ok {
		verified = v.Value
	}
	hasEmail := false
	if v, ok := out.Item["email"].(*types.AttributeValueMemberS); ok {
		hasEmail = strings.TrimSpace(v.Value) != ""
	}
	return isApp, verified, hasEmail, nil
}

// BlockUnverifiedTrustAction：信任行為(開團/入團)前的軟門檻檢查。
// 回 (blocked, err)：blocked=true 表示應擋下。只擋「app 帳號、有 email、且未驗證」；
// 非 app 帳號(legacy linebot)一律放行。err != nil(查詢失敗) 採 fail-open(不擋)避免資料層抖動誤傷。
func BlockUnverifiedTrustAction(ctx context.Context, userID string) (bool, error) {
	if !EmailGateEnabled() {
		return false, nil
	}
	isApp, verified, hasEmail, err := userGateStatus(ctx, userID)
	if err != nil {
		return false, err // fail-open：呼叫端只在 err==nil && blocked 時擋
	}
	return shouldBlockTrustAction(isApp, verified, hasEmail), nil
}

// shouldBlockTrustAction：軟門檻的純決策（抽出來才驗得到，不必碰 DDB）。
// 只擋「app 帳號 + 有 email + 未驗證」。
//
// ⚠️ 沒有 email 的 app 帳號 = LINE Login 建的帳號（auth_line 刻意不寫 Users.email，
// 因為 LINE 官方文件沒說 email claim 經過驗證）。它沒有可驗的信箱、也沒有觸發認證信的
// 路徑 → 若照舊擋下，會是「永遠開不了團、且無解」的死結。
// 判準用「有沒有 email」而非「是不是 LINE」：密碼註冊必填 email（app_register 有驗）、
// Google 帳號也一定帶 email，所以只有真的無信箱的帳號會走到這條放行。
func shouldBlockTrustAction(isApp, verified, hasEmail bool) bool {
	if !isApp {
		return false // 非 app 帳號（legacy linebot）不受 email 門檻管轄
	}
	if !hasEmail {
		return false // 沒有信箱可驗
	}
	return !verified
}
