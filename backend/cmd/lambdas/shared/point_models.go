package shared

// PointTransactionType defines if it's an addition or deduction
type PointTransactionType string

const (
	PointTypeCredit PointTransactionType = "CREDIT" // 增加
	PointTypeDebit  PointTransactionType = "DEBIT"  // 扣除
)

// PointTransaction represents a record of user points adjustment
type PointTransaction struct {
	UserID        string                 `dynamodbav:"userId" json:"userId"`                         // PK
	SortKey       string                 `dynamodbav:"sortKey" json:"sortKey"`                       // SK: TIME#<UnixTimestamp>#<UUID>
	TransactionID string                 `dynamodbav:"txId" json:"txId"`                             // Unique UUID
	Type          PointTransactionType   `dynamodbav:"type" json:"type"`                             // CREDIT/DEBIT
	Amount        int                    `dynamodbav:"amount" json:"amount"`                         // 變動金額 (正數)
	BalanceBefore int                    `dynamodbav:"balanceBefore" json:"balanceBefore"`           // 變動前餘額
	BalanceAfter  int                    `dynamodbav:"balanceAfter" json:"balanceAfter"`             // 變動後餘額
	Reason        string                 `dynamodbav:"reason" json:"reason"`                         // 繁體中文原因
	Source        string                 `dynamodbav:"source" json:"source"`                         // 來源功能 (例如: web_create_game)
	Metadata      map[string]interface{} `dynamodbav:"metadata,omitempty" json:"metadata,omitempty"` // 包含 gameId, code 等
	CreatedAt     int64                  `dynamodbav:"createdAt" json:"createdAt"`                   // Unix 毫秒時間戳
}
