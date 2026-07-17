package shared

import (
	"context"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/google/uuid"
)

// CreateNotificationParams holds the parameters for creating a notification
type CreateNotificationParams struct {
	UserID       string
	Type         string
	Title        string
	Message      string
	GameID       string
	GameName     string
	FromUserID   string
	FromUserName string
	URL          string
}

// CreateNotification creates a web notification and sends a push notification
func CreateNotification(ctx context.Context, apiDB *dynamodb.Client, tablePrefix string, p CreateNotificationParams) error {
	now := time.Now()
	expiresAt := now.AddDate(0, 0, 30) // Default 30 days

	notification := map[string]interface{}{
		"notificationId": uuid.New().String(),
		"userId":         p.UserID,
		"type":           p.Type,
		"title":          p.Title,
		"message":        p.Message,
		"isRead":         false,
		"createdAt":      now.Unix(),
		"expiresAt":      expiresAt.Unix(),
	}

	if p.GameID != "" {
		notification["gameId"] = p.GameID
	}
	if p.GameName != "" {
		notification["gameName"] = p.GameName
	}
	if p.FromUserID != "" {
		notification["fromUserId"] = p.FromUserID
	}
	if p.FromUserName != "" {
		notification["fromUserName"] = p.FromUserName
	}

	item, err := attributevalue.MarshalMap(notification)
	if err != nil {
		log.Printf("Failed to marshal notification: %v", err)
		return err
	}

	tableName := tablePrefix + "Notifications"
	_, err = apiDB.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	if err != nil {
		log.Printf("Failed to save notification: %v", err)
		return err
	}

	// 2. Send push notification asynchronously
	go func() {
		pushService, err := NewPushNotificationService()
		if err != nil {
			log.Printf("Failed to init push service: %v", err)
			return
		}

		data := map[string]interface{}{
			"type": p.Type,
		}
		if p.URL != "" {
			data["url"] = p.URL
		} else {
			data["url"] = "/notifications"
		}

		if p.GameID != "" {
			data["gameId"] = p.GameID
		}
		if p.FromUserID != "" {
			data["fromUserId"] = p.FromUserID
			data["fromUserName"] = p.FromUserName
		}

		pushService.SendPushNotificationToUser(
			context.Background(),
			p.UserID,
			p.Title,
			p.Message,
			data,
		)
	}()

	return nil
}
