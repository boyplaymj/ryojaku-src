package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

const (
	codeCharset     = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"
	CodeStatusUnused = "unused"
	CodeStatusUsed   = "used"
)

// generateRedeemCodes generates a batch of redeem codes
func generateRedeemCodes(ctx context.Context, quantity, points int, createdBy string) ([]RedeemCode, *CodeBatch, error) {
	batchID := uuid.New().String()
	now := time.Now()
	taipeiLoc, _ := time.LoadLocation("Asia/Taipei")
	taipeiTime := now.In(taipeiLoc)

	// Create batch record
	batch := &CodeBatch{
		BatchID:      batchID,
		Points:       points,
		Quantity:     quantity,
		UsedCount:    0,
		CreatedBy:    createdBy,
		CreatedAt:    taipeiTime,
		CreatedAtNum: taipeiTime.Unix(),
	}

	// Save batch to database
	if err := saveBatch(ctx, batch); err != nil {
		return nil, nil, fmt.Errorf("failed to save batch: %w", err)
	}

	// Generate codes
	codes := make([]RedeemCode, quantity)
	for i := 0; i < quantity; i++ {
		codeID, err := generateCodeID()
		if err != nil {
			return nil, nil, fmt.Errorf("failed to generate code: %w", err)
		}

		codes[i] = RedeemCode{
			CodeID:       codeID,
			Points:       points,
			BatchID:      batchID,
			Status:       CodeStatusUnused,
			CreatedAt:    taipeiTime,
			CreatedAtNum: taipeiTime.Unix(),
		}

		// Save code to database
		if err := saveRedeemCode(ctx, &codes[i]); err != nil {
			return nil, nil, fmt.Errorf("failed to save code: %w", err)
		}
	}

	return codes, batch, nil
}

// generateCodeID generates a 16-character code
func generateCodeID() (string, error) {
	code := make([]byte, 16)
	charsetLen := big.NewInt(int64(len(codeCharset)))

	for i := 0; i < 16; i++ {
		num, err := rand.Int(rand.Reader, charsetLen)
		if err != nil {
			return "", err
		}
		code[i] = codeCharset[num.Int64()]
	}

	return string(code), nil
}

// saveBatch saves a code batch to DynamoDB
func saveBatch(ctx context.Context, batch *CodeBatch) error {
	item, err := attributevalue.MarshalMap(batch)
	if err != nil {
		return err
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tablePrefix + "CodeBatches"),
		Item:      item,
	})

	return err
}

// saveRedeemCode saves a redeem code to DynamoDB
func saveRedeemCode(ctx context.Context, code *RedeemCode) error {
	item, err := attributevalue.MarshalMap(code)
	if err != nil {
		return err
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tablePrefix + "RedeemCodes"),
		Item:      item,
	})

	return err
}

// getRedeemCodeStats calculates statistics for redeem codes
func getRedeemCodeStats(ctx context.Context) (*StatsResponse, error) {
	// Scan all codes to calculate stats
	var codes []RedeemCode
	var lastEvaluatedKey map[string]types.AttributeValue

	for {
		input := &dynamodb.ScanInput{
			TableName: aws.String(tablePrefix + "RedeemCodes"),
		}

		if lastEvaluatedKey != nil {
			input.ExclusiveStartKey = lastEvaluatedKey
		}

		result, err := dynamoClient.Scan(ctx, input)
		if err != nil {
			return nil, err
		}

		var batch []RedeemCode
		if err := attributevalue.UnmarshalListOfMaps(result.Items, &batch); err != nil {
			return nil, err
		}

		codes = append(codes, batch...)

		if result.LastEvaluatedKey == nil {
			break
		}
		lastEvaluatedKey = result.LastEvaluatedKey
	}

	// Calculate statistics
	stats := &StatsResponse{
		TotalCodes:         len(codes),
		UsedCodes:          0,
		UnusedCodes:        0,
		TotalPoints:        0,
		PointsDistribution: make([]PointsDistribution, 0),
	}

	pointsMap := make(map[int]int)

	for _, code := range codes {
		stats.TotalPoints += code.Points

		if code.Status == CodeStatusUsed {
			stats.UsedCodes++
		} else {
			stats.UnusedCodes++
		}

		pointsMap[code.Points]++
	}

	// Convert points map to distribution array
	for points, count := range pointsMap {
		stats.PointsDistribution = append(stats.PointsDistribution, PointsDistribution{
			Points: points,
			Count:  count,
		})
	}

	return stats, nil
}

