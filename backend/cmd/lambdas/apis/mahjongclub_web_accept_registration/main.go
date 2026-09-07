package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/google/uuid"
)

var (
	dynamoClient  *dynamodb.Client
	tablePrefix   string
	encryptionKey string
	pushService   *shared.PushNotificationService
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
	encryptionKey = os.Getenv("ENCRYPTION_KEY")
	if encryptionKey == "" {
		log.Println("WARNING: ENCRYPTION_KEY not set")
	}

	var errPush error
	pushService, errPush = shared.NewPushNotificationService()
	if errPush != nil {
		log.Printf("Failed to initialize push notification service: %v", errPush)
	}
}

type AcceptRegistrationRequest struct {
	GameID         string `json:"gameID"`
	GameId         string `json:"gameId"` // Support both cases
	RegistrationID string `json:"registrationID"`
	RegistrationId string `json:"registrationId"` // Support both cases
}

type Response struct {
	Success bool        `json:"success"`
	Error   string      `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeaderV2(request, "web_accept_registration")

	log.Printf("Received request: %s %s", request.RequestContext.HTTP.Method, request.RequestContext.HTTP.Path)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// Get user ID - support both lineID (encrypted) and userId (APP_xxx) parameters
	var userID string
	var err error

	// 身分一律取自 authorizer（S5-C）。本支是 HTTP_V2，故用 AuthorizerUserIDV2
	// （讀 RequestContext.Authorizer.Lambda），與 REST 的 AuthorizerUserID 不同，別用錯。
	//   原本讀 query param 的 userId：登入者帶 ?userId=<團主> 即可代團主核准報名。
	//   lineID：LINE legacy 相容層，自 S2-B 掛上 authorizer 後已無法到達（已實測 401）。
	// 刻意不留 fallback：authorizer context 缺失時必須 fail-closed。
	userID = shared.AuthorizerUserIDV2(request)
	if userID == "" {
		response := Response{Success: false, Error: "unauthorized"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusUnauthorized,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Parse request body
	var req AcceptRegistrationRequest
	err = json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		log.Printf("Failed to parse request body: %v", err)
		response := Response{Success: false, Error: "Invalid request body"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Normalize IDs from request
	finalRegistrationID := req.RegistrationID
	if finalRegistrationID == "" {
		finalRegistrationID = req.RegistrationId
	}
	finalGameID := req.GameID
	if finalGameID == "" {
		finalGameID = req.GameId
	}

	if finalRegistrationID == "" {
		response := Response{Success: false, Error: "Missing registrationID parameter"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get registration first to get gameId if missing
	registration, err := getRegistration(ctx, finalRegistrationID)
	if err != nil || registration == nil {
		log.Printf("Registration not found: %s, err: %v", finalRegistrationID, err)
		response := Response{Success: false, Error: "找不到此報名紀錄"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// If gameId is missing in request, get it from registration
	if finalGameID == "" {
		if gid, ok := registration["gameId"].(string); ok {
			finalGameID = gid
		}
	}

	if finalGameID == "" {
		response := Response{Success: false, Error: "Missing gameID parameter"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get game
	game, err := getGame(ctx, finalGameID)
	if err != nil || game == nil {
		log.Printf("Game not found: %s, err: %v", finalGameID, err)
		response := Response{Success: false, Error: "找不到此團局"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Verify user is host
	if game["hostUserId"].(string) != userID {
		response := Response{Success: false, Error: "只有主揪可以接受報名"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusForbidden,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Check if registration has already been processed
	status := registration["status"].(string)
	if status == "accepted" {
		response := Response{Success: false, Error: "此報名已經接受過了"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	if status == "rejected" {
		response := Response{Success: false, Error: "此報名已經被拒絕過了"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 🔴 [A3-o1] 從這裡到交易送出之間的每一道判斷，都只是**提早失敗**（給使用者一句
	//    像樣的話）。真正的守門員是下面那筆交易的 ConditionExpression —— 讀與寫之間
	//    永遠有空窗，而 cancel_game 正是在那個空窗裡把局翻成 cancelled 的。
	// ⚠️ 這兩道與交易條件重複是刻意的，但**它們不是那個保證** —— 讀出來的東西在送出前
	//    隨時會過期。反過來說也成立：這裡就算漏判，交易照樣擋得住，使用者拿到的會是
	//    decideAcceptConflict 依 ALL_OLD 講的那句話（而不是這裡先猜的那句）。
	gameStatus, _ := game["status"].(string)
	if gameStatus != "recruiting" {
		response := Response{Success: false, Error: gameNotRecruitingMessage(gameStatus)}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Check if game is full
	currentPlayers := int(game["currentPlayers"].(float64))
	playersNeeded := int(game["playersNeeded"].(float64))
	capacity := playersNeeded + 1 // 主揪自己也佔一個位子
	if currentPlayers >= capacity {
		response := Response{Success: false, Error: msgGameFull}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Add player to game
	playerUserID := registration["userId"].(string)
	playerDisplayName := registration["displayName"].(string)

	// Get player info for picture URL
	user, _ := getUser(ctx, playerUserID)
	pictureURL := ""
	if user != nil {
		if pic, ok := user["pictureUrl"].(string); ok {
			pictureURL = pic
		}
	}

	now := time.Now().Format(time.RFC3339)
	newPlayerAV, err := attributevalue.MarshalMap(map[string]interface{}{
		"userId":      playerUserID,
		"displayName": playerDisplayName,
		"pictureUrl":  pictureURL,
		"joinedAt":    now,
	})
	if err != nil {
		log.Printf("Failed to marshal new player: %v", err)
		response := Response{Success: false, Error: "接受報名失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 🔴 [A3-o1] 報名列與團局改成**同一筆交易**，而且都不再整筆覆寫。原本是
	//    「先整筆 PutItem 寫回報名列，再整筆 PutItem 寫回團局」，兩個獨立的缺陷：
	//    ① 整筆覆寫會把別的寫者在讀寫空窗裡寫上去的東西一起蓋掉 —— 包含
	//       cancel_game 剛寫的 `status = cancelled`（於是已取消的局被復活成
	//       recruiting／full，而主揪已經領回 120 點）與 register 遞增的 registrationCount。
	//    ② 兩次寫入之間任一次失敗，會留下「報名已 accepted、人卻沒進團局」的殘局；
	//       而重試會被上面那道「此報名已經接受過了」擋住 ⇒ 兩頭落空。
	//    交易把這兩件事變成一個原子動作，條件沒過就整筆不生效。
	_, err = dynamoClient.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: buildAcceptTransactItems(
			tablePrefix+"Registrations",
			tablePrefix+"Games",
			acceptWrite{
				RegistrationID:  finalRegistrationID,
				GameID:          finalGameID,
				NewPlayer:       newPlayerAV,
				ExpectedPlayers: currentPlayers,
				Capacity:        capacity,
				Now:             now,
			},
		),
	})
	if err != nil {
		var tc *types.TransactionCanceledException
		if errors.As(err, &tc) {
			if msg, ok := decideAcceptConflict(tc.CancellationReasons); ok {
				log.Printf("Accept rejected by condition: reg=%s game=%s msg=%s", finalRegistrationID, finalGameID, msg)
				response := Response{Success: false, Error: msg}
				body, _ := json.Marshal(response)
				return events.APIGatewayV2HTTPResponse{
					StatusCode: http.StatusBadRequest,
					Headers:    headers,
					Body:       string(body),
				}, nil
			}
		}
		log.Printf("Failed to accept registration atomically: %v", err)
		response := Response{Success: false, Error: "接受報名失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 🚀 [New] Add Player to Chat Room (Non-blocking)
	var startTime time.Time
	if gi, ok := game["gameInfo"].(map[string]interface{}); ok {
		if st, ok := gi["startTime"].(string); ok {
			startTime, _ = time.Parse(time.RFC3339, st)
		}
	}
	if startTime.IsZero() {
		startTime = time.Now().Add(24 * time.Hour) // Fallback
	}
	chatTitle := getPlaceName(game)
	startTimeStr := startTime.Format(time.RFC3339)
	address := ""
	if loc, ok := game["location"].(map[string]interface{}); ok {
		if addr, ok := loc["address"].(string); ok {
			address = addr
		}
	}
	err = shared.AddUserToChatRoom(ctx, dynamoClient, tablePrefix, finalGameID, chatTitle, playerUserID, startTime.Add(24*time.Hour).Unix(), startTimeStr, address)
	if err != nil {
		log.Printf("Non-critical Error: Failed to add player %s to chat room %s: %v", playerUserID, finalGameID, err)
	}

	// Create web notification for player (approval)
	createWebNotification(
		ctx,
		playerUserID,
		"approval",
		"報名已通過",
		fmt.Sprintf("您的「%s」團局報名已被接受", getPlaceName(game)),
		finalGameID,
		getPlaceName(game),
		"",
		"",
	)

	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"message": "✅ 已接受報名",
		},
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

// ── [A3-o1] 接受報名的原子寫入 ────────────────────────────────────────────────
//
// 這一段刻意做成「純函式組出請求 → 呼叫端只負責送出」，因為交易本身、條件式與
// ReturnValuesOnConditionCheckFailure 的**行為**要真的 DynamoDB 才驗得到。
// 這裡的測試釘得住的是**請求長什麼樣**（哪一格對哪張表、條件寫了什麼、
// 佔位符有沒有對齊），釘不住 DynamoDB 收到之後會怎麼做 —— 兩者不要互相冒充。

// 交易格的順序即索引。decideAcceptConflict 靠這兩個常數認出「是哪一格被擋下來的」，
// 🔴 而 CancellationReasons 的順序**就是** TransactItems 的順序（AWS 保證逐格對應）。
// ⇒ 順序一旦改動，錯誤訊息會整個對調（把「團局已取消」講成「報名已處理過」）。
// buildAcceptTransactItems 的測試會斷言這兩格各自打在哪張表，那就是這條約定的尺。
const (
	txIdxRegistration = 0
	txIdxGame         = 1
)

const (
	msgGameFull         = "團局已滿，無法接受更多報名"
	msgGameCancelled    = "此團局已取消，無法接受報名"
	msgGameNotOpen      = "此團局目前不接受報名"
	msgGameChanged      = "團局狀態已變動，請重新整理後再試"
	msgRegAccepted      = "此報名已經接受過了"
	msgRegRejected      = "此報名已經被拒絕過了"
	msgRegStatusChanged = "報名狀態已變動，請重新整理後再試"
)

// gameNotRecruitingMessage 把團局狀態翻成給使用者的那句話。
// 🔴 讀出來先擋的那一道與交易條件失敗後的那一道**共用這一個函式** —— 兩處各寫一份的話，
// 同一個情境會依「誰先發現」給出不同的話，而那個差異沒有任何人會去對。
func gameNotRecruitingMessage(status string) string {
	if status == "cancelled" {
		return msgGameCancelled
	}
	return msgGameNotOpen
}

// acceptWrite 是「接受一筆報名」要寫下去的全部東西。
type acceptWrite struct {
	RegistrationID string
	GameID         string
	NewPlayer      map[string]types.AttributeValue
	// ExpectedPlayers 是讀到的 currentPlayers，當樂觀鎖用：條件寫成相等而不是
	// 「小於上限」，因為 status 要不要翻成 full 是**依這個讀數算出來的**。
	// 只寫「小於上限」的話，兩個併發的接受都會過，而其中一個算出來的 full 是錯的。
	ExpectedPlayers int
	Capacity        int // playersNeeded + 1（主揪自己佔一個位子）
	Now             string
}

// buildAcceptTransactItems 組出「接受報名」那一筆交易。
//
// 兩格都掛 ReturnValuesOnConditionCheckFailure: ALL_OLD —— 少了它，被擋下來時只知道
// 「有條件沒過」，說不出是哪一種（局取消了／滿了／報名已處理過），而那三句話要給的
// 使用者行動完全不同。
func buildAcceptTransactItems(regTable, gamesTable string, w acceptWrite) []types.TransactWriteItem {
	// 團局：只動該動的欄位。整筆覆寫正是 [A3-o1] 要修掉的東西。
	gameUpdate := "SET joinedPlayers = list_append(if_not_exists(joinedPlayers, :empty), :newPlayers), currentPlayers = :next, updatedAt = :now"
	gameValues := map[string]types.AttributeValue{
		":empty":      &types.AttributeValueMemberL{Value: []types.AttributeValue{}},
		":newPlayers": &types.AttributeValueMemberL{Value: []types.AttributeValue{&types.AttributeValueMemberM{Value: w.NewPlayer}}},
		":next":       &types.AttributeValueMemberN{Value: strconv.Itoa(w.ExpectedPlayers + 1)},
		":now":        &types.AttributeValueMemberS{Value: w.Now},
		":recruiting": &types.AttributeValueMemberS{Value: "recruiting"},
		":expected":   &types.AttributeValueMemberN{Value: strconv.Itoa(w.ExpectedPlayers)},
	}
	// 🔴 只有「這一筆剛好把它填滿」才寫 status，而且只寫 full。
	// 這支端點**永遠不會**把 status 寫成 recruiting —— 那正是它以前復活已取消團局的手法。
	if w.ExpectedPlayers+1 >= w.Capacity {
		gameUpdate += ", #s = :full"
		gameValues[":full"] = &types.AttributeValueMemberS{Value: "full"}
	}

	return []types.TransactWriteItem{
		txIdxRegistration: {
			Update: &types.Update{
				TableName: aws.String(regTable),
				Key: map[string]types.AttributeValue{
					"registrationId": &types.AttributeValueMemberS{Value: w.RegistrationID},
				},
				UpdateExpression: aws.String("SET #s = :accepted, updatedAt = :now"),
				// 條件掛在 pending：accepted／rejected 都不可以再被改一次，
				// 而「這一列還在不在」對「已經處理過」零鑑別力。
				ConditionExpression:      aws.String("#s = :pending"),
				ExpressionAttributeNames: map[string]string{"#s": "status"},
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":accepted": &types.AttributeValueMemberS{Value: "accepted"},
					":pending":  &types.AttributeValueMemberS{Value: "pending"},
					":now":      &types.AttributeValueMemberS{Value: w.Now},
				},
				ReturnValuesOnConditionCheckFailure: types.ReturnValuesOnConditionCheckFailureAllOld,
			},
		},
		txIdxGame: {
			Update: &types.Update{
				TableName: aws.String(gamesTable),
				Key: map[string]types.AttributeValue{
					"gameId": &types.AttributeValueMemberS{Value: w.GameID},
				},
				UpdateExpression:                    aws.String(gameUpdate),
				ConditionExpression:                 aws.String("#s = :recruiting AND currentPlayers = :expected"),
				ExpressionAttributeNames:            map[string]string{"#s": "status"},
				ExpressionAttributeValues:           gameValues,
				ReturnValuesOnConditionCheckFailure: types.ReturnValuesOnConditionCheckFailureAllOld,
			},
		},
	}
}

// decideAcceptConflict 從交易的取消原因決定回給使用者的那句話。
//
// 回傳的 bool 是「這是不是條件沒過」。**不可以省掉它**：TransactionCanceledException
// 也會因為 TransactionConflict／ProvisionedThroughputExceeded 之類的原因發生，
// 那些是伺服器端的問題，回 400 加一句「狀態已變動」等於對使用者說謊，
// 而且會讓真正該被看見的失敗消失在一句「請重新整理」裡。
func decideAcceptConflict(reasons []types.CancellationReason) (string, bool) {
	// 團局那一格優先：它答得出「為什麼」（取消了／滿了），報名那格只答得出「已處理過」。
	// 兩格同時失敗時（例如重複點擊撞上取消），前者才是使用者需要知道的。
	if item, ok := conditionFailedItem(reasons, txIdxGame); ok {
		return gameConflictMessage(item), true
	}
	if item, ok := conditionFailedItem(reasons, txIdxRegistration); ok {
		switch itemString(item, "status") {
		case "accepted":
			return msgRegAccepted, true
		case "rejected":
			return msgRegRejected, true
		}
		return msgRegStatusChanged, true
	}
	return "", false
}

// conditionFailedItem 取出「第 idx 格是不是因為條件沒過被擋下來」以及它當時的樣子。
// ⚠️ 沒失敗的那幾格 Code 是 "None" 而不是 nil ⇒ 不可以用「有沒有這一格」當判準。
func conditionFailedItem(reasons []types.CancellationReason, idx int) (map[string]types.AttributeValue, bool) {
	if idx < 0 || idx >= len(reasons) {
		return nil, false
	}
	r := reasons[idx]
	if r.Code == nil || *r.Code != "ConditionalCheckFailed" {
		return nil, false
	}
	return r.Item, true
}

// gameConflictMessage 依「被擋下來那一瞬間的團局」決定那句話。
// item 是 nil 時只能給最含糊的那一句 —— 猜一個具體的理由比含糊更糟。
func gameConflictMessage(item map[string]types.AttributeValue) string {
	if item == nil {
		return msgGameChanged
	}
	if status := itemString(item, "status"); status != "recruiting" {
		return gameNotRecruitingMessage(status)
	}
	// 狀態仍是 recruiting ⇒ 擋下來的是樂觀鎖那一半：有人在這中間先被接受了。
	cur, curOK := itemNumber(item, "currentPlayers")
	needed, neededOK := itemNumber(item, "playersNeeded")
	if curOK && neededOK && cur >= needed+1 {
		return msgGameFull
	}
	return msgGameChanged
}

func itemString(item map[string]types.AttributeValue, key string) string {
	if av, ok := item[key].(*types.AttributeValueMemberS); ok {
		return av.Value
	}
	return ""
}

func itemNumber(item map[string]types.AttributeValue, key string) (int, bool) {
	av, ok := item[key].(*types.AttributeValueMemberN)
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(av.Value)
	if err != nil {
		return 0, false
	}
	return n, true
}

func getGame(ctx context.Context, gameID string) (map[string]interface{}, error) {
	tableName := tablePrefix + "Games"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"gameId": &types.AttributeValueMemberS{Value: gameID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, fmt.Errorf("game not found")
	}

	var game map[string]interface{}
	err = attributevalue.UnmarshalMap(result.Item, &game)
	return game, err
}

func getRegistration(ctx context.Context, registrationID string) (map[string]interface{}, error) {
	tableName := tablePrefix + "Registrations"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"registrationId": &types.AttributeValueMemberS{Value: registrationID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, fmt.Errorf("registration not found")
	}

	var registration map[string]interface{}
	err = attributevalue.UnmarshalMap(result.Item, &registration)
	return registration, err
}

func getUser(ctx context.Context, userID string) (map[string]interface{}, error) {
	tableName := tablePrefix + "Users"
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	if result.Item == nil {
		return nil, fmt.Errorf("user not found")
	}

	var user map[string]interface{}
	err = attributevalue.UnmarshalMap(result.Item, &user)
	return user, err
}

func createWebNotification(ctx context.Context, userID, notifType, title, message, gameID, gameName, fromUserID, fromUserName string) error {
	now := time.Now()
	expiresAt := now.AddDate(0, 0, 30)

	notification := map[string]interface{}{
		"notificationId": uuid.New().String(),
		"userId":         userID,
		"type":           notifType,
		"title":          title,
		"message":        message,
		"isRead":         false,
		"createdAt":      now.Unix(),
		"expiresAt":      expiresAt.Unix(),
	}

	if gameID != "" {
		notification["gameId"] = gameID
	}
	if gameName != "" {
		notification["gameName"] = gameName
	}
	if fromUserID != "" {
		notification["fromUserId"] = fromUserID
	}
	if fromUserName != "" {
		notification["fromUserName"] = fromUserName
	}

	item, err := attributevalue.MarshalMap(notification)
	if err != nil {
		log.Printf("Failed to marshal notification: %v", err)
		return err
	}

	tableName := tablePrefix + "Notifications"
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})

	if err != nil {
		log.Printf("Failed to save notification: %v", err)
		return err
	}

	// Send push notification synchronously
	data := map[string]interface{}{
		"url":    "/notifications",
		"gameId": gameID,
		"type":   notifType,
	}
	if fromUserID != "" {
		data["fromUserId"] = fromUserID
		data["fromUserName"] = fromUserName
	}

	if pushService != nil {
		pushService.SendPushNotificationToUser(context.Background(), userID, title, message, data)
	} else {
		log.Println("Push service not initialized, skipping push notification")
	}

	return nil
}

func getPlaceName(game map[string]interface{}) string {
	if location, ok := game["location"].(map[string]interface{}); ok {
		if placeName, ok := location["placeName"].(string); ok {
			return placeName
		}
	}
	return "團局"
}

func decryptLineID(encryptedData string) (string, error) {
	if encryptionKey == "" {
		return "", fmt.Errorf("encryption key not configured")
	}

	// Decode base64 key
	key, err := base64.StdEncoding.DecodeString(encryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to decode encryption key: %w", err)
	}

	// Decode URL-safe base64
	combined, err := base64.URLEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM mode
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	// Extract nonce and ciphertext
	nonceSize := gcm.NonceSize()
	if len(combined) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce := combined[:nonceSize]
	ciphertext := combined[nonceSize:]

	// Decrypt
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

func main() {
	lambda.Start(Handler)
}
