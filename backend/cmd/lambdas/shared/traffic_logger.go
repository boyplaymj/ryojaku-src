package shared

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// RecordTraffic increments the hit count for a given category/action and current date in Taipei time
func RecordTraffic(ctx context.Context, apiDB *dynamodb.Client, tablePrefix string, category string, action string) {
	// Category validation
	validCategories := map[string]bool{
		"core":      true,
		"games":     true,
		"community": true,
		"chat":      true,
		"user":      true,
		"ledger":    true,
	}

	if !validCategories[category] {
		log.Printf("[Traffic] Invalid category: %s", category)
		return
	}

	// Get current time in Taipei (UTC+8)
	loc, err := time.LoadLocation("Asia/Taipei")
	if err != nil {
		// Fallback if TZ data is missing
		loc = time.FixedZone("CST", 8*3600)
	}
	now := time.Now().In(loc)
	dateStr := now.Format("2006-01-02")

	tableName := tablePrefix + "TrafficStats"

	// Composite Sort Key: category#action
	// This details the specific action within the category
	sortKey := fmt.Sprintf("%s#%s", category, action)

	input := &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"Date":     &types.AttributeValueMemberS{Value: dateStr},
			"Category": &types.AttributeValueMemberS{Value: sortKey},
		},
		UpdateExpression: aws.String("ADD Hits :inc"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":inc": &types.AttributeValueMemberN{Value: "1"},
		},
	}

	_, err = apiDB.UpdateItem(ctx, input)
	if err != nil {
		log.Printf("[Traffic] Failed to record traffic for %s/%s on %s: %v", category, action, dateStr, err)
	}
}
