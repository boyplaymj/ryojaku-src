package main

import (
	"errors"
	"fmt"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// [A3-l] isConditionalCheckFailed 是「重複取消不重複退點」那道的守門員：
// 條件沒過必須被認出來，否則會走進一般錯誤路徑、回 500，而使用者重試又被擋 —— 兩頭落空。
//
// 🔴 這條同時釘住「用 errors.As 認型別，不要比對錯誤字串」：
//
//	下面 T3 是一個**訊息裡帶著同樣字眼**、但型別不同的錯誤。
//	若哪天有人改成 strings.Contains(err.Error(), "ConditionalCheckFailed")，T3 會紅。
func TestIsConditionalCheckFailed(t *testing.T) {
	t.Run("T1 直接就是那個例外", func(t *testing.T) {
		if !isConditionalCheckFailed(&types.ConditionalCheckFailedException{}) {
			t.Fatal("應該認得出 ConditionalCheckFailedException")
		}
	})

	t.Run("T2 被包起來也要認得出（SDK 會包一層）", func(t *testing.T) {
		wrapped := fmt.Errorf("operation error DynamoDB: PutItem, %w", &types.ConditionalCheckFailedException{})
		if !isConditionalCheckFailed(wrapped) {
			t.Fatal("包過一層仍應認得出 —— SDK 實際回的就是包過的")
		}
	})

	t.Run("T3 反控：訊息像但型別不同 ⇒ 不可以認成條件失敗", func(t *testing.T) {
		if isConditionalCheckFailed(errors.New("ConditionalCheckFailedException: 這是別的錯誤")) {
			t.Fatal("只有字串像就認的話，任何含這串字的錯誤都會被當成冪等命中 ⇒ 該退的不退")
		}
	})

	t.Run("T4 反控：一般錯誤", func(t *testing.T) {
		if isConditionalCheckFailed(errors.New("throughput exceeded")) {
			t.Fatal("一般錯誤不可以被當成條件失敗（那會讓真正的失敗被吞掉）")
		}
		if isConditionalCheckFailed(nil) {
			t.Fatal("nil 不是條件失敗")
		}
	})
}