// getBatches retrieves code batches
func getBatches(ctx context.Context, limit int) ([]CodeBatch, error) {
	// Query batches sorted by creation time (descending)
	input := &dynamodb.ScanInput{
		TableName: aws.String(tablePrefix + "CodeBatches"),
		Limit:     aws.Int32(int32(limit)),
	}

	result, err := dynamoClient.Scan(ctx, input)
	if err != nil {
		return nil, err
	}

	var batches []CodeBatch
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &batches); err != nil {
		return nil, err
	}

	// For each batch, count used codes
	for i := range batches {
		usedCount, err := countUsedCodesByBatch(ctx, batches[i].BatchID)
		if err != nil {
			log.Printf("Error counting used codes for batch %s: %v", batches[i].BatchID, err)
			continue
		}
		batches[i].UsedCount = usedCount
	}

	return batches, nil
}

// countUsedCodesByBatch counts used codes in a batch
func countUsedCodesByBatch(ctx context.Context, batchID string) (int, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(tablePrefix + "RedeemCodes"),
		IndexName:              aws.String("BatchIdIndex"),
		KeyConditionExpression: aws.String("batchId = :batchId AND #status = :status"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":batchId": &types.AttributeValueMemberS{Value: batchID},
			":status":  &types.AttributeValueMemberS{Value: CodeStatusUsed},
		},
		Select: types.SelectCount,
	}

	result, err := dynamoClient.Query(ctx, input)
	if err != nil {
		return 0, err
	}

	return int(result.Count), nil
}

// getCodesByBatch retrieves all codes in a batch
func getCodesByBatch(ctx context.Context, batchID string) ([]RedeemCode, error) {
	var codes []RedeemCode
	var lastEvaluatedKey map[string]types.AttributeValue

	for {
		input := &dynamodb.QueryInput{
			TableName:              aws.String(tablePrefix + "RedeemCodes"),
			IndexName:              aws.String("BatchIdIndex"),
			KeyConditionExpression: aws.String("batchId = :batchId"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":batchId": &types.AttributeValueMemberS{Value: batchID},
			},
		}

		if lastEvaluatedKey != nil {
			input.ExclusiveStartKey = lastEvaluatedKey
		}

		result, err := dynamoClient.Query(ctx, input)
		if err != nil {
			return nil, err
		}

		var batch []RedeemCode
		if err := attributevalue.UnmarshalListOfMaps(result.Items, &batch); err != nil {
			return nil, err
		}

		codes = append(codes, batch...)

		if result.LastEvaluatedKey == nil {
			break
		}
		lastEvaluatedKey = result.LastEvaluatedKey
	}

	return codes, nil
}

// getUsageTrend calculates usage trend for the past N days
func getUsageTrend(ctx context.Context, days int) (map[string]interface{}, error) {
	taipeiLoc, _ := time.LoadLocation("Asia/Taipei")
	now := time.Now().In(taipeiLoc)
	startDate := now.AddDate(0, 0, -days)

	// Query used codes within the date range
	input := &dynamodb.ScanInput{
		TableName:        aws.String(tablePrefix + "RedeemCodes"),
		FilterExpression: aws.String("#status = :status AND usedAt >= :startDate"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":status":    &types.AttributeValueMemberS{Value: CodeStatusUsed},
			":startDate": &types.AttributeValueMemberS{Value: startDate.Format(time.RFC3339)},
		},
	}

	result, err := dynamoClient.Scan(ctx, input)
	if err != nil {
		return nil, err
	}

	var codes []RedeemCode
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &codes); err != nil {
		return nil, err
	}

	// Group by date
	dateCountMap := make(map[string]int)
	for i := 0; i < days; i++ {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		dateCountMap[date] = 0
	}

	for _, code := range codes {
		if code.UsedAt != nil {
			date := code.UsedAt.In(taipeiLoc).Format("2006-01-02")
			dateCountMap[date]++
		}
	}

	// Convert to arrays
	dates := make([]string, days)
	counts := make([]int, days)
	for i := 0; i < days; i++ {
		date := now.AddDate(0, 0, -(days-1-i)).Format("2006-01-02")
		dates[i] = date
		counts[i] = dateCountMap[date]
	}

	return map[string]interface{}{
		"dates":  dates,
		"counts": counts,
	}, nil
}

