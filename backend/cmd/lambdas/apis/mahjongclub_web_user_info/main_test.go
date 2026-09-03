package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// Sentinel values: distinctive enough that a substring search for them cannot
// collide with anything else the endpoint legitimately emits.
const (
	sentinelPasswordHash = "$2a$10$SENTINELbcryptHASHvalueDoNotLeak"
	sentinelEncLineID    = "SENTINEL-encrypted-lineid-ciphertext"
)

func fullUser() *shared.User {
	return &shared.User{
		UserID:            "U-test-0001",
		DisplayName:       "測試玩家",
		Gender:            "other",
		AgeRange:          "23-27",
		MahjongExperience: "intermediate",
		LineID:            "line-contact-id",
		Points:            1234,
		Rating:            4.5,
		IsVerified:        true,
		Stats:             &shared.UserStats{GamesHosted: 3, GamesJoined: 7},
		Preferences:       shared.UserPreferences{NotifyNewGames: true},
		Email:             "player@example.com",
		AccountType:       "app",
		EmailVerified:     true,
		PictureURL:        "https://example.com/a.png",
		InviteCount:       2,
		CreatedAt:         time.Unix(1700000000, 0).UTC(),
		UpdatedAt:         time.Unix(1700000001, 0).UTC(),

		// The two credentials under test.
		PasswordHash:    sentinelPasswordHash,
		EncryptedLineID: sentinelEncLineID,
	}
}

// TestBuildUserInfoBody_OmitsServerSideCredentials is the regression guard for
// SECURITY_AUDIT_2026-09-03 findings 3 & 7. It asserts on the serialized body
// (what the client actually receives), not on the struct, because omitempty +
// json tags sit between the two.
func TestBuildUserInfoBody_OmitsServerSideCredentials(t *testing.T) {
	body := buildUserInfoBody(fullUser(), "100", "50")

	// Both the JSON keys and — more importantly — the secret VALUES must be
	// absent. Checking only the key name would still pass if someone renamed
	// the tag while continuing to emit the secret.
	for _, needle := range []string{
		`"passwordHash"`,
		`"encryptedLineId"`,
		sentinelPasswordHash,
		sentinelEncLineID,
	} {
		if strings.Contains(body, needle) {
			t.Errorf("response body leaks %q\nbody: %s", needle, body)
		}
	}
}

// TestBuildUserInfoBody_KeepsPublicFields is the positive control for the test
// above: without it, dropping `Data` entirely (or returning "{}") would satisfy
// the leak assertions and look like a pass.
func TestBuildUserInfoBody_KeepsPublicFields(t *testing.T) {
	body := buildUserInfoBody(fullUser(), "100", "50")

	var got struct {
		Success       bool         `json:"success"`
		Data          *shared.User `json:"data"`
		InviterPoints string       `json:"inviterPoints"`
		InviteePoints string       `json:"inviteePoints"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("body is not valid JSON: %v\nbody: %s", err, body)
	}
	if !got.Success {
		t.Errorf("success = false, want true")
	}
	if got.Data == nil {
		t.Fatalf("data missing entirely — the leak assertions above would pass vacuously")
	}
	if got.Data.UserID != "U-test-0001" {
		t.Errorf("userId = %q, want U-test-0001", got.Data.UserID)
	}
	if got.Data.DisplayName != "測試玩家" {
		t.Errorf("displayName = %q, want 測試玩家", got.Data.DisplayName)
	}
	if got.Data.Points != 1234 {
		t.Errorf("points = %d, want 1234", got.Data.Points)
	}
	if got.Data.Email != "player@example.com" {
		t.Errorf("email = %q — the owner's own email is still expected here", got.Data.Email)
	}
	if got.Data.Stats == nil || got.Data.Stats.GamesJoined != 7 {
		t.Errorf("stats not preserved: %+v", got.Data.Stats)
	}
	if got.InviterPoints != "100" || got.InviteePoints != "50" {
		t.Errorf("invite points = %q/%q, want 100/50", got.InviterPoints, got.InviteePoints)
	}
}

// TestBuildUserInfoBody_NilUser: the handler can reach here with a nil user;
// stripping must not panic and `data` must be omitted rather than null-filled.
func TestBuildUserInfoBody_NilUser(t *testing.T) {
	body := buildUserInfoBody(nil, "100", "50")
	if strings.Contains(body, `"data"`) {
		t.Errorf("nil user should omit data, got: %s", body)
	}
	if !strings.Contains(body, `"success":true`) {
		t.Errorf("unexpected body: %s", body)
	}
}

// TestStripServerSideCredentials_MutatesInPlace pins the contract that
// buildUserInfoBody relies on: stripping happens on the caller's struct, so no
// later reader of that pointer can see the credentials either.
func TestStripServerSideCredentials_MutatesInPlace(t *testing.T) {
	u := fullUser()
	stripServerSideCredentials(u)
	if u.PasswordHash != "" {
		t.Errorf("PasswordHash = %q, want empty", u.PasswordHash)
	}
	if u.EncryptedLineID != "" {
		t.Errorf("EncryptedLineID = %q, want empty", u.EncryptedLineID)
	}
	stripServerSideCredentials(nil) // must not panic
}

// TestUserStructFieldsUnchanged exists because stripServerSideCredentials
// carries a HAND-PICKED list of fields to blank. A hand-picked list has no
// signal when something is added next to it: a new credential-ish field on
// shared.User would start leaking through this endpoint with zero test churn.
//
// This pins the exact field set of shared.User. When it turns red, do NOT just
// update the hash — first decide whether the new/renamed field is a
// server-side credential, and if so add it to stripServerSideCredentials.
func TestUserStructFieldsUnchanged(t *testing.T) {
	const wantFingerprint = "302a10831183fd925fec79b5a3443d93fb20437619b28b1a181712ecb39321fd"

	rt := reflect.TypeOf(shared.User{})
	var fields []string
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		jsonTag := strings.Split(f.Tag.Get("json"), ",")[0]
		fields = append(fields, f.Name+":"+jsonTag)
	}
	sort.Strings(fields)
	sum := sha256.Sum256([]byte(strings.Join(fields, "\n")))
	got := hex.EncodeToString(sum[:])

	if got != wantFingerprint {
		t.Errorf(
			"shared.User field set changed (or fingerprint not yet pinned).\n"+
				"got fingerprint: %s\nfields (%d):\n  %s\n\n"+
				"→ If a new field is a server-side credential, add it to "+
				"stripServerSideCredentials, then update wantFingerprint.",
			got, len(fields), strings.Join(fields, "\n  "))
	}
}
