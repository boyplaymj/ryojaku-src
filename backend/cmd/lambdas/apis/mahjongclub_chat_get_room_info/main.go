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

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

type RoomInfoResponse struct {
	RoomID        string `json:"roomId"`
	TotalMembers  int    `json:"totalMembers"`
	OnlineMembers int    `json:"onlineMembers"`
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
	shared.RecordTokenUsageFromHeader(request, "chat_get_room_info")

	roomID := request.QueryStringParameters["roomId"]
	if roomID == "" {
		return errorResponse(http.StatusBadRequest, "Missing roomId")
	}

	// 1. Get Room Metadata
	roomTableName := tablePrefix + "ChatRooms"
	roomResult, err := dbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &roomTableName,
		Key: map[string]types.AttributeValue{
			"RoomID": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	if err != nil {
		log.Printf("Failed to get room: %v", err)
		return errorResponse(http.StatusInternalServerError, "Failed to fetch room info")
	}
	if roomResult.Item == nil {
		return errorResponse(http.StatusNotFound, "Room not found")
	}

	var room shared.ChatRoomMetadata
	err = attributevalue.UnmarshalMap(roomResult.Item, &room)
	if err != nil {
		return errorResponse(http.StatusInternalServerError, "Failed to parse room data")
	}

	totalMembers := len(room.MemberIDs)
	onlineMembers := 0

	// 2. Count Online Members
	// We can optimize this by batching... but `ChatConnections` is by ConnectionID.
	// We have to Query the GSI `UserID-index` for each user.
	// Since max members usually < 10, executing 10 queries is acceptable for now.
	// A better design would be a `UserStatus` table, but we work with what we have.

	connTableName := tablePrefix + "ChatConnections"
	for _, memberID := range room.MemberIDs {
		// Just check if there is at least one connection
		result, err := dbClient.Query(ctx, &dynamodb.QueryInput{
			TableName:              &connTableName,
			IndexName:              aws.String("UserID-index"),
			KeyConditionExpression: aws.String("UserID = :uid"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":uid": &types.AttributeValueMemberS{Value: memberID},
			},
			Limit: aws.Int32(1), // We only need to know IF connected
		})

		if err == nil && result.Count > 0 {
			onlineMembers++
		}
	}

	respData := RoomInfoResponse{
		RoomID:        roomID,
		TotalMembers:  totalMembers,
		OnlineMembers: onlineMembers,
	}

	return successResponse(respData)
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
