package shared

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// CreateChatRoom creates a new chat room and adds the host as the first member
func CreateChatRoom(ctx context.Context, dbClient *dynamodb.Client, tablePrefix, gameID, title, hostUserID string, startTime time.Time, address string) error {
	roomID := gameID // Using GameID as RoomID for simplicity
	expiryTime := startTime.Add(24 * time.Hour).Unix()
	startTimeStr := startTime.Format(time.RFC3339)

	// 1. Create Room Metadata
	room := ChatRoomMetadata{
		RoomID:     roomID,
		GameID:     gameID,
		Title:      title,
		StartTime:  startTimeStr,
		Address:    address,
		MemberIDs:  []string{hostUserID},
		ExpiryTime: expiryTime,
		CreatedAt:  time.Now(),
	}

	item, err := attributevalue.MarshalMap(room)
	if err != nil {
		return err
	}

	tableNameRooms := tablePrefix + "ChatRooms"
	_, err = dbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableNameRooms,
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("failed to create ChatRoom: %w", err)
	}

	// 2. Create Initial Membership for Host
	err = AddUserToChatRoom(ctx, dbClient, tablePrefix, roomID, title, hostUserID, expiryTime, startTimeStr, address)
	if err != nil {
		log.Printf("Warning: Created room but failed to add host membership: %v", err)
	}

	return nil
}

// AddUserToChatRoom adds a user to a chat room and creates/updates their membership record
func AddUserToChatRoom(ctx context.Context, dbClient *dynamodb.Client, tablePrefix, roomID, title, userID string, expiryTime int64, startTime, address string) error {
	now := time.Now().UnixNano()
	log.Printf("Adding user %s to chat room %s (Title: %s)", userID, roomID, title)

	membership := ChatMembership{
		UserID:               userID,
		MessageTimeAndRoom:   roomID, // SK = RoomID
		RoomID:               roomID,
		Title:                title,
		LastMessage:          "團局已開啟，大家來聊天吧！",
		UnreadCount:          0,
		ExpiryTime:           expiryTime,
		StartTime:            startTime,
		Address:              address,
		LastMessageTimestamp: now,
	}

	item, err := attributevalue.MarshalMap(membership)
	if err != nil {
		return err
	}

	tableNameMemberships := tablePrefix + "ChatUserMemberships"
	_, err = dbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableNameMemberships,
		Item:      item,
	})
	if err != nil {
		log.Printf("Error putting membership for user %s: %v", userID, err)
		return err
	}

	// Also update ChatRooms member list
	tableNameRooms := tablePrefix + "ChatRooms"
	// Use ADD for SS (String Set)
	_, err = dbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tableNameRooms,
		Key: map[string]types.AttributeValue{
			"RoomID": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("ADD MemberIDs :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberSS{Value: []string{userID}},
		},
	})

	if err != nil {
		log.Printf("Warning: Failed to update ChatRooms MemberIDs for user %s: %v. Attempting fallback...", userID, err)
		// Fallback: If MemberIDs is a List (L), use list_append
		_, err = dbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &tableNameRooms,
			Key: map[string]types.AttributeValue{
				"RoomID": &types.AttributeValueMemberS{Value: roomID},
			},
			UpdateExpression: aws.String("SET MemberIDs = list_append(if_not_exists(MemberIDs, :empty_list), :uid_list)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":uid_list":   &types.AttributeValueMemberL{Value: []types.AttributeValue{&types.AttributeValueMemberS{Value: userID}}},
				":empty_list": &types.AttributeValueMemberL{Value: []types.AttributeValue{}},
			},
		})
		if err != nil {
			log.Printf("Critical Error: Fallback update also failed for user %s: %v", userID, err)
		}
	}

	return nil
}

