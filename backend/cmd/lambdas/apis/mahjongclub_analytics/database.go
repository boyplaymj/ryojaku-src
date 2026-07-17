package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// User represents a user
type User struct {
	UserID            string    `dynamodbav:"userId"`
	DisplayName       string    `dynamodbav:"displayName"`
	Gender            string    `dynamodbav:"gender,omitempty"`
	MahjongExperience string    `dynamodbav:"mahjongExperience,omitempty"`
	CreatedAt         time.Time `dynamodbav:"createdAt"`
	UpdatedAt         time.Time `dynamodbav:"updatedAt"`
}

// Game represents a game
type Game struct {
	GameID         string    `dynamodbav:"gameId"`
	HostUserID     string    `dynamodbav:"hostUserId"`
	Type           string    `dynamodbav:"type"`
	Status         string    `dynamodbav:"status"`
	PlayersNeeded  int       `dynamodbav:"playersNeeded"`
	CurrentPlayers int       `dynamodbav:"currentPlayers"`
	CreatedAt      int64     `dynamodbav:"createdAt"`
	UpdatedAt      time.Time `dynamodbav:"updatedAt"`
}

// Registration represents a registration
type Registration struct {
	RegistrationID string    `dynamodbav:"registrationId"`
	GameID         string    `dynamodbav:"gameId"`
	UserID         string    `dynamodbav:"userId"`
	Status         string    `dynamodbav:"status"`
	CreatedAt      int64     `dynamodbav:"createdAt"`
	UpdatedAt      time.Time `dynamodbav:"updatedAt"`
}

// Rating represents a rating
type Rating struct {
	RatingID   string    `dynamodbav:"ratingId"`
	GameID     string    `dynamodbav:"gameId"`
	FromUserID string    `dynamodbav:"fromUserId"`
	ToUserID   string    `dynamodbav:"toUserId"`
	IsPositive bool      `dynamodbav:"isPositive"`
	CreatedAt  int64     `dynamodbav:"createdAt"`
	UpdatedAt  time.Time `dynamodbav:"updatedAt"`
}

// RatingComment represents a rating comment from RatingComments table
type RatingComment struct {
	CommentID       string    `dynamodbav:"commentId"`
	RatingID        string    `dynamodbav:"ratingId"`
	GameID          string    `dynamodbav:"gameId"`
	FromUserID      string    `dynamodbav:"fromUserId"`
	FromDisplayName string    `dynamodbav:"fromDisplayName"`
	ToUserID        string    `dynamodbav:"toUserId"`
	IsPositive      bool      `dynamodbav:"isPositive"`
	Comment         string    `dynamodbav:"comment"`
	CreatedAt       int64     `dynamodbav:"createdAt"`
	UpdatedAt       time.Time `dynamodbav:"updatedAt"`
}

// getTotalUsers returns the total number of users
func (db *Database) getTotalUsers(ctx context.Context) (int, error) {
	tableName := db.cfg.GetTableName("Users")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
		Select:    types.SelectCount,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to scan users: %w", err)
	}

	return int(result.Count), nil
}

// getTotalGames returns the total number of games
func (db *Database) getTotalGames(ctx context.Context) (int, error) {
	tableName := db.cfg.GetTableName("Games")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
		Select:    types.SelectCount,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to scan games: %w", err)
	}

	return int(result.Count), nil
}

// getTodayNewUsers returns the number of new users today
func (db *Database) getTodayNewUsers(ctx context.Context) (int, error) {
	tableName := db.cfg.GetTableName("Users")

	// Get start of today in Asia/Taipei timezone
	loc := time.FixedZone("Asia/Taipei", 8*60*60)
	now := time.Now().In(loc)
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(tableName),
		FilterExpression: aws.String("createdAt >= :startOfDay"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":startOfDay": &types.AttributeValueMemberS{Value: startOfDay.Format(time.RFC3339)},
		},
		Select: types.SelectCount,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to scan today's users: %w", err)
	}

	return int(result.Count), nil
}

