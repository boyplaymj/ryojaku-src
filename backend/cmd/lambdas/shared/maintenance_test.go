package shared

// maintenanceModeFromItem 的決策表測試 —— 純函式，不打 DDB。
// 每一列指名期望值；fail-open 的方向是「判不出來一律 false（不封鎖）」。

import (
	"context"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func TestMaintenanceModeFromItem(t *testing.T) {
	s := func(v string) map[string]types.AttributeValue {
		return map[string]types.AttributeValue{
			"info_value": &types.AttributeValueMemberS{Value: v},
		}
	}

	cases := []struct {
		name string
		item map[string]types.AttributeValue
		want bool
	}{
		{name: `"true" → 封鎖`, item: s("true"), want: true},
		{name: `"TRUE"（不分大小寫）→ 封鎖`, item: s("TRUE"), want: true},
		{name: `" true "（trim）→ 封鎖`, item: s(" true "), want: true},
		{name: `"false" → 不封鎖`, item: s("false"), want: false},
		{name: `空字串 → 不封鎖`, item: s(""), want: false},
		{
			name: "缺 info_value → 不封鎖",
			item: map[string]types.AttributeValue{
				"info_key": &types.AttributeValueMemberS{Value: "maintenanceMode"},
			},
			want: false,
		},
		{name: "nil item（旗標從沒設過）→ 不封鎖", item: nil, want: false},
		{
			name: "info_value 型別不是 S → 不封鎖",
			item: map[string]types.AttributeValue{
				"info_value": &types.AttributeValueMemberBOOL{Value: true},
			},
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := maintenanceModeFromItem(tc.item); got != tc.want {
				t.Fatalf("maintenanceModeFromItem() = %v, want %v", got, tc.want)
			}
		})
	}
}

// DDB 讀取失敗 → fail-open（回 false，不封鎖）。
// 不打真 DDB：把共用 client 換成指向 127.0.0.1:1 的假端點（連線必被拒絕、
// 匿名憑證、不重試），GetItem 必然出錯 ⇒ 走到 err != nil 那條 fail-open 分支。
// 沒有這條的話，「fail-open 被誰改成 fail-closed」對整個測試集零徵兆。
func TestIsMaintenanceModeFailOpenOnDDBError(t *testing.T) {
	orig := authDDBClient
	authDDBClient = dynamodb.New(dynamodb.Options{
		Region:       "ap-southeast-1",
		BaseEndpoint: aws.String("http://127.0.0.1:1"),
		Credentials:  aws.AnonymousCredentials{},
		Retryer:      aws.NopRetryer{},
	})
	t.Cleanup(func() { authDDBClient = orig })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if IsMaintenanceMode(ctx) {
		t.Fatal("DDB 讀取失敗時必須 fail-open（回 false），實得 true —— 這會把全站鎖死")
	}
}

func TestAdminConfigsTableName(t *testing.T) {
	// tablePrefix() 預設 MahjongClub_（TABLE_PREFIX 未設時）；
	// 測試環境不設該變數，直接驗預設組合對齊 identities.go 慣例。
	t.Setenv("TABLE_PREFIX", "")
	if got := adminConfigsTable(); got != "MahjongClub_AdminConfigs" {
		t.Fatalf("adminConfigsTable() = %q, want MahjongClub_AdminConfigs", got)
	}
}
