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
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Request struct {
	UserID      string `json:"userId"`
	RoomID      string `json:"roomId"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
}

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var (
	s3Client      *s3.Client
	presignClient *s3.PresignClient
	dbClient      *dynamodb.Client
	tablePrefix   string
	bucketName    string
	region        string
)

func init() {
	region = os.Getenv("AWS_REGION")
	if region == "" {
		region = "ap-southeast-1"
	}
	bucketName = os.Getenv("COMMUNITY_BUCKET")
	if bucketName == "" {
		bucketName = "mahjongclub-community-media"
	}

	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		log.Fatalf("Unable to load SDK config: %v", err)
	}

	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

	s3Client = s3.NewFromConfig(cfg)
	presignClient = s3.NewPresignClient(s3Client)
	dbClient = dynamodb.NewFromConfig(cfg)
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計
	shared.RecordTokenUsageFromHeader(request, "chat_get_upload_url")

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
		}, nil
	}

	userID := shared.AuthorizerUserID(request)
	if userID == "" {
		return respond(http.StatusUnauthorized, Response{Success: false, Error: "unauthorized"}, headers)
	}

	var req Request
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"}, headers)
	}

	if req.RoomID == "" || req.FileName == "" {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Missing roomId or fileName"}, headers)
	}
	// fileName 是使用者可控且會被串進 S3 key：帶 `/` 就能寫進別的前綴（見 shared/upload_utils.go）。
	safeName, okName := shared.SanitizeUploadFileName(req.FileName)
	if !okName {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "檔名不合法"}, headers)
	}
	if !shared.IsAllowedUploadContentType(req.ContentType) {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "不支援的檔案類型"}, headers)
	}
	// roomId 同樣會被串進 key。註：這只擋「寫進別的前綴」，
	// **不驗證呼叫者是否為該聊天室成員** —— 那是另一個未修的問題。
	safeRoom, okRoom := shared.SanitizeUploadPathSegment(req.RoomID)
	if !okRoom {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "roomId 不合法"}, headers)
	}

	// 水平越權修補：掛上 authorizer 只擋掉未登入者，任何「已登入」使用者仍可帶任意
	// roomId 取得 chat/{roomId}/ 底下的預簽上傳網址，把檔案寫進自己不屬於的聊天室前綴。
	// 姊妹端點 chat-get-history / chat-get-room-info 早已驗成員資格，本支漏了。
	//
	// 用 safeRoom（而非 req.RoomID）查驗：確保「驗過的房間」與「實際寫入的前綴」是同一個。
	// 若拿原值驗、拿淨化值寫，兩者就可能指向不同房間。
	isMember, memErr := shared.IsRoomMember(ctx, dbClient, tablePrefix, userID, safeRoom)
	if memErr != nil {
		// fail-closed：查不出來就不放行，不可因為 DB 出錯而變成人人可寫。
		log.Printf("[chat-get-upload-url] 成員資格查驗失敗 user=%s room=%s: %v", userID, safeRoom, memErr)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Failed to verify room membership"}, headers)
	}
	if !isMember {
		log.Printf("[chat-get-upload-url] 非成員遭拒 user=%s room=%s", userID, safeRoom)
		return respond(http.StatusForbidden, Response{Success: false, Error: "You are not a member of this chat room"}, headers)
	}

	// Generate S3 key: chat/{roomId}/{userId}/{timestamp}_{filename}
	now := time.Now()
	timestamp := now.Unix()
	key := fmt.Sprintf("chat/%s/%s/%d_%s", safeRoom, userID, timestamp, safeName)

	// Create presigned URL for PUT request with Cache-Control
	presignedReq, err := presignClient.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(bucketName),
		Key:          aws.String(key),
		ContentType:  aws.String(req.ContentType),
		CacheControl: aws.String("public, max-age=31536000, immutable"),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = time.Duration(15 * time.Minute)
	})

	if err != nil {
		log.Printf("Failed to generate presigned URL: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Failed to generate upload URL"}, headers)
	}

	// Normalize it to CloudFront URL
	s3URL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", bucketName, region, key)
	publicURL := shared.NormalizeMediaURL(s3URL)

	return respond(http.StatusOK, Response{
		Success: true,
		Data: map[string]string{
			"uploadUrl": presignedReq.URL,
			"publicUrl": publicURL,
			"key":       key,
		},
	}, headers)
}

func respond(statusCode int, response Response, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(handler)
}
