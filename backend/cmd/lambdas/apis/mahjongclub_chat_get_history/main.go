package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type ChatMessageRecord = shared.ChatMessageRecord

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
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "chat_get_history")
	// 記錄流量統計
	shared.RecordTraffic(ctx, dbClient, tablePrefix, "chat", "get_history")

	roomID := request.QueryStringParameters["roomId"]
	if roomID == "" {
		return errorResponse(http.StatusBadRequest, "Missing roomId")
	}

	// 水平越權修補：本支原本只吃 roomId，不驗呼叫者與該聊天室的關係。
	// 掛上 authorizer 只擋掉未登入者，任何「已登入」使用者仍可列舉／猜 roomId
	// 讀取任意聊天室的完整歷史訊息，故必須額外驗成員資格。
	userID := shared.AuthorizerUserID(request)
	if userID == "" {
		return errorResponse(http.StatusUnauthorized, "unauthorized")
	}
	isMember, memErr := shared.IsRoomMember(ctx, dbClient, tablePrefix, userID, roomID)
	if memErr != nil {
		// fail-closed：查不出來就不放行，不可因為 DB 出錯而變成人人可讀。
		log.Printf("Failed to verify room membership (user=%s room=%s): %v", userID, roomID, memErr)
		return errorResponse(http.StatusInternalServerError, "Failed to verify room membership")
	}
	if !isMember {
		return errorResponse(http.StatusForbidden, "You are not a member of this chat room")
	}

	limit := 50
	if l := request.QueryStringParameters["limit"]; l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 {
			limit = val
		}
	}

	tableName := tablePrefix + "ChatMessages"

	result, err := dbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		KeyConditionExpression: aws.String("RoomID = :rid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":rid": &types.AttributeValueMemberS{Value: roomID},
		},
		Limit:            aws.Int32(int32(limit)),
		ScanIndexForward: aws.Bool(false), // Latest messages first
	})

	if err != nil {
		log.Printf("Failed to query messages: %v", err)
		return errorResponse(http.StatusInternalServerError, "Failed to fetch history")
	}

	var messages []ChatMessageRecord
	err = attributevalue.UnmarshalListOfMaps(result.Items, &messages)
	if err != nil {
		return errorResponse(http.StatusInternalServerError, "Failed to parse data")
	}

	return successResponse(messages)
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
