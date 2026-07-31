package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type Config struct {
	AWSRegion   string
	TablePrefix string
}

type ChatConnection struct {
	ConnectionID string `dynamodbav:"ConnectionID"`
	UserID       string `dynamodbav:"UserID"`
	ConnectedAt  int64  `dynamodbav:"ConnectedAt"`
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

// authorizedUserID 從 $connect 的 authorizer context 取出已驗證的 userId。
// RequestContext.Authorizer 的型別是 interface{}（API Gateway 傳來的是 JSON 物件），
// 故需逐層型別斷言；取不到一律回空字串，由呼叫端 fail-closed。
func authorizedUserID(request events.APIGatewayWebsocketProxyRequest) string {
	authCtx, ok := request.RequestContext.Authorizer.(map[string]interface{})
	if !ok {
		return ""
	}
	if v, ok := authCtx["userId"].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func Handler(ctx context.Context, request events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	connectionID := request.RequestContext.ConnectionID

	// S3 安全鐵律：身分只認 authorizer 驗過的結果，絕不再信 ?userId=。
	//
	// 原本這裡直接吃 request.QueryStringParameters["userId"] 建立連線記錄，
	// 等於任何人都能以任意身分連上 WebSocket（冒名發言、竊聽他人聊天室）。
	// 現改由 $connect 的 REQUEST authorizer 驗 JWT，把已驗證的 userId 放進
	// authorizer context，本函式只從那裡取。
	//
	// 🔴 這一點修好，保證的是後續 route 拿到的**身分**是真的 —— 它們用 ConnectionID
	// 反查 ChatConnections（getUserIDByConnection），讀到的是這裡寫進去的、
	// 已驗證的 userId。範圍僅止於此。
	//
	// 原註解由此推論「sendMessage 自動就安全了」是錯的：那是身分驗證（authN），
	// 不是授權（authZ）。「userId 是真的」不等於「這個 userId 有權對該 roomId
	// 做這件事」—— 房間層級的成員檢查一律是各 handler 自己的責任
	// （shared.IsRoomMember），$connect 這裡代不了勞。
	userID := authorizedUserID(request)

	log.Printf("Connect: ConnectionID=%s, UserID=%s", connectionID, userID)

	if userID == "" {
		// 正常情況下 authorizer 會先擋掉，走到這裡代表 authorizer 沒掛好或 context 沒帶過來。
		// fail-closed：寧可拒絕連線，也不要退回信任 query param。
		log.Printf("Connect 拒絕：authorizer context 沒有 userId（authorizer 是否未掛載？）")
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusUnauthorized,
			Body:       "Unauthorized",
		}, nil
	}

	conn := ChatConnection{
		ConnectionID: connectionID,
		UserID:       userID,
		ConnectedAt:  request.RequestContext.ConnectedAt,
	}

	item, err := attributevalue.MarshalMap(conn)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError}, err
	}

	tableName := tablePrefix + "ChatConnections"
	_, err = dbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	if err != nil {
		log.Printf("Failed to save connection: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError}, err
	}

	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Body:       "Connected.",
	}, nil
}

func main() {
	lambda.Start(Handler)
}
