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

type AddCommentRequest struct {
	PostID  string `json:"postId"`
	UserID  string `json:"userId"`
	Content string `json:"content"`
}

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
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

// GetPost retrieves a post by ID
func (d *Database) GetPost(ctx context.Context, postID string) (*shared.Post, error) {
	tableName := d.cfg.GetTableName("Community")
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"postId":  &types.AttributeValueMemberS{Value: postID},
			"sortKey": &types.AttributeValueMemberS{Value: "METADATA"},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, nil
	}

	var post shared.Post
	err = attributevalue.UnmarshalMap(result.Item, &post)
	return &post, err
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

func (d *Database) AddComment(ctx context.Context, comment *shared.Comment) error {
	tableName := d.cfg.GetTableName("Community")
	item, err := attributevalue.MarshalMap(comment)
	if err != nil {
		return err
	}

	// 1. Put Comment
	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	if err != nil {
		return err
	}

	// 2. Increment CommentCount
	_, err = d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"postId":  &types.AttributeValueMemberS{Value: comment.PostID},
			"sortKey": &types.AttributeValueMemberS{Value: "METADATA"},
		},
		UpdateExpression: aws.String("ADD commentCount :inc"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":inc": &types.AttributeValueMemberN{Value: "1"},
		},
	})
	return err
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "community_add_comment")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers}, nil
	}

	var req AddCommentRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"}, headers)
	}

	if req.PostID == "" || req.UserID == "" || req.Content == "" {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Missing required fields"}, headers)
	}

	now := time.Now().UTC()
	commentID := uuid.New().String()
	sk := "COMMENT#" + now.Format("20060102150405") + "#" + commentID

	comment := &shared.Comment{
		PostID:    req.PostID,
		SortKey:   sk,
		AuthorID:  req.UserID,
		Content:   req.Content,
		LikeCount: 0,
		CreatedAt: now.Format(time.RFC3339),
	}

	if err := db.AddComment(ctx, comment); err != nil {
		log.Printf("Failed to add comment: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Internal server error"}, headers)
	}

	// Send Notifications
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		// 1. Get Post to find author
		post, err := db.GetPost(context.Background(), req.PostID)
		if err != nil || post == nil {
			return
		}

		// Don't notify if commenting on own post
		if post.AuthorID == req.UserID {
			return
		}

		// 2. Get Commenter Info
		commenter, err := db.GetUser(context.Background(), req.UserID)
		commenterName := "有人"
		if err == nil && commenter != nil {
			commenterName = commenter.DisplayName
		}

		// 3. Create In-App Notification
		notif := &shared.Notification{
			NotificationID: uuid.New().String(),
			UserID:         post.AuthorID,
			Type:           "community_comment",
			Title:          "新的貼文留言",
			Message:        commenterName + " 在您的貼文留言了：" + req.Content,
			PostID:         req.PostID,
			FromUserID:     req.UserID,
			FromUserName:   commenterName,
			IsRead:         false,
			CreatedAt:      time.Now().Unix(),
		}
		db.CreateNotification(context.Background(), notif)

		// 4. Send Push Notification
		pns, err := shared.NewPushNotificationService()
		if err == nil {
			pns.SendPushNotificationToUser(context.Background(), post.AuthorID, notif.Title, notif.Message, map[string]interface{}{
				"type":   "community_comment",
				"postId": req.PostID,
			})
		}
	}()

	wg.Wait()

	return respond(http.StatusOK, Response{Success: true, Data: comment}, headers)
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
