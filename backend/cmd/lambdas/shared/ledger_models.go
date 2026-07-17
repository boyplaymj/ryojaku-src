package shared

import (
)

// LedgerEntry represents a record in the mahjong bookkeeping ledger
type LedgerEntry struct {
	UserID       string       `dynamodbav:"userId" json:"userId"`             // PK: USER#<UserID>
	SortKey      string       `dynamodbav:"sortKey" json:"sortKey"`           // SK: LEDGER#<Timestamp>#<UUID>
	LedgerID     string       `dynamodbav:"ledgerId" json:"ledgerId"`         // Unique ID for the entry
	Date         string       `dynamodbav:"date" json:"date"`                 // ISO8601 (YYYY-MM-DD)
	Stakes       string       `dynamodbav:"stakes" json:"stakes"`             // e.g., "30/10"
	Rounds       int          `dynamodbav:"rounds" json:"rounds"`             // Number of rounds (雀數)
	WinLoss      int          `dynamodbav:"winLoss" json:"winLoss"`           // Win or Loss amount
	ActualAmount int          `dynamodbav:"actualAmount" json:"actualAmount"` // Final cash in/out
	Opponents    []Opponent   `dynamodbav:"opponents" json:"opponents"`       // Multi-opponent support
	Mood         string       `dynamodbav:"mood" json:"mood"`                 // Emoji or short string
	Note         string       `dynamodbav:"note" json:"note"`                 // User notes
	GameID       string       `dynamodbav:"gameId,omitempty" json:"gameId,omitempty"` // Reference to system game
	CreatedAt    int64        `dynamodbav:"createdAt" json:"createdAt"`       // Unix timestamp
	UpdatedAt    int64        `dynamodbav:"updatedAt" json:"updatedAt"`       // Unix timestamp
}

// Opponent represents a person played against
type Opponent struct {
	Name   string `dynamodbav:"name" json:"name"`                 // Display name
	UserID string `dynamodbav:"userId,omitempty" json:"userId,omitempty"` // System UserID if available
}

// LedgerSummary represents the statistical overview for a user
type LedgerSummary struct {
	TotalEntries int     `json:"totalEntries"`
	TotalRounds  int     `json:"totalRounds"`
	TotalWinLoss int     `json:"totalWinLoss"`
	AverageWin   float64 `json:"averageWin"`
	WinRate      float64 `json:"winRate"`      // Percentage of winning entries
	MoodStats    map[string]int `json:"moodStats"` // Count of each mood
}
