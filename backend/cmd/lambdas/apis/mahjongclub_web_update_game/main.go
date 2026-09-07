// [A3-m] update-game —— 開局表單「第二段」的著陸點。
//
// §4.4：第一段（時間／地點／底台／人數）送出後就成立可招募，其餘（規則細項、
// 場地特色、玩家限制、封面圖）放第二段「補充設定」，**可跳過、可事後補**。
// 在這支之前後端**沒有任何 update／edit 端點** ⇒「可事後補」沒有著陸點。
//
// 🔴 這支刻意做成「只有一次條件式 UpdateItem，連 GetItem 都不做」：
//
//	① 先讀再寫的話，讀與寫之間那個空窗就是 A3-o1（accept 復活已取消的局）那一類缺陷的
//	   來源。這裡把「是不是主揪」「局還在不在」一起寫進 ConditionExpression，
//	   它們與寫入是同一個原子動作。
//	② 條件沒過時靠 ReturnValuesOnConditionCheckFailure=ALL_OLD 拿回那一瞬間的樣子，
//	   才說得出是「不是你的局」還是「局已取消」—— 兩者要給的使用者行動完全不同。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"sort"
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
		log.Fatalf("Unable to load SDK config: %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
}

// UpdateGameRequest 是第二段送上來的東西。
//
// 🔴 四個欄位都是 **指標**，因為「沒送這個欄位」與「送了一個空陣列」是兩件事：
// 前者是「這一項我不動」（第二段可以只補一半），後者是「把它清空」。
// 用 []string 的話 JSON 缺欄位會 unmarshal 成 nil，跟送 [] 完全一樣 ⇒
// 使用者刪光規則之後會**看起來像沒送**，那一項就永遠清不掉。
type UpdateGameRequest struct {
	GameID       string    `json:"gameId"`
	GameId       string    `json:"gameID"` // 兩種大小寫都收（與既有端點一致）
	Rules        *[]string `json:"rules,omitempty"`
	Features     *[]string `json:"features,omitempty"`
	Restrictions *[]string `json:"restrictions,omitempty"`
	Images       *[]string `json:"images,omitempty"`
}

