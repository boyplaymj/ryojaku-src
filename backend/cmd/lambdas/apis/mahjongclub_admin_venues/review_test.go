package main

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"mahjongclub-backend/cmd/lambdas/shared"
)

// 🔴 界線：這一批**只**驗決策層（review.go）。DDB 真的寫進去沒有、
// ConditionExpression 有沒有擋下併發、admin token 驗證對不對 —— 一條都沒驗到。

// S1 approve／reject 各自的目標狀態。
func TestDecideReviewOutcome_Targets(t *testing.T) {
	got, err := decideReviewOutcome(ActionApprove, shared.VenueStatusPending)
	if err != nil || got != shared.VenueStatusActive {
		t.Fatalf("approve → (%q, %v)，want active", got, err)
	}
	got, err = decideReviewOutcome(ActionReject, shared.VenueStatusPending)
	if err != nil || got != shared.VenueStatusRejected {
		t.Fatalf("reject → (%q, %v)，want rejected", got, err)
	}
	// 🔴 兩者不可相同 —— 若都回 active 或都回 rejected，上面兩條有一半會自動成立，
	// 而「駁回其實把店開通了」是這支最不可逆的錯。
	a, _ := decideReviewOutcome(ActionApprove, shared.VenueStatusPending)
	r, _ := decideReviewOutcome(ActionReject, shared.VenueStatusPending)
	if a == r {
		t.Fatal("approve 與 reject 的結果相同 ⇒ 這個狀態機沒有在分辨動作")
	}
}

// S2 🔴 承重：只有 pending 可以被審。
// 對應的失效模式是「駁回之後改口」—— 對一個 rejected 的場地再送 approve
// 就把它開通了，而且沒有任何地方記得它曾經被駁回過。
func TestDecideReviewOutcome_OnlyPendingIsReviewable(t *testing.T) {
	for _, cur := range []string{
		shared.VenueStatusActive, shared.VenueStatusRejected,
		shared.VenueStatusSuspended, "", "unknown",
	} {
		for _, act := range []string{ActionApprove, ActionReject} {
			if _, err := decideReviewOutcome(act, cur); !errors.Is(err, ErrNotPending) {
				t.Errorf("對 status=%q 送 %s 應該回 ErrNotPending，得到 %v", cur, act, err)
			}
		}
	}
}

// S3 未知 action 一律拒絕，而且**錯誤要指向 action**。
// 🔴 順序有意義：若先驗狀態，對一個 active 的場地送打錯的 action，
// 訊息會說「只有 pending 可以審」—— 而真正的問題是 action 打錯了，
// 後台的人會去找錯方向。
func TestDecideReviewOutcome_UnknownActionReportsAction(t *testing.T) {
	for _, act := range []string{"", "APPROVE", "approve ", "delete", "suspend"} {
		if _, err := decideReviewOutcome(act, shared.VenueStatusPending); !errors.Is(err, ErrUnknownAction) {
			t.Errorf("action=%q 應該回 ErrUnknownAction，得到 %v", act, err)
		}
	}
	// 承重那一格：狀態不合法**且** action 不合法時，要先講 action。
	if _, err := decideReviewOutcome("typo", shared.VenueStatusActive); !errors.Is(err, ErrUnknownAction) {
		t.Fatalf("兩者都錯時應該先報 action，得到 %v", err)
	}
}

// S4 rejected 與 suspended 必須是不同的值。
// 合成一個的話，「審核不通過」與「上線後被停權」在後台逐字相同，
// 而那個區別事後補不回來。
func TestVenueStatus_RejectedIsNotSuspended(t *testing.T) {
	if shared.VenueStatusRejected == shared.VenueStatusSuspended {
		t.Fatal("rejected 與 suspended 是同一個值 ⇒ 兩件不同的事在後台分不出來")
	}
	if shared.VenueStatusRejected == shared.VenueStatusPending ||
		shared.VenueStatusRejected == shared.VenueStatusActive {
		t.Fatal("rejected 撞到了其他狀態")
	}
}

// S5 審核 DTO 上不可以有 status（後台只能說 approve／reject，不能直接指定結果）。
func TestReviewRequest_NoForbiddenFields(t *testing.T) {
	rt := reflect.TypeOf(ReviewRequest{})
	got := map[string]bool{}
	for i := 0; i < rt.NumField(); i++ {
		n := strings.Split(rt.Field(i).Tag.Get("json"), ",")[0]
		if n != "" && n != "-" {
			got[strings.ToLower(n)] = true
		}
	}
	if len(got) == 0 {
		t.Fatal("一個 json 欄位都沒掃到 ⇒ 這把尺失明了")
	}
	for _, f := range reviewForbiddenFields {
		if got[strings.ToLower(f)] {
			t.Fatalf("審核 DTO 上出現了 %q ⇒ 後台可以繞過審核語意直接指定狀態", f)
		}
	}
	if len(reviewForbiddenFields) < 3 {
		t.Fatalf("禁止清單只有 %d 項", len(reviewForbiddenFields))
	}
	if !got["venueid"] || !got["action"] {
		t.Fatalf("正控失敗：連 venueId／action 都沒掃到（%v）", got)
	}
}
