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
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Request struct {
	UserID      string `json:"userId"`
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

	s3Client = s3.NewFromConfig(cfg)
	presignClient = s3.NewPresignClient(s3Client)
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
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

	// 🔴 這支原本 manifest 標 auth:"public"，等於 API Gateway 不掛 authorizer；
	// handler 這裡也只呼叫 RecordTokenUsageFromHeader（純統計、不驗證），
	// `userId` 直接取自 request body 且只檢查非空 —— 結果是**任何人不帶憑證**
	// 都能拿到本 bucket 的預簽上傳網址並實際寫入。
	// （2026-07-31 staging 實打：未帶憑證 POST 回 200，PUT 回 200，物件確實落地。）
	//
	// 這個洞躲過先前那輪 authorizer 掃蕩的原因，比「分類錯了」更迂迴一層：
	// gen_app_template.py 的 authorizer 掛載**並不是**看 manifest 的 auth 欄位
	// （該欄位到 S1 為止仍只是註解），而是看一份明確列舉的 AUTHORIZER_PILOT 名單。
	// 本端點既沒進那份名單、manifest 又標成 public，於是兩層都沒有人管到它。
	// 故本次三處一起補：manifest 改標 auth:"user"（為 S2 全面套用預備，現階段不生效）、
	// 加入 AUTHORIZER_PILOT（閘門層，立即生效）、以及這裡改為必須是驗證過的身分（深度防禦）。
	userID, verified := shared.GetUserIdentifierWithTracking(request, "event_get_upload_url")
	if !verified {
		log.Printf("[AUTH][event-get-upload-url] 拒絕未驗證請求 sourceIp=%s ua=%q",
			request.RequestContext.Identity.SourceIP, request.Headers["User-Agent"])
		return respond(http.StatusUnauthorized, Response{Success: false, Error: "需要登入"}, headers)
	}

	var req Request
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"}, headers)
	}

	// userID 一律以 JWT 內的身分為準，不採用 body 的 `userId`（body 值可任意偽造）。
	// 本端點的 S3 key 不含 userID（events/{年月}/…），故此處僅用於稽核日誌。
	//
	// 另三支 upload 端點取身分的機制與這裡不同但同樣安全：它們在 AUTHORIZER_PILOT 內，
	// 直接用 `shared.AuthorizerUserID(request)` 讀 API Gateway authorizer 帶進來的 context
	// （avatars/{userID}/、chat/{roomId}/{userID}/ 的 userID 都來自該處，不是 body）。
	// 本端點因為原本不在 PILOT，走的是 handler 自驗那條路，故用 GetUserIdentifierWithTracking。
	if req.FileName == "" {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Missing fileName"}, headers)
	}
	// fileName 是使用者可控且會被串進 S3 key：帶 `/` 就能寫進別的前綴（見 shared/upload_utils.go）。
	safeName, ok := shared.SanitizeUploadFileName(req.FileName)
	if !ok {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "檔名不合法"}, headers)
	}
	if !shared.IsAllowedUploadContentType(req.ContentType) {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "不支援的檔案類型"}, headers)
	}
	log.Printf("[event-get-upload-url] userId=%s fileName=%q", userID, safeName)

	// Generate S3 key: events/{year}{month}/{timestamp}_{filename}
	now := time.Now()
	timestamp := now.Unix()
	yearMonth := now.Format("200601")
	key := fmt.Sprintf("events/%s/%d_%s", yearMonth, timestamp, safeName)

	// Create presigned URL for PUT request
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

	// Build public URL using CDN replacement logic
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
