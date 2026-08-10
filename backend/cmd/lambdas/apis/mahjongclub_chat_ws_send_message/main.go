package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type MessagePayload struct {
	Action  string `json:"action"` // Should be "sendMessage"
	RoomID  string `json:"roomId"`
	Content string `json:"content"`
	Type    string `json:"type"` // text, game_link
}

type ChatMessage = shared.ChatMessageRecord
type ChatRoom = shared.ChatRoomMetadata

var dbClient *dynamodb.Client
var awsCfg aws.Config
var tablePrefix string
var pushService *shared.PushNotificationService

func init() {
	awsRegion := os.Getenv("AWS_REGION")
	if awsRegion == "" {
		awsRegion = "ap-southeast-1"
	}
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

	var err error
	awsCfg, err = config.LoadDefaultConfig(context.TODO(), config.WithRegion(awsRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	dbClient = dynamodb.NewFromConfig(awsCfg)
	pushService, _ = shared.NewPushNotificationService()
}

func Handler(ctx context.Context, request events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("SendMessage: ConnectionID=%s, Body=%s", request.RequestContext.ConnectionID, request.Body)

	// 記錄流量統計
	shared.RecordTraffic(ctx, dbClient, tablePrefix, "chat", "send_message")

	var payload MessagePayload
	err := json.Unmarshal([]byte(request.Body), &payload)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 400}, nil
	}

	// 1. Get current user from connection
	userID, err := getUserIDByConnection(ctx, request.RequestContext.ConnectionID)
	if err != nil || userID == "" {
		log.Printf("Failed to identify user for connection %s: %v", request.RequestContext.ConnectionID, err)
		return events.APIGatewayProxyResponse{StatusCode: 403}, nil
	}

	// 2. 房間層授權（水平越權修補）。
	//
	// $connect 的 authorizer 只做**身分驗證** —— 它保證 userID 是真的，不保證這個人
	// 有權對 payload.RoomID 發言。在此之前，任何已登入者只要列舉／猜到 roomId，就能
	// 把訊息寫進他不屬於的聊天室，並連帶觸發該房間的廣播、成員未讀數更新與推播通知。
	// 2026-08-10 以 infra/ws_room_authz_probe.sh 對 staging 實證成立（非成員寫入 1 筆，
	// 同一輪的成員正控也 1 筆，證明不是鏈路壞掉造成的假象）。
	//
	// 與 chat-get-upload-url（6f9d73b）同一個模式，不需要重新設計連線身分模型。
	//
	// 🔴 這道檢查必須擺在 PutItem **之前**：原本的流程是先把訊息寫進 ChatMessages，
	//    之後才 getRoom(payload.RoomID)，而且 room 為 nil 時只是跳過廣播 ——
	//    所以連「房間根本不存在」的 roomId 都寫得進去。擋在寫入後面等於沒擋。
	isMember, memErr := shared.IsRoomMember(ctx, dbClient, tablePrefix, userID, payload.RoomID)
	if memErr != nil {
		// fail-closed：查不出來就不放行。不可因為 DB 出錯而退化成人人可寫 ——
		// 那正是「最有利攻擊者」的那一側。
		log.Printf("[chat-ws-send-message] 成員資格查驗失敗 user=%s room=%s: %v", userID, payload.RoomID, memErr)
		return events.APIGatewayProxyResponse{StatusCode: 500}, nil
	}
	if !isMember {
		log.Printf("[chat-ws-send-message] 非成員遭拒 user=%s room=%s", userID, payload.RoomID)
		return events.APIGatewayProxyResponse{StatusCode: 403}, nil
	}

	// 3. Get User Name (Could be optimized by caching or session)
	userName := "User"
	user, _ := getUser(ctx, userID)
	if user != nil {
		if dn, ok := user["displayName"].(string); ok {
			userName = dn
		}
	}

	now := time.Now()
	msg := ChatMessage{
		RoomID:      payload.RoomID,
		TimestampID: fmt.Sprintf("%d#%s", now.UnixNano(), uuid.New().String()[:8]),
		SenderID:    userID,
		SenderName:  userName,
		Content:     payload.Content,
		Type:        payload.Type,
		TTL:         now.Add(7 * 24 * time.Hour).Unix(),
	}

	// 4. Save Message to DB
	item, _ := attributevalue.MarshalMap(msg)
	tableNameMsg := tablePrefix + "ChatMessages"
	_, err = dbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableNameMsg,
		Item:      item,
	})
	if err != nil {
		log.Printf("Failed to save message: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: 500}, nil
	}

	// 5. Update all members' Membership list (LastMessage & Time)
	room, _ := getRoom(ctx, payload.RoomID)
	if room != nil {
		// If room title is missing, default "聊天室", or looks like a GameID, or missing metadata
		if room.Title == "" || room.Title == "聊天室" || (len(room.Title) > 5 && room.Title[:5] == "GAME_") || room.StartTime == "" || room.Address == "" {
			gamesTableName := tablePrefix + "Games"
			gameResult, err := dbClient.GetItem(ctx, &dynamodb.GetItemInput{
				TableName: &gamesTableName,
				Key: map[string]types.AttributeValue{
					"gameId": &types.AttributeValueMemberS{Value: room.GameID},
				},
			})
			if err == nil && gameResult.Item != nil {
				var game shared.Game
				attributevalue.UnmarshalMap(gameResult.Item, &game)
				room.Title = game.Location.PlaceName
				room.StartTime = game.GameInfo.StartTime.Format(time.RFC3339)
				room.Address = game.Location.Address

				// Optional: Update ChatRooms table with enriched data
				roomItem, _ := attributevalue.MarshalMap(room)
				roomsTableName := tablePrefix + "ChatRooms"
				dbClient.PutItem(ctx, &dynamodb.PutItemInput{
					TableName: &roomsTableName,
					Item:      roomItem,
				})
			}
		}

		displayContent := payload.Content
		if payload.Type == "image" {
			displayContent = "[圖片]"
		}

		for _, memberID := range room.MemberIDs {
			shared.UpdateMembership(ctx, dbClient, tablePrefix, memberID, payload.RoomID, room.Title, userName+": "+displayContent, room.ExpiryTime, room.StartTime, room.Address, true)
		}
	}

	// 6. Broadcast to connected members & Push to offline members
	if room != nil {
		callbackAPI := os.Getenv("WS_API_ENDPOINT")
		log.Printf("Broadcasting to %d members in room %s using endpoint %s", len(room.MemberIDs), payload.RoomID, callbackAPI)

		apigwClient := apigatewaymanagementapi.NewFromConfig(awsCfg, func(o *apigatewaymanagementapi.Options) {
			if callbackAPI != "" {
				o.BaseEndpoint = aws.String(callbackAPI)
			}
		})

		displayContent := payload.Content
		if payload.Type == "image" {
			displayContent = "[圖片]"
		}

		for _, memberID := range room.MemberIDs {
			// 1. Send via WebSocket if online (sync all devices of the user)
			conns, err := getUserConnections(ctx, memberID)
			if err == nil && len(conns) > 0 {
				log.Printf("Member %s is online with %d connections, sending WS", memberID, len(conns))
				msgJSON, _ := json.Marshal(msg)
				for _, connID := range conns {
					_, err := apigwClient.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
						ConnectionId: aws.String(connID),
						Data:         msgJSON,
					})
					if err != nil {
						log.Printf("Failed to post to connection %s for user %s: %v", connID, memberID, err)
					}
				}
			}

			// 2. Always send Push Notification to others (except sender)
			if memberID != userID && pushService != nil {
				log.Printf("Sending push notification to member %s", memberID)

				notificationTitle := room.Title
				if notificationTitle == "" {
					notificationTitle = "新訊息"
				}

				pushService.SendPushNotificationToUser(ctx, memberID, notificationTitle, userName+": "+displayContent, map[string]interface{}{
					"type":   "chat",
					"roomId": payload.RoomID,
					"url":    "/#/chat/" + payload.RoomID,
				})
			}
		}
	} else {
		log.Printf("Room %s not found, skipping broadcast", payload.RoomID)
	}

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

