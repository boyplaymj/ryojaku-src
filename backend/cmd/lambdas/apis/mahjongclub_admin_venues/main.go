package main

// [B1-f2] venue 審核端點（後台）。
//
// 這支是選項 B 的**前提**：hall 建立後是 pending，非 owner 拿不到它的地址
// ⇒ 沒有這支，館方付了錢而功能是壞的，而且他自己看得到地址所以不會發現。
//
// 🔴 界線：決策層在 review.go，完全不碰 I/O、有完整測試。
// 這個檔驗不到 —— DDB 真的寫進去沒有、ConditionExpression 有沒有擋下併發、
// admin token 驗證對不對。那些要真的環境。

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"mahjongclub-backend/cmd/lambdas/adminrole"
	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

var (
	dynamoClient *dynamodb.Client
	jwtSecret    []byte
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Unable to load SDK config: %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)

	jwtSecret = []byte(os.Getenv("ADMIN_JWT_SECRET"))
	if len(jwtSecret) == 0 {
		if os.Getenv("ALLOW_DEV_JWT_SECRET") == "true" {
			jwtSecret = []byte("dev_only_insecure_secret_do_not_use_in_prod")
		} else {
			panic("ADMIN_JWT_SECRET not configured — refusing empty admin JWT secret (AUTH_SYSTEM_DESIGN §6.1)")
		}
	}
}

func headers() map[string]string {
	return map[string]string{
		"Content-Type":                 "application/json",
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Headers": "Content-Type,Authorization",
		"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	}
}

func validateToken(authHeader string) (jwt.MapClaims, error) {
	if authHeader == "" {
		return nil, fmt.Errorf("missing token")
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return nil, fmt.Errorf("invalid header format")
	}
	token, err := jwt.Parse(parts[1], func(*jwt.Token) (interface{}, error) { return jwtSecret, nil })
	if err != nil || !token.Valid {
		return nil, err
	}
	if claims, ok := token.Claims.(jwt.MapClaims); ok {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid claims")
}

// adminVenueView 是**後台專用**的形狀：把 exactAddress 明確加回來。
//
// 🔴 為什麼需要它（做前端時才發現，B1-f2 已經提交之後）：
// shared.Venue.ExactAddress 標 `json:"-"`，那是對**玩家端**的 fail-closed 預設。
// 但後台審核麻將館時，「地址是不是亂填的」正是判斷它是不是真店的主要依據 ——
// 沒有地址的審核頁，審核者只能看店名點核准，那道閘就退化成蓋章。
// 實測過：直接 marshal []*shared.Venue，回應裡完全沒有 exactAddress。
//
// ⚠️ 這**不是**把 json:"-" 拿掉。玩家端那條路徑完全沒動 ——
// 這裡是一條**已經過 adminrole.Allows** 的獨立路徑，在它自己的型別上明確加回來。
// 差別在於：拿掉 tag 是全域放行，這樣做是逐路徑授權。
type adminVenueView struct {
	shared.Venue
	// ExactAddress 遮蔽嵌入的那個（嵌入的是 json:"-"，所以不會有兩個鍵）。
	ExactAddress string `json:"exactAddress"`
}

// newAdminVenueView 是後台回應的單一出口（同兩支玩家端端點的規矩）。
func newAdminVenueView(v *shared.Venue, nowUnix int64) adminVenueView {
	if v == nil {
		return adminVenueView{}
	}
	v.ResolveIsDojo(nowUnix)
	return adminVenueView{Venue: *v, ExactAddress: v.ExactAddress}
}

type listResponse struct {
	Success bool             `json:"success"`
	Venues  []adminVenueView `json:"venues"`
	Error   string           `json:"error,omitempty"`
}

type reviewResponse struct {
	Success bool   `json:"success"`
	Status  string `json:"status,omitempty"`
	Error   string `json:"error,omitempty"`
}

func respond(status int, body interface{}) (events.APIGatewayProxyResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Headers: headers(),
			Body: `{"success":false,"error":"internal"}`}, nil
	}
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: headers(), Body: string(b)}, nil
}

// listByStatus 列出某個狀態的 venue。
//
// ⚠️ 用 Scan ＋ FilterExpression：venue 表沒有 GSI（§12 記了判準：
// 筆數 > 500 或單次 Scan > 20 RCU 時才回來加）。後台用量本來就低。
// ⚠️ FilterExpression 是**取回之後才篩**，所以計費看的是掃過的量不是回傳的量。
func listByStatus(ctx context.Context, status string) ([]adminVenueView, error) {
	out, err := dynamoClient.Scan(ctx, &dynamodb.ScanInput{
		TableName:                aws.String(shared.VenuesTableName()),
		FilterExpression:         aws.String("#s = :s"),
		ExpressionAttributeNames: map[string]string{"#s": "status"}, // status 是 DDB 保留字
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":s": &types.AttributeValueMemberS{Value: status},
		},
	})
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	venues := make([]adminVenueView, 0, len(out.Items))
	for _, item := range out.Items {
		var v shared.Venue
		if err := attributevalue.UnmarshalMap(item, &v); err != nil {
			log.Printf("unmarshal venue failed: %v", err)
			continue
		}
		// newAdminVenueView 裡會 ResolveIsDojo（isDojo 不落地，後台要看當下值）。
		venues = append(venues, newAdminVenueView(&v, now))
	}
	return venues, nil
}

