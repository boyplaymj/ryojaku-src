package shared

import (
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestAuthorizerUserID(t *testing.T) {
	request := events.APIGatewayProxyRequest{
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{"userId": " APP_123 "},
		},
	}

	if got := AuthorizerUserID(request); got != "APP_123" {
		t.Fatalf("AuthorizerUserID() = %q, want APP_123", got)
	}
}

func TestAuthorizerUserIDV2(t *testing.T) {
	request := events.APIGatewayV2HTTPRequest{
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			Authorizer: &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
				Lambda: map[string]interface{}{"userId": " APP_456 "},
			},
		},
	}

	if got := AuthorizerUserIDV2(request); got != "APP_456" {
		t.Fatalf("AuthorizerUserIDV2() = %q, want APP_456", got)
	}
}
