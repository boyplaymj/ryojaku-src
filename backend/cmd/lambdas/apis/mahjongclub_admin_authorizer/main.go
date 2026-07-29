package main

import (
	"context"
	"errors"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/golang-jwt/jwt/v5"

	"mahjongclub-backend/cmd/lambdas/adminrole"
)

var errUnauthorized = errors.New("Unauthorized")

func extractBearer(headers map[string]string) string {
	for k, v := range headers {
		if strings.EqualFold(k, "Authorization") {
			if len(v) > 7 && strings.EqualFold(v[:7], "Bearer ") {
				return strings.TrimSpace(v[7:])
			}
			return ""
		}
	}
	return ""
}

func verifyAdminToken(tokenString string) (jwt.MapClaims, error) {
	secret := os.Getenv("ADMIN_JWT_SECRET")
	if secret == "" {
		return nil, errors.New("ADMIN_JWT_SECRET not configured")
	}

	token, err := jwt.ParseWithClaims(tokenString, jwt.MapClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	if !adminrole.Allows(claims, adminrole.Admin, adminrole.SuperAdmin) {
		return nil, errors.New("admin role required")
	}
	return claims, nil
}

func allow(claims jwt.MapClaims, methodArn string) events.APIGatewayCustomAuthorizerResponse {
	sub := adminrole.SubjectOf(claims)
	role := adminrole.Of(claims)
	return events.APIGatewayCustomAuthorizerResponse{
		PrincipalID: sub,
		PolicyDocument: events.APIGatewayCustomAuthorizerPolicy{
			Version: "2012-10-17",
			Statement: []events.IAMPolicyStatement{{
				Action:   []string{"execute-api:Invoke"},
				Effect:   "Allow",
				Resource: []string{methodArn},
			}},
		},
		Context: map[string]interface{}{
			"sub":  sub,
			"role": role,
		},
	}
}

func Handler(ctx context.Context, ev events.APIGatewayCustomAuthorizerRequestTypeRequest) (events.APIGatewayCustomAuthorizerResponse, error) {
	_ = ctx
	token := extractBearer(ev.Headers)
	if token == "" {
		log.Printf("[ADMIN_AUTHZ] 拒絕：缺少 Bearer token, arn=%s", ev.MethodArn)
		return events.APIGatewayCustomAuthorizerResponse{}, errUnauthorized
	}

	claims, err := verifyAdminToken(token)
	if err != nil {
		log.Printf("[ADMIN_AUTHZ] 拒絕：token 無效或非 admin: %v", err)
		return events.APIGatewayCustomAuthorizerResponse{}, errUnauthorized
	}

	log.Printf("[ADMIN_AUTHZ] 放行 sub=%s role=%s", adminrole.SubjectOf(claims), adminrole.Of(claims))
	return allow(claims, ev.MethodArn), nil
}

func main() {
	lambda.Start(Handler)
}
