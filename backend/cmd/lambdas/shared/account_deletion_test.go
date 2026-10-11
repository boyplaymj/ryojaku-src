package shared

import (
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func TestAccountDeletionStatusAt(t *testing.T) {
	req := int64(1_800_000_000)
	grace := int64(30 * 24 * 3600)
	cases := []struct {
		name        string
		requestedAt int64
		now         int64
		want        AccountDeletionStatus
	}{
		{"沒提出過", 0, req, DeletionNone},
		{"負值當成沒提出過", -1, req, DeletionNone},
		{"剛提出", req, req, DeletionPending},
		{"差一秒滿 30 天", req, req + grace - 1, DeletionPending},
		{"剛好滿 30 天算到期", req, req + grace, DeletionExpired},
		{"過期很久", req, req + grace*3, DeletionExpired},
	}
	for _, c := range cases {
		if got := AccountDeletionStatusAt(c.requestedAt, time.Unix(c.now, 0)); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func numOf(t *testing.T, v types.AttributeValue) int64 {
	t.Helper()
	n, ok := v.(*types.AttributeValueMemberN)
	if !ok {
		t.Fatalf("不是 Number：%T", v)
	}
	i, err := strconv.ParseInt(n.Value, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestBuildAccountDeletionRequest(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	in := BuildAccountDeletionRequest("MahjongClubStg_", "u1", now)
	if *in.TableName != "MahjongClubStg_Users" {
		t.Errorf("table = %s", *in.TableName)
	}
	expr := *in.UpdateExpression
	// 重複提出不可以把期限往後延。
	if !strings.Contains(expr, "deleteRequestedAt = if_not_exists(deleteRequestedAt, :t)") {
		t.Errorf("deleteRequestedAt 沒有用 if_not_exists：%s", expr)
	}
	// 提出即登出所有裝置。
	if !strings.Contains(expr, "pwChangedAt = :t") {
		t.Errorf("沒有寫 pwChangedAt：%s", expr)
	}
	if got := numOf(t, in.ExpressionAttributeValues[":t"]); got != now.Unix() {
		t.Errorf(":t = %d", got)
	}
	// 不可以替不存在的 userId 憑空建出一列。
	if in.ConditionExpression == nil || *in.ConditionExpression != "attribute_exists(userId)" {
		t.Errorf("condition = %v", in.ConditionExpression)
	}
}

// 撤回的條件式與 AccountDeletionStatusAt 必須是同一條線：
// 判定為 Pending 的那一刻撤得掉，判定為 Expired 的那一刻撤不掉。
func TestBuildAccountDeletionCancelAgreesWithStatus(t *testing.T) {
	req := int64(1_800_000_000)
	grace := int64(30 * 24 * 3600)
	for _, now := range []int64{req, req + 1, req + grace - 1, req + grace, req + grace + 1} {
		in := BuildAccountDeletionCancel("P_", "u1", time.Unix(now, 0))
		cond := *in.ConditionExpression
		if cond != "attribute_exists(deleteRequestedAt) AND deleteRequestedAt > :cutoff" {
			t.Fatalf("condition = %s", cond)
		}
		wouldCancel := req > numOf(t, in.ExpressionAttributeValues[":cutoff"])
		pending := AccountDeletionStatusAt(req, time.Unix(now, 0)) == DeletionPending
		if wouldCancel != pending {
			t.Errorf("now=req+%d: 條件式說撤得掉=%v，狀態判定 pending=%v", now-req, wouldCancel, pending)
		}
		if !strings.HasPrefix(*in.UpdateExpression, "REMOVE deleteRequestedAt") {
			t.Errorf("update = %s", *in.UpdateExpression)
		}
	}
}

// 30 這個數字有兩個載體：這裡的常數與刪除頁的原稿。改其中一邊而沒改另一邊＝對外承諾與行為不符。
func TestGraceMatchesPublicDeletePage(t *testing.T) {
	if AccountDeletionGrace != 30*24*time.Hour {
		t.Fatalf("grace = %v；要改天數請連同下面的原稿比對一起改", AccountDeletionGrace)
	}
	const src = "../../../../frontend/legal/delete-account.txt"
	b, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("讀不到刪除頁原稿 %s：%v（讀不到不可以當成相符）", src, err)
	}
	text := string(b)
	for _, want := range []string{"停用期（三十日）", "三十日內以原帳號重新登入", "滿三十日未重新登入"} {
		if !strings.Contains(text, want) {
			t.Errorf("刪除頁原稿裡找不到「%s」", want)
		}
	}
}
