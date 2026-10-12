package shared

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
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
