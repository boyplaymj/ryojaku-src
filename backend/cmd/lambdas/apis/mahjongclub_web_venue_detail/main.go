package main

// [B1-c2c-2] 查詢單一 venue 的端點。**這支是安全承重的** ——
// 它決定誰拿得到自建場的精確地址（正典 §5.1 的硬規則）。
//
// 正典 §5.3 第 ③ 條的兩小條落在這裡：
//   - GameVenueID 必須從 **game 記錄**讀，不可以從請求 body 照抄
//   - Registration 必須依 **(caller, gameId)** 查，不可以信任 body 說「這是我的報名」
//
// 🔴 界線：這裡驗不到 DDB 真的回什麼、GSI 有沒有延遲、authorizer 設定對不對。
// 驗得到的是「evidence 的每一格是從哪裡來的」—— 而那正是這兩小條在講的事。

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// VenueDetailRequest 是查詢的窄 DTO。
//
// 🔴 它**只有兩個欄位**。特別注意這裡沒有 userId（身分取自 authorizer）、
// 也沒有任何 evidence 欄位（gameVenueId／registrationStatus）——
// 那些都是伺服器自己去查的事實，讓前端送就等於讓前端自己核發通行證。
type VenueDetailRequest struct {
	VenueID string `json:"venueId"`
	// GameID 是「我透過哪一局要這個地址」。它**可以**由前端指定 ——
	// 因為後面每一項都會拿它去查真來源再交叉比對，前端指定別人的局只會拿不到東西。
	GameID string `json:"gameId,omitempty"`
}

// venueDetailForbiddenFields 是這個 DTO 上絕對不可以出現的欄位。
// 測試用反射掃它（機械掃描，不是手打比對）。
var venueDetailForbiddenFields = []string{
	"userId", "ownerId", "callerUserId",
	"gameVenueId", "registration", "registrationStatus",
	"exactAddress", "isDojo",
}

type Response struct {
	Success bool                    `json:"success"`
	Data    *shared.VenueDetailView `json:"data,omitempty"`
	Error   string                  `json:"error,omitempty"`
}

// evidenceSource 是 evidence 的**真來源**。抽成介面只有一個目的：
// 讓測試驗得到「handler 是拿什麼參數去查的」。
//
// ⚠️ 假件不可以自己補齊 handler 漏傳的參數 —— 所以下面的假件會把收到的參數
// 原樣記下來讓測試斷言（`reference_fake_deps_supply_the_missing_wiring` 那個坑）。
// fullSource 是 handler 需要的全部查詢能力。handleDetail 吃它而不是吃 *dynamodb.Client，
// 這樣測試能注入 spy，驗得到「handler 是拿什麼參數去查的」——
// 而那正是正典 §5.3 第 ③ 條在講的事。少了這個縫，那兩小條就只能靠讀程式碼確認。
type fullSource interface {
	evidenceSource
	GetVenue(ctx context.Context, venueID string) (*shared.Venue, error)
}

type evidenceSource interface {
	// GameVenueID 回傳 gameID 那一局**記錄上**綁的 venueId。
	GameVenueID(ctx context.Context, gameID string) (string, error)
	// FindRegistration 依 (gameID, userID) 找那筆報名；找不到回 (nil, nil)。
	FindRegistration(ctx context.Context, gameID, userID string) (*shared.Registration, error)
}

// buildAddressEvidence 把 evidence 的每一格從真來源組起來。
//
// 🔴 fail-closed 的兩個方向都要對：
//   - 查詢**失敗**時，那一格留空 ⇒ CanSeeExactAddress 會因為「對不上」而拒絕。
//     不可以因為查不到就跳過比對 —— 那會把資料層抖動變成放行。
//   - gameID 是空的（呼叫者沒說走哪一局）時根本不去查，evidence 就是空的。
//     公開場地（hall／event）不需要 evidence，那條路徑在授權函式裡另外成立。
func buildAddressEvidence(ctx context.Context, src evidenceSource, callerUserID, gameID string) shared.AddressEvidence {
	ev := shared.AddressEvidence{CallerUserID: callerUserID, GameID: gameID}
	if src == nil || gameID == "" || callerUserID == "" {
		return ev
	}
	if vid, err := src.GameVenueID(ctx, gameID); err != nil {
		log.Printf("evidence: 查 game 的 venueId 失敗 game=%s: %v", gameID, err)
	} else {
		ev.GameVenueID = vid
	}
	// 🔴 用 callerUserID 查，不是用 body 裡的任何東西。
	if reg, err := src.FindRegistration(ctx, gameID, callerUserID); err != nil {
		log.Printf("evidence: 查報名失敗 game=%s: %v", gameID, err)
	} else {
		ev.Registration = reg
	}
	return ev
}