func getUserIDByConnection(ctx context.Context, connID string) (string, error) {
	tableName := tablePrefix + "ChatConnections"
	result, err := dbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"ConnectionID": &types.AttributeValueMemberS{Value: connID},
		},
	})
	if err != nil || result.Item == nil {
		return "", err
	}
	var conn shared.ChatConnectionRecord
	attributevalue.UnmarshalMap(result.Item, &conn)
	return conn.UserID, nil
}

func getUserConnections(ctx context.Context, userID string) ([]string, error) {
	tableName := tablePrefix + "ChatConnections"
	result, err := dbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		IndexName:              aws.String("UserID-index"),
		KeyConditionExpression: aws.String("UserID = :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	var connIDs []string
	for _, item := range result.Items {
		var conn shared.ChatConnectionRecord
		attributevalue.UnmarshalMap(item, &conn)
		connIDs = append(connIDs, conn.ConnectionID)
	}
	return connIDs, nil
}

func getRoom(ctx context.Context, roomID string) (*ChatRoom, error) {
	tableName := tablePrefix + "ChatRooms"
	result, err := dbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"RoomID": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	if err != nil || result.Item == nil {
		return nil, err
	}
	var room ChatRoom
	attributevalue.UnmarshalMap(result.Item, &room)
	return &room, nil
}

func getUser(ctx context.Context, userID string) (map[string]interface{}, error) {
	tableName := tablePrefix + "Users"
	result, err := dbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	var user map[string]interface{}
	attributevalue.UnmarshalMap(result.Item, &user)
	return user, nil
}

func main() {
	lambda.Start(Handler)
}