type Response struct {
	Success bool        `json:"success"`
	Error   string      `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

const (
	msgNotHost      = "只有主揪可以修改團局"
	msgGameCancel   = "此團局已取消，無法修改"
	msgGameNotOpen  = "此團局目前無法修改"
	msgGameChanged  = "團局狀態已變動，請重新整理後再試"
	msgNothingToSet = "沒有任何可更新的欄位"
	msgMissingGame  = "Missing gameId parameter"
)

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	shared.RecordTokenUsageFromHeader(request, "web_update_game")

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: ""}, nil
	}

	// 身分一律取自 authorizer。本支是 REST_V1 ⇒ 用 AuthorizerUserID（不是 V2 那支）。
	// 刻意不留任何 query param／body 的 fallback：那正是 S2-B 那七支的漏洞形狀
	//（身分由呼叫端自稱 ⇒ 任何人都能代主揪改團局）。
	userID := shared.AuthorizerUserID(request)
	if userID == "" {
		return jsonResponse(headers, http.StatusUnauthorized, Response{Success: false, Error: "unauthorized"})
	}

	var req UpdateGameRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Failed to parse request body: %v", err)
		return jsonResponse(headers, http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"})
	}

	gameID := req.GameID
	if gameID == "" {
		gameID = req.GameId
	}
	if gameID == "" {
		return jsonResponse(headers, http.StatusBadRequest, Response{Success: false, Error: msgMissingGame})
	}

	setExpr, names, values := buildGameUpdate(req, time.Now().Format(time.RFC3339))
	if setExpr == "" {
		// 一個欄位都沒送。DynamoDB 對空的 UpdateExpression 是 ValidationException，
		// 而那會變成 500 —— 但這其實是呼叫端的問題，要講清楚。
		return jsonResponse(headers, http.StatusBadRequest, Response{Success: false, Error: msgNothingToSet})
	}

	names["#s"] = "status"
	values[":uid"] = &types.AttributeValueMemberS{Value: userID}
	values[":recruiting"] = &types.AttributeValueMemberS{Value: "recruiting"}
	values[":full"] = &types.AttributeValueMemberS{Value: "full"}

	tableName := tablePrefix + "Games"
	_, err := dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"gameId": &types.AttributeValueMemberS{Value: gameID},
		},
		UpdateExpression: aws.String(setExpr),
		// 🔴 三道合在一起，而且與寫入同一個原子動作：
		//    ① 這一列還在 ② 是你的局 ③ 局還開著（recruiting／full）。
		//    ③ 寫成**白名單**而不是「不是 cancelled」—— 後者對未來新增的狀態
		//    （closed／completed…）會自動放行，而放行的方向是「可以改」。
		ConditionExpression:                 aws.String("attribute_exists(gameId) AND hostUserId = :uid AND (#s = :recruiting OR #s = :full)"),
		ExpressionAttributeNames:            names,
		ExpressionAttributeValues:           values,
		ReturnValuesOnConditionCheckFailure: types.ReturnValuesOnConditionCheckFailureAllOld,
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			msg, status := decideUpdateConflict(ccf.Item, userID)
			log.Printf("Update rejected by condition: game=%s uid=%s msg=%s", gameID, userID, msg)
			return jsonResponse(headers, status, Response{Success: false, Error: msg})
		}
		log.Printf("Failed to update game %s: %v", gameID, err)
		return jsonResponse(headers, http.StatusInternalServerError, Response{Success: false, Error: "更新團局失敗"})
	}

	return jsonResponse(headers, http.StatusOK, Response{
		Success: true,
		Data:    map[string]interface{}{"message": "✅ 已更新團局"},
	})
}

// updatableFields 是第二段「補充設定」允許改的全部欄位，也是這支端點的白名單。
//
// 🔴 白名單，不是黑名單 —— 但要講準它擋在**第幾層**（一發突變照出我原本寫錯了）：
// 真正讓 `status`／`hostUserId`／`currentPlayers` 進不來的第一層是
// `UpdateGameRequest` 只有那四個欄位、`buildGameUpdate` 的 `provided` 也只列那四個；
// 這張表是第二層，管的是「這四個名字各自落到哪個屬性」。
// 兩層都要有尺：只驗第一層的話，日後有人加一筆 `"notes": "status"` 會全綠。
// key＝送上來的 JSON 欄位名；value＝它在 Games 這一列的**屬性路徑**。
// ⚠️ `features` 落在頂層 `venueFeatures`、`rules` 落在 `gameInfo.rules` ——
//
//	兩邊不同名是既有資料模型的事實（見 create_game 的 GameInfo 組法），不是筆誤。
var updatableFields = map[string]string{
	"rules":        "gameInfo.rules",
	"features":     "venueFeatures",
	"restrictions": "restrictions",
	"images":       "images",
}

// buildGameUpdate 依白名單組出 SET 子句。
//
// 回傳空字串代表「一個欄位都沒送」—— 呼叫端必須擋下來，不可以送出去。
// 名稱一律走 ExpressionAttributeNames（`#f0`／`#f1`…）：屬性名可能撞到 DynamoDB 保留字，
// 而撞到時的症狀是 ValidationException，跟寫錯欄位名長得一樣。
func buildGameUpdate(req UpdateGameRequest, now string) (string, map[string]string, map[string]types.AttributeValue) {
	names := map[string]string{}
	values := map[string]types.AttributeValue{}

	provided := map[string]*[]string{
		"rules":        req.Rules,
		"features":     req.Features,
		"restrictions": req.Restrictions,
		"images":       req.Images,
	}

	// 排序過才有決定性的輸出 —— map 的走訪順序在 Go 是隨機的，
	// 不排的話同一個輸入每次組出來的字串都不一樣，測試只能用集合比對（弱得多）。
	keys := make([]string, 0, len(provided))
	for k := range provided {
		if provided[k] != nil {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)

	setParts := []string{}
	for i, k := range keys {
		path, ok := updatableFields[k]
		if !ok {
			continue // 白名單以外的一律丟掉（目前不可能發生，但這行是那條規則本身）
		}
		namePath := expressionPath(path, i, names)
		valRef := ":f" + itoa(i)
		values[valRef] = stringListAV(*provided[k])
		setParts = append(setParts, namePath+" = "+valRef)
	}
	if len(setParts) == 0 {
		return "", names, values
	}

	values[":now"] = &types.AttributeValueMemberS{Value: now}
	expr := "SET " + joinComma(setParts) + ", updatedAt = :now"
	return expr, names, values
}

// expressionPath 把 `gameInfo.rules` 這種路徑翻成 `#f0_0.#f0_1`，並登記名稱。
// 巢狀路徑必須逐段換成 name placeholder —— 整串當成一個名字的話，
// DynamoDB 會把它當成一個**含點的屬性名**，於是寫出一個新欄位而不是改巢狀的那個。
func expressionPath(path string, idx int, names map[string]string) string {
	segs := splitDot(path)
	out := ""
	for i, seg := range segs {
		ref := "#f" + itoa(idx) + "_" + itoa(i)
		names[ref] = seg
		if i > 0 {
			out += "."
		}
		out += ref
	}
	return out
}

// decideUpdateConflict 依「被擋下來那一瞬間的團局」決定要說什麼、回幾號。
//
// 🔴 順序就是判準：先分「不是你的局」再分「局的狀態」。反過來的話，
// 別人的已取消團局會回「此團局已取消」—— 那等於對外確認了一個不屬於你的 gameId 存在。
func decideUpdateConflict(item map[string]types.AttributeValue, userID string) (string, int) {
	if item == nil {
		// ALL_OLD 沒回東西 ⇒ 多半是這一列根本不存在。猜一個具體理由比含糊更糟。
		return msgGameChanged, http.StatusBadRequest
	}
	// 🔴 兩個空字串不算相等。`itemString` 對「欄位缺失」與「值是空字串」都回 ""，
	// 而 userID 也可能是 ""（handler 之前會擋，但這支不可以依賴呼叫端擋得住）——
	// 少了前兩道，`hostUserId` 缺失的舊資料配上空 uid 就會被判成「你是主揪」。
	// 這是我自己的反控抓到的：第一版寫 `host != userID`，那條測試當場紅。
	host := itemString(item, "hostUserId")
	if host == "" || userID == "" || host != userID {
		return msgNotHost, http.StatusForbidden
	}
	switch itemString(item, "status") {
	case "cancelled":
		return msgGameCancel, http.StatusBadRequest
	case "recruiting", "full":
		// 是你的局、狀態也還開著 ⇒ 條件失敗的原因不在這三道裡（例如同時被取消了）。
		return msgGameChanged, http.StatusBadRequest
	}
	return msgGameNotOpen, http.StatusBadRequest
}

func itemString(item map[string]types.AttributeValue, key string) string {
	if av, ok := item[key].(*types.AttributeValueMemberS); ok {
		return av.Value
	}
	return ""
}

func stringListAV(in []string) types.AttributeValue {
	l := make([]types.AttributeValue, 0, len(in))
	for _, s := range in {
		l = append(l, &types.AttributeValueMemberS{Value: s})
	}
	return &types.AttributeValueMemberL{Value: l}
}

func splitDot(s string) []string {
	out := []string{}
	cur := ""
	for _, r := range s {
		if r == '.' {
			out = append(out, cur)
			cur = ""
			continue
		}
		cur += string(r)
	}
	return append(out, cur)
}

func joinComma(in []string) string {
	out := ""
	for i, s := range in {
		if i > 0 {
			out += ", "
		}
		out += s
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	b := []byte{}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func jsonResponse(headers map[string]string, status int, r Response) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(r)
	return events.APIGatewayProxyResponse{StatusCode: status, Headers: headers, Body: string(body)}, nil
}

func main() {
	lambda.Start(Handler)
}
