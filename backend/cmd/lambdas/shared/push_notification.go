package shared

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// PushSubscriptionRecord represents a push subscription in DynamoDB
type PushSubscriptionRecord struct {
	UserID    string                 `dynamodbav:"userId"`
	DeviceID  string                 `dynamodbav:"deviceId"`
	Endpoint  string                 `dynamodbav:"endpoint"`
	Keys      map[string]interface{} `dynamodbav:"keys"`
	IsActive  bool                   `dynamodbav:"isActive"`
	CreatedAt int64                  `dynamodbav:"createdAt"`
	UpdatedAt int64                  `dynamodbav:"updatedAt"`
	ExpiresAt int64                  `dynamodbav:"expiresAt"`
}

// PushNotificationService handles multi-device push notifications
type PushNotificationService struct {
	dynamoClient    *dynamodb.Client
	tablePrefix     string
	vapidPublicKey  string
	vapidPrivateKey string
	vapidSubscriber string
}

// NewPushNotificationService creates a new push notification service
func NewPushNotificationService() (*PushNotificationService, error) {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, err
	}

	tablePrefix := os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

	return &PushNotificationService{
		dynamoClient:    dynamodb.NewFromConfig(cfg),
		tablePrefix:     tablePrefix,
		vapidPublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
		vapidPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
		vapidSubscriber: getVapidSubscriber(),
	}, nil
}

// SendPushNotificationToUser sends push notifications to all devices of a user
func (pns *PushNotificationService) SendPushNotificationToUser(ctx context.Context, userID, title, body string, data map[string]interface{}) {
	// Check if VAPID keys are configured
	if pns.vapidPublicKey == "" || pns.vapidPrivateKey == "" {
		log.Printf("VAPID keys not configured, skipping push notification")
		return
	}

	// Get all push subscriptions for the user
	subscriptions, err := pns.getUserPushSubscriptions(ctx, userID)
	if err != nil {
		log.Printf("Failed to get push subscriptions for user %s: %v", userID, err)
		return
	}

	if len(subscriptions) == 0 {
		log.Printf("No push subscriptions found for user %s", userID)
		return
	}

	// Build notification payload
	payload := map[string]interface{}{
		"title": title,
		"body":  body,
		"icon":  "/mahjong-icon.png",
		"badge": "/mahjong-icon.png",
		"data":  data,
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Failed to marshal push payload: %v", err)
		return
	}

	log.Printf("Sending push notification to user %s (%d devices)", userID, len(subscriptions))

	// Send to all devices
	successCount := 0
	for _, record := range subscriptions {
		// Only send to active devices
		if !record.IsActive {
			log.Printf("Skipping inactive device %s for user %s", record.DeviceID, userID)
			continue
		}

		if pns.sendToDevice(ctx, userID, record, payloadJSON) {
			successCount++
		}
	}

	log.Printf("Push notification sent to %d/%d devices for user %s", successCount, len(subscriptions), userID)
}

// getUserPushSubscriptions retrieves all push subscriptions for a user
func (pns *PushNotificationService) getUserPushSubscriptions(ctx context.Context, userID string) ([]PushSubscriptionRecord, error) {
	tableName := pns.tablePrefix + "PushSubscriptions_MultiDevice"

	// Query all devices for this user
	result, err := pns.dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		KeyConditionExpression: stringPtr("userId = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err != nil {
		return nil, err
	}

	var subscriptions []PushSubscriptionRecord
	for _, item := range result.Items {
		var record PushSubscriptionRecord
		if err := attributevalue.UnmarshalMap(item, &record); err != nil {
			log.Printf("Failed to unmarshal subscription record: %v", err)
			continue
		}
		subscriptions = append(subscriptions, record)
	}

	if len(subscriptions) > 0 {
		return subscriptions, nil
	}

	// Step 2: Fallback to old PushSubscriptions table (for backward compatibility)
	oldTableName := pns.tablePrefix + "PushSubscriptions"
	log.Printf("[Push] No multi-device records for %s, checking old table...", userID)

	// Since old table is userId HASH only, we use GetItem
	getItemResult, err := pns.dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &oldTableName,
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})

	if err == nil && getItemResult.Item != nil {
		var record PushSubscriptionRecord
		if err := attributevalue.UnmarshalMap(getItemResult.Item, &record); err == nil {
			// Old records don't have isActive field, default to true
			record.IsActive = true
			if record.DeviceID == "" {
				record.DeviceID = "legacy_device"
			}
			subscriptions = append(subscriptions, record)
			log.Printf("[Push] found legacy subscription for user %s", userID)
		}
	}

	return subscriptions, nil
}

// sendToDevice sends push notification to a specific device
func (pns *PushNotificationService) sendToDevice(ctx context.Context, userID string, record PushSubscriptionRecord, payloadJSON []byte) bool {
	// Convert to webpush.Subscription
	subscription := &webpush.Subscription{
		Endpoint: record.Endpoint,
		Keys: webpush.Keys{
			Auth:   getStringFromMap(record.Keys, "auth"),
			P256dh: getStringFromMap(record.Keys, "p256dh"),
		},
	}

	// Send push notification
	resp, err := webpush.SendNotification(payloadJSON, subscription, &webpush.Options{
		Subscriber:      pns.vapidSubscriber,
		VAPIDPublicKey:  pns.vapidPublicKey,
		VAPIDPrivateKey: pns.vapidPrivateKey,
		TTL:             30,
	})

	if err != nil {
		log.Printf("Failed to send push notification to user %s device %s: %v", userID, record.DeviceID, err)
		return false
	}

	defer resp.Body.Close()

	// Handle response
	if resp.StatusCode == 410 {
		// Subscription expired, delete it
		log.Printf("Push subscription expired for user %s device %s, deleting", userID, record.DeviceID)
		pns.deletePushSubscription(ctx, userID, record.DeviceID)
		return false
	} else if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Printf("Push notification sent successfully to user %s device %s", userID, record.DeviceID)
		return true
	} else {
		log.Printf("Push notification failed with status %d for user %s device %s", resp.StatusCode, userID, record.DeviceID)
		return false
	}
}

// deletePushSubscription removes an expired subscription
func (pns *PushNotificationService) deletePushSubscription(ctx context.Context, userID, deviceID string) {
	tableName := pns.tablePrefix + "PushSubscriptions_MultiDevice"

	_, err := pns.dynamoClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"userId":   &types.AttributeValueMemberS{Value: userID},
			"deviceId": &types.AttributeValueMemberS{Value: deviceID},
		},
	})

	if err != nil {
		log.Printf("Failed to delete expired subscription for user %s device %s: %v", userID, deviceID, err)
	} else {
		log.Printf("Deleted expired subscription for user %s device %s", userID, deviceID)
	}
}

// Helper functions
func getVapidSubscriber() string {
	subscriber := os.Getenv("VAPID_SUBSCRIBER")
	if subscriber == "" {
		// Note: webpush-go will automatically add "mailto:" prefix if not HTTPS URL
		subscriber = "support@mahjongclub.com"
	}
	return subscriber
}

func getStringFromMap(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

// stringPtr helper function
func stringPtr(s string) *string {
	return &s
}
