package main

// 帳號刪除 — 到期清除的排程工作（判定與清除範圍見 shared/account_purge.go）。
// 不掛任何 API 路由；預期由排程一天叫一次。
//
// 兩個保險都預設在「不動資料」那一邊：
//   PURGE_DRY_RUN    只有明確設成 "false" 才會真的刪；沒設、設錯、設成別的值一律只列清單。
//   PURGE_MAX_USERS  一次最多處理幾個人（預設 20）。判準寫壞時，這是一次最多會錯殺的人數。
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

type Summary struct {
	DryRun  bool                        `json:"dryRun"`
	Due     int                         `json:"due"`
	Purged  int                         `json:"purged"`
	Skipped int                         `json:"skipped"`
	Failed  int                         `json:"failed"`
	Reports []shared.AccountPurgeReport `json:"reports"`
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func Handler(ctx context.Context) (Summary, error) {
	dryRun := os.Getenv("PURGE_DRY_RUN") != "false"
	maxUsers, err := strconv.Atoi(getEnv("PURGE_MAX_USERS", "20"))
	if err != nil || maxUsers <= 0 {
		return Summary{DryRun: dryRun}, fmt.Errorf("PURGE_MAX_USERS 不是正整數：%q", os.Getenv("PURGE_MAX_USERS"))
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
	log.Printf("[account-purge] dryRun=%v due=%d purged=%d skipped=%d failed=%d", dryRun, sum.Due, sum.Purged, sum.Skipped, sum.Failed)
	// 有人失敗就讓這次執行算失敗：沒清完的人下次還會被找到，但不可以安靜地過去。
	if sum.Failed > 0 {
		return sum, fmt.Errorf("%d 個帳號清除失敗", sum.Failed)
	}
	return sum, nil
}

func main() {
	lambda.Start(Handler)
}
