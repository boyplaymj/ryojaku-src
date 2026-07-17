package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func main() {
	ctx := context.TODO()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-southeast-1"))
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}

	dbClient := dynamodb.NewFromConfig(cfg)
	tablePrefix := "MahjongClub_"
	membershipsTable := tablePrefix + "ChatUserMemberships"

	// Scan a few records to see the structure
	fmt.Println("Scanning ChatUserMemberships table...")
	result, err := dbClient.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(membershipsTable),
		Limit:     aws.Int32(10),
	})
	if err != nil {
		log.Fatalf("failed to scan, %v", err)
	}

	for _, item := range result.Items {
		b, _ := json.Marshal(item)
		fmt.Println(string(b))
	}
}
