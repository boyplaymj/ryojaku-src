package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type ChatMembership = shared.ChatMembership

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var dbClient *dynamodb.Client
var tablePrefix string

func init() {
	awsRegion := os.Getenv("AWS_REGION")
	if awsRegion == "" {
		awsRegion = "ap-southeast-1"
	}
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(awsRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	dbClient = dynamodb.NewFromConfig(awsCfg)
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 身分一律取自 authorizer（S5-D）。原本用 GetUserIdentifierWithTracking，
	// 其底層 GetUserIdentifier 是 Phase 1 相容層：JWT 優先，失敗則 fallback 回
	// query param 的 userId／lineID；且此處把 hasToken 丟給 _ 忽略，
	// 等同接受「登入者帶 ?userId=<他人> 讀取別人的聊天室清單」。
	userID := shared.AuthorizerUserID(request)
	// 保留原本的 Token 使用統計副作用：能走到這裡必然是通過 authorizer 的 JWT 請求。
	if userID != "" {
		shared.RecordTokenUsage("chat_get_rooms", true)
	}
	// 記錄流量統計
	shared.RecordTraffic(ctx, dbClient, tablePrefix, "chat", "get_rooms")
	if userID == "" {
		return errorResponse(http.StatusUnauthorized, "unauthorized")
	}

	tableName := tablePrefix + "ChatUserMemberships"

	// Query memberships for the user
	result, err := dbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		KeyConditionExpression: aws.String("UserID = :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false), // Reverse order (latest first)
	})

	if err != nil {
		log.Printf("Failed to query memberships: %v. Error: %s", err, err.Error())
		return errorResponse(http.StatusInternalServerError, "Failed to fetch chat rooms")
	}

	var memberships []ChatMembership
	err = attributevalue.UnmarshalListOfMaps(result.Items, &memberships)
	if err != nil {
		return errorResponse(http.StatusInternalServerError, "Failed to parse data")
	}

	// 1. Normalize LastMessageTimestamp
	// For legacy items, try to extract timestamp from MessageTimeAndRoom (format: "timestamp#roomId")
	for i := range memberships {
		if memberships[i].LastMessageTimestamp == 0 {
			parts := strings.Split(memberships[i].MessageTimeAndRoom, "#")
			if len(parts) == 2 {
				if ts, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
					memberships[i].LastMessageTimestamp = ts
				}
			}
		}
	}

	// 2. Sort by LastMessageTimestamp descending
	sort.Slice(memberships, func(i, j int) bool {
		return memberships[i].LastMessageTimestamp > memberships[j].LastMessageTimestamp
	})

	// 3. Dedup by RoomID & Filter by ExpiryTime
	deduped := make([]ChatMembership, 0, len(memberships))
	seen := make(map[string]bool)
	now := time.Now().Unix()

	for _, m := range memberships {
		// Filter out expired rooms (if ExpiryTime is set and in the past)
		if m.ExpiryTime > 0 && m.ExpiryTime < now {
			continue
		}

		if !seen[m.RoomID] {
			seen[m.RoomID] = true
			deduped = append(deduped, m)
		}
	}

	return successResponse(deduped)
}

func errorResponse(status int, msg string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: false, Error: msg})
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers: map[string]string{
			"Access-Control-Allow-Origin": "*",
			"Content-Type":                "application/json",
		},
		Body: string(body),
	}, nil
}

func successResponse(data interface{}) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: true, Data: data})
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers: map[string]string{
			"Access-Control-Allow-Origin": "*",
			"Content-Type":                "application/json",
		},
		Body: string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