// addressAuditLine 組出地址授權的稽核行。
//
// 🔴 **訂正（收 Codex 覆驗，2026-09-09）**：這裡原本寫「簽章本身就是守衛，
// 呼叫端沒辦法順手把 venueId／地址／userId 傳進來」—— **那句話是錯的**。
// 兩個參數都是 `string`，`addressAuditLine(v.ExactAddress, v.Type)` 照樣編譯，
// 而那條「只吃 2 個 string 參數」的反射測試照樣綠（實測 FAIL=0）。
// **參數個數對「傳錯東西」零鑑別力。**
//
// ⇒ 真正承擔「不記敏感值」的是**值域白名單**：兩個欄位都必須落在已知集合裡，
// 否則記成 `unknown`。所以就算有人把地址傳進來，寫出去的也只是 `unknown`。
// 順帶擋掉日誌注入 —— 含換行的值不在白名單裡。
//
// ⚠️ 代價：新增 reason 常數而忘了加進 shared 的 map，這裡會把它記成 `unknown`
//
//	（fail-safe 方向，但會失去資訊）⇒ shared 那邊有一條測試掃常數定義比對大小。
func addressAuditLine(reason, venueType string) string {
	if !shared.IsKnownAddressReason(reason) {
		reason = "unknown"
	}
	if !shared.IsValidVenueType(venueType) {
		venueType = "unknown"
	}
	return fmt.Sprintf("[venue-address] reason=%s type=%s", reason, venueType)
}

// venueResponsePayload 是回應的單一出口（正典 §5.3 第 ② 條）。
// 與 create 端點那支同一個形狀 —— 兩支都必須經過它。
func venueResponsePayload(v *shared.Venue, ev shared.AddressEvidence, nowUnix int64) *shared.VenueDetailView {
	if v == nil {
		return nil
	}
	// [B5-b] VenueDetailView 是白名單型別，不嵌入 Venue：路人查自建場拿不到
	// phone／ownerId（前身 VenueView 會照出）。IsDojo 由建構子用 nowUnix 現算。
	return shared.NewVenueDetailView(v, ev, nowUnix)
}

// --- DDB 實作 ---

var dynamoClient *dynamodb.Client

type ddbSource struct{ c *dynamodb.Client }

func (s ddbSource) GameVenueID(ctx context.Context, gameID string) (string, error) {
	out, err := s.c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(shared.TablePrefix() + "Games"),
		Key:                  map[string]types.AttributeValue{"gameId": &types.AttributeValueMemberS{Value: gameID}},
		ProjectionExpression: aws.String("venueId"),
		// 強一致讀：剛把局綁到 venue 就查，最終一致讀可能還看不到，
		// 而那會讓剛核准的玩家拿不到地址。這是單筆 GetItem，成本差異可忽略。
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return "", err
	}
	if v, ok := out.Item["venueId"].(*types.AttributeValueMemberS); ok {
		return v.Value, nil
	}
	return "", nil
}

