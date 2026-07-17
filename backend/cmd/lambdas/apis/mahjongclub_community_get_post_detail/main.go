package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

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

func (d *Database) GetPostDetail(ctx context.Context, postID string) (*shared.Post, []shared.Comment, error) {
	tableName := d.cfg.GetTableName("Community")

	// Query for both Post and all its Comments using the PostID as PK
	input := &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		KeyConditionExpression: aws.String("postId = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: postID},
		},
	}

	result, err := d.client.Query(ctx, input)
	if err != nil {
		return nil, nil, err
	}

	var post *shared.Post
	var comments []shared.Comment

	for _, item := range result.Items {
		var sk string
		err := attributevalue.Unmarshal(item["sortKey"], &sk)
		if err != nil {
			continue
		}

		if sk == "METADATA" {
			var p shared.Post
			if err := attributevalue.UnmarshalMap(item, &p); err == nil {
				post = &p
			}
		} else if len(sk) > 8 && sk[:8] == "COMMENT#" {
			var c shared.Comment
			if err := attributevalue.UnmarshalMap(item, &c); err == nil {
				comments = append(comments, c)
			}
		}
	}

	if post == nil {
		return nil, nil, nil
	}

	return post, comments, nil
}

func (d *Database) GetUsersByIDs(ctx context.Context, userIDs []string) (map[string]*shared.User, error) {
	if len(userIDs) == 0 {
		return make(map[string]*shared.User), nil
	}

	tableName := d.cfg.GetTableName("Users")
	usersMap := make(map[string]*shared.User)

	for _, id := range userIDs {
		result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: aws.String(tableName),
			Key: map[string]types.AttributeValue{
				"userId": &types.AttributeValueMemberS{Value: id},
			},
		})
		if err == nil && result.Item != nil {
			var user shared.User
			if err := attributevalue.UnmarshalMap(result.Item, &user); err == nil {
				usersMap[id] = &user
			}
		}
	}
	return usersMap, nil
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "community_get_post_detail")

	// Record traffic
	shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "community", "view_post_detail")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	postID := request.QueryStringParameters["postId"]
	userID := request.QueryStringParameters["userId"]
	if postID == "" {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Missing postId"}, headers)
	}

	// We'll reuse GetPostDetail but we need to handle the LIKE records within handler to avoid changing shared logic too much
	tableName := db.cfg.GetTableName("Community")
	input := &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		KeyConditionExpression: aws.String("postId = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: postID},
		},
	}

	result, err := db.client.Query(ctx, input)
	if err != nil {
		log.Printf("Failed to fetch post detail items: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Internal server error"}, headers)
	}

	var post *shared.Post
	var comments []shared.Comment
	commentLikes := make(map[string]bool)
	postLiked := false

	for _, item := range result.Items {
		var sk string
		attributevalue.Unmarshal(item["sortKey"], &sk)

		if sk == "METADATA" {
			var p shared.Post
			if err := attributevalue.UnmarshalMap(item, &p); err == nil {
				post = &p
			}
		} else if len(sk) > 8 && sk[:8] == "COMMENT#" {
			var c shared.Comment
			if err := attributevalue.UnmarshalMap(item, &c); err == nil {
				comments = append(comments, c)
			}
		} else if userID != "" {
			// Check for Post Like: LIKE#USER#<userID>
			if sk == "LIKE#USER#"+userID {
				postLiked = true
			}
			// Check for Comment Like: LIKE#COMMENT#<commentId>#USER#<userID>
			const commentLikePrefix = "LIKE#COMMENT#"
			if len(sk) > len(commentLikePrefix) && sk[:len(commentLikePrefix)] == commentLikePrefix {
				// Parse commentId: LIKE#COMMENT#<commentId>#USER#<userID>
				// Check if it ends with #USER#<userID>
				userSuffix := "#USER#" + userID
				if len(sk) > len(userSuffix) && sk[len(sk)-len(userSuffix):] == userSuffix {
					commentID := sk[len(commentLikePrefix) : len(sk)-len(userSuffix)]
					commentLikes[commentID] = true
				}
			}
		}
	}

	if post == nil {
		return respond(http.StatusNotFound, Response{Success: false, Error: "Post not found"}, headers)
	}

	post.IsLikedByMe = postLiked

	// Normalize media URLs to use CDN
	shared.NormalizePostMediaURLs(post)

	// Data Hydration: Collect author IDs from post and comments
	authorIDs := make(map[string]bool)
	authorIDs[post.AuthorID] = true
	for _, c := range comments {
		authorIDs[c.AuthorID] = true
	}

	var idList []string
	for id := range authorIDs {
		idList = append(idList, id)
	}

	usersMap, _ := db.GetUsersByIDs(ctx, idList)

	// Hydrate Post
	if user, ok := usersMap[post.AuthorID]; ok {
		post.AuthorName = user.DisplayName
		post.AuthorAvatar = user.PictureURL
	}

	// Hydrate Comments
	for i := range comments {
		if user, ok := usersMap[comments[i].AuthorID]; ok {
			comments[i].AuthorName = user.DisplayName
			comments[i].AuthorAvatar = user.PictureURL
		}
		// Check if comment author is the post author
		comments[i].IsAuthor = comments[i].AuthorID == post.AuthorID
		// Check if current user liked this comment
		if liked, ok := commentLikes[comments[i].SortKey]; ok {
			comments[i].IsLikedByMe = liked
		}
	}

	return respond(http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"post":     post,
			"comments": comments,
		},
	}, headers)
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
