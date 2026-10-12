package shared

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
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

// ── 登入時的處理 ─────────────────────────────────────────────

type fakeDeletionDB struct {
	items     []map[string]types.AttributeValue // 每次 GetItem 依序回一筆；用完就重複最後一筆
	getErr    error
	updateErr []error // 每次 UpdateItem 依序回；用完回 nil
	gets      int
	updates   []*dynamodb.UpdateItemInput
	lastGet   *dynamodb.GetItemInput
	onGet     func() // 每次 GetItem 回應之前呼叫（用來讓時間在「讀」的期間往前走）
}

func (f *fakeDeletionDB) GetItem(_ context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	f.lastGet = in
	if f.onGet != nil {
		f.onGet()
	}
	if f.getErr != nil {
		return nil, f.getErr
	}
	i := f.gets
	if i >= len(f.items) {
		i = len(f.items) - 1
	}
	f.gets++
	return &dynamodb.GetItemOutput{Item: f.items[i]}, nil
}

func (f *fakeDeletionDB) UpdateItem(_ context.Context, in *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	f.updates = append(f.updates, in)
	if n := len(f.updates); n <= len(f.updateErr) {
		return nil, f.updateErr[n-1]
	}
	return &dynamodb.UpdateItemOutput{}, nil
}

func userItem(extra map[string]types.AttributeValue) map[string]types.AttributeValue {
	m := map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: "u1"}}
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func nAttr(v int64) types.AttributeValue {
	return &types.AttributeValueMemberN{Value: strconv.FormatInt(v, 10)}
}

func TestResolveAccountDeletionOnLogin(t *testing.T) {
	req := int64(1_800_000_000)
	grace := int64(30 * 24 * 3600)
	ccf := &types.ConditionalCheckFailedException{}
	boom := errors.New("boom")
	pending := userItem(map[string]types.AttributeValue{"deleteRequestedAt": nAttr(req)})

	cases := []struct {
		name        string
		db          *fakeDeletionDB
		now         int64
		wantErr     error // nil＝放行；errAny＝任何非 nil 且不是 ErrAccountDeleted
		wantUpdates int
	}{
		{"沒提出過 ⇒ 放行，不寫任何東西", &fakeDeletionDB{items: []map[string]types.AttributeValue{userItem(nil)}}, req, nil, 0},
		{"停用期內 ⇒ 撤回後放行", &fakeDeletionDB{items: []map[string]types.AttributeValue{pending}}, req + 10, nil, 1},
		{"差一秒到期 ⇒ 仍可撤回", &fakeDeletionDB{items: []map[string]types.AttributeValue{pending}}, req + grace - 1, nil, 1},
		{"剛好到期 ⇒ 拒絕，而且不去寫", &fakeDeletionDB{items: []map[string]types.AttributeValue{pending}}, req + grace, ErrAccountDeleted, 0},
		{"撤回時發生非條件式錯誤 ⇒ 不可放行", &fakeDeletionDB{items: []map[string]types.AttributeValue{pending}, updateErr: []error{boom}}, req + 10, boom, 1},
		{"條件不成立、重讀後欄位已不在（另一個登入搶先撤回）⇒ 放行",
			&fakeDeletionDB{items: []map[string]types.AttributeValue{pending, userItem(nil)}, updateErr: []error{ccf}}, req + 10, nil, 1},
		{"條件連兩次不成立 ⇒ 拒絕，不無限重試",
			&fakeDeletionDB{items: []map[string]types.AttributeValue{pending}, updateErr: []error{ccf, ccf}}, req + 10, ErrAccountDeleted, 2},
		{"讀取失敗 ⇒ 不可放行", &fakeDeletionDB{getErr: boom}, req, boom, 0},
		{"查無此人 ⇒ 不可放行", &fakeDeletionDB{items: []map[string]types.AttributeValue{{}}}, req, errAny, 0},
		{"欄位是字串 ⇒ 不可當成沒提出過",
			&fakeDeletionDB{items: []map[string]types.AttributeValue{userItem(map[string]types.AttributeValue{
				"deleteRequestedAt": &types.AttributeValueMemberS{Value: "1800000000"}})}}, req, errAny, 0},
	}
	for _, c := range cases {
		err := resolveAccountDeletionOnLogin(context.Background(), c.db, "P_", "u1", fixedClock(c.now), true)
		switch {
		case c.wantErr == nil && err != nil:
			t.Errorf("%s: 應放行，得到 %v", c.name, err)
		case c.wantErr == errAny && (err == nil || errors.Is(err, ErrAccountDeleted)):
			t.Errorf("%s: 應是「判不出來」的錯誤，得到 %v", c.name, err)
		case c.wantErr != nil && c.wantErr != errAny && !errors.Is(err, c.wantErr):
			t.Errorf("%s: got %v want %v", c.name, err, c.wantErr)
		}
		if len(c.db.updates) != c.wantUpdates {
			t.Errorf("%s: UpdateItem 次數 %d，期望 %d", c.name, len(c.db.updates), c.wantUpdates)
		}
	}

	// 讀取必須是強一致、打在 Users 表上。
	db := &fakeDeletionDB{items: []map[string]types.AttributeValue{userItem(nil)}}
	_ = resolveAccountDeletionOnLogin(context.Background(), db, "P_", "u1", fixedClock(req), true)
	if db.lastGet == nil || db.lastGet.ConsistentRead == nil || !*db.lastGet.ConsistentRead || *db.lastGet.TableName != "P_Users" {
		t.Errorf("GetItem 不是對 P_Users 的強一致讀取：%+v", db.lastGet)
	}
}

