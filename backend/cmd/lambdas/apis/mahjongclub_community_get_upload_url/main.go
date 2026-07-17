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
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "community_get_upload_url")

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

	var req Request
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Invalid request body"}, headers)
	}

	if req.UserID == "" || req.FileName == "" {
		return respond(http.StatusBadRequest, Response{Success: false, Error: "Missing userId or fileName"}, headers)
	}

	// Generate S3 key: posts/{year}{month}/{timestamp}_{uuid}_{filename}
	now := time.Now()
	timestamp := now.Unix()
	yearMonth := now.Format("200601")
	// Use a simple key structure for now, can add UUID later if needed
	key := fmt.Sprintf("posts/%s/%d_%s", yearMonth, timestamp, req.FileName)

	// Create presigned URL for PUT request with Cache-Control for long-term browser/app caching
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

	// Build original S3 URL and then normalize it to CloudFront URL
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
