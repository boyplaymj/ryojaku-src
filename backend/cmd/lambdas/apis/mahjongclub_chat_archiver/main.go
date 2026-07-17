package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

var s3Client *s3.Client
var archiveBucket string

func init() {
	awsRegion := os.Getenv("AWS_REGION")
	if awsRegion == "" {
		awsRegion = "ap-southeast-1"
	}
	archiveBucket = os.Getenv("ARCHIVE_BUCKET")
	if archiveBucket == "" {
		archiveBucket = "mahjongclub-chat-archive-ap-southeast-1"
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(awsRegion))
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	s3Client = s3.NewFromConfig(awsCfg)
}

func Handler(ctx context.Context, event events.DynamoDBEvent) error {
	log.Printf("Processing %d DynamoDB Stream records", len(event.Records))

	for _, record := range event.Records {
		// We only care about REMOVE events (TTL expired)
		if record.EventName != "REMOVE" {
			continue
		}

		// Since it's a REMOVE event, OldImage contains the data
		oldImage := record.Change.OldImage
		if oldImage == nil {
			continue
		}

		roomId := oldImage["roomId"].String()
		timestampId := oldImage["timestamp#messageId"].String()
		
		log.Printf("Archiving message: Room=%s, ID=%s", roomId, timestampId)

		// Create a JSON of the message
		msgMap := make(map[string]interface{})
		for k, v := range oldImage {
			msgMap[k] = v.String() // Simplified, as most fields are strings
		}
		
		msgJSON, _ := json.Marshal(msgMap)

		// Key: chat-archive/roomId/timestampId.json
		key := fmt.Sprintf("chat-archive/%s/%s.json", roomId, timestampId)

		_, err := s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket: &archiveBucket,
			Key:    &key,
			Body:   bytes.NewReader(msgJSON),
		})

		if err != nil {
			log.Printf("Failed to archive message to S3: %v", err)
		}
	}

	return nil
}

func main() {
	lambda.Start(Handler)
}
