package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// Config holds the configuration
type Config struct {
	AWSRegion   string
	TablePrefix string
}

// Database handles DynamoDB operations
type Database struct {
	client *dynamodb.Client
	cfg    *Config
}

// Response structure for API responses
type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

var db *Database

func init() {
	cfg := &Config{
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(cfg.AWSRegion),
	)
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	db = &Database{
		client: dynamodb.NewFromConfig(awsCfg),
		cfg:    cfg,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func (c *Config) GetTableName(tableName string) string {
	return c.TablePrefix + tableName
}

// CreateLedgerEntry creates a new bookkeeping record
func (d *Database) CreateLedgerEntry(ctx context.Context, entry *shared.LedgerEntry) error {
	now := time.Now().Unix()
	entry.CreatedAt = now
	entry.UpdatedAt = now
	
	if entry.LedgerID == "" {
		entry.LedgerID = uuid.New().String()
	}
	
	// SortKey format: LEDGER#<Timestamp>#<UUID>
	// Use Date + CreatedAt for better sorting by date in DynamoDB if needed
	entry.SortKey = fmt.Sprintf("LEDGER#%d#%s", now, entry.LedgerID)

	av, err := attributevalue.MarshalMap(entry)
	if err != nil {
		return err
	}

	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.cfg.GetTableName("Ledger")),
		Item:      av,
	})
	return err
}

// UpdateLedgerEntry updates an existing bookkeeping record
func (d *Database) UpdateLedgerEntry(ctx context.Context, entry *shared.LedgerEntry) error {
	entry.UpdatedAt = time.Now().Unix()
	
	// SortKey format: LEDGER#<Timestamp>#<UUID>
	// We must use the original CreatedAt to find the correct item
	if entry.CreatedAt == 0 {
		return fmt.Errorf("createdAt is required for update")
	}
	entry.SortKey = fmt.Sprintf("LEDGER#%d#%s", entry.CreatedAt, entry.LedgerID)

	av, err := attributevalue.MarshalMap(entry)
	if err != nil {
		return err
	}

	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.cfg.GetTableName("Ledger")),
		Item:      av,
	})
	return err
}


// DeleteLedgerEntry deletes a bookkeeping record
func (d *Database) DeleteLedgerEntry(ctx context.Context, userID, ledgerID string, createdAt int64) error {
	sortKey := fmt.Sprintf("LEDGER#%d#%s", createdAt, ledgerID)
	
	_, err := d.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(d.cfg.GetTableName("Ledger")),
		Key: map[string]types.AttributeValue{
			"userId":  &types.AttributeValueMemberS{Value: userID},
			"sortKey": &types.AttributeValueMemberS{Value: sortKey},
		},
	})
	return err
}


// GetLedgerEntries retrieves entries for a user
func (d *Database) GetLedgerEntries(ctx context.Context, userID string) ([]shared.LedgerEntry, error) {
	result, err := d.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(d.cfg.GetTableName("Ledger")),
		KeyConditionExpression: aws.String("userId = :userId AND begins_with(sortKey, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId": &types.AttributeValueMemberS{Value: userID},
			":prefix": &types.AttributeValueMemberS{Value: "LEDGER#"},
		},
	})

	if err != nil {
		return nil, err
	}

	var entries []shared.LedgerEntry
	err = attributevalue.UnmarshalListOfMaps(result.Items, &entries)
	if err != nil {
		return nil, err
	}

	// Sort by date (descending)
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Date != entries[j].Date {
			return entries[i].Date > entries[j].Date
		}
		return entries[i].CreatedAt > entries[j].CreatedAt
	})

	return entries, nil
}

// Handler is the main Lambda handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: ""}, nil
	}

	userID := request.QueryStringParameters["userId"]
	if userID == "" {
		// Try to fallback to authenticated user if available in context (not implemented here but good to have)
		return errorResponse(http.StatusBadRequest, "Missing userId", headers)
	}

	switch request.HTTPMethod {
	case "POST":
		var entry shared.LedgerEntry
		if err := json.Unmarshal([]byte(request.Body), &entry); err != nil {
			return errorResponse(http.StatusBadRequest, "Invalid request body", headers)
		}
		entry.UserID = userID
		if err := db.CreateLedgerEntry(ctx, &entry); err != nil {
			return errorResponse(http.StatusInternalServerError, "Failed to create entry", headers)
		}
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "ledger", "create")
		return successResponse(entry, headers)

	case "PUT":
		var entry shared.LedgerEntry
		if err := json.Unmarshal([]byte(request.Body), &entry); err != nil {
			return errorResponse(http.StatusBadRequest, "Invalid request body", headers)
		}
		entry.UserID = userID
		if entry.LedgerID == "" {
			return errorResponse(http.StatusBadRequest, "Missing ledgerId", headers)
		}
		if err := db.UpdateLedgerEntry(ctx, &entry); err != nil {
			return errorResponse(http.StatusInternalServerError, "Failed to update entry", headers)
		}
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "ledger", "update")
		return successResponse(entry, headers)

	case "DELETE":
		ledgerID := request.QueryStringParameters["ledgerId"]
		createdAtStr := request.QueryStringParameters["createdAt"]
		if ledgerID == "" || createdAtStr == "" {
			return errorResponse(http.StatusBadRequest, "Missing ledgerId or createdAt", headers)
		}
		var createdAt int64
		fmt.Sscanf(createdAtStr, "%d", &createdAt)
		if createdAt == 0 {
			return errorResponse(http.StatusBadRequest, "Invalid createdAt", headers)
		}
		if err := db.DeleteLedgerEntry(ctx, userID, ledgerID, createdAt); err != nil {
			return errorResponse(http.StatusInternalServerError, "Failed to delete entry", headers)
		}
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "ledger", "delete")
		return successResponse("Deleted successfully", headers)

	case "GET":
		if request.Path == "/ledger/summary" {
			entries, err := db.GetLedgerEntries(ctx, userID)
			if err != nil {
				return errorResponse(http.StatusInternalServerError, "Failed to fetch summary", headers)
			}
			summary := calculateSummary(entries)
			shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "ledger", "summary")
			return successResponse(summary, headers)
		}

		entries, err := db.GetLedgerEntries(ctx, userID)
		if err != nil {
			return errorResponse(http.StatusInternalServerError, "Failed to fetch entries", headers)
		}
		shared.RecordTraffic(ctx, db.client, db.cfg.TablePrefix, "ledger", "list")
		return successResponse(entries, headers)

	default:
		return errorResponse(http.StatusMethodNotAllowed, "Method not allowed", headers)
	}


}

func calculateSummary(entries []shared.LedgerEntry) shared.LedgerSummary {
	summary := shared.LedgerSummary{
		TotalEntries: len(entries),
		MoodStats:    make(map[string]int),
	}

	if len(entries) == 0 {
		return summary
	}

	winCount := 0
	for _, e := range entries {
		summary.TotalWinLoss += e.WinLoss
		summary.TotalRounds += e.Rounds
		if e.WinLoss > 0 {
			winCount++
		}
		if e.Mood != "" {
			summary.MoodStats[e.Mood]++
		}
	}

	summary.AverageWin = float64(summary.TotalWinLoss) / float64(len(entries))
	summary.WinRate = (float64(winCount) / float64(len(entries))) * 100

	return summary
}

func successResponse(data interface{}, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: true, Data: data})
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func errorResponse(code int, msg string, headers map[string]string) (events.APIGatewayProxyResponse, error) {
	body, _ := json.Marshal(Response{Success: false, Error: msg})
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
