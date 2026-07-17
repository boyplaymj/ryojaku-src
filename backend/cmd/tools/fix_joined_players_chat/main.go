package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Player struct {
	UserID      string `dynamodbav:"userId"`
	DisplayName string `dynamodbav:"displayName"`
}

type Location struct {
	Address   string `dynamodbav:"address"`
	PlaceName string `dynamodbav:"placeName"`
}

type GameInfo struct {
	StartTime string `dynamodbav:"startTime"`
}

type Game struct {
	GameID        string   `dynamodbav:"gameId"`
	HostUserID    string   `dynamodbav:"hostUserId"`
	JoinedPlayers []Player `dynamodbav:"joinedPlayers"`
	Location      Location `dynamodbav:"location"`
	GameInfo      GameInfo `dynamodbav:"gameInfo"`
	Status        string   `dynamodbav:"status"`
}

type ChatMembership struct {
	UserID             string `dynamodbav:"UserID"`
	MessageTimeAndRoom string `dynamodbav:"LastMessageTime#RoomID"`
	RoomID             string `dynamodbav:"RoomID"`
	Title              string `dynamodbav:"Title"`
	LastMessage        string `dynamodbav:"LastMessage"`
	UnreadCount        int    `dynamodbav:"UnreadCount"`
	ExpiryTime         int64  `dynamodbav:"ExpiryTime"`
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
	gamesTable := tablePrefix + "Games"
	membershipsTable := tablePrefix + "ChatUserMemberships"
	roomsTable := tablePrefix + "ChatRooms"

	fmt.Println("Scanning Games table...")
	paginator := dynamodb.NewScanPaginator(dbClient, &dynamodb.ScanInput{
		TableName: aws.String(gamesTable),
	})

	totalFixed := 0
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			log.Fatalf("failed to scan games, %v", err)
		}

		var games []Game
		attributevalue.UnmarshalListOfMaps(page.Items, &games)

		for _, g := range games {
			if g.Status == "cancelled" || g.Status == "closed" {
				continue
			}

			fmt.Printf("Processing Game: %s (%s) - Status: %s\n", g.GameID, g.Location.PlaceName, g.Status)

			// All players including host
			allUserIDs := []string{g.HostUserID}
			for _, p := range g.JoinedPlayers {
				allUserIDs = append(allUserIDs, p.UserID)
			}

			for _, userID := range allUserIDs {
				// Check if membership exists
				queryResult, err := dbClient.Query(ctx, &dynamodb.QueryInput{
					TableName:              aws.String(membershipsTable),
					KeyConditionExpression: aws.String("UserID = :uid"),
					FilterExpression:       aws.String("RoomID = :rid"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":uid": &types.AttributeValueMemberS{Value: userID},
						":rid": &types.AttributeValueMemberS{Value: g.GameID},
					},
				})

				if err == nil && len(queryResult.Items) == 0 {
					fmt.Printf("  -> Adding missing membership for User: %s\n", userID)

					now := time.Now().UnixNano()
					expiryTime := time.Now().Add(48 * time.Hour).Unix() // Default expiry

					membership := ChatMembership{
						UserID:             userID,
						MessageTimeAndRoom: fmt.Sprintf("%d#%s", now, g.GameID),
						RoomID:             g.GameID,
						Title:              g.Location.PlaceName,
						LastMessage:        "團局已開啟，大家來聊天吧！",
						UnreadCount:        0,
						ExpiryTime:         expiryTime,
						StartTime:          g.GameInfo.StartTime,
						Address:            g.Location.Address,
					}

					item, _ := attributevalue.MarshalMap(membership)
					dbClient.PutItem(ctx, &dynamodb.PutItemInput{
						TableName: aws.String(membershipsTable),
						Item:      item,
					})

					// Also ensure in ChatRooms
					dbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
						TableName: aws.String(roomsTable),
						Key: map[string]types.AttributeValue{
							"RoomID": &types.AttributeValueMemberS{Value: g.GameID},
						},
						UpdateExpression: aws.String("ADD MemberIDs :uid"),
						ExpressionAttributeValues: map[string]types.AttributeValue{
							":uid": &types.AttributeValueMemberSS{Value: []string{userID}},
						},
					})
					totalFixed++
				}
			}
		}
	}

	fmt.Printf("Finished! Fixed %d missing memberships.\n", totalFixed)
}
