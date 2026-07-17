package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type Config struct {
	AWSRegion   string
	TablePrefix string
}

type Database struct {
	client *dynamodb.Client
	cfg    *Config
}

type LikeCommentRequest struct {
	PostID    string `json:"postId"`
	CommentID string `json:"commentId"` // This is the SortKey
	UserID    string `json:"userId"`
}

type Response struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

var db *Database

func init() {
	cfg := &Config{
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(cfg.AWSRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	db = &Database{
		client: dynamodb.NewFromConfig(awsCfg),
		cfg:    cfg,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func (c *Config) GetTableName(tableName string) string {
	return c.TablePrefix + tableName
}

// GetComment retrieves a comment by ID
func (d *Database) GetComment(ctx context.Context, postID, commentID string) (*shared.Comment, error) {
	tableName := d.cfg.GetTableName("Community")
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"postId":  &types.AttributeValueMemberS{Value: postID},
			"sortKey": &types.AttributeValueMemberS{Value: commentID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, nil
	}

	var comment shared.Comment
	err = attributevalue.UnmarshalMap(result.Item, &comment)
	return &comment, err
}

// GetUser retrieves a user by ID
func (d *Database) GetUser(ctx context.Context, userID string) (*shared.User, error) {
	tableName := d.cfg.GetTableName("Users")
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, nil
	}

	var user shared.User
	err = attributevalue.UnmarshalMap(result.Item, &user)
	return &user, err
}

// CreateNotification creates an in-app notification
func (d *Database) CreateNotification(ctx context.Context, notif *shared.Notification) error {
	tableName := d.cfg.GetTableName("Notifications")
	item, err := attributevalue.MarshalMap(notif)
	if err != nil {
		return err
	}

	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	return err
}

func (d *Database) ToggleLikeComment(ctx context.Context, postID, commentID, userID string) error {
	tableName := d.cfg.GetTableName("Community")
	likeSK := "LIKE#COMMENT#" + commentID + "#USER#" + userID

	// 1. Check if like exists
	getItem, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"postId":  &types.AttributeValueMemberS{Value: postID},
			"sortKey": &types.AttributeValueMemberS{Value: likeSK},
		},
	})
	if err != nil {
		return err
	}

	isLiked := getItem.Item != nil

	if isLiked {
		// Unlike: Delete Like record and decrement count
		_, err = d.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(tableName),
			Key: map[string]types.AttributeValue{
				"postId":  &types.AttributeValueMemberS{Value: postID},
				"sortKey": &types.AttributeValueMemberS{Value: likeSK},
			},
		})
		if err != nil {
			return err
		}

		_, err = d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: aws.String(tableName),
			Key: map[string]types.AttributeValue{
				"postId":  &types.AttributeValueMemberS{Value: postID},
				"sortKey": &types.AttributeValueMemberS{Value: commentID},
			},
			UpdateExpression: aws.String("ADD likeCount :dec"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":dec": &types.AttributeValueMemberN{Value: "-1"},
			},
		})
		return err
	} else {
		// Like: Create Like record and increment count
		_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(tableName),
			Item: map[string]types.AttributeValue{
				"postId":    &types.AttributeValueMemberS{Value: postID},
				"sortKey":   &types.AttributeValueMemberS{Value: likeSK},
				"createdAt": &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
			},
		})
		if err != nil {
			return err
		}

		_, err = d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: aws.String(tableName),
			Key: map[string]types.AttributeValue{
				"postId":  &types.AttributeValueMemberS{Value: postID},
				"sortKey": &types.AttributeValueMemberS{Value: commentID},
			},
			UpdateExpression: aws.String("ADD likeCount :inc"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":inc": &types.AttributeValueMemberN{Value: "1"},
			},
		})
		return err
	}
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "community_like_comment")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers}, nil
	}

	var req LikeCommentRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"}, headers)
	}

	if req.PostID == "" || req.CommentID == "" || req.UserID == "" {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Missing required fields"}, headers)
	}

	if err := db.ToggleLikeComment(ctx, req.PostID, req.CommentID, req.UserID); err != nil {
		log.Printf("Failed to toggle comment like: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Internal server error"}, headers)
	}

	// Send Notifications (only for Like, not Unlike)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		// Check if it was a like or unlike by checking if the record exists now
		tableName := db.cfg.GetTableName("Community")
		likeSK := "LIKE#COMMENT#" + req.CommentID + "#USER#" + req.UserID
		getItem, err := db.client.GetItem(context.Background(), &dynamodb.GetItemInput{
			TableName: aws.String(tableName),
			Key: map[string]types.AttributeValue{
				"postId":  &types.AttributeValueMemberS{Value: req.PostID},
				"sortKey": &types.AttributeValueMemberS{Value: likeSK},
			},
		})
		if err != nil || getItem.Item == nil {
			// It was an unlike or error
			return
		}

		// 1. Get Comment to find author
		comment, err := db.GetComment(context.Background(), req.PostID, req.CommentID)
		if err != nil || comment == nil {
			return
		}

		// Don't notify if liking own comment
		if comment.AuthorID == req.UserID {
			return
		}

		// 2. Get Liker Info
		liker, err := db.GetUser(context.Background(), req.UserID)
		likerName := "有人"
		if err == nil && liker != nil {
			likerName = liker.DisplayName
		}

		// 3. Create In-App Notification
		notif := &shared.Notification{
			NotificationID: uuid.New().String(),
			UserID:         comment.AuthorID,
			Type:           "community_like",
			Title:          "留言收到新的讚",
			Message:        likerName + " 覺得您的留言很讚！",
			PostID:         req.PostID,
			FromUserID:     req.UserID,
			FromUserName:   likerName,
			IsRead:         false,
			CreatedAt:      time.Now().Unix(),
		}
		db.CreateNotification(context.Background(), notif)

		// 4. Send Push Notification
		pns, err := shared.NewPushNotificationService()
		if err == nil {
			pns.SendPushNotificationToUser(context.Background(), comment.AuthorID, notif.Title, notif.Message, map[string]interface{}{
				"type":   "community_like",
				"postId": req.PostID,
			})
		}
	}()

	wg.Wait()

	return respond(http.StatusOK, Response{Success: true}, headers)
}

func respond(status int, resp Response, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(resp)
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(handler)
}
