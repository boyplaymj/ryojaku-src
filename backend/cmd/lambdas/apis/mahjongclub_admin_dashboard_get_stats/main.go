package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

// Config holds the configuration
type Config struct {
	AWSRegion   string
	TablePrefix string
	JWTSecret   string
}

// StatsResponse represents the dashboard statistics
type StatsResponse struct {
	Users         UserStats           `json:"users"`
	Games         GameStats           `json:"games"`
	Registrations RegistrationStats   `json:"registrations"`
	Community     CommunityStats      `json:"community"`
	Trends        []TrendData         `json:"trends"`
	GamesTrend    []DailyStats        `json:"gamesTrend"`
	RegTrend      []RegStatsTrend     `json:"regTrend"`
	TrafficTrend  []TrafficStatsTrend `json:"trafficTrend"`
}

type UserStats struct {
	Total       int     `json:"total"`
	NewToday    int     `json:"newToday"`
	ActiveToday int     `json:"activeToday"`
	GrowthRate  float64 `json:"growthRate"`
}

type GameStats struct {
	Total               int `json:"total"`
	Active              int `json:"active"`
	RecruitingToday     int `json:"recruitingToday"`
	RecruitingYesterday int `json:"recruitingYesterday"`
	FullToday           int `json:"fullToday"`
	FullYesterday       int `json:"fullYesterday"`
	NewToday            int `json:"newToday"`
}

type RegistrationStats struct {
	Total          int     `json:"total"`
	Pending        int     `json:"pending"`
	Accepted       int     `json:"accepted"`
	AcceptanceRate float64 `json:"acceptanceRate"`
}

type CommunityStats struct {
	PostsToday   int `json:"postsToday"`
	Interactions int `json:"interactions"`
}

type TrendData struct {
	Date  string `json:"date"`
	Value int    `json:"value"`
}

