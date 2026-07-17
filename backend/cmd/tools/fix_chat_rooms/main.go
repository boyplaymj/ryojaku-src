package main

import (
	"context"
	"fmt"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Location struct {
	Address   string `dynamodbav:"address"`
	PlaceName string `dynamodbav:"placeName"`
}

type GameInfo struct {
	StartTime string `dynamodbav:"startTime"`
}

type Game struct {
	GameID   string   `dynamodbav:"gameId"`
	Location Location `dynamodbav:"location"`
	GameInfo GameInfo `dynamodbav:"gameInfo"`
}

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
	gamesTable := tablePrefix + "Games"
	roomsTable := tablePrefix + "ChatRooms"

	// 1. Scan Games to get source of truth
	fmt.Println("Scanning Games table...")
	gamesMap := make(map[string]Game)
	paginator := dynamodb.NewScanPaginator(dbClient, &dynamodb.ScanInput{
		TableName: aws.String(gamesTable),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			log.Fatalf("failed to scan games, %v", err)
		}
		var games []Game
		attributevalue.UnmarshalListOfMaps(page.Items, &games)
		for _, g := range games {
			gamesMap[g.GameID] = g
		}
	}

	// 2. Scan ChatRooms and update if needed
	fmt.Println("Scanning ChatRooms table...")
	roomPaginator := dynamodb.NewScanPaginator(dbClient, &dynamodb.ScanInput{
		TableName: aws.String(roomsTable),
	})

	updatedCount := 0
	for roomPaginator.HasMorePages() {
		page, err := roomPaginator.NextPage(ctx)
		if err != nil {
			log.Fatalf("failed to scan rooms, %v", err)
		}

		var rooms []ChatRoomMetadata
		attributevalue.UnmarshalListOfMaps(page.Items, &rooms)

		for _, r := range rooms {
			game, ok := gamesMap[r.RoomID]
			if !ok {
				continue
			}

			needsUpdate := false
			if r.Title == "" || r.Title == "聊天室" || (len(r.Title) > 5 && r.Title[:5] == "GAME_") {
				needsUpdate = true
			}
			if r.StartTime == "" {
				needsUpdate = true
			}
			if r.Address == "" {
				needsUpdate = true
			}

			if needsUpdate {
				fmt.Printf("Updating Room %s: Title=%s, StartTime=%s\n", r.RoomID, game.Location.PlaceName, game.GameInfo.StartTime)

				_, err := dbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
					TableName: aws.String(roomsTable),
					Key: map[string]types.AttributeValue{
						"RoomID": &types.AttributeValueMemberS{Value: r.RoomID},
					},
					UpdateExpression: aws.String("SET Title = :t, StartTime = :s, Address = :a"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":t": &types.AttributeValueMemberS{Value: game.Location.PlaceName},
						":s": &types.AttributeValueMemberS{Value: game.GameInfo.StartTime},
						":a": &types.AttributeValueMemberS{Value: game.Location.Address},
					},
				})
				if err != nil {
					log.Printf("Failed to update room: %v", err)
				} else {
					updatedCount++
				}
			}
		}
	}

	fmt.Printf("Finished! Updated %d chat rooms.\n", updatedCount)
}
