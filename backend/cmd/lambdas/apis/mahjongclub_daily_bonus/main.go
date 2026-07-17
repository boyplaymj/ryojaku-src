package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
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

type DailyClaim struct {
	UserID          string `dynamodbav:"userID"`
	ClaimDate       string `dynamodbav:"claimDate"`
	Points          int    `dynamodbav:"points"`
	ConsecutiveDays int    `dynamodbav:"consecutiveDays"`
	ClaimedAt       string `dynamodbav:"claimedAt"`
}

type ActivityConfig struct {
	InfoKey   string `dynamodbav:"info_key"`
	InfoValue string `dynamodbav:"info_value"`
}

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{StatusCode: 200, Headers: headers, Body: ""}, nil
	}

	userID := request.QueryStringParameters["userId"]
	if userID == "" {
		return errorResponse(headers, http.StatusBadRequest, "Missing userId")
	}

	// 1. Get accurate Taipei time
	loc, _ := time.LoadLocation("Asia/Taipei")
	now := time.Now().In(loc)
	todayStr := now.Format("2006-01-02")
	yesterdayStr := now.AddDate(0, 0, -1).Format("2006-01-02")

	// 2. Fetch Configs
	basePoints, streakBonus, err := getRewardsConfig(ctx)
	if err != nil {
		log.Printf("Error fetching config: %v", err)
		// Fallback to defaults
		basePoints = 10
		streakBonus = 50
	}

	// 3. Check Yesterday's Claim for streak
	prevClaim, err := getClaimRecord(ctx, userID, yesterdayStr)
	if err != nil {
		log.Printf("Error checking yesterday claim: %v", err)
	}

	consecutiveDays := 1
	if prevClaim != nil {
		consecutiveDays = prevClaim.ConsecutiveDays + 1
		if consecutiveDays > 7 {
			consecutiveDays = 1 // Reset cycle of 7
		}
	}

	// 4. Calculate total reward
	totalReward := basePoints
	isStreakBonus := false
	if consecutiveDays == 7 {
		totalReward += streakBonus
		isStreakBonus = true
	}

	// 5. Atomic Claim Transaction
	claimRecord := DailyClaim{
		UserID:          userID,
		ClaimDate:       todayStr,
		Points:          totalReward,
		ConsecutiveDays: consecutiveDays,
		ClaimedAt:       now.Format(time.RFC3339),
	}

	err = executeClaimTransaction(ctx, userID, claimRecord, totalReward)
	if err != nil {
		log.Printf("Transaction error for user %s: %v", userID, err)
		// Check if it's because already claimed today
		return errorResponse(headers, http.StatusConflict, "You have already claimed your bonus today")
	}

	// 5.5 Record Shadow Point Log
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
			log.Printf("[DailyBonus] Failed to fetch balance for user %s: %v", userID, err)
			return
		}

		var user shared.User
		attributevalue.UnmarshalMap(res.Item, &user)

		shared.RecordPointChangeShadow(logCtx, dynamoClient, tablePrefix, userID, totalReward, shared.PointTypeCredit, user.Points-totalReward, user.Points, "每日簽到獎勵", "daily_bonus", nil)
	}()

	return successResponse(headers, map[string]interface{}{
		"pointsEarned":    totalReward,
		"consecutiveDays": consecutiveDays,
		"isStreakBonus":   isStreakBonus,
		"today":           todayStr,
	})
}

func getRewardsConfig(ctx context.Context) (int, int, error) {
	tableName := tablePrefix + "AdminConfigs"

	// Default values
	base := 10
	bonus := 50

	// Fetch base
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:DailyBonusBase"},
		},
	})
	if err == nil && result.Item != nil {
		var config ActivityConfig
		attributevalue.UnmarshalMap(result.Item, &config)
		if v, e := strconv.Atoi(config.InfoValue); e == nil {
			base = v
		}
	}

	// Fetch bonus
	result, err = dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"info_key": &types.AttributeValueMemberS{Value: "Activity:DailyBonusStreak"},
		},
	})
	if err == nil && result.Item != nil {
		var config ActivityConfig
		attributevalue.UnmarshalMap(result.Item, &config)
		if v, e := strconv.Atoi(config.InfoValue); e == nil {
			bonus = v
		}
	}

	return base, bonus, nil
}

func getClaimRecord(ctx context.Context, userID, date string) (*DailyClaim, error) {
	tableName := tablePrefix + "DailyClaims"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"userID":    &types.AttributeValueMemberS{Value: userID},
			"claimDate": &types.AttributeValueMemberS{Value: date},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, nil
	}
	var claim DailyClaim
	err = attributevalue.UnmarshalMap(result.Item, &claim)
	return &claim, err
}

func executeClaimTransaction(ctx context.Context, userID string, record DailyClaim, points int) error {
	recordMap, err := attributevalue.MarshalMap(record)
	if err != nil {
		return err
	}

	_, err = dynamoClient.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Put: &types.Put{
					TableName:           aws.String(tablePrefix + "DailyClaims"),
					Item:                recordMap,
					ConditionExpression: aws.String("attribute_not_exists(userID)"), // Since PK+SK combo shouldn't exist
				},
			},
			{
				Update: &types.Update{
					TableName: aws.String(tablePrefix + "Users"),
					Key: map[string]types.AttributeValue{
						"userId": &types.AttributeValueMemberS{Value: userID},
					},
					UpdateExpression: aws.String("ADD points :p"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":p": &types.AttributeValueMemberN{Value: strconv.Itoa(points)},
					},
				},
			},
		},
	})
	return err
}

func successResponse(headers map[string]string, data interface{}) (events.APIGatewayV2HTTPResponse, error) {
	body, _ := json.Marshal(Response{Success: true, Data: data})
	return events.APIGatewayV2HTTPResponse{StatusCode: 200, Headers: headers, Body: string(body)}, nil
}

func errorResponse(headers map[string]string, statusCode int, message string) (events.APIGatewayV2HTTPResponse, error) {
	body, _ := json.Marshal(Response{Success: false, Error: message})
	return events.APIGatewayV2HTTPResponse{StatusCode: statusCode, Headers: headers, Body: string(body)}, nil
}

func main() {
	lambda.Start(handler)
}
