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
	LastKey interface{} `json:"lastKey,omitempty"`
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

func (d *Database) GetPosts(ctx context.Context, limit int32, lastKey map[string]types.AttributeValue) ([]*shared.Post, map[string]types.AttributeValue, error) {
	tableName := d.cfg.GetTableName("Community")
	input := &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("sortKey-createdAt-index"),
		Limit:                  aws.Int32(limit),
		ExclusiveStartKey:      lastKey,
		KeyConditionExpression: aws.String("sortKey = :sk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":sk": &types.AttributeValueMemberS{Value: "METADATA"},
		},
		ScanIndexForward: aws.Bool(false), // 倒序排列 (最新的在前)
	}

	result, err := d.client.Query(ctx, input)
	if err != nil {
		return nil, nil, err
	}

	var posts []*shared.Post
	err = attributevalue.UnmarshalListOfMaps(result.Items, &posts)
	return posts, result.LastEvaluatedKey, err
}

func (d *Database) GetUsersByIDs(ctx context.Context, userIDs []string) (map[string]*shared.User, error) {
	if len(userIDs) == 0 {
		return make(map[string]*shared.User), nil
	}

	tableName := d.cfg.GetTableName("Users")
	usersMap := make(map[string]*shared.User)

	// In a real production environment, you should use BatchGetItem (up to 100 items per request)
	// For simplicity in this initial implementation, we'll implement a basic version
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

func (d *Database) CheckPostsLiked(ctx context.Context, posts []*shared.Post, userID string) error {
	if userID == "" || len(posts) == 0 {
		return nil
	}

	tableName := d.cfg.GetTableName("Community")
	keys := make([]map[string]types.AttributeValue, 0, len(posts))
	postMap := make(map[string]*shared.Post)

	for _, p := range posts {
		likeSK := "LIKE#USER#" + userID
		keys = append(keys, map[string]types.AttributeValue{
			"postId":  &types.AttributeValueMemberS{Value: p.PostID},
			"sortKey": &types.AttributeValueMemberS{Value: likeSK},
		})
		postMap[p.PostID] = p
	}

	input := &dynamodb.BatchGetItemInput{
		RequestItems: map[string]types.KeysAndAttributes{
			tableName: {
				Keys: keys,
			},
		},
	}

	result, err := d.client.BatchGetItem(ctx, input)
	if err != nil {
		return err
	}

	for _, item := range result.Responses[tableName] {
		var postID string
		attributevalue.Unmarshal(item["postId"], &postID)
		if p, ok := postMap[postID]; ok {
			p.IsLikedByMe = true
		}
	}

	return nil
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "community", "view_posts")

	// 記錄 Token 使用統計 (此 API 可公開瀏覽，但追蹤有多少使用者帶 Token)
	shared.RecordTokenUsageFromHeader(request, "community_get_posts")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	userID := request.QueryStringParameters["userId"]

	// Parse lastKey
	var exclusiveStartKey map[string]types.AttributeValue
	if lastKeyStr := request.QueryStringParameters["lastKey"]; lastKeyStr != "" {
		var lastKeyMap map[string]interface{}
		if err := json.Unmarshal([]byte(lastKeyStr), &lastKeyMap); err != nil {
			log.Printf("Failed to unmarshal lastKey: %v", err)
			return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid lastKey format"}, headers)
		}
		var err error
		exclusiveStartKey, err = attributevalue.MarshalMap(lastKeyMap)
		if err != nil {
			log.Printf("Failed to marshal lastKeyMap: %v", err)
			return respond(http.StatusInternalServerError, Response{Success: false, Error: "Internal server error"}, headers)
		}
	}

	posts, lastEvaluatedKey, err := db.GetPosts(ctx, 10, exclusiveStartKey)
	if err != nil {
		log.Printf("Failed to fetch posts: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Failed to fetch posts"}, headers)
	}

	// Normalize media URLs to use CDN
	for _, p := range posts {
		shared.NormalizePostMediaURLs(p)
	}

	// Data Hydration: Fetch author info
	authorIDs := make(map[string]bool)
	for _, p := range posts {
		authorIDs[p.AuthorID] = true
	}
	var idList []string
	for id := range authorIDs {
		idList = append(idList, id)
	}

	usersMap, _ := db.GetUsersByIDs(ctx, idList)
	for _, p := range posts {
		if user, ok := usersMap[p.AuthorID]; ok {
			p.AuthorName = user.DisplayName
			p.AuthorAvatar = user.PictureURL
		}
	}

	// Check likes if userID provided
	if userID != "" {
		db.CheckPostsLiked(ctx, posts, userID)
	}

	// Prepare response with lastKey
	var lastKeyResponse interface{}
	if lastEvaluatedKey != nil {
		var lastKeyMap map[string]interface{}
		attributevalue.UnmarshalMap(lastEvaluatedKey, &lastKeyMap)
		lastKeyResponse = lastKeyMap
	}

	return respond(http.StatusOK, Response{
		Success: true,
		Data:    posts,
		LastKey: lastKeyResponse,
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
