package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
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

type CreatePostRequest struct {
	UserID      string   `json:"userId"`
	Content     string   `json:"content"`
	ContentType string   `json:"contentType"` // "markdown" or "json"
	Images      []string `json:"images"`
	Tags        []string `json:"tags"`
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

func (d *Database) CreatePost(ctx context.Context, post *shared.Post) error {
	tableName := d.cfg.GetTableName("Community")
	item, err := attributevalue.MarshalMap(post)
	if err != nil {
		return err
	}

	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	return err
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "community_create_post")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers}, nil
	}

	var req CreatePostRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"}, headers)
	}

	if req.UserID == "" || req.Content == "" {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Missing userId or content"}, headers)
	}

	now := time.Now().Format(time.RFC3339)
	postID := uuid.New().String()

	post := &shared.Post{
		PostID:       "POST#" + postID,
		SortKey:      "METADATA",
		AuthorID:     req.UserID,
		Content:      req.Content,
		ContentType:  req.ContentType,
		Images:       req.Images,
		Tags:         req.Tags,
		LikeCount:    0,
		CommentCount: 0,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := db.CreatePost(ctx, post); err != nil {
		log.Printf("Failed to create post: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Failed to create post"}, headers)
	}

	return respond(http.StatusOK, Response{Success: true, Data: post}, headers)
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
