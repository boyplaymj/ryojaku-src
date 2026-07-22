package main

// 帳號系統 — 重設密碼端點（AUTH_SYSTEM_DESIGN §5.C）。
// POST {token, newPassword}: 一次性 reset_password token 即授權（使用者已忘記舊密碼，不需舊密碼）。
// ConsumeToken 原子消耗 → 更新 passwordHash + pwChangedAt(=now，令所有舊 JWT 失效=全裝置登出)。

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"golang.org/x/crypto/bcrypt"

	"mahjongclub-backend/cmd/lambdas/shared"
)

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

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type resetRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

func jsonResp(headers map[string]string, code int, payload map[string]interface{}) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(payload)
	return events.APIGatewayProxyResponse{StatusCode: code, Headers: headers, Body: string(body)}
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type":                 "application/json",
	}
	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: ""}, nil
	}
	if dynamoClient == nil {
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "service unavailable"}), nil
	}

	var req resetRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "invalid request"}), nil
	}
	if req.Token == "" {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "missing token"}), nil
	}
	if len(req.NewPassword) < 8 {
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "密碼長度至少 8 個字元"}), nil
	}

	// 先算好新 hash（token 消耗前，避免 hash 失敗白燒 token）
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("bcrypt failed: %v", err)
		return jsonResp(headers, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "internal error"}), nil
	}

	// 原子消耗 reset token；失敗一律同一句、不洩漏細節。
	userID, err := shared.ConsumeToken(ctx, req.Token, shared.PurposeResetPassword)
	if err != nil {
		log.Printf("ConsumeToken(reset) failed: %v", err)
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "invalid, expired, or used token"}), nil
	}

	// 更新密碼 + pwChangedAt(=now，令所有簽發早於此刻的 JWT 失效)。
	now := time.Now()
	_, err = dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:           aws.String(tablePrefix + "Users"),
		Key:                 map[string]types.AttributeValue{"userId": &types.AttributeValueMemberS{Value: userID}},
		UpdateExpression:    aws.String("SET passwordHash = :h, pwChangedAt = :t, updatedAt = :now"),
		ConditionExpression: aws.String("attribute_exists(userId)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":h":   &types.AttributeValueMemberS{Value: string(hash)},
			":t":   &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
			":now": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		},
	})
	if err != nil {
		// token 已消耗但更新失敗（user 列不存在等病態）→ 統一訊息；重寄流程見 BUILD_PLAN 6.5。
		log.Printf("reset update failed user=%s: %v", userID, err)
		return jsonResp(headers, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "invalid, expired, or used token"}), nil
	}

	return jsonResp(headers, http.StatusOK, map[string]interface{}{"success": true}), nil
}

func main() {
	lambda.Start(Handler)
}
