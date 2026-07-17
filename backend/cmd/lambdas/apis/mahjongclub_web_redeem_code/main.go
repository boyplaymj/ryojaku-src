package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
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

var (
	dynamoClient *dynamodb.Client
	tablePrefix  string
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
}

type Response struct {
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

type RedeemRequest struct {
	Code string `json:"code"`
}

type RedeemCode struct {
	CodeID       string     `dynamodbav:"codeId"`
	Points       int        `dynamodbav:"points"`
	BatchID      string     `dynamodbav:"batchId"`
	Status       string     `dynamodbav:"status"`
	UsedBy       string     `dynamodbav:"usedBy,omitempty"`
	UsedAt       *time.Time `dynamodbav:"usedAt,omitempty"`
	CreatedAt    time.Time  `dynamodbav:"createdAt"`
	CreatedAtNum int64      `dynamodbav:"createdAtNum"`
}

type EventCommand struct {
	CommandID   string    `dynamodbav:"commandId"`
	Command     string    `dynamodbav:"command"`
	CodeCount   int       `dynamodbav:"codeCount"`
	Points      int       `dynamodbav:"points"`
	UsedCount   int       `dynamodbav:"usedCount"`
	StartTime   time.Time `dynamodbav:"startTime"`
	EndTime     time.Time `dynamodbav:"endTime"`
	StartTimeTS int64     `dynamodbav:"startTimeTS"`
	EndTimeTS   int64     `dynamodbav:"endTimeTS"`
	IsActive    string    `dynamodbav:"isActive"` // "true" or "false"
}

type EventRedemption struct {
	RedemptionID string    `dynamodbav:"redemptionId"`
	CommandID    string    `dynamodbav:"commandId"`
	Command      string    `dynamodbav:"command"`
	UserID       string    `dynamodbav:"userId"`
	Points       int       `dynamodbav:"points"`
	RedeemedAt   time.Time `dynamodbav:"redeemedAt"`
	RedeemedTS   int64     `dynamodbav:"redeemedTS"`
}

const (
	CodeStatusUnused = "unused"
	CodeStatusUsed   = "used"
)

func handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (Response, error) {
	log.Printf("Received request: %s %s", request.RequestContext.HTTP.Method, request.RawPath)

	// CORS headers
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	// Handle OPTIONS request for CORS
	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return Response{
			StatusCode: 200,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// Get user ID from query parameters
	userID := request.QueryStringParameters["userId"]
	if userID == "" {
		userID = request.QueryStringParameters["lineID"]
	}

	if userID == "" {
		return errorResponse(headers, http.StatusBadRequest, "Missing userId or lineID parameter"), nil
	}

	// Parse request body
	var req RedeemRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid request body"), nil
	}

	if req.Code == "" {
		return errorResponse(headers, http.StatusBadRequest, "Code is required"), nil
	}

	// Make code case-insensitive
	req.Code = strings.ToUpper(req.Code)

	// 1. Try to find as a regular RedeemCode
	code, err := getRedeemCode(ctx, req.Code)
	if err != nil {
		log.Printf("Error getting code: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to verify code"), nil
	}

	if code != nil {
		return handleRedeemCode(ctx, code, userID, headers)
	}

	// 2. If not found, try to find as an EventCommand
	eventCmd, err := getEventCommandByCommand(ctx, req.Code)
	if err != nil {
		log.Printf("Error getting event command: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to verify event command"), nil
	}

	if eventCmd != nil {
		return handleRedeemEventCommand(ctx, eventCmd, userID, headers)
	}

	return errorResponse(headers, http.StatusNotFound, "Invalid code"), nil
}

func handleRedeemCode(ctx context.Context, code *RedeemCode, userID string, headers map[string]string) (Response, error) {
	// Check if code is valid and unused
	if code.Status != CodeStatusUnused {
		return errorResponse(headers, http.StatusBadRequest, "Code has already been used"), nil
	}

	// Mark code as used (Atomic update)
	now := time.Now()
	taipeiLoc, _ := time.LoadLocation("Asia/Taipei")
	taipeiTime := now.In(taipeiLoc)

	err := markCodeAsUsed(ctx, code.CodeID, userID, taipeiTime)
	if err != nil {
		log.Printf("Error marking code as used: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to redeem code"), nil
	}

	// Add points to user
	err = addPointsToUser(ctx, userID, code.Points)
	if err != nil {
		log.Printf("Error adding points to user: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to update user points. Please contact support."), nil
	}

	return successResponse(headers, map[string]interface{}{
		"points":  code.Points,
		"message": fmt.Sprintf("Successfully redeemed %d points", code.Points),
	}), nil
}

func handleRedeemEventCommand(ctx context.Context, cmd *EventCommand, userID string, headers map[string]string) (Response, error) {
	// 1. Check if active
	if cmd.IsActive != "true" {
		return errorResponse(headers, http.StatusBadRequest, "Event code is not active"), nil
	}

	// 2. Check time
	now := time.Now()
	if now.Before(cmd.StartTime) {
		return errorResponse(headers, http.StatusBadRequest, "Event has not started yet"), nil
	}
	if now.After(cmd.EndTime) {
		return errorResponse(headers, http.StatusBadRequest, "Event has ended"), nil
	}

	// 3. Check if user already redeemed (Quick check)
	alreadyRedeemed, err := checkUserAlreadyRedeemedEvent(ctx, cmd.CommandID, userID)
	if err != nil {
		log.Printf("Error checking redemption: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to verify redemption status"), nil
	}
	if alreadyRedeemed {
		return errorResponse(headers, http.StatusBadRequest, "You have already redeemed this code"), nil
	}

	// 4. Transaction (Redeem and Add Points)
	err = redeemEventTransaction(ctx, cmd, userID)
	if err != nil {
		log.Printf("Transaction error: %v", err)
		var tce *types.TransactionCanceledException
		if errors.As(err, &tce) {
			if len(tce.CancellationReasons) >= 2 {
				if tce.CancellationReasons[0].Code != nil && *tce.CancellationReasons[0].Code == "ConditionalCheckFailed" {
					return errorResponse(headers, http.StatusBadRequest, "Event code has reached its usage limit"), nil
				}
				if tce.CancellationReasons[1].Code != nil && *tce.CancellationReasons[1].Code == "ConditionalCheckFailed" {
					return errorResponse(headers, http.StatusBadRequest, "You have already redeemed this code"), nil
				}
			}
		}
		return errorResponse(headers, http.StatusInternalServerError, "Failed to redeem event code"), nil
	}

	// 4.5 Record Shadow Point Log
	go func() {
		logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Get current balance
		res, err := dynamoClient.GetItem(logCtx, &dynamodb.GetItemInput{
			TableName: aws.String(tablePrefix + "Users"),
			Key: map[string]types.AttributeValue{
				"userId": &types.AttributeValueMemberS{Value: userID},
			},
		})
		if err != nil || res.Item == nil {
			return
		}

		var user shared.User
		attributevalue.UnmarshalMap(res.Item, &user)

		meta := map[string]interface{}{
			"commandId": cmd.CommandID,
			"command":   cmd.Command,
		}
		shared.RecordPointChangeShadow(logCtx, dynamoClient, tablePrefix, userID, cmd.Points, shared.PointTypeCredit, user.Points-cmd.Points, user.Points, "活動代碼兌換獎勵", "web_redeem_event", meta)
	}()

	return successResponse(headers, map[string]interface{}{
		"points":  cmd.Points,
		"message": fmt.Sprintf("Successfully redeemed %d points from event", cmd.Points),
	}), nil
}

func getRedeemCode(ctx context.Context, codeID string) (*RedeemCode, error) {
	tableName := tablePrefix + "RedeemCodes"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"codeId": &types.AttributeValueMemberS{Value: codeID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, nil
	}
	var code RedeemCode
	err = attributevalue.UnmarshalMap(result.Item, &code)
	return &code, err
}

func getEventCommandByCommand(ctx context.Context, command string) (*EventCommand, error) {
	tableName := tablePrefix + "EventCommands"
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("command-index"),
		KeyConditionExpression: aws.String("command = :command"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":command": &types.AttributeValueMemberS{Value: command},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, err
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	var cmd EventCommand
	err = attributevalue.UnmarshalMap(result.Items[0], &cmd)
	return &cmd, err
}

func checkUserAlreadyRedeemedEvent(ctx context.Context, commandID, userID string) (bool, error) {
	tableName := tablePrefix + "EventRedemptions"
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("commandId-redeemedTS-index"),
		KeyConditionExpression: aws.String("commandId = :commandId"),
		FilterExpression:       aws.String("userId = :userId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":commandId": &types.AttributeValueMemberS{Value: commandID},
			":userId":    &types.AttributeValueMemberS{Value: userID},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return false, err
	}
	return len(result.Items) > 0, nil
}

func redeemEventTransaction(ctx context.Context, cmd *EventCommand, userID string) error {
	redemptionID := fmt.Sprintf("%s#%s", cmd.CommandID, userID)
	now := time.Now()

	redemption := EventRedemption{
		RedemptionID: redemptionID,
		CommandID:    cmd.CommandID,
		Command:      cmd.Command,
		UserID:       userID,
		Points:       cmd.Points,
		RedeemedAt:   now,
		RedeemedTS:   now.Unix(),
	}

	redemptionItem, err := attributevalue.MarshalMap(redemption)
	if err != nil {
		return err
	}

	_, err = dynamoClient.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Update: &types.Update{
					TableName: aws.String(tablePrefix + "EventCommands"),
					Key: map[string]types.AttributeValue{
						"commandId": &types.AttributeValueMemberS{Value: cmd.CommandID},
					},
					UpdateExpression:    aws.String("ADD usedCount :inc"),
					ConditionExpression: aws.String("usedCount < codeCount"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":inc": &types.AttributeValueMemberN{Value: "1"},
					},
				},
			},
			{
				Put: &types.Put{
					TableName:           aws.String(tablePrefix + "EventRedemptions"),
					Item:                redemptionItem,
					ConditionExpression: aws.String("attribute_not_exists(redemptionId)"),
				},
			},
			{
				Update: &types.Update{
					TableName: aws.String(tablePrefix + "Users"),
					Key: map[string]types.AttributeValue{
						"userId": &types.AttributeValueMemberS{Value: userID},
					},
					UpdateExpression: aws.String("ADD points :points"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":points": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", cmd.Points)},
					},
				},
			},
		},
	})

	return err
}