// getTodayNewGames returns the number of new games today
func (db *Database) getTodayNewGames(ctx context.Context) (int, error) {
	tableName := db.cfg.GetTableName("Games")

	// Get start of today in Asia/Taipei timezone
	loc := time.FixedZone("Asia/Taipei", 8*60*60)
	now := time.Now().In(loc)
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	startOfDayUnix := startOfDay.Unix()

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(tableName),
		FilterExpression: aws.String("createdAt >= :startOfDay"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":startOfDay": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", startOfDayUnix)},
		},
		Select: types.SelectCount,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to scan today's games: %w", err)
	}

	return int(result.Count), nil
}

// getGamesByStatus returns games by status
func (db *Database) getGamesByStatus(ctx context.Context, status string) ([]Game, error) {
	tableName := db.cfg.GetTableName("Games")

	result, err := db.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(tableName),
		IndexName:              aws.String("status-createdAt-index"),
		KeyConditionExpression: aws.String("#status = :status"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":status": &types.AttributeValueMemberS{Value: status},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query games by status: %w", err)
	}

	var games []Game
	err = attributevalue.UnmarshalListOfMaps(result.Items, &games)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal games: %w", err)
	}

	return games, nil
}

// getUserGrowth returns user growth data for the last N days
func (db *Database) getUserGrowth(ctx context.Context, days int) ([]map[string]interface{}, error) {
	tableName := db.cfg.GetTableName("Users")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to scan users: %w", err)
	}

	var users []User
	err = attributevalue.UnmarshalListOfMaps(result.Items, &users)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal users: %w", err)
	}

	// Group by date
	loc := time.FixedZone("Asia/Taipei", 8*60*60)
	now := time.Now().In(loc)
	dateCounts := make(map[string]int)

	// Initialize all dates with 0
	for i := 0; i < days; i++ {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		dateCounts[date] = 0
	}

	// Count users by date
	for _, user := range users {
		userDate := user.CreatedAt.In(loc).Format("2006-01-02")
		if _, exists := dateCounts[userDate]; exists {
			dateCounts[userDate]++
		}
	}

	// Convert to array
	var growth []map[string]interface{}
	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		growth = append(growth, map[string]interface{}{
			"date":  date,
			"count": dateCounts[date],
		})
	}

	return growth, nil
}

// getUserStats returns user statistics
func (db *Database) getUserStats(ctx context.Context) (map[string]interface{}, error) {
	tableName := db.cfg.GetTableName("Users")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to scan users: %w", err)
	}

	var users []User
	err = attributevalue.UnmarshalListOfMaps(result.Items, &users)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal users: %w", err)
	}

	// Calculate statistics
	genderCounts := make(map[string]int)
	experienceCounts := make(map[string]int)

	for _, user := range users {
		// Count gender distribution
		if user.Gender != "" {
			genderCounts[user.Gender]++
		} else {
			genderCounts["未設定"]++
		}

		// Count experience distribution
		if user.MahjongExperience != "" {
			experienceCounts[user.MahjongExperience]++
		} else {
			experienceCounts["未設定"]++
		}
	}

	stats := map[string]interface{}{
		"total":                  len(users),
		"genderDistribution":     genderCounts,
		"experienceDistribution": experienceCounts,
	}

	return stats, nil
}

// getGameStats returns game statistics for the last N days
func (db *Database) getGameStats(ctx context.Context, days int) (map[string]interface{}, error) {
	tableName := db.cfg.GetTableName("Games")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to scan games: %w", err)
	}

	var games []Game
	err = attributevalue.UnmarshalListOfMaps(result.Items, &games)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal games: %w", err)
	}

	// Group by date
	loc := time.FixedZone("Asia/Taipei", 8*60*60)
	now := time.Now().In(loc)
	dateCounts := make(map[string]int)

	// Initialize all dates with 0
	for i := 0; i < days; i++ {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		dateCounts[date] = 0
	}

	// Count games by date
	for _, game := range games {
		gameTime := time.Unix(game.CreatedAt, 0).In(loc)
		gameDate := gameTime.Format("2006-01-02")
		if _, exists := dateCounts[gameDate]; exists {
			dateCounts[gameDate]++
		}
	}

	// Convert to array
	var dailyGames []map[string]interface{}
	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		dailyGames = append(dailyGames, map[string]interface{}{
			"date":  date,
			"count": dateCounts[date],
		})
	}

	stats := map[string]interface{}{
		"dailyGames": dailyGames,
		"total":      len(games),
	}

	return stats, nil
}

