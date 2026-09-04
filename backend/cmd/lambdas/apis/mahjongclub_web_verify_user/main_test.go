package main

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

// testKeyB64 is the encryption key handed to the Database under test. Value is
// irrelevant (it never leaves the test); what matters is that the ciphertexts
// below are produced with the SAME key, so the real DecryptLineID runs for real.
const testKeyB64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" // 32 bytes

func testDB(t *testing.T) *Database {
	t.Helper()
	// client is nil on purpose: resolveTargetUserID must not touch DynamoDB.
	// If a future change makes it hit the DB, these tests panic rather than
	// silently start depending on AWS.
	return &Database{cfg: &Config{EncryptionKey: testKeyB64}}
}

// encryptLineID mirrors what the LINE login flow produces: AES-GCM, then
// URL-safe base64. Built here (not read from a fixture) so the ciphertext is
// guaranteed to match testKeyB64.
func encryptLineID(t *testing.T, plaintext string) string {
	t.Helper()
	key, err := base64.StdEncoding.DecodeString(testKeyB64)
	if err != nil {
		t.Fatalf("bad test key: %v", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("gcm: %v", err)
	}
	nonce := make([]byte, gcm.NonceSize()) // deterministic zero nonce: fine for a test
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return base64.URLEncoding.EncodeToString(append(nonce, sealed...))
}

func req(query map[string]string, headers map[string]string) events.APIGatewayProxyRequest {
	if headers == nil {
		headers = map[string]string{}
	}
	return events.APIGatewayProxyRequest{
		HTTPMethod:            http.MethodPost,
		QueryStringParameters: query,
		Headers:               headers,
	}
}

func errorOf(t *testing.T, resp *events.APIGatewayProxyResponse) string {
	t.Helper()
	var got struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &got); err != nil {
		t.Fatalf("response body is not JSON: %v (%s)", err, resp.Body)
	}
	if got.Success {
		t.Errorf("rejection body says success:true — %s", resp.Body)
	}
	return got.Error
}

// TestResolveTargetUserID_AnonymousUserIdIsRejected is the finding 2 regression
// guard: before the fix, `?userId=<anyone>` with no credentials whatsoever
// returned that account's lineId / points / gender / invitedBy.
func TestResolveTargetUserID_AnonymousUserIdIsRejected(t *testing.T) {
	userID, deny := testDB(t).resolveTargetUserID(
		req(map[string]string{"userId": "APP_someone_elses_id"}, nil),
		map[string]string{},
	)
	if deny == nil {
		t.Fatalf("anonymous ?userId= lookup was ALLOWED (userID=%q) — this is the IDOR", userID)
	}
	if deny.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", deny.StatusCode)
	}
	if userID != "" {
		t.Errorf("userID = %q, want empty on rejection", userID)
	}
	if msg := errorOf(t, deny); msg != "需要登入" {
		t.Errorf("error = %q, want 需要登入", msg)
	}
}

// TestResolveTargetUserID_InvalidTokenIsRejected: a malformed/forged Bearer
// token must fail closed, NOT fall back to the query parameter.
func TestResolveTargetUserID_InvalidTokenIsRejected(t *testing.T) {
	_, deny := testDB(t).resolveTargetUserID(
		req(
			map[string]string{"userId": "APP_someone_elses_id"},
			map[string]string{"Authorization": "Bearer not.a.real.token"},
		),
		map[string]string{},
	)
	if deny == nil {
		t.Fatalf("forged token was accepted")
	}
	if deny.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", deny.StatusCode)
	}
}

// TestResolveTargetUserID_LineIDPathStillWorks is the CONTROL for the two tests
// above. Without it, deleting the whole function body and always returning 401
// would look like a pass — while LINE login is dead.
//
// This is the fix's actual boundary: userId= got locked down, lineID= did not.
func TestResolveTargetUserID_LineIDPathStillWorks(t *testing.T) {
	const lineUserID = "U0123456789abcdef0123456789abcdef"
	ciphertext := encryptLineID(t, lineUserID)

	userID, deny := testDB(t).resolveTargetUserID(
		req(map[string]string{"lineID": ciphertext}, nil),
		map[string]string{},
	)
	if deny != nil {
		t.Fatalf("LINE login fallback was rejected (status %d, body %s) — the fix broke login",
			deny.StatusCode, deny.Body)
	}
	if userID != lineUserID {
		t.Errorf("userID = %q, want the decrypted LINE id", userID)
	}
}

// TestResolveTargetUserID_LineIDDecryptFailure: a ciphertext that does not
// decrypt is still a 401 — but it must be a DIFFERENT 401 than the one above.
// Both rejections share a status code, so asserting only on the code cannot
// tell "blocked by the new userId gate" from "walked the lineID path and
// failed to decrypt".
func TestResolveTargetUserID_LineIDDecryptFailure(t *testing.T) {
	_, deny := testDB(t).resolveTargetUserID(
		req(map[string]string{"lineID": "bm90LXJlYWwtY2lwaGVydGV4dA=="}, nil),
		map[string]string{},
	)
	if deny == nil {
		t.Fatalf("garbage ciphertext was accepted")
	}
	if deny.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", deny.StatusCode)
	}
	if msg := errorOf(t, deny); msg != "Failed to decrypt LINE ID" {
		t.Errorf("error = %q — want the decrypt failure, not the userId gate", msg)
	}
}

// TestResolveTargetUserID_MissingBothParams keeps the pre-existing 400.
func TestResolveTargetUserID_MissingBothParams(t *testing.T) {
	_, deny := testDB(t).resolveTargetUserID(req(map[string]string{}, nil), map[string]string{})
	if deny == nil {
		t.Fatalf("request with neither userId nor lineID was accepted")
	}
	if deny.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", deny.StatusCode)
	}
	if msg := errorOf(t, deny); msg != "Missing userId or lineID parameter" {
		t.Errorf("error = %q", msg)
	}
}

// 🔴 NOT covered here, on purpose — record it rather than let a green run imply it:
// the "valid token" branch (verified == true, where the token's identity replaces
// the query parameter) cannot run in a unit test. shared.VerifyTokenWithUserPwGate
// calls getUserPwChangedAt, which reads DynamoDB, so a signed token still fails
// closed here and lands in the same 401 as a forged one. That branch has to be
// verified against staging: log in, then `?userId=<someone else>` must return
// YOUR OWN record, not theirs.
