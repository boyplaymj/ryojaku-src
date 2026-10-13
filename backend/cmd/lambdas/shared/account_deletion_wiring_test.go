package shared

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// 發 JWT 的地方不需要先問刪除狀態的例外。每一筆都要寫理由。
var tokenIssuersExemptFromDeletionCheck = map[string]string{
	// 註冊：帳號是這一次請求才建出來的，不可能已經提出過刪除。
	"apis/mahjongclub_app_register/main.go": "new account",
}

// TestEveryTokenIssuerResolvesAccountDeletionFirst 釘住刪除頁的兩句承諾：
// 「三十日內重新登入即撤回」與「滿三十日即清除」。
//
// 兩句都靠同一件事成立：**每一個**發 JWT 的入口，發之前都先呼叫
// ResolveAccountDeletionOnLogin。漏掉一個入口的後果沒有任何錯誤訊息 ——
// 從那個入口登入的人拿得到 JWT、用得了 App，而帳號仍掛著刪除、到期照樣被清掉。
//
// 掃的是「誰呼叫了 shared.GenerateToken」，不是一份手列的登入端點名單：
// 以後多一個登入方式（例如 Sign in with Apple）也會被這條照到。
//
// 🔴 照不到的：不經過 shared.GenerateToken 自己簽 JWT 的程式；
//
//	以及「有呼叫但忽略回傳值」—— 這條只看呼叫的先後，不看錯誤有沒有被處理。
func TestEveryTokenIssuerResolvesAccountDeletionFirst(t *testing.T) {
	root := ".."
	files, err := filepath.Glob(filepath.Join(root, "apis", "*", "*.go"))
	if err != nil || len(files) < 50 {
		t.Fatalf("只掃到 %d 個檔（err=%v）⇒ 掃描範圍不對，下面的結論不算數", len(files), err)
	}

	isSharedCall := func(n ast.Node, name string) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return false
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != name {
			return false
		}
		pkg, ok := sel.X.(*ast.Ident)
		return ok && pkg.Name == "shared"
	}

	var guarded, exempt []string
	for _, path := range files {
		if filepath.Ext(path) != ".go" || len(path) > 8 && path[len(path)-8:] == "_test.go" {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			t.Fatalf("解析失敗 %s：%v", path, err)
		}
		rel := filepath.ToSlash(path[len(root)+1:])
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			var issueAt, resolveAt []token.Pos
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				if isSharedCall(n, "GenerateToken") {
					issueAt = append(issueAt, n.Pos())
				}
				if isSharedCall(n, "ResolveAccountDeletionOnLogin") {
					resolveAt = append(resolveAt, n.Pos())
				}
				return true
			})
			for _, issue := range issueAt {
				if _, ok := tokenIssuersExemptFromDeletionCheck[rel]; ok {
					exempt = append(exempt, rel)
					continue
				}
				before := false
				for _, r := range resolveAt {
					if r < issue {
						before = true
					}
				}
				if !before {
					t.Errorf("%s 的 %s() 在第 %d 行發 JWT，之前沒有呼叫 shared.ResolveAccountDeletionOnLogin",
						rel, fn.Name.Name, fset.Position(issue).Line)
					continue
				}
				guarded = append(guarded, rel)
			}
		}
	}

	sort.Strings(guarded)
	// 今天的讀數是三個登入入口。少於三個代表有人把發 JWT 的方式改掉了，這條因此變瞎。
	if len(guarded) < 3 {
		t.Fatalf("只找到 %d 個受守的發 JWT 處（%v）⇒ 這條測試的掃法可能已經照不到東西", len(guarded), guarded)
	}
	// 例外清單上的每一筆都要真的還在發 JWT，否則那筆例外是過期的。
	for rel := range tokenIssuersExemptFromDeletionCheck {
		found := false
		for _, e := range exempt {
			if e == rel {
				found = true
			}
		}
		if !found {
			t.Errorf("例外 %s 已經不呼叫 shared.GenerateToken，請從例外清單移除", rel)
		}
	}
}

// 讀了 ?userId=／?targetUserId= 卻不需要問「這個人是不是已提出刪除」的端點。每一筆都要寫理由。
var userIDParamReadersExemptFromHiding = map[string]string{
	"apis/mahjongclub_admin_point_history/main.go":       "後台：管理員查帳，不是使用者互看",
	"apis/mahjongclub_admin_users/main.go":               "後台：管理員管理使用者，停用中的帳號也要看得到",
	"apis/mahjongclub_chat_ws_connect/main.go":           "只剩註解提到；身分取自 authorizer",
	"apis/mahjongclub_community_get_post_detail/main.go": "userId 是「誰在看」（算按讚狀態），不是被看的人",
	"apis/mahjongclub_community_get_posts/main.go":       "userId 是「誰在看」（算按讚狀態），不是被看的人",
	"apis/mahjongclub_web_user_info/main.go":             "只回登入者自己的資料；query 的 userId 只拿來記錄",
	"apis/mahjongclub_web_verify_user/main.go":           "必須是驗證過的身分，只回自己",
}

