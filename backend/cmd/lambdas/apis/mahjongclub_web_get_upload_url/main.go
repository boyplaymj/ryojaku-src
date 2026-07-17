package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"mahjongclub-backend/cmd/lambdas/shared"
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
	dynamoClient  *dynamodb.Client
	bucketName    string
	region        string
	tablePrefix   string
)

func init() {
	region = os.Getenv("AWS_REGION")
	if region == "" {
		region = "ap-southeast-1"
	}
	bucketName = os.Getenv("ASSETS_BUCKET")
	if bucketName == "" {
		bucketName = "mahjongclub-app-assets"
	}
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}

	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		log.Fatalf("Unable to load SDK config: %v", err)
	}

	s3Client = s3.NewFromConfig(cfg)
	presignClient = s3.NewPresignClient(s3Client)
	dynamoClient = dynamodb.NewFromConfig(cfg)
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 記錄 Token 使用統計 (異步，不影響回應時間)
	shared.RecordTokenUsageFromHeader(request, "web_get_upload_url")

	// Record traffic
	if dynamoClient != nil {
		shared.RecordTraffic(ctx, dynamoClient, tablePrefix, "core", "get_upload_url")
	}

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

	// Generate S3 key: avatars/{userId}/{timestamp}_{filename}
	timestamp := time.Now().Unix()
	key := fmt.Sprintf("avatars/%s/%d_%s", req.UserID, timestamp, req.FileName)

	// Create presigned URL for PUT request
	presignedReq, err := presignClient.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucketName),
		Key:         aws.String(key),
		ContentType: aws.String(req.ContentType),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = time.Duration(15 * time.Minute)
	})

	if err != nil {
		log.Printf("Failed to generate presigned URL: %v", err)
		return respond(http.StatusInternalServerError, Response{Success: false, Error: "Failed to generate upload URL"}, headers)
	}

	// Public URL
	cloudfrontURL := os.Getenv("CLOUDFRONT_URL")
	var publicURL string
	if cloudfrontURL != "" {
		// Remove trailing slash if present
		if cloudfrontURL[len(cloudfrontURL)-1] == '/' {
			cloudfrontURL = cloudfrontURL[:len(cloudfrontURL)-1]
		}
		publicURL = fmt.Sprintf("%s/%s", cloudfrontURL, key)
	} else {
		publicURL = fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", bucketName, region, key)
	}

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
