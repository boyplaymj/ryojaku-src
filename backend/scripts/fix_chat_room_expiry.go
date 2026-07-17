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