type DailyStats struct {
	Date  string `json:"date"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

type RegStatsTrend struct {
	Date    string `json:"date"`
	Label   string `json:"label"`
	Total   int    `json:"total"`
	Success int    `json:"success"`
}

type TrafficStatsTrend struct {
	Date      string `json:"date"`
	Label     string `json:"label"`
	Community int    `json:"community"`
	Games     int    `json:"games"`
}

var db *dynamodb.Client
var cfg *Config

func init() {
	cfg = &Config{
		AWSRegion:   getEnv("AWS_REGION", "ap-southeast-1"),
		TablePrefix: getEnv("TABLE_PREFIX", "MahjongClub_"),
		JWTSecret:   getEnv("JWT_SECRET", "default-secret-change-me"),
	}

	awsCfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(cfg.AWSRegion),
	)
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	db = dynamodb.NewFromConfig(awsCfg)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// ValidateToken validates the JWT token
func ValidateToken(tokenString, secret string) (jwt.MapClaims, error) {
	tokenString = strings.TrimPrefix(tokenString, "Bearer ")

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

func countTable(ctx context.Context, tableName string) (int, error) {
	input := &dynamodb.ScanInput{
		TableName: &tableName,
		Select:    types.SelectCount,
	}

	totalCount := 0
	var startKey map[string]types.AttributeValue
	for {
		input.ExclusiveStartKey = startKey
		result, err := db.Scan(ctx, input)
		if err != nil {
			return 0, err
		}
		totalCount += int(result.Count)

		startKey = result.LastEvaluatedKey
		if len(startKey) == 0 {
			break
		}
	}
	return totalCount, nil
}

func countWithFilter(ctx context.Context, tableName string, filterExpr string, exprNames map[string]string, exprValues map[string]types.AttributeValue) (int, error) {
	input := &dynamodb.ScanInput{
		TableName:                 &tableName,
		FilterExpression:          &filterExpr,
		ExpressionAttributeNames:  exprNames,
		ExpressionAttributeValues: exprValues,
		Select:                    types.SelectCount,
	}

	totalCount := 0
	var startKey map[string]types.AttributeValue
	for {
		input.ExclusiveStartKey = startKey
		result, err := db.Scan(ctx, input)
		if err != nil {
			return 0, err
		}
		totalCount += int(result.Count)

		startKey = result.LastEvaluatedKey
		if len(startKey) == 0 {
			break
		}
	}
	return totalCount, nil
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Content-Type":                 "application/json",
	}

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers}, nil
	}

	// Auth Check
	token := request.Headers["Authorization"]
	if token == "" {
		token = request.Headers["authorization"]
	}

	_, err := ValidateToken(token, cfg.JWTSecret)
	if err != nil {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusUnauthorized,
			Headers:    headers,
			Body:       `{"success":false,"error":"Unauthorized"}`,
		}, nil
	}

	// --- Aggregating Stats ---
	loc, _ := time.LoadLocation("Asia/Taipei")
	nowTaipei := time.Now().In(loc)

	// Helper: Get start/end of a day in Taipei time
	// Returns: Unix timestamp, UTC-formatted ISO string (for consistent DB filtering)
	getTaipeiDayBoundaries := func(d time.Time) (int64, string) {
		start := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc)
		// 使用 UTC 格式以與 analysis API 保持一致
		return start.Unix(), start.UTC().Format(time.RFC3339)
	}

	todayUnix, todayISO := getTaipeiDayBoundaries(nowTaipei)

	// 1. Users (createdAt: String ISO8601)
	usersTable := cfg.TablePrefix + "Users"
	totalUsers, _ := countTable(ctx, usersTable)
	newTodayUsers, _ := countWithFilter(ctx, usersTable, "createdAt >= :s", nil, map[string]types.AttributeValue{
		":s": &types.AttributeValueMemberS{Value: todayISO},
	})

	userStats := UserStats{
		Total:       totalUsers,
		NewToday:    newTodayUsers,
		ActiveToday: totalUsers/15 + 1, // Simplified estimate
		GrowthRate:  0,
	}
	if totalUsers > 0 {
		userStats.GrowthRate = float64(newTodayUsers) / float64(totalUsers) * 100
	}

	// 2. Games (createdAt: Number Unix, status: String)
	gamesTable := cfg.TablePrefix + "Games"
	totalGamesCount, _ := countTable(ctx, gamesTable)
	activeGames, _ := countWithFilter(ctx, gamesTable, "#s IN (:s1, :s2)", map[string]string{"#s": "status"}, map[string]types.AttributeValue{
		":s1": &types.AttributeValueMemberS{Value: "recruiting"},
		":s2": &types.AttributeValueMemberS{Value: "full"},
	})

	yesterdayUnix, _ := getTaipeiDayBoundaries(nowTaipei.AddDate(0, 0, -1))
	yesterdayEndUnix := todayUnix - 1

	recruitingToday, _ := countWithFilter(ctx, gamesTable, "#s = :s AND createdAt >= :t", map[string]string{"#s": "status"}, map[string]types.AttributeValue{
		":s": &types.AttributeValueMemberS{Value: "recruiting"},
		":t": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", todayUnix)},
	})
	fullToday, _ := countWithFilter(ctx, gamesTable, "#s = :s AND createdAt >= :t", map[string]string{"#s": "status"}, map[string]types.AttributeValue{
		":s": &types.AttributeValueMemberS{Value: "full"},
		":t": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", todayUnix)},
	})

	recruitingYesterday, _ := countWithFilter(ctx, gamesTable, "#s = :s AND (createdAt BETWEEN :st AND :et)", map[string]string{"#s": "status"}, map[string]types.AttributeValue{
		":s":  &types.AttributeValueMemberS{Value: "recruiting"},
		":st": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", yesterdayUnix)},
		":et": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", yesterdayEndUnix)},
	})
	fullYesterday, _ := countWithFilter(ctx, gamesTable, "#s = :s AND (createdAt BETWEEN :st AND :et)", map[string]string{"#s": "status"}, map[string]types.AttributeValue{
		":s":  &types.AttributeValueMemberS{Value: "full"},
		":st": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", yesterdayUnix)},
		":et": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", yesterdayEndUnix)},
	})

	newGamesToday, _ := countWithFilter(ctx, gamesTable, "createdAt >= :s", nil, map[string]types.AttributeValue{
		":s": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", todayUnix)},
	})

	gameStats := GameStats{
		Total:               totalGamesCount,
		Active:              activeGames,
		RecruitingToday:     recruitingToday,
		RecruitingYesterday: recruitingYesterday,
		FullToday:           fullToday,
		FullYesterday:       fullYesterday,
		NewToday:            newGamesToday,
	}

	// 3. Registrations (CreatedAt: Number Unix, status: String)
	regsTable := cfg.TablePrefix + "Registrations"
	totalRegs, _ := countTable(ctx, regsTable)
	pendingRegs, _ := countWithFilter(ctx, regsTable, "#s = :s", map[string]string{"#s": "status"}, map[string]types.AttributeValue{
		":s": &types.AttributeValueMemberS{Value: "pending"},
	})
	// Today's registrations (New entries today)
	newTodayRegs, _ := countWithFilter(ctx, regsTable, "createdAt >= :s", nil, map[string]types.AttributeValue{
		":s": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", todayUnix)},
	})

	regStats := RegistrationStats{
		Total:          totalRegs,
		Pending:        pendingRegs,
		Accepted:       newTodayRegs,
		AcceptanceRate: 0,
	}
	if totalRegs > 0 {
		regStats.AcceptanceRate = float64(totalRegs-pendingRegs) / float64(totalRegs) * 100
	}

	// 4. Community (Reports for now)
	reportsTable := cfg.TablePrefix + "Reports"
	totalReports, _ := countTable(ctx, reportsTable)

	communityStats := CommunityStats{
		PostsToday:   totalReports,
		Interactions: 0,
	}

	// 5. Trends (Last 7 days, Taipei Time)
	userTrends := make([]TrendData, 7)
	gamesTrend := make([]DailyStats, 7)
	regTrend := make([]RegStatsTrend, 7)
	trafficTrend := make([]TrafficStatsTrend, 7)

	for i := 0; i < 7; i++ {
		d := nowTaipei.AddDate(0, 0, -6+i)
		dateKey := d.Format("2006-01-02")
		startUnix, startISO := getTaipeiDayBoundaries(d)
		endUnix := startUnix + 86399

		dNext := d.AddDate(0, 0, 1)
		_, endISO := getTaipeiDayBoundaries(dNext)

		uCount, _ := countWithFilter(ctx, usersTable, "createdAt BETWEEN :s AND :e", nil, map[string]types.AttributeValue{
			":s": &types.AttributeValueMemberS{Value: startISO},
			":e": &types.AttributeValueMemberS{Value: endISO},
		})
		userTrends[i] = TrendData{
			Date:  d.Format("Mon"),
			Value: uCount,
		}

		gCount, _ := countWithFilter(ctx, gamesTable, "createdAt BETWEEN :st AND :et", nil, map[string]types.AttributeValue{
			":st": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", startUnix)},
			":et": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", endUnix)},
		})
		gamesTrend[i] = DailyStats{
			Date:  d.Format("2006-01-02"),
			Label: d.Format("01/02"),
			Count: gCount,
		}

		rTotal, _ := countWithFilter(ctx, regsTable, "createdAt BETWEEN :st AND :et", nil, map[string]types.AttributeValue{
			":st": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", startUnix)},
			":et": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", endUnix)},
		})
		rSuccess, _ := countWithFilter(ctx, regsTable, "#s = :status AND (createdAt BETWEEN :st AND :et)", map[string]string{"#s": "status"}, map[string]types.AttributeValue{
			":status": &types.AttributeValueMemberS{Value: "accepted"},
			":st":     &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", startUnix)},
			":et":     &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", endUnix)},
		})
		regTrend[i] = RegStatsTrend{
			Date:    d.Format("2006-01-02"),
			Label:   d.Format("01/02"),
			Total:   rTotal,
			Success: rSuccess,
		}

		// Traffic trend
		trafficTable := cfg.TablePrefix + "TrafficStats"
		hComm := 0
		hGames := 0

		resComm, err := db.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: &trafficTable,
			Key: map[string]types.AttributeValue{
				"Date":     &types.AttributeValueMemberS{Value: dateKey},
				"Category": &types.AttributeValueMemberS{Value: "community"},
			},
		})
		if err == nil && resComm != nil && resComm.Item != nil {
			attributevalue.Unmarshal(resComm.Item["Hits"], &hComm)
		}

		resGames, err := db.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: &trafficTable,
			Key: map[string]types.AttributeValue{
				"Date":     &types.AttributeValueMemberS{Value: dateKey},
				"Category": &types.AttributeValueMemberS{Value: "games"},
			},
		})
		if err == nil && resGames != nil && resGames.Item != nil {
			attributevalue.Unmarshal(resGames.Item["Hits"], &hGames)
		}

		trafficTrend[i] = TrafficStatsTrend{
			Date:      dateKey,
			Label:     d.Format("01/02"),
			Community: hComm,
			Games:     hGames,
		}
	}

	resp := StatsResponse{
		Users:         userStats,
		Games:         gameStats,
		Registrations: regStats,
		Community:     communityStats,
		Trends:        userTrends,
		GamesTrend:    gamesTrend,
		RegTrend:      regTrend,
		TrafficTrend:  trafficTrend,
	}

	body, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"data":    resp,
	})

	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    headers,
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(Handler)
}
