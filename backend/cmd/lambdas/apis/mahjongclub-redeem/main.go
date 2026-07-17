package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

var (
	dynamoClient *dynamodb.Client
	tableName    = os.Getenv("TABLE_NAME")
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
}

type Response struct {
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// RedeemCode model
type RedeemCode struct {
	CodeID       string     `dynamodbav:"codeId" json:"codeId"`
	Points       int        `dynamodbav:"points" json:"points"`
	BatchID      string     `dynamodbav:"batchId" json:"batchId"`
	Status       string     `dynamodbav:"status" json:"status"`
	UsedBy       string     `dynamodbav:"usedBy,omitempty" json:"usedBy,omitempty"`
	UsedAt       *time.Time `dynamodbav:"usedAt,omitempty" json:"usedAt,omitempty"`
	CreatedAt    time.Time  `dynamodbav:"createdAt" json:"createdAt"`
	CreatedAtNum int64      `dynamodbav:"createdAtNum" json:"createdAtNum"`
}

type CodeBatch struct {
	BatchID      string    `dynamodbav:"batchId" json:"batchId"`
	Points       int       `dynamodbav:"points" json:"points"`
	Quantity     int       `dynamodbav:"quantity" json:"quantity"`
	UsedCount    int       `dynamodbav:"usedCount" json:"usedCount"`
	CreatedBy    string    `dynamodbav:"createdBy" json:"createdBy"`
	CreatedAt    time.Time `dynamodbav:"createdAt" json:"createdAt"`
	CreatedAtNum int64     `dynamodbav:"createdAtNum" json:"createdAtNum"`
}

type GenerateRequest struct {
	Quantity  int    `json:"quantity"`
	Points    int    `json:"points"`
	CreatedBy string `json:"createdBy"`
}

type GenerateResponse struct {
	BatchID  string       `json:"batchId"`
	Quantity int          `json:"quantity"`
	Points   int          `json:"points"`
	Codes    []RedeemCode `json:"codes"`
}

type StatsResponse struct {
	TotalCodes         int                  `json:"totalCodes"`
	UsedCodes          int                  `json:"usedCodes"`
	UnusedCodes        int                  `json:"unusedCodes"`
	TotalPoints        int                  `json:"totalPoints"`
	PointsDistribution []PointsDistribution `json:"pointsDistribution"`
}

type PointsDistribution struct {
	Points int `json:"points"`
	Count  int `json:"count"`
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (Response, error) {
	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	// CORS headers
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	// Handle OPTIONS request for CORS
	if request.HTTPMethod == "OPTIONS" {
		return Response{
			StatusCode: 200,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// Route handling
	path := request.Path
	method := request.HTTPMethod

	switch {
	case path == "/redeem-codes/generate" && method == "POST":
		return handleGenerateCodes(ctx, request, headers)
	case path == "/redeem-codes/stats" && method == "GET":
		return handleGetStats(ctx, headers)
	case path == "/redeem-codes/batches" && method == "GET":
		return handleGetBatches(ctx, request, headers)
	case strings.HasPrefix(path, "/redeem-codes/batch/") && strings.HasSuffix(path, "/download") && method == "GET":
		batchID := extractBatchID(path)
		return handleDownloadBatch(ctx, batchID, headers)
	case path == "/redeem-codes/usage-trend" && method == "GET":
		return handleGetUsageTrend(ctx, request, headers)
	default:
		return errorResponse(headers, http.StatusNotFound, "Not found"), nil
	}
}

func handleGenerateCodes(ctx context.Context, request events.APIGatewayProxyRequest, headers map[string]string) (Response, error) {
	var req GenerateRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(headers, http.StatusBadRequest, "Invalid request body"), nil
	}

	// Validation
	if req.Quantity < 1 || req.Quantity > 10000 {
		return errorResponse(headers, http.StatusBadRequest, "Quantity must be between 1 and 10000"), nil
	}
	if req.Points < 1 {
		return errorResponse(headers, http.StatusBadRequest, "Points must be greater than 0"), nil
	}

	// Generate codes
	codes, batch, err := generateRedeemCodes(ctx, req.Quantity, req.Points, req.CreatedBy)
	if err != nil {
		log.Printf("Error generating codes: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to generate codes"), nil
	}

	response := GenerateResponse{
		BatchID:  batch.BatchID,
		Quantity: batch.Quantity,
		Points:   batch.Points,
		Codes:    codes,
	}

	return successResponse(headers, response), nil
}

func handleGetStats(ctx context.Context, headers map[string]string) (Response, error) {
	stats, err := getRedeemCodeStats(ctx)
	if err != nil {
		log.Printf("Error getting stats: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to get stats"), nil
	}

	return successResponse(headers, stats), nil
}

func handleGetBatches(ctx context.Context, request events.APIGatewayProxyRequest, headers map[string]string) (Response, error) {
	limit := 20
	if limitStr, ok := request.QueryStringParameters["limit"]; ok {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	batches, err := getBatches(ctx, limit)
	if err != nil {
		log.Printf("Error getting batches: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to get batches"), nil
	}

	return successResponse(headers, batches), nil
}

func handleDownloadBatch(ctx context.Context, batchID string, headers map[string]string) (Response, error) {
	codes, err := getCodesByBatch(ctx, batchID)
	if err != nil {
		log.Printf("Error getting codes: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to get codes"), nil
	}

	// Generate CSV
	csvData := generateCSV(codes)

	// Update headers for CSV download
	headers["Content-Type"] = "text/csv"
	headers["Content-Disposition"] = fmt.Sprintf("attachment; filename=codes_%s.csv", batchID)

	return Response{
		StatusCode: 200,
		Headers:    headers,
		Body:       csvData,
	}, nil
}

func handleGetUsageTrend(ctx context.Context, request events.APIGatewayProxyRequest, headers map[string]string) (Response, error) {
	days := 30
	if daysStr, ok := request.QueryStringParameters["days"]; ok {
		if d, err := strconv.Atoi(daysStr); err == nil {
			days = d
		}
	}

	trend, err := getUsageTrend(ctx, days)
	if err != nil {
		log.Printf("Error getting usage trend: %v", err)
		return errorResponse(headers, http.StatusInternalServerError, "Failed to get usage trend"), nil
	}

	return successResponse(headers, trend), nil
}

func extractBatchID(path string) string {
	// Extract batch ID from path like /redeem-codes/batch/{batchId}/download
	parts := strings.Split(path, "/")
	if len(parts) >= 4 {
		return parts[3]
	}
	return ""
}

func successResponse(headers map[string]string, data interface{}) Response {
	resp := APIResponse{
		Success: true,
		Data:    data,
	}
	body, _ := json.Marshal(resp)
	return Response{
		StatusCode: 200,
		Headers:    headers,
		Body:       string(body),
	}
}

func errorResponse(headers map[string]string, statusCode int, message string) Response {
	resp := APIResponse{
		Success: false,
		Error:   message,
	}
	body, _ := json.Marshal(resp)
	return Response{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(body),
	}
}

// generateCSV creates CSV content from redeem codes
func generateCSV(codes []RedeemCode) string {
	var builder strings.Builder
	writer := csv.NewWriter(&builder)

	// UTF-8 BOM
	builder.WriteString("\uFEFF")

	// Header
	writer.Write([]string{"序號", "點數", "狀態", "創建時間", "使用者", "使用時間"})

	// Rows
	for _, code := range codes {
		usedBy := ""
		usedAt := ""
		if code.UsedBy != "" {
			usedBy = code.UsedBy
		}
		if code.UsedAt != nil {
			usedAt = code.UsedAt.Format("2006-01-02 15:04:05")
		}

		writer.Write([]string{
			code.CodeID,
			strconv.Itoa(code.Points),
			code.Status,
			code.CreatedAt.Format("2006-01-02 15:04:05"),
			usedBy,
			usedAt,
		})
	}

	writer.Flush()
	return builder.String()
}

func main() {
	lambda.Start(handler)
}
