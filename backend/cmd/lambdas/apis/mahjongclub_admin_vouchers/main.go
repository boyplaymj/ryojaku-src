package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/golang-jwt/jwt/v5"
)

var (
	svc         *dynamodb.Client
	tablePrefix string
	jwtSecret   []byte
)

func init() {
	tablePrefix = os.Getenv("TABLE_PREFIX")
	if tablePrefix == "" {
		tablePrefix = "MahjongClub_"
	}
	jwtSecret = []byte(os.Getenv("JWT_SECRET"))
}

type Voucher struct {
	Code               string `json:"code"`
	Points             int    `json:"points"`
	MaxRedemptions     int    `json:"maxRedemptions"`
	CurrentRedemptions int    `json:"currentRedemptions"`
	Status             string `json:"status"`
	CreatedAt          int64  `json:"createdAt"`
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if svc == nil {
		cfg, _ := config.LoadDefaultConfig(ctx)
		svc = dynamodb.NewFromConfig(cfg)
	}

	// Auth Check — API Gateway 可能正規化 header 為大寫 Authorization,故兩種都試
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}
	claims, err := validateToken(authHeader)
	if err != nil {
		return errorResponse(401, "Unauthorized"), nil
	}
	adminUser := claims["sub"].(string)
	adminRole := claims["role"].(string)

	if adminRole != "super_admin" {
		return errorResponse(403, "Forbidden"), nil
	}

	tableName := tablePrefix + "ActivityVouchers"

	switch request.HTTPMethod {
	case "GET":
		return listVouchers(ctx, tableName)
	case "POST":
		if strings.HasSuffix(request.Path, "/delete") {
			return deleteVoucher(ctx, request, tableName, adminUser)
		}
		if strings.HasSuffix(request.Path, "/update") {
			return updateVoucher(ctx, request, tableName, adminUser)
		}
		return createVoucher(ctx, request, tableName, adminUser)
	default:
		return errorResponse(405, "Method Not Allowed"), nil
	}
}

func listVouchers(ctx context.Context, table string) (events.APIGatewayProxyResponse, error) {
	input := &dynamodb.ScanInput{
		TableName: aws.String(table),
	}
	result, err := svc.Scan(ctx, input)
	if err != nil {
		return errorResponse(500, "Failed to fetch vouchers"), nil
	}

	body, _ := json.Marshal(map[string]interface{}{
		"data": result.Items,
	})
	return successResponse(body), nil
}

func createVoucher(ctx context.Context, request events.APIGatewayProxyRequest, table string, adminUser string) (events.APIGatewayProxyResponse, error) {
	var v Voucher
	if err := json.Unmarshal([]byte(request.Body), &v); err != nil {
		return errorResponse(400, "Invalid JSON"), nil
	}

	v.CreatedAt = time.Now().Unix()
	v.Status = "active"
	v.CurrentRedemptions = 0

	_, err := svc.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(table),
		Item: map[string]types.AttributeValue{
			"code":               &types.AttributeValueMemberS{Value: v.Code},
			"points":             &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", v.Points)},
			"maxRedemptions":     &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", v.MaxRedemptions)},
			"currentRedemptions": &types.AttributeValueMemberN{Value: "0"},
			"status":             &types.AttributeValueMemberS{Value: v.Status},
			"createdAt":          &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", v.CreatedAt)},
		},
	})

	if err != nil {
		return errorResponse(500, "Failed to create voucher"), nil
	}

	shared.LogAdminAction(ctx, adminUser, "CREATE_VOUCHER", v.Code, request.Body)

	return successResponse([]byte(`{"message": "Voucher created"}`)), nil
}

func deleteVoucher(ctx context.Context, request events.APIGatewayProxyRequest, table string, adminUser string) (events.APIGatewayProxyResponse, error) {
	var body struct {
		Code string `json:"code"`
	}
	json.Unmarshal([]byte(request.Body), &body)

	_, err := svc.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(table),
		Key: map[string]types.AttributeValue{
			"code": &types.AttributeValueMemberS{Value: body.Code},
		},
	})

	if err != nil {
		return errorResponse(500, "Failed to delete voucher"), nil
	}

	shared.LogAdminAction(ctx, adminUser, "DELETE_VOUCHER", body.Code, "")

	return successResponse([]byte(`{"message": "Voucher deleted"}`)), nil
}

func updateVoucher(ctx context.Context, request events.APIGatewayProxyRequest, table string, adminUser string) (events.APIGatewayProxyResponse, error) {
	var v Voucher
	if err := json.Unmarshal([]byte(request.Body), &v); err != nil {
		return errorResponse(400, "Invalid JSON"), nil
	}

	if v.Code == "" {
		return errorResponse(400, "Missing code"), nil
	}

	// We only allow updating points and maxRedemptions and status
	updateExpression := "SET points = :p, maxRedemptions = :m, #s = :s"
	expressionNames := map[string]string{
		"#s": "status",
	}
	expressionValues := map[string]types.AttributeValue{
		":p": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", v.Points)},
		":m": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", v.MaxRedemptions)},
		":s": &types.AttributeValueMemberS{Value: v.Status},
	}

	_, err := svc.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(table),
		Key:                       map[string]types.AttributeValue{"code": &types.AttributeValueMemberS{Value: v.Code}},
		UpdateExpression:          &updateExpression,
		ExpressionAttributeNames:  expressionNames,
		ExpressionAttributeValues: expressionValues,
	})

	if err != nil {
		return errorResponse(500, "Failed to update voucher"), nil
	}

	shared.LogAdminAction(ctx, adminUser, "UPDATE_VOUCHER", v.Code, request.Body)

	return successResponse([]byte(`{"message": "Voucher updated"}`)), nil
}

func validateToken(authHeader string) (jwt.MapClaims, error) {
	if authHeader == "" {
		return nil, fmt.Errorf("missing token")
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return nil, fmt.Errorf("invalid header format")
	}
	tokenString := parts[1]

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return nil, err
	}

	return token.Claims.(jwt.MapClaims), nil
}

func successResponse(body []byte) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(body),
	}
}

func errorResponse(status int, message string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]string{"error": message})
	return events.APIGatewayProxyResponse{
		StatusCode: status,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(body),
	}
}

func main() {
	lambda.Start(handleRequest)
}
