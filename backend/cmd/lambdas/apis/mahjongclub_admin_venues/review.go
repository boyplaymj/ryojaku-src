package main

// [B1-f2] venue 審核的**決策層**。抽成獨立檔是為了讓它完全不碰 I/O ——
// 審核是不可逆的狀態轉換，而測不到的狀態機等於沒有。

import (
	"errors"

	"mahjongclub-backend/cmd/lambdas/shared"
)

const (
	ActionApprove = "approve"
	ActionReject  = "reject"
)

var (
	ErrUnknownAction = errors.New("action 必須是 approve 或 reject")
	ErrNotPending    = errors.New("只有 pending 的場地可以審核")
	ErrNoVenueID     = errors.New("venueId 不可為空")
)

// ReviewRequest 是審核的窄 DTO。
//
// 🔴 沒有 status 欄位 —— 後台**不能直接指定要改成什麼**，只能說 approve／reject。
// 讓後台送 status 的話，「把 suspended 的店直接改回 active」就變成一次普通請求，
// 而那條路徑繞過了所有審核語意。
type ReviewRequest struct {
	VenueID string `json:"venueId"`
	Action  string `json:"action"`
	// Note 是審核備註，寫進稽核日誌，不寫進 venue。
	Note string `json:"note,omitempty"`
}

// reviewForbiddenFields 是這個 DTO 上不可以出現的欄位（測試用反射掃）。
var reviewForbiddenFields = []string{"status", "isDojo", "dojoPaidUntil", "certifiedRefereeCount", "ownerId"}

// decideReviewOutcome 是審核狀態轉換的**唯一求值點**。
//
// 🔴 兩件事一起決定，不可以拆開：目標狀態、以及「這個當前狀態允不允許被審」。
// 拆開的話，「approve 一個已經 rejected 的場地」會變成合法操作 ——
// 而那正是審核制度想擋的（駁回之後改口，不留痕跡）。
//
// 回傳 (目標狀態, error)。error != nil 時目標狀態無意義。
func decideReviewOutcome(action, currentStatus string) (string, error) {
	// 🔴 先驗 action 再驗狀態：順序有意義。反過來的話，
	// 對一個 active 的場地送未知 action，錯誤訊息會說「只有 pending 可以審」，
	// 而真正的問題是 action 打錯了。
	var target string
	switch action {
	case ActionApprove:
		target = shared.VenueStatusActive
	case ActionReject:
		target = shared.VenueStatusRejected
	default:
		return "", ErrUnknownAction
	}
	// 只有 pending 可以被審。已經 active／rejected／suspended 的都不行 ——
	// 它們各自要走別的流程（停權、申訴），而那些流程還沒做。
	if currentStatus != shared.VenueStatusPending {
		return "", ErrNotPending
	}
	return target, nil
}
