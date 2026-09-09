package main

// [B1-c2c-3] 公開場地列表端點。
//
// 🔴 這支是 auth:"public"，**刻意沒有 authorizer** —— 它存在的理由正是讓
// 「未登入瀏覽地圖」不必去放寬 venue-detail 的閘門（正典 §5.3）。
// 它回的是 shared.PublicVenueCard，一個**白名單型別**，結構上不含 exactAddress。
//
// 🔴 界線：決策層在 list.go（掃描上限、分頁終止條件、篩選）有完整測試。
// 這個檔驗不到 —— DDB Scan 真的回什麼、Limit 的實際計費、authorizer 沒掛對不對。

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
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

type Response struct {
	Success bool `json:"success"`
	*ListPage
	Error string `json:"error,omitempty"`
}

var dynamoClient *dynamodb.Client

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Unable to load SDK config: %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
}

func headers() map[string]string {
	return map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}
}

func respond(status int, body Response) (events.APIGatewayProxyResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError,
			Headers: headers(), Body: `{"success":false,"error":"internal"}`}, nil
	}
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: headers(), Body: string(b)}, nil
}

// toStringMap / toAVMap 在 DDB 的 AttributeValue 與可序列化的 map 之間轉換。
// venue 表的 key 只有 venueId（字串），所以這裡只處理字串 —— 若 key schema 變了，
// 這裡會靜靜漏掉新的 key 欄位，因此 buildListPage 的分頁測試釘的是 map 內容。
func toStringMap(av map[string]types.AttributeValue) map[string]string {
	if len(av) == 0 {
		return nil
	}
	m := make(map[string]string, len(av))
	for k, v := range av {
		if s, ok := v.(*types.AttributeValueMemberS); ok {
			m[k] = s.Value
		}
	}
	return m
}

func toAVMap(m map[string]string) map[string]types.AttributeValue {
	if len(m) == 0 {
		return nil
	}
	av := make(map[string]types.AttributeValue, len(m))
	for k, v := range m {
		av[k] = &types.AttributeValueMemberS{Value: v}
	}
	return av
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if request.HTTPMethod == http.MethodOptions {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers()}, nil
	}

	q := request.QueryStringParameters
	limit, _ := strconv.Atoi(q["limit"]) // 解析失敗 → 0 → capScanLimit 回預設值
	startKey, err := decodePageToken(q["nextToken"])
	if err != nil {
		return respond(http.StatusBadRequest, Response{Error: err.Error()})
	}

	out, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
		TableName:         aws.String(shared.VenuesTableName()),
		Limit:             aws.Int32(capScanLimit(limit)),
		ExclusiveStartKey: toAVMap(startKey),
	})
	if err != nil {
		log.Printf("scan venues failed: %v", err)
		return respond(http.StatusInternalServerError, Response{Error: "查詢失敗"})
	}

	venues := make([]shared.Venue, 0, len(out.Items))
	for _, item := range out.Items {
		var v shared.Venue
		if err := attributevalue.UnmarshalMap(item, &v); err != nil {
			log.Printf("unmarshal venue failed: %v", err)
			continue
		}
		venues = append(venues, v)
	}

	page := buildListPage(venues, toStringMap(out.LastEvaluatedKey), time.Now().Unix())
	return respond(http.StatusOK, Response{Success: true, ListPage: &page})
}

func main() { lambda.Start(handler) }
