package shared

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

// UpdateUserPoints updates a user's points and records the transaction.
// Based on the safety plan, this initially uses "Shadow Logging" - log failures will not block the main process.
func UpdateUserPoints(ctx context.Context, apiDB *dynamodb.Client, tablePrefix string, userID string, amount int, reason string, source string, metadata map[string]interface{}) (int, error) {
	usersTable := tablePrefix + "Users"

	// Determine transaction type
	txType := PointTypeCredit
	updateExpr := "ADD points :amt"
	if amount < 0 {
		txType = PointTypeDebit
		// amount is negative, ADDing a negative value is subtraction
	}

	// 1. Update the User's points
	updateInput := &dynamodb.UpdateItemInput{
		TableName: aws.String(usersTable),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression: aws.String(updateExpr),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":amt": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", amount)},
		},
		ReturnValues: types.ReturnValueAllNew,
	}

	result, err := apiDB.UpdateItem(ctx, updateInput)
	if err != nil {
		return 0, fmt.Errorf("failed to update user points: %w", err)
	}

	// Extract new balance
	var newUser User
	err = attributevalue.UnmarshalMap(result.Attributes, &newUser)
	if err != nil {
		return 0, fmt.Errorf("failed to unmarshal updated user: %w", err)
	}

	balanceAfter := newUser.Points
	balanceBefore := balanceAfter - amount

	// 2. Shadow Logging - Write to PointTransactions
	// We do this in a way that failures don't block the caller (Phase 1 of safety plan)
	go func() {
		// Use a fresh context or background context to ensure logging persists even if request context is cancelled
		logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		logErr := RecordPointChangeShadow(logCtx, apiDB, tablePrefix, userID, amount, txType, balanceBefore, balanceAfter, reason, source, metadata)
		if logErr != nil {
			log.Printf("[Points] CRITICAL: Shadow logging failed for user %s: %v", userID, logErr)
		}
	}()

	return balanceAfter, nil
}

// RecordPointChangeShadow handles the actual writing to the transactions table.
// It is exported to allow manual logging in cases where the points were updated via other means (e.g. PutItem during registration).
func RecordPointChangeShadow(ctx context.Context, apiDB *dynamodb.Client, tablePrefix string, userID string, amount int, txType PointTransactionType, before int, after int, reason string, source string, metadata map[string]interface{}) error {
	txTable := tablePrefix + "PointTransactions"

	now := time.Now()
	txID := uuid.New().String()

	// Absolute value for amount in log
	absAmount := amount
	if absAmount < 0 {
		absAmount = -absAmount
	}

	// SortKey: TIME#<UnixTimestamp>#<UUID>
	sortKey := fmt.Sprintf("TIME#%d#%s", now.Unix(), txID)

	tx := PointTransaction{
		UserID:        userID,
		SortKey:       sortKey,
		TransactionID: txID,
		Type:          txType,
		Amount:        absAmount,
		BalanceBefore: before,
		BalanceAfter:  after,
		Reason:        reason,
		Source:        source,
		Metadata:      metadata,
		CreatedAt:     now.UnixMilli(),
	}

	av, err := attributevalue.MarshalMap(tx)
	if err != nil {
		return err
	}

	_, err = apiDB.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(txTable),
		Item:      av,
	})

	return err
}