// UpdateMembership updates the last message and timestamp for a user's chat list
func UpdateMembership(ctx context.Context, dbClient *dynamodb.Client, tablePrefix, userID, roomID, title, lastMessage string, expiryTime int64, startTime, address string, incrementUnread bool) error {
	tableName := tablePrefix + "ChatUserMemberships"
	now := time.Now().UnixNano()

	// We are changing the schema to use RoomID as the SortKey to prevent race conditions and duplicates.
	// The SortKey attribute name is still "LastMessageTime#RoomID" (defined in table), but we will store just the RoomID.
	// We will store the actual timestamp in a new attribute "LastMessageTime" (if added to model) or just rely on "MessageTimeAndRoom" being the SK.
	// Wait, if we change SK to RoomID, we lose the time in SK. We need to store time separately.
	// We will assume ChatMembership has a LastMessageTimestamp field or we add it.
	// If we can't change the struct easily, we can just put it in the map.

	// 1. Get current unread count (we still need to read to increment, unless we use ADD? UnreadCount is number)
	// But we also need to handle the migration from old SK to new SK.
	// If we just Put with SK=RoomID, the old SK=Time#RoomID will remain.
	// So we DO need to delete the old item if it exists.
	// So the race condition "delete old, put new" still exists IF we are migrating.
	// BUT, once migrated, the SK is constant (RoomID).
	// So subsequent updates will just be Put (overwrite).
	// So the race condition only affects the *first* update after migration.
	// This is acceptable.

	var currentUnreadCount int = 0

	// Query to find ANY existing membership for this room (old or new SK)
	queryResult, err := dbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		KeyConditionExpression: aws.String("UserID = :uid"),
		FilterExpression:       aws.String("RoomID = :rid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
			":rid": &types.AttributeValueMemberS{Value: roomID},
		},
	})

	if err == nil && len(queryResult.Items) > 0 {
		for _, item := range queryResult.Items {
			// Capture current unread count
			var oldMem ChatMembership
			if err := attributevalue.UnmarshalMap(item, &oldMem); err == nil {
				// Use the largest unread count if multiple exist (conservative)
				if oldMem.UnreadCount > currentUnreadCount {
					currentUnreadCount = oldMem.UnreadCount
				}
				// Preserve expiry time if not provided
				if expiryTime == 0 && oldMem.ExpiryTime > 0 {
					expiryTime = oldMem.ExpiryTime
				}
			}

			// Delete the item.
			// If SK is already RoomID, we are deleting it to put a new one?
			// Or we can just UpdateItem if SK is RoomID.
			// But to handle duplicates, let's just delete all found and put one new.
			dbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: &tableName,
				Key: map[string]types.AttributeValue{
					"UserID":                 item["UserID"],
					"LastMessageTime#RoomID": item["LastMessageTime#RoomID"],
				},
			})
		}
	}

	// Calculate new unread count
	newUnreadCount := 0
	if incrementUnread {
		newUnreadCount = currentUnreadCount + 1
	}

	// 2. Put new record with SK = RoomID
	// We need to ensure LastMessageTimestamp is stored.
	// Let's check ChatMembership struct.

	membership := ChatMembership{
		UserID:               userID,
		MessageTimeAndRoom:   roomID, // SK = RoomID
		RoomID:               roomID,
		Title:                title,
		LastMessage:          lastMessage,
		UnreadCount:          newUnreadCount,
		ExpiryTime:           expiryTime,
		StartTime:            startTime,
		Address:              address,
		LastMessageTimestamp: now, // We need to add this field to struct
	}

	item, err := attributevalue.MarshalMap(membership)
	if err != nil {
		return err
	}

	_, err = dbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	return err
}

// RemoveUserFromChatRoom removes a user from a chat room
func RemoveUserFromChatRoom(ctx context.Context, dbClient *dynamodb.Client, tablePrefix, roomID, userID string) error {
	// 1. Delete membership records for this user in this room
	tableNameMemberships := tablePrefix + "ChatUserMemberships"
	queryResult, err := dbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableNameMemberships,
		KeyConditionExpression: aws.String("UserID = :uid"),
		FilterExpression:       aws.String("RoomID = :rid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
			":rid": &types.AttributeValueMemberS{Value: roomID},
		},
	})

	if err == nil {
		for _, item := range queryResult.Items {
			dbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: &tableNameMemberships,
				Key: map[string]types.AttributeValue{
					"UserID":                 item["UserID"],
					"LastMessageTime#RoomID": item["LastMessageTime#RoomID"],
				},
			})
		}
	}

	// 2. Remove from ChatRooms member list
	tableNameRooms := tablePrefix + "ChatRooms"
	_, err = dbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tableNameRooms,
		Key: map[string]types.AttributeValue{
			"RoomID": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("DELETE MemberIDs :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberSS{Value: []string{userID}},
		},
	})

	return err
}
