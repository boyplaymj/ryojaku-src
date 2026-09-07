package main

import (
	"errors"
	"fmt"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// [A3-o2] isTransactionConditionFailed 決定「局在報名途中被取消」會回哪一句話。
// 認錯的後果：使用者看到「報名失敗，請稍後再試」並重試，而重試永遠不會成功。
func TestIsTransactionConditionFailed(t *testing.T) {
	cancelled := func(codes ...string) error {
		reasons := make([]types.CancellationReason, 0, len(codes))
		for _, c := range codes {
			c := c
			reasons = append(reasons, types.CancellationReason{Code: &c})
		}
		return &types.TransactionCanceledException{
			Message:             aws.String("Transaction cancelled"),
			CancellationReasons: reasons,
		}
	}

	t.Run("T1 條件沒過（局已非 recruiting）", func(t *testing.T) {
		if !isTransactionConditionFailed(cancelled("ConditionalCheckFailed", "None")) {
			t.Fatal("應該認得出條件失敗")
		}
	})

	t.Run("T2 條件失敗出現在第二項也要認得出", func(t *testing.T) {
		// 🔴 少了這條，只看 CancellationReasons[0] 的寫法會全綠 ——
		//    而報名列那筆（attribute_not_exists）正是第二項。
		if !isTransactionConditionFailed(cancelled("None", "ConditionalCheckFailed")) {
			t.Fatal("條件失敗在第二項時也必須認得出")
		}
	})

	t.Run("T3 被包起來也要認得出", func(t *testing.T) {
		if !isTransactionConditionFailed(fmt.Errorf("operation error: %w", cancelled("ConditionalCheckFailed"))) {
			t.Fatal("SDK 實際回的是包過的")
		}
	})

	t.Run("T4 反控：交易被取消，但不是因為條件", func(t *testing.T) {
		// 🔴 這一格分開「局已被取消」與「容量不足／衝突」——後者重試會成功，
		//    講成前者的話使用者會被告知一個假的原因而放棄。
		if isTransactionConditionFailed(cancelled("TransactionConflict", "None")) {
			t.Fatal("交易衝突不是條件失敗（那個可以重試）")
		}
		if isTransactionConditionFailed(cancelled("ProvisionedThroughputExceeded")) {
			t.Fatal("吞吐不足不是條件失敗")
		}
	})

	t.Run("T5 反控：完全不同的錯誤 / nil", func(t *testing.T) {
		if isTransactionConditionFailed(errors.New("ConditionalCheckFailed 這只是字串")) {
			t.Fatal("只有字串像不可以算 —— 這條釘住『用 errors.As 不要比對字串』")
		}
		if isTransactionConditionFailed(nil) {
			t.Fatal("nil 不是條件失敗")
		}
	})
}