func (s ddbSource) FindRegistration(ctx context.Context, gameID, userID string) (*shared.Registration, error) {
	// ⚠️ 走 GSI gameId-createdAt-index（與 web_game_detail 同一條路）。
	// GSI 在 DynamoDB **不支援強一致讀** ⇒ 剛寫進去的報名可能查不到。
	// 這裡的方向是 fail-closed（拿不到地址），可接受；但不要把它讀成「這人沒報名」。
	out, err := s.c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(shared.TablePrefix() + "Registrations"),
		IndexName:              aws.String("gameId-createdAt-index"),
		KeyConditionExpression: aws.String("gameId = :g"),
		FilterExpression:       aws.String("userId = :u"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":g": &types.AttributeValueMemberS{Value: gameID},
			":u": &types.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	for _, item := range out.Items {
		var reg shared.Registration
		if err := attributevalue.UnmarshalMap(item, &reg); err != nil {
			continue
		}
		// 再比一次：FilterExpression 已經篩過，但這條讓「篩選寫錯」不會直接變成放行。
		if reg.UserID == userID && reg.GameID == gameID {
			return &reg, nil
		}
	}
	return nil, nil
}

func (s ddbSource) GetVenue(ctx context.Context, venueID string) (*shared.Venue, error) {
	out, err := s.c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(shared.VenuesTableName()),
		Key:       map[string]types.AttributeValue{"venueId": &types.AttributeValueMemberS{Value: venueID}},
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

func respond(status int, body Response) (events.APIGatewayProxyResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError, Headers: corsHeaders(),
			Body: `{"success":false,"error":"internal"}`,
		}, nil
	}
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: corsHeaders(), Body: string(b)}, nil
}

var errNoVenueID = errors.New("venueId 不可為空")

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if request.HTTPMethod == http.MethodOptions {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: corsHeaders()}, nil
	}

	// 🔴 身分只取自 authorizer（正典 §5.3 第 ③ 條）。
	userID := shared.AuthorizerUserID(request)

	var req VenueDetailRequest
	if request.Body != "" {
		if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
			return respond(http.StatusBadRequest, Response{Error: "請求格式錯誤"})
		}
	}
	if req.VenueID == "" {
		req.VenueID = request.QueryStringParameters["venueId"]
	}
	if req.GameID == "" {
		req.GameID = request.QueryStringParameters["gameId"]
	}
	if req.VenueID == "" {
		return respond(http.StatusBadRequest, Response{Error: errNoVenueID.Error()})
	}

	return handleDetail(ctx, ddbSource{c: dynamoClient}, userID, req, time.Now().Unix())
}

// handleDetail 是 handler 扣掉 I/O 建構之後的全部邏輯。
//
// 🔴 callerUserID 是**參數**，由 handler 從 authorizer 取好再傳進來 ——
// 它拿不到 request，所以「不小心讀 body 的 userId」在這個函式裡寫不出來。
func handleDetail(ctx context.Context, src fullSource, callerUserID string, req VenueDetailRequest, nowUnix int64) (events.APIGatewayProxyResponse, error) {
	v, err := src.GetVenue(ctx, req.VenueID)
	if err != nil {
		log.Printf("get venue failed: %v", err)
		return respond(http.StatusInternalServerError, Response{Error: "查詢失敗"})
	}
	if v == nil {
		return respond(http.StatusNotFound, Response{Error: "找不到這個場地"})
	}
	ev := buildAddressEvidence(ctx, src, callerUserID, req.GameID)
	view := venueResponsePayload(v, ev, nowUnix)

	// 🔴 記下**是哪一條規則**決定的（正典 §13 的盲區，2026-09-09 補）。
	//
	// 補它的理由不是「多埋一點總是好的」，是一次線上驗證直接撞到：
	// 授權矩陣八格全過，而我**分不出** N4（拿另一局當通行證）是被
	// `deny:game-not-at-venue` 擋的，還是被上一條規則順便擋掉的 ——
	// 「被正確的規則擋下」與「被別條順便擋下」在回應上逐字相同，
	// 而後者在那條規則被改壞時就會漏。
	//
	// 更長遠的理由（§13）：規則太嚴時玩家只看到「沒有地址」，不會回報，
	// 也分不出是「還沒核准」還是「我們的規則寫錯」⇒
	// **「正確擋下攻擊者」與「誤擋已核准的玩家」在線上長得一模一樣**，
	// 而後者是 fail-closed 設計最可能的失敗形狀。
	//
	// ⚠️ 只記 reason 與 venue type，**不記 venueId、不記地址、不記 userId**
	//    （§13 明訂）——「誰在看哪一個場地」是行為資料，不是排錯需要的東西。
	log.Print(addressAuditLine(view.AddressReason, v.Type))

	return respond(http.StatusOK, Response{Success: true, Data: view})
}

func main() {
	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") == "" && os.Getenv("LOCAL_SMOKE") != "" {
		log.Println("local smoke mode; not starting lambda")
		return
	}
	lambda.Start(handler)
}
