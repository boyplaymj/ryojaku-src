// 棘輪：不准再新增「裸型別斷言」到生產碼。
//
// 裸型別斷言＝ x.(T)，而不是 v, ok := x.(T)、也不是 switch x.(type)。
// 斷言失敗會 panic ⇒ Lambda Unhandled ⇒ API Gateway 回 502，而 Lambda 端**零錯誤日誌**
// ⇒ 「函式壞了」與「回應形狀不合規矩」在 CloudWatch 上逐字相同（設計冊 P0／§5 都記過）。
//
// 🔴 用 go/ast 而不是 grep：這是「哪些運算式是型別斷言」的問題，parser 才答得準。
// grep 寫得出來的只是一份手挑清單（.(string) .(float64) …），漏掉的那種零徵兆。
//
// 🔴 為什麼是棘輪不是「一律禁止」：2026-09-11 修完兩支 registration handler 之後，
// 全 repo 生產碼仍有 11 處。一次修完划不來（多半在 admin 那幾支，而且改動面大），
// 但**不能讓它繼續長**。既有的收進 baseline.txt，新增的一律紅。
//
// 🔴 key 是「相對路徑 ＋ 斷言原文」，**不是行號**：行號會被上面任何一行編輯位移，
// 那會讓 baseline 每次改動都假紅，而假紅訓練出「直接重建 baseline」的習慣。
//
// ⚠️ 已知代價：同一個檔裡**原文相同**的兩處會塌成一筆（admin_push_all 的
// token.Claims.(jwt.MapClaims) 就是這樣：AST 掃到 3 處，baseline 只有 2 筆）。
// ⇒ 修掉三處中的一處不會被本測試看見。代價不對稱所以接受：
// 行號當 key 的話每次上游編輯都假紅，而假紅訓練出「直接 -update」的習慣，
// 那會讓真正的新增也一起被吞掉。
//
// 真的必須寫裸斷言時：把它加進 baseline.txt 並在該行留一句為什麼。
// 重建：go test ./cmd/lambdas/bareassert -run TestBareAssertRatchet -update
package bareassert

import (
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "重建 baseline.txt")

// scan 回「相對路徑\t斷言原文」的集合。root 由呼叫端給，**不寫死檢出根**
// （CLAUDE.md 🌲：寫死的話在 git worktree 裡會掃到主工作樹）。
func scan(t *testing.T, root string) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	fset := token.NewFileSet()
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") {
			return err
		}
		if strings.HasSuffix(p, "_test.go") {
			return nil // 測試檔 panic 就是測試失敗，不會變成線上 502
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		node, err := parser.ParseFile(fset, p, src, 0)
		if err != nil {
			// 🔴 解析不了就讓測試紅，不可以靜靜跳過 —— 那與「這個檔沒有裸斷言」逐字相同。
			t.Fatalf("parse 失敗 %s: %v", p, err)
		}
		safe := map[ast.Node]bool{}
		ast.Inspect(node, func(n ast.Node) bool {
			switch s := n.(type) {
			case *ast.AssignStmt:
				if len(s.Lhs) == 2 && len(s.Rhs) == 1 {
					if ta, ok := s.Rhs[0].(*ast.TypeAssertExpr); ok {
						safe[ta] = true
					}
				}
			case *ast.TypeSwitchStmt:
				ast.Inspect(s.Assign, func(m ast.Node) bool {
					if ta, ok := m.(*ast.TypeAssertExpr); ok {
						safe[ta] = true
					}
					return true
				})
			}
			return true
		})
		ast.Inspect(node, func(n ast.Node) bool {
			ta, ok := n.(*ast.TypeAssertExpr)
			if !ok || ta.Type == nil || safe[ta] {
				return true
			}
			rel, _ := filepath.Rel(root, p)
			snippet := string(src[fset.Position(ta.Pos()).Offset:fset.Position(ta.End()).Offset])
			out[fmt.Sprintf("%s\t%s", filepath.ToSlash(rel), snippet)] = true
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	return out
}

func load(t *testing.T, p string) map[string]bool {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("讀不到 baseline %s: %v", p, err)
	}
	out := map[string]bool{}
	for _, ln := range strings.Split(string(b), "\n") {
		ln = strings.TrimRight(ln, "\r")
		if ln == "" || strings.HasPrefix(ln, "#") {
			continue
		}
		out[ln] = true
	}
	return out
}

func TestBareAssertRatchet(t *testing.T) {
	root := ".." // cmd/lambdas；相對於本測試所在的套件目錄
	found := scan(t, root)

	if *update {
		keys := make([]string, 0, len(found))
		for k := range found {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		body := "# 裸型別斷言的既有清單（棘輪基線）。新增一處就會讓測試紅。\n" +
			"# 格式：<相對 cmd/lambdas 的路徑>\\t<斷言原文>\n" +
			strings.Join(keys, "\n") + "\n"
		if err := os.WriteFile("baseline.txt", []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("已重建 baseline.txt（%d 筆）", len(keys))
		return
	}

	base := load(t, "baseline.txt")

	var added, removed []string
	for k := range found {
		if !base[k] {
			added = append(added, k)
		}
	}
	for k := range base {
		if !found[k] {
			removed = append(removed, k)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)

	for _, a := range added {
		t.Errorf("🔴 新增了裸型別斷言（會 panic → 502 且零錯誤日誌）：\n    %s\n"+
			"    改成 v, ok := x.(T) 並在 !ok 時 fail-closed；真的必須寫就加進 baseline.txt 並附理由。", a)
	}
	// 🔴 移除也要紅：否則 baseline 會靜靜過期，而「過期的 baseline」會把
	//    未來新增的那一處當成既有的放過去。
	for _, r := range removed {
		t.Errorf("✅ baseline 裡這筆已經修掉了，請更新 baseline（-update）：\n    %s", r)
	}
	t.Logf("生產碼裸型別斷言：%d 處（baseline %d 處）", len(found), len(base))
}

// TestRatchetHasTeeth 是上面那條的**正控**：把一段已知含裸斷言的原始碼丟進掃描器，
// 它必須抓得到；同時安全形式必須不被誤報。
// 少了它，scan() 若因為任何理由永遠回空集合，上面那條會**恆綠**，
// 而「一處都沒新增」與「掃描器瞎了」逐字相同。
func TestRatchetHasTeeth(t *testing.T) {
	dir := t.TempDir()
	src := `package fx
func bare(m map[string]interface{}) string { return m["a"].(string) }
func safe(m map[string]interface{}) string { v, ok := m["b"].(string); if !ok { return "" }; return v }
func sw(v interface{}) string { switch v.(type) { case string: return "s" }; return "" }
`
	if err := os.WriteFile(filepath.Join(dir, "fx.go"), []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	got := scan(t, dir)
	if len(got) != 1 {
		t.Fatalf("期望恰好抓到 1 處裸斷言，實得 %d：%v", len(got), got)
	}
	for k := range got {
		if !strings.Contains(k, `m["a"].(string)`) {
			t.Errorf("抓到的不是預期那一處：%s", k)
		}
	}
}
