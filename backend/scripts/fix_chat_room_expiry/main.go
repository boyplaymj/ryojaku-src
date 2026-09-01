// 一次性修補腳本（2026-07-17 工程師交付時帶入，之後無人動過）：
// 掃 ExpiryTime 缺漏或為 0 的列，補成 StartTime + 24 小時。
// 姊妹檔 scripts/fix_chat_expiry 是同一套邏輯套在 ChatUserMemberships 上；
// 兩者只差 key 欄位（此處 RoomID）與進度列印間隔，邏輯逐行相同。
//
// 🔴 2026-09-01 實查：它寫死的表 MahjongClub_ChatRooms 在本帳號
// （380931373365）ap-southeast-1 **不存在**（ResourceNotFoundException rc=254；
// 正控 MahjongClubStg_ChatRooms 回 ACTIVE rc=0）。無前綴表名是
// MahjongClub_ / MahjongClubStg_ 前綴制度**之前**的產物 ⇒ 現在跑第一步就會死。
// 保留是因為它記錄了「ExpiryTime = StartTime + 24h」這條業務規則，不是因為它還能跑。
// ⚠️ 界線：帳號隨執行者憑證走，只查過本帳號本區域。
//
// ⚠️ 2026-09-01 從 scripts/fix_chat_room_expiry.go 搬進本子目錄。原本兩支腳本同在
// scripts/ 下、各自宣告 func main() ⇒ 同一個 package ⇒ go build ./... 恆 rc=1
// （main redeclared）。單檔 go run 不受影響，所以這個狀態一直沒人發現，
// 而它正是後端接不上 CI 的原因。呼叫方式隨之改變：
//   舊：go run scripts/fix_chat_room_expiry.go
//   新：go run ./scripts/fix_chat_room_expiry
//
// ⚠️ 它沒有 dry-run、沒有確認步驟，直接 Scan 全表並逐列 UpdateItem。要復用先加 dry-run。
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func main() {
	ctx := context.TODO()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}

	svc := dynamodb.NewFromConfig(cfg)
	tableName := "MahjongClub_ChatRooms"

	// 1. Scan for items with ExpiryTime = 0 or missing ExpiryTime
	input := &dynamodb.ScanInput{
		TableName:        aws.String(tableName),
		FilterExpression: aws.String("attribute_not_exists(ExpiryTime) OR ExpiryTime = :zero"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":zero": &types.AttributeValueMemberN{Value: "0"},
		},
	}

	paginator := dynamodb.NewScanPaginator(svc, input)
	count := 0
	updatedCount := 0

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			log.Fatalf("failed to get page, %v", err)
		}

		for _, item := range page.Items {
			count++
			roomID := item["RoomID"].(*types.AttributeValueMemberS).Value
			startTimeStr := ""
			if val, ok := item["StartTime"]; ok {
				startTimeStr = val.(*types.AttributeValueMemberS).Value
			}

			if startTimeStr == "" {
				fmt.Printf("Skipping RoomID: %s (No StartTime)\n", roomID)
				continue
			}

			// Parse StartTime (ISO8601)
			startTime, err := time.Parse(time.RFC3339, startTimeStr)
			if err != nil {
				// Try another format just in case
				startTime, err = time.Parse("2006-01-02T15:04:05", startTimeStr)
				if err != nil {
					fmt.Printf("Error parsing StartTime %s for RoomID: %s: %v\n", startTimeStr, roomID, err)
					continue
				}
			}

			// Core logic: ExpiryTime = StartTime + 24 hours
			expiryTime := startTime.Add(24 * time.Hour).Unix()

			// Update the item
			_, err = svc.UpdateItem(ctx, &dynamodb.UpdateItemInput{
				TableName: aws.String(tableName),
				Key: map[string]types.AttributeValue{
					"RoomID": &types.AttributeValueMemberS{Value: roomID},
				},
				UpdateExpression: aws.String("SET ExpiryTime = :val"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":val": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", expiryTime)},
				},
			})

			if err != nil {
				fmt.Printf("Failed to update RoomID: %s: %v\n", roomID, err)
			} else {
				updatedCount++
				if updatedCount%50 == 0 {
					fmt.Printf("Updated %d items so far...\n", updatedCount)
				}
			}
		}
	}

	fmt.Printf("\nFinished! Total scanned: %d, Total updated: %d\n", count, updatedCount)
}
