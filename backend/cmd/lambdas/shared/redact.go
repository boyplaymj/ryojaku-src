package shared

// RedactContactInfo strips contact PII from a game before it is returned to a
// requester who is not authorized to see it. It clears the host's entire
// ContactInfo (LINE ID, phone, and the free-text note — all three are private
// contact channels), and every joined player's LINE ID.
//
// Rationale (SECURITY_AUDIT_2026-09-03):
//   - finding 1:  web_search_games returned the whole Game with no redaction.
//   - finding 1b: web_game_detail's inline redaction cleared LINE IDs but
//     missed ContactInfo.Phone. Centralising the rule here means both callers
//     stay in sync and neither can drift. Note is cleared too so the same
//     "gate covers n-1 fields" gap can't reappear via the free-text field.
//
// nil-safe: a nil game is a no-op.
func RedactContactInfo(game *Game) {
	if game == nil {
		return
	}
	game.ContactInfo.LineID = ""
	game.ContactInfo.Phone = ""
	game.ContactInfo.Note = ""
	for i := range game.JoinedPlayers {
		game.JoinedPlayers[i].LineID = ""
	}
}
