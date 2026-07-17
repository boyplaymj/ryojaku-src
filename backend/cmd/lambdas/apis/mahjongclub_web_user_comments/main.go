package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type RatingComment struct {
	CommentID       string    `dynamodbav:"commentId" json:"commentId"`
	RatingID        string    `dynamodbav:"ratingId" json:"ratingId"`
	GameID          string    `dynamodbav:"gameId" json:"gameId"`
	FromUserID      string    `dynamodbav:"fromUserId" json:"fromUserId"`
	FromDisplayName string    `dynamodbav:"fromDisplayName" json:"fromDisplayName"`
	ToUserID        string    `dynamodbav:"toUserId" json:"toUserId"`
	IsPositive      bool      `dynamodbav:"isPositive" json:"isPositive"`
	Comment         string    `dynamodbav:"comment" json:"comment"`
	CreatedAt       int64     `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt       time.Time `dynamodbav:"updatedAt" json:"updatedAt"`
}

type Response struct {
	Success bool             `json:"success"`
	Data    []*RatingComment `json:"data,omitempty"`
	LastKey string           `json:"lastKey,omitempty"`
	HasMore bool             `json:"hasMore"`
	Error   string           `json:"error,omitempty"`
}

var (
	dynamoClient *dynamodb.Client
	tablePrefix  string
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Unable to load SDK config: %v", err)
	}

	dynamoClient = dynamodb.NewFromConfig(cfg)
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_user_comments")
	// 記錄流量統計
	shared.RecordTraffic(ctx, dynamoClient, tablePrefix, "user", "view_comments")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
		}, nil
	}

	userID := request.QueryStringParameters["userId"]
	if userID == "" {
		response := Response{Success: false, Error: "缺少用戶 ID"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get comments
	limitStr := request.QueryStringParameters["limit"]
	limit := 10
	if limitStr != "" {
		fmt.Sscanf(limitStr, "%d", &limit)
	}
	lastKeyStr := request.QueryStringParameters["lastKey"]

	comments, lastKey, err := getRatingCommentsForUser(ctx, userID, int32(limit), lastKeyStr)
	if err != nil {
		log.Printf("Failed to get comments: %v", err)
		response := Response{Success: false, Error: "獲取評論失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	response := Response{
		Success: true,
		Data:    comments,
		LastKey: lastKey,
		HasMore: lastKey != "",
	}
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func getRatingCommentsForUser(ctx context.Context, toUserID string, limit int32, lastKeyStr string) ([]*RatingComment, string, error) {
	tableName := tablePrefix + "RatingComments"

	var lastKey map[string]types.AttributeValue
	if lastKeyStr != "" {
		err := json.Unmarshal([]byte(lastKeyStr), &lastKey)
		if err != nil {
			log.Printf("Failed to unmarshal lastKey: %v", err)
		}
	}

	input := &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("toUserId-createdAt-index"),
		Limit:                  aws.Int32(limit),
		ExclusiveStartKey:      lastKey,
		KeyConditionExpression: aws.String("toUserId = :toUserId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":toUserId": &types.AttributeValueMemberS{Value: toUserID},
		},
		ScanIndexForward: aws.Bool(false), // Sort by createdAt descending
	}

	result, err := dynamoClient.Query(ctx, input)

	if err != nil {
		return nil, "", err
	}

	var comments []*RatingComment
	err = attributevalue.UnmarshalListOfMaps(result.Items, &comments)
	if err != nil {
		return nil, "", err
	}

	var newLastKey string
	if result.LastEvaluatedKey != nil {
		keyJSON, _ := json.Marshal(result.LastEvaluatedKey)
		newLastKey = string(keyJSON)
	}

	return comments, newLastKey, nil
}

func main() {
	lambda.Start(handler)
}
