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

// ddbAPI 只列 handler 主線真的會呼叫的兩支。
// 抽成介面的唯一理由是**可注入** —— 見 main_v1_contract_test.go 檔頭的 M4:
// 在此之前「身分讀得到的時候不會被判 401」這條線沒有任何單元尺,
// 因為 handler 一旦走過 401 那道閘,下一步就是碰真表。
type ddbAPI interface {
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	TransactWriteItems(ctx context.Context, in *dynamodb.TransactWriteItemsInput, optFns ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error)
}

var (
	dynamoClient ddbAPI
	// 🔴 影子帳本那一步走 shared.RecordPointChangeShadow,它吃的是**具體**的
	// *dynamodb.Client(points.go:75)。把它改成介面會動到整個 backend 的呼叫端,
	// 是另一個決定 ⇒ 這裡另存一份具體 client。生產路徑上兩個變數指向同一顆;
	// 測試裡 recordShadowLog 會被整個換掉,所以碰不到這顆。
	shadowDB    *dynamodb.Client
	tablePrefix string
)

// nowFunc 是時鐘的接縫。理由不是為了好看:連續天數要拿「台北的昨天」當 key,
// 而測試若用真時鐘,跨午夜跑就會拿到差一天的 key ⇒ 那把尺會間歇假紅。
var nowFunc = time.Now

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}
	client := dynamodb.NewFromConfig(cfg)
	dynamoClient = client
	shadowDB = client
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

// 🔴 v1(APIGatewayProxy*) 而非 v2 —— 2026-09-10 由 HTTP_V2 改判 REST_V1 時一起轉。
// 光搬路由不夠,而失敗的樣子會誤導:v2 的回應結構多一個 `cookies` 欄位,
// REST proxy integration 只認 statusCode/headers/multiValueHeaders/body/isBase64Encoded,
// 多出來的欄位被判成 malformed ⇒ 回 **502**,而 Lambda 那邊 END 正常、零錯誤日誌。
// 「lambda 壞了」與「回應形狀不合 REST 的規矩」在 CloudWatch 上逐字相同。
// 請求端同樣要轉:RequestContext.HTTP.Method 與 AuthorizerUserIDV2 讀的都是 v2 專屬欄位,
// 餵 v1 事件時**靜靜取到零值** ⇒ 每個請求都會被判成未授權。
func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers, Body: ""}, nil
	}

	userID := shared.AuthorizerUserID(request)
	if userID == "" {
		return errorResponse(headers, http.StatusUnauthorized, "unauthorized")
	}

	// 1. Get accurate Taipei time
	loc, _ := time.LoadLocation("Asia/Taipei")
	now := nowFunc().In(loc)
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
	go recordShadowLog(userID, totalReward)

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

func successResponse(headers map[string]string, data interface{}) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: true, Data: data})
	return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers, Body: string(body)}, nil
}

func errorResponse(headers map[string]string, statusCode int, message string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: false, Error: message})
	return events.APIGatewayProxyResponse{StatusCode: statusCode, Headers: headers, Body: string(body)}, nil
}

// recordShadowLog 是上面「5.5 影子帳本」那一步。抽成變數是為了讓契約測試把它換掉 ——
// 它走的是具體 client(見 shadowDB 那段),留在 handler 裡的話,
// 一個「帶合法身分」的單元測試會在背景真的打到線上表。
//
// ⚠️ 代價要寫清楚:被換掉之後,下面這個函式本體在單元測試裡是**零覆蓋**的。
// 它在補這支測試之前也是零覆蓋(整支 handler 都沒有測試),所以不是退步 ——
// 但也**不可以**因為「契約測試全綠」就讀成這一段有尺。
var recordShadowLog = defaultRecordShadowLog

func defaultRecordShadowLog(userID string, totalReward int) {
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

	shared.RecordPointChangeShadow(logCtx, shadowDB, tablePrefix, userID, totalReward, shared.PointTypeCredit, user.Points-totalReward, user.Points, "每日簽到獎勵", "daily_bonus", nil)
}

func main() {
	lambda.Start(handler)
}