// TestUserIDParamReadersHideDeletedAccounts 釘住刪除頁第三條「其他用戶看不到您的個人檔案」。
//
// App 沒有單一的「看別人個人檔案」端點 —— 別人的評價、評語、貼文是三支各自吃
// ?userId=／?targetUserId= 的端點。掃的是「誰讀了那兩個參數」：以後多一支，
// 沒接上也沒寫例外理由的話這條會紅。
//
// 🔴 照不到的：從 body、path 參數或別的參數名拿到「別人的 userId」的端點；
//
//	以及團局、聊天、貼文列表裡各筆紀錄自己存的顯示名稱與大頭貼。
func TestUserIDParamReadersHideDeletedAccounts(t *testing.T) {
	root := ".."
	files, err := filepath.Glob(filepath.Join(root, "apis", "*", "main.go"))
	if err != nil || len(files) < 50 {
		t.Fatalf("只掃到 %d 個檔（err=%v）⇒ 掃描範圍不對，下面的結論不算數", len(files), err)
	}
	reads := func(src string) bool {
		return strings.Contains(src, `QueryStringParameters["userId"]`) ||
			strings.Contains(src, `QueryStringParameters["targetUserId"]`)
	}
	var guarded []string
	seen := map[string]bool{}
	for _, path := range files {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		src := string(b)
		if !reads(src) {
			continue
		}
		rel := filepath.ToSlash(path[len(root)+1:])
		seen[rel] = true
		if _, ok := userIDParamReadersExemptFromHiding[rel]; ok {
			continue
		}
		if !strings.Contains(src, "shared.AccountHiddenFromOthers(") {
			t.Errorf("%s 讀了 ?userId=／?targetUserId= 卻沒有呼叫 shared.AccountHiddenFromOthers，也不在例外清單裡", rel)
			continue
		}
		guarded = append(guarded, rel)
	}
	sort.Strings(guarded)
	if len(guarded) < 3 {
		t.Fatalf("只找到 %d 支受守的端點（%v）⇒ 這條的掃法可能已經照不到東西", len(guarded), guarded)
	}
	for rel := range userIDParamReadersExemptFromHiding {
		if !seen[rel] {
			t.Errorf("例外 %s 已經不讀那兩個參數，請從例外清單移除", rel)
		}
	}
}

// 碰了 Notifications 表、也會 PutItem，卻不需要先問「收件人是不是已刪除」的端點。每一筆都要寫理由。
var notificationWritersExemptFromDeletedCheck = map[string]string{}

// TestNotificationWritersSkipDeletedRecipients：每一支會替別人寫通知的端點，寫之前都要先問
// shared.RecipientIsDeleted。通知的寫入沒有集中在一處（九支各有自己的函式），
// 漏掉一支的後果是墓碑名下繼續長出新的列，而且沒有任何錯誤。
//
// 掃的是「同一個檔裡提到 Notifications 表、又有 PutItem」。
// 🔴 照不到的：透過 shared.CreateNotification 寫的（那支自己在函式裡問）；
//
//	表名不是寫成 `Notifications"` 字面的；以及「有呼叫但問的不是收件人」。
func TestNotificationWritersSkipDeletedRecipients(t *testing.T) {
	root := ".."
	files, err := filepath.Glob(filepath.Join(root, "apis", "*", "main.go"))
	if err != nil || len(files) < 50 {
		t.Fatalf("只掃到 %d 個檔（err=%v）⇒ 掃描範圍不對，下面的結論不算數", len(files), err)
	}
	guarded := 0
	seen := map[string]bool{}
	for _, path := range files {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		src := string(b)
		if !strings.Contains(src, `Notifications"`) || !strings.Contains(src, "PutItem") {
			continue
		}
		rel := filepath.ToSlash(path[len(root)+1:])
		seen[rel] = true
		if _, ok := notificationWritersExemptFromDeletedCheck[rel]; ok {
			continue
		}
		if !strings.Contains(src, "shared.RecipientIsDeleted(") {
			t.Errorf("%s 會寫 Notifications，卻沒有呼叫 shared.RecipientIsDeleted，也不在例外清單裡", rel)
			continue
		}
		guarded++
	}
	if guarded < 9 {
		t.Fatalf("只找到 %d 支受守的通知寫入端（2026-10-13 是 9 支）⇒ 這條的掃法可能已經照不到東西", guarded)
	}
	for rel := range notificationWritersExemptFromDeletedCheck {
		if !seen[rel] {
			t.Errorf("例外 %s 已經不寫 Notifications，請從例外清單移除", rel)
		}
	}
	// 共用的那一支自己問。
	b, err := os.ReadFile("notification_utils.go")
	if err != nil || !strings.Contains(string(b), "RecipientIsDeleted(ctx, p.UserID)") {
		t.Errorf("shared.CreateNotification 沒有先問 RecipientIsDeleted（err=%v）", err)
	}
}
