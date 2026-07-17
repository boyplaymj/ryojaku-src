package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"mahjongclub-backend/cmd/lambdas/shared"
)

type VersionConfigResponse struct {
	Success            bool   `json:"success"`
	MinRequiredVersion string `json:"minRequiredVersion"`
	LatestVersion      string `json:"latestVersion"`
	UpdateUrl          string `json:"updateUrl"`
	ForceUpdate        bool   `json:"forceUpdate"`
	InviterPoints      string `json:"inviterPoints"`
	InviteePoints      string `json:"inviteePoints"`
}

type ConfigItem struct {
	Key   string `dynamodbav:"info_key"`
	Value string `dynamodbav:"info_value"`
}

var dynamoClient *dynamodb.Client
var tablePrefix string

func init() {
	awsRegion := getEnv("AWS_REGION", "ap-southeast-1")
	tablePrefix = getEnv("TABLE_PREFIX", "MahjongClub_")

	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(awsRegion))
	if err != nil {
		log.Printf("Failed to load AWS config: %v", err)
	} else {
		dynamoClient = dynamodb.NewFromConfig(cfg)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Record traffic
	if dynamoClient != nil {
		shared.RecordTraffic(ctx, dynamoClient, tablePrefix, "core", "get_version")
	}

	log.Printf("Received request: %s %s", request.HTTPMethod, request.Path)

	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       "",
		}, nil
	}

	// Default fallback to environment variable (or hardcoded default)
	minVersion := getEnv("MIN_REQUIRED_VERSION", "1.0.0")
	latestVersion := minVersion
	updateUrl := "https://jiomj.com"
	inviterPoints := "100" // Default
	inviteePoints := "50"  // Default
	
	// Try to fetch from DynamoDB to get dynamic config
	if dynamoClient != nil {
		table := tablePrefix + "AdminConfigs"
		input := &dynamodb.ScanInput{
			TableName: aws.String(table),
		}
		
		result, err := dynamoClient.Scan(ctx, input)
		if err == nil {
			var items []ConfigItem
			if err := attributevalue.UnmarshalListOfMaps(result.Items, &items); err == nil {
				for _, item := range items {
					// Check for various potential key names to be robust
					if (item.Key == "minVersion" || item.Key == "min_version") && item.Value != "" {
						minVersion = item.Value
					}
					if (item.Key == "latestVersion" || item.Key == "latest_version") && item.Value != "" {
						latestVersion = item.Value
					}
					if (item.Key == "updateUrl" || item.Key == "update_url") && item.Value != "" {
						updateUrl = item.Value
					}
					if item.Key == "Activity:InviterPoints" && item.Value != "" {
						inviterPoints = item.Value
					}
					if item.Key == "Activity:InviteePoints" && item.Value != "" {
						inviteePoints = item.Value
					}
				}
			} else {
				log.Printf("Failed to unmarshal config items: %v", err)
			}
		} else {
			log.Printf("Failed to scan config table: %v", err)
		}
	}
	
	// Ensure latestVersion is at least equal to minVersion if logic dictates
	// (Optional: depends on business logic, here we keep them independent or default)
	
	response := VersionConfigResponse{
		Success:            true,
		MinRequiredVersion: minVersion,
		LatestVersion:      latestVersion,
		UpdateUrl:          updateUrl,
		ForceUpdate:        false, // Client logic in VersionGuard handles the forcing based on version mismatch
		InviterPoints:      inviterPoints,
		InviteePoints:      inviteePoints,
	}

	body, _ := json.Marshal(response)

	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
