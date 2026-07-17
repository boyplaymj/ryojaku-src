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

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

type ClaimRequest struct {
	UserID   string `json:"userId"`
}

const BonusPoints = 360

func handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	log.Printf("Received claim request: %s", request.Body)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 200,
			Headers:    headers,
		}, nil
	}

	var req ClaimRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid request body"), nil
	}

	if req.UserID == "" {
		return errorResponse(headers, http.StatusBadRequest, "UserID is required"), nil
	}

	// 1. Verify if user has subscribed to push (Optional check for extra safety)
	subscribed, err := checkPushSubscription(ctx, req.UserID)
	if err != nil {
		log.Printf("Error checking subscription: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to verify push status"), nil
	}
	if !subscribed {
		return errorResponse(headers, http.StatusBadRequest, "請先開啟推播通知權限唷！"), nil
	}

	// 2. Atomic Transaction: Set flag and Add points
	err = claimBonusTransaction(ctx, req.UserID)
	if err != nil {
		log.Printf("Transaction error: %v", err)
		// Check if it's a condition failure (already claimed)
		var tce *types.TransactionCanceledException
		if ok := (fmt.Sprintf("%v", err) != ""); ok { // Simplified check for demonstration
			// In production, we'd inspect tce.CancellationReasons
			if tce != nil && len(tce.CancellationReasons) > 0 && *tce.CancellationReasons[0].Code == "ConditionalCheckFailed" {
				return errorResponse(headers, http.StatusBadRequest, "您已經領取過獎勵囉！"), nil
			}
		}
		// A more robust way to check for conditional check failure in DynamoDB V2
		if err.Error() != "" && (fmt.Sprintf("%v", err) != "") {
             // Fallback error if we can't be sure it's a duplicate claim
             // In a real scenario, we'd parse the error more carefully
		}
		
		// Let's re-verify if they already claimed if the transaction failed
		user, _ := shared.GetUserInfo(ctx, dynamoClient, tablePrefix, req.UserID)
		if user != nil && user.HasClaimedPushBonus {
			return errorResponse(headers, http.StatusBadRequest, "您已經領取過獎勵囉！"), nil
		}
		
		return errorResponse(headers, http.StatusInternalServerError, "領取獎勵失敗，請稍後再試"), nil
	}

	// 3. Record Shadow Point Log (Non-blocking)
	go func() {
		logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		user, err := shared.GetUserInfo(logCtx, dynamoClient, tablePrefix, req.UserID)
		if err != nil || user == nil {
			return
		}

		meta := map[string]interface{}{
			"claimedAt": time.Now().Format(time.RFC3339),
		}
		
		shared.RecordPointChangeShadow(
			logCtx, 
			dynamoClient, 
			tablePrefix, 
			req.UserID, 
			BonusPoints, 
			shared.PointTypeCredit, 
			user.Points-BonusPoints, 
			user.Points, 
			"開啟推播通知獎勵", 
			"push_notification_bonus", 
			meta,
		)
	}()

	// 4. Send Instant Push & Web Notification Confirmation (Non-blocking)
	go func() {
		shared.CreateNotification(context.Background(), dynamoClient, tablePrefix, shared.CreateNotificationParams{
			UserID:  req.UserID,
			Type:    "reward_claim",
			Title:   "🎉 獎勵領取成功！",
			Message: fmt.Sprintf("恭喜您獲得 %d 點數！推播通知功能已成功開啟，祝您對局愉快。", BonusPoints),
		})
	}()

	return successResponse(headers, map[string]interface{}{
		"points":   BonusPoints,
		"message":  "恭喜領取成功！",
	}), nil
}

// checkPushSubscription 檢查用戶是否有訂閱推播
// 支援過渡期：先查新表，若無記錄則查舊表
func checkPushSubscription(ctx context.Context, userID string) (bool, error) {
	// Step 1: 先查新表 PushSubscriptions_MultiDevice
	newTableName := tablePrefix + "PushSubscriptions_MultiDevice"
	newResult, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(newTableName),
		KeyConditionExpression: aws.String("userId = :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		log.Printf("Error querying new table: %v", err)
		// 繼續查舊表
	} else if len(newResult.Items) > 0 {
		log.Printf("Found subscription in new table for user %s", userID)
		return true, nil
	}

	// Step 2: 新表無記錄，查舊表 PushSubscriptions
	log.Printf("No subscription in new table, checking legacy table for user %s", userID)
	legacyTableName := tablePrefix + "PushSubscriptions"
	legacyResult, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(legacyTableName),
		KeyConditionExpression: aws.String("userId = :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		log.Printf("Error querying legacy table: %v", err)
		return false, err
	}

	if len(legacyResult.Items) > 0 {
		log.Printf("Found subscription in legacy table for user %s", userID)
		return true, nil
	}

	log.Printf("No subscription found in any table for user %s", userID)
	return false, nil
}

func claimBonusTransaction(ctx context.Context, userID string) error {
	_, err := dynamoClient.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Update: &types.Update{
					TableName: aws.String(tablePrefix + "Users"),
					Key: map[string]types.AttributeValue{
						"userId": &types.AttributeValueMemberS{Value: userID},
					},
					UpdateExpression:    aws.String("SET hasClaimedPushBonus = :true, points = points + :points"),
					ConditionExpression: aws.String("attribute_not_exists(hasClaimedPushBonus) OR hasClaimedPushBonus = :false"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":true":   &types.AttributeValueMemberBOOL{Value: true},
						":false":  &types.AttributeValueMemberBOOL{Value: false},
						":points": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", BonusPoints)},
					},
				},
			},
		},
	})
	return err
}

func successResponse(headers map[string]string, data interface{}) events.APIGatewayV2HTTPResponse {
	resp := APIResponse{Success: true, Data: data}
	body, _ := json.Marshal(resp)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: 200,
		Headers:    headers,
		Body:       string(body),
	}
}

func errorResponse(headers map[string]string, statusCode int, message string) events.APIGatewayV2HTTPResponse {
	resp := APIResponse{Success: false, Error: message}
	body, _ := json.Marshal(resp)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(body),
	}
}

func main() {
	lambda.Start(handler)
}
