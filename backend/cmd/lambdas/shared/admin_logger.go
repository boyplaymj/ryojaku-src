package shared

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

var dbSvc *dynamodb.Client

func init() {
	cfg, _ := config.LoadDefaultConfig(context.TODO())
	dbSvc = dynamodb.NewFromConfig(cfg)
}

func LogAdminAction(ctx context.Context, adminUser, action, target, details string) {
	tablePrefix := os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
	tableName := tablePrefix + "AdminAuditLogs"

	logID := uuid.New().String()
	timestamp := time.Now().Unix()

	_, err := dbSvc.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item: map[string]types.AttributeValue{
			"log_id":    &types.AttributeValueMemberS{Value: logID},
			"timestamp": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", timestamp)},
			"admin":     &types.AttributeValueMemberS{Value: adminUser},
			"action":    &types.AttributeValueMemberS{Value: action},
			"target":    &types.AttributeValueMemberS{Value: target},
			"details":   &types.AttributeValueMemberS{Value: details},
		},
	})

	if err != nil {
		fmt.Printf("Failed to log admin action: %v\n", err)
	}
}