func markCodeAsUsed(ctx context.Context, codeID, userID string, usedAt time.Time) error {
	tableName := tablePrefix + "RedeemCodes"
	_, err := dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"codeId": &types.AttributeValueMemberS{Value: codeID},
		},
		UpdateExpression:    aws.String("SET #status = :usedStatus, usedBy = :userID, usedAt = :usedAt"),
		ConditionExpression: aws.String("#status = :unusedStatus"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":usedStatus":   &types.AttributeValueMemberS{Value: CodeStatusUsed},
			":unusedStatus": &types.AttributeValueMemberS{Value: CodeStatusUnused},
			":userID":       &types.AttributeValueMemberS{Value: userID},
			":usedAt":       &types.AttributeValueMemberS{Value: usedAt.Format(time.RFC3339)},
		},
	})
	return err
}

func addPointsToUser(ctx context.Context, userID string, points int) error {
	_, err := shared.UpdateUserPoints(ctx, dynamoClient, tablePrefix, userID, points, "序號兌換獎勵", "web_redeem_code", nil)
	return err
}

func successResponse(headers map[string]string, data interface{}) Response {
	resp := APIResponse{Success: true, Data: data}
	body, _ := json.Marshal(resp)
	return Response{StatusCode: 200, Headers: headers, Body: string(body)}
}

func errorResponse(headers map[string]string, statusCode int, message string) Response {
	resp := APIResponse{Success: false, Error: message}
	body, _ := json.Marshal(resp)
	return Response{StatusCode: statusCode, Headers: headers, Body: string(body)}
}

func main() {
	lambda.Start(handler)
}