var errAny = errors.New("any non-nil error")

func fixedClock(sec int64) func() time.Time {
	return func() time.Time { return time.Unix(sec, 0) }
}

// 提出刪除的同一秒內登入：不可以撤回、不可以放行（發出去的 JWT 會當場作廢），
// 也不可以說成「已刪除」。下一秒就照常撤回。
func TestResolveAccountDeletionOnLogin_SameSecondAsRequest(t *testing.T) {
	req := int64(1_800_000_000)
	item := userItem(map[string]types.AttributeValue{"deleteRequestedAt": nAttr(req), "pwChangedAt": nAttr(req)})

	db := &fakeDeletionDB{items: []map[string]types.AttributeValue{item}}
	err := resolveAccountDeletionOnLogin(context.Background(), db, "P_", "u1", fixedClock(req), true)
	if !errors.Is(err, ErrLoginTooSoonAfterDeletionRequest) {
		t.Errorf("同秒：got %v，要 ErrLoginTooSoonAfterDeletionRequest", err)
	}
	if len(db.updates) != 0 {
		t.Errorf("同秒不該撤回，卻寫了 %d 次", len(db.updates))
	}

	db = &fakeDeletionDB{items: []map[string]types.AttributeValue{item}}
	if err := resolveAccountDeletionOnLogin(context.Background(), db, "P_", "u1", fixedClock(req+1), true); err != nil {
		t.Errorf("下一秒應該放行，得到 %v", err)
	}
	if len(db.updates) != 1 {
		t.Errorf("下一秒應該撤回一次，實得 %d 次", len(db.updates))
	}
}

// 判定用的時間要在讀完之後才取：讀取期間跨過期限的帳號不可以被撤回。
func TestResolveAccountDeletionOnLogin_ClockIsReadAfterTheRead(t *testing.T) {
	req := int64(1_800_000_000)
	grace := int64(30 * 24 * 3600)
	now := req + grace - 1 // 開始登入時還差一秒
	db := &fakeDeletionDB{items: []map[string]types.AttributeValue{
		userItem(map[string]types.AttributeValue{"deleteRequestedAt": nAttr(req)})}}
	db.onGet = func() { now = req + grace } // 讀回來的時候已經到期
	err := resolveAccountDeletionOnLogin(context.Background(), db, "P_", "u1", func() time.Time { return time.Unix(now, 0) }, true)
	if !errors.Is(err, ErrAccountDeleted) {
		t.Errorf("got %v，要 ErrAccountDeleted", err)
	}
	if len(db.updates) != 0 {
		t.Errorf("已到期不該撤回，卻寫了 %d 次", len(db.updates))
	}
}