// applyReview 把審核結果寫回去。
//
// 🔴 ConditionExpression 釘住「當前必須還是 pending」：後台兩個人同時審同一間店時，
// 第二個人的寫入會被擋下，而不是靜靜覆蓋第一個人的決定。
// 少了它，「approve 後又被 reject」會發生而且沒有任何徵兆。
func applyReview(ctx context.Context, venueID, target string, nowUnix int64) error {
	_, err := dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                aws.String(shared.VenuesTableName()),
		Key:                      map[string]types.AttributeValue{"venueId": &types.AttributeValueMemberS{Value: venueID}},
		UpdateExpression:         aws.String("SET #s = :new, updatedAt = :now"),
		ConditionExpression:      aws.String("attribute_exists(venueId) AND #s = :pending"),
		ExpressionAttributeNames: map[string]string{"#s": "status"},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":new":     &types.AttributeValueMemberS{Value: target},
			":pending": &types.AttributeValueMemberS{Value: shared.VenueStatusPending},
			":now":     &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", nowUnix)},
		},
	})
	return err
}

func getVenue(ctx context.Context, venueID string) (*shared.Venue, error) {
	out, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(shared.VenuesTableName()),
		Key:            map[string]types.AttributeValue{"venueId": &types.AttributeValueMemberS{Value: venueID}},
		ConsistentRead: aws.Bool(true), // 審核是不可逆的，不要對著陳舊的狀態做決定
	})
	if err != nil {
		return nil, err
	}
	if len(out.Item) == 0 {
		return nil, nil
	}
	var v shared.Venue
	if err := attributevalue.UnmarshalMap(out.Item, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if request.HTTPMethod == http.MethodOptions {
		return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers()}, nil
	}

	claims, err := validateToken(request.Headers["Authorization"])
	if err != nil {
		claims, err = validateToken(request.Headers["authorization"])
	}
	if err != nil {
		return respond(http.StatusUnauthorized, reviewResponse{Error: "Unauthorized"})
	}
	if !adminrole.Allows(claims, adminrole.SuperAdmin, adminrole.Admin) {
		return respond(http.StatusForbidden, reviewResponse{Error: "Forbidden"})
	}
	adminID := adminrole.SubjectOf(claims)

	if request.HTTPMethod == http.MethodGet {
		status := request.QueryStringParameters["status"]
		if status == "" {
			status = shared.VenueStatusPending
		}
		venues, err := listByStatus(ctx, status)
		if err != nil {
			log.Printf("list venues failed: %v", err)
			return respond(http.StatusInternalServerError, listResponse{Error: "查詢失敗"})
		}
		return respond(http.StatusOK, listResponse{Success: true, Venues: venues})
	}

	var req ReviewRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, reviewResponse{Error: "請求格式錯誤"})
	}
	if req.VenueID == "" {
		return respond(http.StatusBadRequest, reviewResponse{Error: ErrNoVenueID.Error()})
	}

	v, err := getVenue(ctx, req.VenueID)
	if err != nil {
		log.Printf("get venue failed: %v", err)
		return respond(http.StatusInternalServerError, reviewResponse{Error: "查詢失敗"})
	}
	if v == nil {
		return respond(http.StatusNotFound, reviewResponse{Error: "找不到這個場地"})
	}

	target, err := decideReviewOutcome(req.Action, v.Status)
	if err != nil {
		return respond(http.StatusBadRequest, reviewResponse{Error: err.Error()})
	}

	if err := applyReview(ctx, req.VenueID, target, time.Now().Unix()); err != nil {
		// ConditionalCheckFailed 代表狀態在我們讀完之後被改了（併發）。
		log.Printf("apply review failed venue=%s: %v", req.VenueID, err)
		return respond(http.StatusConflict, reviewResponse{Error: "狀態已被其他人改變，請重新整理"})
	}

	// 稽核軌跡：審核是不可逆的，誰在什麼時候把哪一間改成什麼一定要留。
	log.Printf("[venue-review] admin=%s venue=%s %s->%s note=%q",
		adminID, req.VenueID, v.Status, target, req.Note)

	return respond(http.StatusOK, reviewResponse{Success: true, Status: target})
}

func main() {
	lambda.Start(handler)
}
