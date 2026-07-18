package services

import "os"

// lineBotTable resolves the DynamoDB table name for the LINE-bot / AI-advisor
// tables (the LineBot-* family: user profiles, consultants, sessions,
// conversation records, OpenAI config).
//
// It takes the canonical base name (the part after the "LineBot-" prefix, e.g.
// "User-Profiles") and prepends the prefix from the LINEBOT_TABLE_PREFIX env
// var, defaulting to "LineBot-" so production keeps its existing table names
// byte-for-byte. Staging sets LINEBOT_TABLE_PREFIX=LineBotStg- so stg and prod
// never collide when they share an AWS account.
//
// This mirrors the TABLE_PREFIX scheme the MahjongClub_* Lambdas already use.
func lineBotTable(base string) string {
	prefix := os.Getenv("LINEBOT_TABLE_PREFIX")
	if prefix == "" {
		prefix = "LineBot-"
	}
	return prefix + base
}
