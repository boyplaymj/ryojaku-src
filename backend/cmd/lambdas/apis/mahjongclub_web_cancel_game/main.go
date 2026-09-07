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
	"sync"
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

type CancelGameRequest struct {
	GameID string `json:"gameID"`
}

type Response struct {
	Success bool        `json:"success"`
	Error   string      `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_cancel_game")

	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// Get user ID - support both lineID (encrypted) and userId (APP_xxx) parameters
	var userID string
	var err error

	// 身分一律取自 authorizer（S5-C），不再讀 query param 的 userId／lineID：
	//   userId：登入者帶 ?userId=<他人> 即可代其執行破壞性動作（B 級）。
	//   lineID：LINE legacy 相容層，自 S2-B 掛上 authorizer 後已無法到達 ——
	//     不帶 JWT 的請求在 Lambda 執行前就被擋成 401（已實測），保留只會誤導後人。
	// 刻意不留 fallback：authorizer context 缺失時必須 fail-closed，
	// 掉回 lineID 解密等於留一條 fail-open 的後路。
	userID = shared.AuthorizerUserID(request)
	if userID == "" {
		response := Response{Success: false, Error: "unauthorized"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusUnauthorized,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Parse request body
	var req CancelGameRequest
	err = json.Unmarshal([]byte(request.Body), &req)
	if err != nil {
		response := Response{Success: false, Error: "Invalid request body"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusBadRequest,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Get game
	game, err := getGame(ctx, req.GameID)
	if err != nil || game == nil {
		response := Response{Success: false, Error: "找不到此團局"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Verify user is host
	if game["hostUserId"].(string) != userID {
		response := Response{Success: false, Error: "只有主揪可以取消團局"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusForbidden,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// 🔴 [A3-l] 退點之前要先知道「這一次是不是真的由我們把它從未取消改成取消」。
	//    `saveGame` 是無條件 PutItem ⇒ 重複呼叫這支 API 會重複成功，
	//    而退點如果只看「這次呼叫成功了」就會**每呼叫一次退一次 120 點**。
	//    ⚠️ 下面 saveGame 帶了條件式（status <> cancelled），所以競態也擋得住：
	//      兩個併發請求只有一個寫得進去，另一個拿到 ConditionalCheckFailed。
	prevStatus, _ := game["status"].(string)

	// Update game status to cancelled
	game["status"] = "cancelled"
	game["updatedAt"] = time.Now().Format(time.RFC3339)

	err = saveGameIfNotCancelled(ctx, game)
	if err != nil {
		if isConditionalCheckFailed(err) {
			// 已經是 cancelled ⇒ 這次沒有造成任何狀態改變，**不可以**退點。
			// 回 200：對呼叫端而言「這個局已經取消了」是它要的結果（冪等）。
			log.Printf("[A3-l] game %s 已是 cancelled，本次不退點（冪等）", req.GameID)
			response := Response{Success: true, Data: map[string]interface{}{"gameId": req.GameID, "alreadyCancelled": true}}
			body, _ := json.Marshal(response)
			return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: string(body)}, nil
		}
		log.Printf("Failed to cancel game: %v", err)
		response := Response{Success: false, Error: "取消團局失敗"}
		body, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Headers:    headers,
			Body:       string(body),
		}, nil
	}

	// Create web notifications for all players
	// Create web notifications for all players
	var wg sync.WaitGroup

	// Notify all joined players
	if joinedPlayers, ok := game["joinedPlayers"].([]interface{}); ok {
		for _, p := range joinedPlayers {
			if player, ok := p.(map[string]interface{}); ok {
				if playerUserID, ok := player["userId"].(string); ok && playerUserID != userID {
					wg.Add(1)
					go func(uid string) {
						defer wg.Done()
						createWebNotification(
							ctx,
							uid,
							"cancellation",
							"團局已取消",
							fmt.Sprintf("「%s」團局已被主揪取消", getPlaceName(game)),
							req.GameID,
							getPlaceName(game),
							"",
							"",
						)
					}(playerUserID)
				}
			}
		}
	}

	// Also notify pending registrations
	allRegistrations, err := getGameRegistrations(ctx, req.GameID)
	regQueryOK := err == nil
	if err == nil {
		for _, reg := range allRegistrations {
			if status, ok := reg["status"].(string); ok && status == "pending" {
				if regUserID, ok := reg["userId"].(string); ok {
					wg.Add(1)
					go func(uid string) {
						defer wg.Done()
						createWebNotification(
							ctx,
							uid,
							"cancellation",
							"團局已取消",
							fmt.Sprintf("「%s」團局已被主揪取消", getPlaceName(game)),
							req.GameID,
							getPlaceName(game),
							"",
							"",
						)
					}(regUserID)
				}
			}
		}
	}

	// Wait for all notifications to be sent
	wg.Wait()

	// ── [A3-l] 無人報名就全額退還發團費（使用者拍板 2026-09-07）
	//
	// 🔴 判準本身住在 `shared.ShouldRefundOnCancel`，因為它的兩個輸入在真實環境裡
	//    很難湊齊（要一個「有人申請、主揪還沒核准」的局）⇒ 寫在這裡就沒有尺。
	// 🔴 **查不到報名清單時一律不退**：`getGameRegistrations` 失敗會回空 slice，
	//    而「查到 0 筆」與「查詢炸了」在 `len()` 上逐字相同 —— 拿後者去退點
	//    等於把查詢故障變成發錢。
	// ⚠️ `prevStatus` 那道已經擋掉重複呼叫；這裡再確認一次是為了讓「為什麼退」
	//    在一個地方讀得完。
	refunded := 0
	{
		currentPlayers := 0
		if cp, ok := game["currentPlayers"].(float64); ok {
			currentPlayers = int(cp)
		}
		// 🔴 判斷整段住在 `shared.DecideCancelRefund`（有測試）。這裡只做接線。
		//    ⚠️ 三個分支答錯的後果都是「把點數送出去」，所以它不可以是 inline 的 if。
		doRefund, reason := shared.DecideCancelRefund(regQueryOK, prevStatus, len(allRegistrations), currentPlayers)
		log.Printf("[A3-l] game %s 退點判定：%s（報名 %d 筆／currentPlayers %d／查詢OK=%v／前狀態=%q）",
			req.GameID, reason, len(allRegistrations), currentPlayers, regQueryOK, prevStatus)
		if doRefund {
			before, after, rerr := addUserPoints(ctx, userID, shared.CreateGameCost)
			if rerr != nil {
				// 🔴 退不成不可以讓整支 API 變成失敗：局**已經**取消了，
				//    回 500 會讓前端以為沒取消而重試，重試又被冪等擋掉 ⇒ 使用者兩頭落空。
				//    ⇒ 記 log（這是唯一的線索），照常回成功。
				log.Printf("[A3-l] ⚠️ game %s 退點失敗（局已取消）：%v", req.GameID, rerr)
			} else {
				refunded = shared.CreateGameCost
				// 🔴 帳本這一筆**同步**寫，不要 `go func()`。
				//    本檔其他地方與 `web_create_game` 都用 goroutine，那是因為它們後面
				//    還有工作、goroutine 有時間跑完。這裡緊接著就 return ⇒
				//    Lambda 回應後 runtime 會凍結，那筆 log 可能**永遠不會寫**，
				//    而外觀是「退點成功、帳本上沒有這筆」——事後查不出點數哪來的。
				//    代價是一次 DDB 寫入的延遲；換的是點數異動一定有紀錄。
				logCtx, logCancel := context.WithTimeout(ctx, 5*time.Second)
				if lerr := shared.RecordPointChangeShadow(logCtx, dynamoClient, tablePrefix, userID,
					shared.CreateGameCost, shared.PointTypeCredit, before, after,
					"取消團局（無人報名）退還發團費", "web_cancel_game_refund", nil); lerr != nil {
					// 點數已經加回去了，帳本沒寫成 ⇒ 這是**對帳會發現的差異**，要留線索。
					log.Printf("[A3-l] 🔴 game %s 已退 %d 點但帳本寫入失敗：%v",
						req.GameID, shared.CreateGameCost, lerr)
				}
				logCancel()
			}
		}
	}

	msg := "✅ 團局已取消，已通知所有報名者"
	if refunded > 0 {
		msg = fmt.Sprintf("✅ 團局已取消，因無人報名已退還 %d 點", refunded)
	}
	response := Response{
		Success: true,
		Data: map[string]interface{}{
			"message":        msg,
			"pointsRefunded": refunded,
		},
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
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

func saveGame(ctx context.Context, game map[string]interface{}) error {
	item, err := attributevalue.MarshalMap(game)
	if err != nil {
		return err
	}

	tableName := tablePrefix + "Games"
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &tableName,
		Item:      item,
	})
	return err
}

// saveGameIfNotCancelled 寫回局，但**只在它還不是 cancelled 時**才寫得進去。
//
// 🔴 原本是無條件 PutItem。加條件的理由是 [A3-l] 退點：沒有它的話，
//
//	同一顆局被取消兩次會退兩次 120 點，而兩次呼叫在回應上**逐字相同**。
//	⚠️ 條件掛在 `status`，不是「有沒有這一列」——後者對「已經取消過」零鑑別力。
func saveGameIfNotCancelled(ctx context.Context, game map[string]interface{}) error {
	item, err := attributevalue.MarshalMap(game)
	if err != nil {
		return err
	}

	tableName := tablePrefix + "Games"
	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           &tableName,
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(#s) OR #s <> :cancelled"),
		ExpressionAttributeNames: map[string]string{
			"#s": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":cancelled": &types.AttributeValueMemberS{Value: "cancelled"},
		},
	})
	return err
}

// isConditionalCheckFailed 把「條件沒過」與其他錯誤分開。
// 🔴 用 errors.As 認型別，不要比對錯誤字串 —— 字串會隨 SDK 版本改，
//
//	而改掉之後這裡會靜靜退化成「所有錯誤都當成一般失敗」，重複退點就回來了。
func isConditionalCheckFailed(err error) bool {
	var ccf *types.ConditionalCheckFailedException
	return errors.As(err, &ccf)
}

// addUserPoints 原子地把點數加回去，回傳 (before, after)。
//
// 🔴 刻意用 `ADD`（DynamoDB 原子加），不是「讀出來 +120 再寫回去」——
//
//	後者是 `web_create_game` 扣點的做法，而那個做法在併發下會 lost update。
//	退點若也那樣寫，使用者同時在別處賺點數就可能把退的那筆吃掉。
//
// ⚠️ before 由 after 反推：ADD 只回得到新值，而 point log 兩個都要。
func addUserPoints(ctx context.Context, userID string, amount int) (int, int, error) {
	tableName := tablePrefix + "Users"
	out, err := dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression: aws.String("ADD points :amt SET updatedAt = :now"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":amt": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", amount)},
			":now": &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
		},
		ReturnValues: types.ReturnValueUpdatedNew,
	})
	if err != nil {
		return 0, 0, err
	}

	after := 0
	if v, ok := out.Attributes["points"].(*types.AttributeValueMemberN); ok {
		fmt.Sscanf(v.Value, "%d", &after)
	}
	return after - amount, after, nil
}

func getGameRegistrations(ctx context.Context, gameID string) ([]map[string]interface{}, error) {
	tableName := tablePrefix + "Registrations"
	result, err := dynamoClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &tableName,
		IndexName:              aws.String("GameIdIndex"),
		KeyConditionExpression: aws.String("gameId = :gameId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":gameId": &types.AttributeValueMemberS{Value: gameID},
		},
	})
	if err != nil {
		return nil, err
	}

	var registrations []map[string]interface{}
	for _, item := range result.Items {
		var reg map[string]interface{}
		if err := attributevalue.UnmarshalMap(item, &reg); err == nil {
			registrations = append(registrations, reg)
		}
	}
	return registrations, nil
}

func createWebNotification(ctx context.Context, userID, notifType, title, message, gameID, gameName, fromUserID, fromUserName string) error {
	now := time.Now()
	expiresAt := now.AddDate(0, 0, 30) // Expire after 30 days

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

	// Send push notification synchronously (since we are already in a goroutine)
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
