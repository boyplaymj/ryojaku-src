package main

// [B1-c2c] 建立 venue 的端點（正典 PLAYER_APP_REDESIGN.md §5.3）。
//
// 這支存在的理由是正典 §5.3 那三條接線驗收。三條的**決策部分**都抽成了純函式，
// 因為 DDB 那一層在這裡測不到 —— 而測不到的授權等於沒有。
//
// 🔴 界線寫在最前面，免得被引用成別的東西：PutItem 會不會真的寫進去、
// ConditionExpression 會不會擋下重複的 venueId、authorizer 有沒有正確設定，
// **這裡一條都驗不到**。這些測試能保證的是：身分取自 authorizer 而不是 body、
// 回應一定經過單一出口、以及出口有沒有做 ResolveIsDojo。

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/google/uuid"
)

type Response struct {
	Success bool              `json:"success"`
	Data    *shared.VenueView `json:"data,omitempty"`
	Error   string            `json:"error,omitempty"`
}

var dynamoClient *dynamodb.Client

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Unable to load SDK config: %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
}

func corsHeaders() map[string]string {
	return map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}
}

// callerUserID 是正典 §5.3 第 ③ 條的一半：身分**只**取自 authorizer。
//
// 🔴 抽成函式是為了讓它有尺。web_create_game 的註解記著同一個坑（S5-C）：
// 那支原本讀 query param 的 userId，於是登入者帶 ?userId=<他人> 就能用別人的
// 身分與點數開團。這裡的對應失效模式是「用別人的身分建場地」——
// 而建出來的場地 ownerId 是別人，那個人就成了「自己家地址」的合法查看者之一。
func callerUserID(request events.APIGatewayProxyRequest) string {
	return shared.AuthorizerUserID(request)
}

// venueResponsePayload 是**所有**回應的單一出口（正典 §5.3 第 ② 條）。
//
// 🔴 不要在別處組回應。IsDojo 不落地，所以從 DDB 讀出來的 Venue 它一定是 false；
// 而「忘了呼叫 ResolveIsDojo」的後果是徽章不亮 —— fail-closed，但也代表
// **漏掉沒有徵兆**。單一出口讓「有沒有做」變成一個可以打的點。
func venueResponsePayload(v *shared.Venue, ev shared.AddressEvidence, nowUnix int64) *shared.VenueView {
	if v == nil {
		return nil
	}
	v.ResolveIsDojo(nowUnix)
	return shared.NewVenueView(v, ev)
}

// errVenueNotSelfServe 是 [B5-a] 自助路徑的第五條擋門訊息。
//
// 🔴 與 shared 的四條驗證訊息**不同**，而且刻意不放進 shared 的 Validate()：
// event 仍然是合法 type（將來會有官方建立的路徑），不合法的是「玩家自己建它」。
// 判準只有一份（shared.IsSelfServeVenueType）；這裡只是把它接到 HTTP 上。
const errVenueNotSelfServe = "活動場由官方建立，不開放自助登錄"

// selfServeGate 在 Validate() 通過**之後**再判一次：這種 type 玩家可不可以自己建。
// 回空字串＝放行。抽成函式是為了讓「hall／home 放行、event 擋下」兩個方向都有尺，
// 而不必在測試裡打到 DDB。
func selfServeGate(venueType string) string {
	if shared.IsSelfServeVenueType(venueType) {
		return ""
	}
	return errVenueNotSelfServe
}

func respond(status int, body Response) (events.APIGatewayProxyResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		// 序列化失敗時不要回傳原始物件的任何片段 —— 那可能含 exactAddress。
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    corsHeaders(),
			Body:       `{"success":false,"error":"internal"}`,
		}, nil
	}
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: corsHeaders(), Body: string(b)}, nil
}

// validationStatus 把驗證錯誤對到 HTTP 狀態碼。
// 未知的錯誤一律 500 而不是 400：把沒想到的情況說成「你的輸入不對」會讓人一直重試。
func validationStatus(err error) int {
	switch {
	case err == nil:
		return http.StatusOK
	case errors.Is(err, shared.ErrVenueTypeInvalid),
		errors.Is(err, shared.ErrVenueNameRequired),
		errors.Is(err, shared.ErrVenueLatLngRange),
		errors.Is(err, shared.ErrVenueHomeNeedAddr):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if request.HTTPMethod == http.MethodOptions {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: corsHeaders(), Body: ""}, nil
	}

	userID := callerUserID(request)
	if userID == "" {
		return respond(http.StatusUnauthorized, Response{Error: "未登入"})
	}

	// 🔴 窄 DTO（正典 §5.3 第 ① 條）：絕不 decode 進 shared.Venue。
	var req shared.CreateVenueRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Error: "請求格式錯誤"})
	}
	if err := req.Validate(); err != nil {
		return respond(validationStatus(err), Response{Error: err.Error()})
	}
	// 🔴 [B5-a] 自助路徑只收 hall／home。event 是官方建的（§5.1）：它 status 直接
	// active、進公開列表、地址對所有登入者公開 ⇒ 讓玩家自己建等於免審公開一個地址。
	if msg := selfServeGate(req.Type); msg != "" {
		return respond(http.StatusBadRequest, Response{Error: msg})
	}

	now := time.Now().Unix()
	// [B5-a] rand.Float64 是自建場座標位移的隨機源（shared.BlurredApproxLocation）。
	v := shared.NewVenueFromCreateRequest(&req, "V_"+uuid.NewString(), userID, now, rand.Float64)

	item, err := attributevalue.MarshalMap(v)
	if err != nil {
		log.Printf("marshal venue failed: %v", err)
		return respond(http.StatusInternalServerError, Response{Error: "internal"})
	}
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(shared.VenuesTableName()),
		Item:      item,
		// venueId 是 uuid，撞號機率可忽略，但條件寫上去的成本是零，
		// 而少了它的話撞號會靜靜覆蓋掉別人的場地。
		ConditionExpression: aws.String("attribute_not_exists(venueId)"),
	})
	if err != nil {
		log.Printf("put venue failed: %v", err)
		return respond(http.StatusInternalServerError, Response{Error: "建立失敗"})
	}

	// 建立者就是 owner ⇒ 一定拿得到自己的精確地址（CanSeeExactAddress 規則 3）。
	ev := shared.AddressEvidence{CallerUserID: userID}
	return respond(http.StatusOK, Response{Success: true, Data: venueResponsePayload(v, ev, now)})
}

func main() {
	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") == "" && os.Getenv("LOCAL_SMOKE") != "" {
		log.Println("local smoke mode; not starting lambda")
		return
	}
	lambda.Start(handler)
}
