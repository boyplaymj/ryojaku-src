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
	StartTime string `dynamodbav:"startTime"` // Simplified for script
}

type Game struct {
	GameID   string   `dynamodbav:"gameId"`
	Location Location `dynamodbav:"location"`
	GameInfo GameInfo `dynamodbav:"gameInfo"`
}

type ChatMembership struct {
	UserID             string `dynamodbav:"UserID"`
	MessageTimeAndRoom string `dynamodbav:"LastMessageTime#RoomID"`
	RoomID             string `dynamodbav:"RoomID"`
	Title              string `dynamodbav:"Title"`
	StartTime          string `dynamodbav:"StartTime"`
	Address            string `dynamodbav:"Address"`
}

func main() {
	ctx := context.TODO()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}

	dbClient := dynamodb.NewFromConfig(cfg)
	tablePrefix := "MahjongClub_"
	membershipsTable := tablePrefix + "ChatUserMemberships"
	gamesTable := tablePrefix + "Games"

	// 1. Scan all games to create a lookup map
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
	fmt.Printf("Found %d games\n", len(gamesMap))

	// 2. Scan all memberships and update them
	fmt.Println("Scanning ChatUserMemberships table...")
	memPaginator := dynamodb.NewScanPaginator(dbClient, &dynamodb.ScanInput{
		TableName: aws.String(membershipsTable),
	})

	updateCount := 0
	for memPaginator.HasMorePages() {
		page, err := memPaginator.NextPage(ctx)
		if err != nil {
			log.Fatalf("failed to scan memberships, %v", err)
		}

		for _, item := range page.Items {
			var m ChatMembership
			attributevalue.UnmarshalMap(item, &m)

			game, ok := gamesMap[m.RoomID]
			if !ok {
				continue
			}

			newTitle := game.Location.PlaceName
			newStartTime := game.GameInfo.StartTime
			newAddress := game.Location.Address

			// Only update if data is different
			if m.Title != newTitle || m.StartTime != newStartTime || m.Address != newAddress {
				fmt.Printf("Updating Room %s for User %s: Title=%s\n", m.RoomID, m.UserID, newTitle)

				_, err := dbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
					TableName: aws.String(membershipsTable),
					Key: map[string]types.AttributeValue{
						"UserID":                 &types.AttributeValueMemberS{Value: m.UserID},
						"LastMessageTime#RoomID": &types.AttributeValueMemberS{Value: m.MessageTimeAndRoom},
					},
					UpdateExpression: aws.String("SET Title = :t, StartTime = :s, Address = :a"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":t": &types.AttributeValueMemberS{Value: newTitle},
						":s": &types.AttributeValueMemberS{Value: newStartTime},
						":a": &types.AttributeValueMemberS{Value: newAddress},
					},
				})
				if err != nil {
					log.Printf("Failed to update membership: %v", err)
				} else {
					updateCount++
				}
			}
		}
	}

	fmt.Printf("Finished! Updated %d membership records.\n", updateCount)
}
