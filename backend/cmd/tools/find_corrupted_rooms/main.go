package main

import (
	"context"
	"fmt"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type ChatRoomMetadata struct {
	RoomID    string `dynamodbav:"RoomID"`
	Title     string `dynamodbav:"Title"`
	StartTime string `dynamodbav:"StartTime"`
	Address   string `dynamodbav:"Address"`
}

func main() {
	ctx := context.TODO()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}

	dbClient := dynamodb.NewFromConfig(cfg)
	tablePrefix := "MahjongClub_"
	roomsTable := tablePrefix + "ChatRooms"

	fmt.Println("Scanning ChatRooms table for corrupted data...")
	paginator := dynamodb.NewScanPaginator(dbClient, &dynamodb.ScanInput{
		TableName: aws.String(roomsTable),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			log.Fatalf("failed to scan rooms, %v", err)
		}

		var rooms []ChatRoomMetadata
		attributevalue.UnmarshalListOfMaps(page.Items, &rooms)

		for _, r := range rooms {
			if r.Title == "聊天室" || r.StartTime == "" || r.Address == "" {
				fmt.Printf("Found corrupted room: %+v\n", r)
			}
		}
	}
}
