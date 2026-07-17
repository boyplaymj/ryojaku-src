package main

import (
	"context"
	"log"
	"net/http"
	"os"

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

func Handler(ctx context.Context, request events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	connectionID := request.RequestContext.ConnectionID
	// UserID should be passed as query parameter, e.g., ws://.../?userId=APP_xxx
	userID := request.QueryStringParameters["userId"]

	log.Printf("Connect: ConnectionID=%s, UserID=%s", connectionID, userID)

	if userID == "" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusUnauthorized,
			Body:       "Missing userId",
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