// getGameStatusDistribution returns game status distribution
func (db *Database) getGameStatusDistribution(ctx context.Context) (map[string]interface{}, error) {
	tableName := db.cfg.GetTableName("Games")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to scan games: %w", err)
	}

	var games []Game
	err = attributevalue.UnmarshalListOfMaps(result.Items, &games)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal games: %w", err)
	}

	// Count by status
	statusCounts := make(map[string]int)
	typeCounts := make(map[string]int)
	playersCounts := make(map[int]int)

	for _, game := range games {
		statusCounts[game.Status]++
		typeCounts[game.Type]++
		playersCounts[game.PlayersNeeded]++
	}

	distribution := map[string]interface{}{
		"statusDistribution":  statusCounts,
		"typeDistribution":    typeCounts,
		"playersDistribution": playersCounts,
	}

	return distribution, nil
}

// getRegistrationStats returns registration statistics for the last N days
func (db *Database) getRegistrationStats(ctx context.Context, days int) (map[string]interface{}, error) {
	tableName := db.cfg.GetTableName("Registrations")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to scan registrations: %w", err)
	}

	var registrations []Registration
	err = attributevalue.UnmarshalListOfMaps(result.Items, &registrations)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal registrations: %w", err)
	}

	// Group by date
	loc := time.FixedZone("Asia/Taipei", 8*60*60)
	now := time.Now().In(loc)
	dateCounts := make(map[string]int)

	// Initialize all dates with 0
	for i := 0; i < days; i++ {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		dateCounts[date] = 0
	}

	// Count registrations by date and status
	statusCounts := make(map[string]int)
	for _, reg := range registrations {
		regTime := time.Unix(reg.CreatedAt, 0).In(loc)
		regDate := regTime.Format("2006-01-02")
		if _, exists := dateCounts[regDate]; exists {
			dateCounts[regDate]++
		}
		statusCounts[reg.Status]++
	}

	// Convert to array
	var dailyRegistrations []map[string]interface{}
	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		dailyRegistrations = append(dailyRegistrations, map[string]interface{}{
			"date":  date,
			"count": dateCounts[date],
		})
	}

	stats := map[string]interface{}{
		"dailyRegistrations": dailyRegistrations,
		"statusDistribution": statusCounts,
		"total":              len(registrations),
	}

	return stats, nil
}

// getRatingStats returns rating statistics from RatingComments table
func (db *Database) getRatingStats(ctx context.Context) (map[string]interface{}, error) {
	tableName := db.cfg.GetTableName("RatingComments")

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		log.Printf("Warning: failed to scan rating comments (table may not exist): %v", err)
		return map[string]interface{}{
			"total":        0,
			"positive":     0,
			"negative":     0,
			"positiveRate": 0.0,
		}, nil
	}

	var comments []RatingComment
	err = attributevalue.UnmarshalListOfMaps(result.Items, &comments)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal rating comments: %w", err)
	}

	// Calculate statistics from RatingComments
	positiveCount := 0
	negativeCount := 0

	for _, comment := range comments {
		if comment.IsPositive {
			positiveCount++
		} else {
			negativeCount++
		}
	}

	positiveRate := 0.0
	if len(comments) > 0 {
		positiveRate = (float64(positiveCount) / float64(len(comments))) * 100
	}

	stats := map[string]interface{}{
		"total":        len(comments),
		"positive":     positiveCount,
		"negative":     negativeCount,
		"positiveRate": positiveRate,
	}

	return stats, nil
}

// getTodayRegistrations returns the number of registrations today
func (db *Database) getTodayRegistrations(ctx context.Context) (int, error) {
	tableName := db.cfg.GetTableName("Registrations")

	// Get start of today in Asia/Taipei timezone
	loc := time.FixedZone("Asia/Taipei", 8*60*60)
	now := time.Now().In(loc)
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	startOfDayUnix := startOfDay.Unix()

	result, err := db.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(tableName),
		FilterExpression: aws.String("createdAt >= :startOfDay"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":startOfDay": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", startOfDayUnix)},
		},
		Select: types.SelectCount,
	})
	if err != nil {
		log.Printf("Warning: failed to scan today's registrations: %v", err)
		return 0, nil
	}

	return int(result.Count), nil
}
