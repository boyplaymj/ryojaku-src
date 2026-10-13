package main

// 帳號刪除 — 到期清除的排程工作（判定與清除範圍見 shared/account_purge.go）。
// 不掛任何 API 路由；預期由排程一天叫一次。
//
// 兩個保險都預設在「不動資料」那一邊：
//   PURGE_DRY_RUN    只有明確設成 "false" 才會真的刪；沒設、設錯、設成別的值一律只列清單。
//   PURGE_MAX_USERS  一次最多處理幾個人（預設 20，**不可超過 hardMaxUsers**，超過直接拒絕執行）。
//                    判準寫壞時，這是一次最多會錯殺的人數 —— 所以上限寫死在程式裡，不讓設定檔抬高。
//
// 🔴 這支還沒登記進 infra/functions.manifest.json，也還沒有排程 —— 現在沒有任何東西會叫它。

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// hardMaxUsers：PURGE_MAX_USERS 的上限。要抬高得改程式、過覆驗，不是改一個環境變數。
const hardMaxUsers = 50

type Summary struct {
	DryRun  bool                        `json:"dryRun"`
	Due     int                         `json:"due"`
	Purged  int                         `json:"purged"`
	Skipped int                         `json:"skipped"`
	Failed  int                         `json:"failed"`
	Reswept int                         `json:"reswept"` // 已是墓碑、這次回頭又清到東西的人數
	Reports []shared.AccountPurgeReport `json:"reports"`
}

// parseMaxUsers：沒設用 20；不是正整數或超過 hardMaxUsers 都回錯誤（不悄悄夾成合法值）。
func parseMaxUsers(raw string) (int, error) {
	if raw == "" {
		return 20, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("PURGE_MAX_USERS 不是正整數：%q", raw)
	}
	if n > hardMaxUsers {
		return 0, fmt.Errorf("PURGE_MAX_USERS=%d 超過寫死的上限 %d", n, hardMaxUsers)
	}
	return n, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func Handler(ctx context.Context) (Summary, error) {
	dryRun := os.Getenv("PURGE_DRY_RUN") != "false"
	maxUsers, err := parseMaxUsers(os.Getenv("PURGE_MAX_USERS"))
	if err != nil {
		return Summary{DryRun: dryRun}, err
	}
	prefix := getEnv("TABLE_PREFIX", "MahjongClub_")

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(getEnv("AWS_REGION", "ap-southeast-1")))
	if err != nil {
		return Summary{DryRun: dryRun}, err
	}
	db := dynamodb.NewFromConfig(cfg)
	now := time.Now()

	sum := Summary{DryRun: dryRun}
	due, err := shared.FindAccountsDueForPurge(ctx, db, prefix, now, maxUsers)
	if err != nil {
		return sum, err
	}
	sum.Due = len(due)
	for _, userID := range due {
		rep, perr := shared.PurgeAccount(ctx, db, prefix, userID, now, dryRun)
		sum.Reports = append(sum.Reports, rep)
		switch {
		case perr != nil:
			sum.Failed++
			log.Printf("[account-purge] 失敗 user=%s rows=%v: %v", userID, rep.Rows, perr)
		case rep.Skipped != "":
			sum.Skipped++
			log.Printf("[account-purge] 跳過 user=%s：%s", userID, rep.Skipped)
		default:
			sum.Purged++
			log.Printf("[account-purge] dryRun=%v user=%s rows=%v", dryRun, userID, rep.Rows)
		}
	}
	// 回頭再掃最近寫上墓碑的人：GSI 當時還沒同步的列、墓碑之後才被別人寫進來的通知。
	recent, err := shared.FindAccountsForResweep(ctx, db, prefix, now, hardMaxUsers)
	if err != nil {
		return sum, err
	}
	for _, userID := range recent {
		rep, rerr := shared.ResweepAccount(ctx, db, prefix, userID, dryRun)
		switch {
		case rerr != nil:
			sum.Failed++
			log.Printf("[account-purge] 回掃失敗 user=%s rows=%v: %v", userID, rep.Rows, rerr)
		case len(rep.Rows) > 0:
			sum.Reswept++
			sum.Reports = append(sum.Reports, rep)
			log.Printf("[account-purge] 回掃 dryRun=%v user=%s rows=%v", dryRun, userID, rep.Rows)
		}
	}
	log.Printf("[account-purge] dryRun=%v due=%d purged=%d skipped=%d reswept=%d failed=%d", dryRun, sum.Due, sum.Purged, sum.Skipped, sum.Reswept, sum.Failed)
	// 有人失敗就讓這次執行算失敗：沒清完的人下次還會被找到，但不可以安靜地過去。
	if sum.Failed > 0 {
		return sum, fmt.Errorf("%d 個帳號清除失敗", sum.Failed)
	}
	return sum, nil
}

func main() {
	lambda.Start(Handler)
}
