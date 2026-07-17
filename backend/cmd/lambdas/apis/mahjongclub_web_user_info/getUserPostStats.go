package main

import (
	"context"
	"log"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// getUserPostStats calculates real-time post statistics (TotalPosts, TotalLikesReceived)
// It queries the Community table using authorId-createdAt-index and filters for actual posts (sortKey=METADATA)
// preventing commenting replies from being counted.
func getUserPostStats(ctx context.Context, userID string) (*shared.UserStats, error) {
	tableName := tablePrefix + "Community"

	// Query to get all posts by user
	// Note: For heavy users, this might be expensive.
	// Filter logic aligns with community-get-user-posts: sortKey must be METADATA
	input := &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("authorId-createdAt-index"),
		KeyConditionExpression: aws.String("authorId = :authorId"),
		FilterExpression:       aws.String("sortKey = :metadata"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":authorId": &types.AttributeValueMemberS{Value: userID},
			":metadata": &types.AttributeValueMemberS{Value: "METADATA"},
		},
	}

	totalPosts := 0
	totalLikes := 0

	// Use pagination to scan all posts
	paginator := dynamodb.NewQueryPaginator(dynamoClient, input)

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			log.Printf("Failed to query user posts stats: %v", err)
			return nil, err
		}

		totalPosts += len(page.Items)

		for _, item := range page.Items {
			// Extract likeCount
			if v, ok := item["likeCount"]; ok {
				var count int
				if err := attributevalue.Unmarshal(v, &count); err == nil {
					totalLikes += count
				}
			}
		}
	}

	return &shared.UserStats{
		TotalPosts:         totalPosts,
		TotalLikesReceived: totalLikes,
	}, nil
}
