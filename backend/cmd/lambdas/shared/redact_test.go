package shared

import "testing"

// populatedGame builds a game whose every contact field carries a value, so the
// test can assert each one is present *before* redaction and empty *after*.
// (A test that only checks the "after" state would pass against a helper that
// never populates anything — the before-check is the negative control.)
func populatedGame() *Game {
	return &Game{
		GameID:     "game-1",
		HostUserID: "APP_host",
		ContactInfo: ContactInfo{
			Phone:  "0912345678",
			LineID: "host_line",
			Note:   "call me after 8pm 0912345678",
		},
		JoinedPlayers: []Player{
			{UserID: "APP_p1", LineID: "p1_line"},
			{UserID: "APP_p2", LineID: "p2_line"},
		},
	}
}

func TestRedactContactInfo_clearsAllContactFields(t *testing.T) {
	g := populatedGame()

	// Negative control: confirm the fixture actually has values to strip.
	if g.ContactInfo.Phone == "" || g.ContactInfo.LineID == "" || g.ContactInfo.Note == "" {
		t.Fatal("fixture should have populated host contact fields before redaction")
	}
	if g.JoinedPlayers[0].LineID == "" || g.JoinedPlayers[1].LineID == "" {
		t.Fatal("fixture should have populated player LINE IDs before redaction")
	}

	RedactContactInfo(g)

	if g.ContactInfo.Phone != "" {
		t.Errorf("ContactInfo.Phone not cleared: %q", g.ContactInfo.Phone)
	}
	if g.ContactInfo.LineID != "" {
		t.Errorf("ContactInfo.LineID not cleared: %q", g.ContactInfo.LineID)
	}
	if g.ContactInfo.Note != "" {
		t.Errorf("ContactInfo.Note not cleared: %q", g.ContactInfo.Note)
	}
	for i, p := range g.JoinedPlayers {
		if p.LineID != "" {
			t.Errorf("JoinedPlayers[%d].LineID not cleared: %q", i, p.LineID)
		}
	}
}

func TestRedactContactInfo_preservesNonContactFields(t *testing.T) {
	g := populatedGame()
	RedactContactInfo(g)

	// Non-contact identifiers must survive — redaction must not nuke the game.
	if g.GameID != "game-1" {
		t.Errorf("GameID should be preserved, got %q", g.GameID)
	}
	if g.HostUserID != "APP_host" {
		t.Errorf("HostUserID should be preserved, got %q", g.HostUserID)
	}
	if len(g.JoinedPlayers) != 2 {
		t.Errorf("JoinedPlayers slice should be preserved, got len %d", len(g.JoinedPlayers))
	}
	if g.JoinedPlayers[0].UserID != "APP_p1" {
		t.Errorf("player UserID should be preserved, got %q", g.JoinedPlayers[0].UserID)
	}
}

func TestRedactContactInfo_nilSafe(t *testing.T) {
	RedactContactInfo(nil) // must not panic
}
