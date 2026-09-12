// 棘輪：不准再新增「裸型別斷言」到生產碼。
//
// 裸型別斷言＝ x.(T)，而不是 v, ok := x.(T)、也不是 switch x.(type)。
// 斷言失敗會 panic ⇒ Lambda Unhandled ⇒ API Gateway 回 502，而 Lambda 端**零錯誤日誌**
// ⇒ 「函式壞了」與「回應形狀不合規矩」在 CloudWatch 上逐字相同（設計冊 P0／§5 都記過）。
//
// 🔴 用 go/ast 而不是 grep：這是「哪些運算式是型別斷言」的問題，parser 才答得準。
// grep 寫得出來的只是一份手挑清單（.(string) .(float64) …），漏掉的那種零徵兆。
//
// 🔴 2026-09-12：baseline 已經**清到 0 筆** —— admin 那 8 支的 10 處全部修掉了。
// ⇒ 現在它實質上是「一律禁止」，而不再是棘輪。留著 baseline.txt 與 -update 機制，
// 是因為將來真的有必須寫裸斷言的地方時，要有一個**帶理由**的出口，
// 而不是讓人把整條測試註解掉。
// （歷史：2026-09-11 修完兩支 registration handler 時還剩 11 處，一次修完划不來，
// 所以先做成棘輪；隔天把剩下的補完。）
//
// 🔴 baseline 是 0 筆之後，「一處都沒有」與「scan() 瞎了回空集合」在本測試上**逐字相同**。
// 撐住這個區別的是 TestRatchetHasTeeth（正控），以及 build_all.sh 那道閘門
// —— 少了正控，這條測試會恆綠而看起來完全正常。
//
// 🔴 key 是「相對路徑 ＋ 斷言原文」，**不是行號**：行號會被上面任何一行編輯位移，
// 那會讓 baseline 每次改動都假紅，而假紅訓練出「直接重建 baseline」的習慣。
//
// ⚠️ 已知代價：同一個檔裡**原文相同**的兩處會塌成一筆。
// （2026-09-11 的實例：admin_push_all 的 token.Claims.(jwt.MapClaims) AST 掃到 3 處、
// baseline 只有 2 筆。那 3 處 2026-09-12 已全部修掉，此處只留形狀當說明。）
// ⇒ 修掉三處中的一處不會被本測試看見。代價不對稱所以接受：
// 行號當 key 的話每次上游編輯都假紅，而假紅訓練出「直接 -update」的習慣，
// 那會讓真正的新增也一起被吞掉。
//
// 真的必須寫裸斷言時（現在應該是 0 筆，所以這是例外不是常態）：加進 baseline.txt 並附理由。
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

// renderBaseline 把 key 集合渲染成 baseline.txt 的內容。
//
// 🔴 抽出來是為了讓它**可測**。舊版把字串組在 `if *update` 裡面，而那段
// 只在有人手打 `-update` 時才執行 ⇒ 沒有任何測試碰得到它。
// 🔴 它有一個真的 bug，2026-09-12 Codex 覆驗抓到：舊版寫
// `header + strings.Join(keys, "\n") + "\n"`，**keys 為空時 Join 回空字串**
// ⇒ 產出 `header + "\n"`，尾巴多一行空白（`git diff --check` 會報
// "new blank line at EOF"）。
// ⚠️ 它在 baseline 有內容的那 9 個月都是對的 —— **清到 0 筆的那一刻才第一次浮出來**，
// 而那正是我這一輪做的事。「以前沒出過問題」對退化情形零鑑別力。
func renderBaseline(keys []string) string {
	body := "# 裸型別斷言的既有清單（棘輪基線）。新增一處就會讓測試紅。\n" +
		"# 格式：<相對 cmd/lambdas 的路徑>\\t<斷言原文>\n"
	for _, k := range keys {
		body += k + "\n"
	}
	return body
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
		if err := os.WriteFile("baseline.txt", []byte(renderBaseline(keys)), 0o644); err != nil {
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

// TestRenderBaselineNoTrailingBlank 擋的是 renderBaseline 的**退化情形**。
//
// 🔴 兩格缺一不可：只驗 0 筆的話，`renderBaseline` 退化成「永遠只回檔頭」
// 也會全綠；只驗 N 筆的話，正是 2026-09-12 那個 bug 的所在（Join 對空切片
// 回空字串）結構上量不到。**退化情形要配一個非退化的控制組。**
func TestRenderBaselineNoTrailingBlank(t *testing.T) {
	for _, tc := range []struct {
		name string
		keys []string
		want string
	}{
		{"空集合（baseline 清到 0 的那一格）", nil, header()},
		{"兩筆（控制組：少了它，永遠只回檔頭也會綠）", []string{"a/main.go\tx.(int)", "b/main.go\ty.(string)"},
			header() + "a/main.go\tx.(int)\n" + "b/main.go\ty.(string)\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := renderBaseline(tc.keys)
			if got != tc.want {
				t.Errorf("渲染結果不符\n  got  %q\n  want %q", got, tc.want)
			}
			if strings.HasSuffix(got, "\n\n") {
				t.Errorf("尾巴有多餘空白行（git diff --check 會報 new blank line at EOF）：%q", got)
			}
			if !strings.HasSuffix(got, "\n") {
				t.Errorf("檔案必須以單一換行收尾：%q", got)
			}
		})
	}
}

func header() string {
	return "# 裸型別斷言的既有清單（棘輪基線）。新增一處就會讓測試紅。\n" +
		"# 格式：<相對 cmd/lambdas 的路徑>\\t<斷言原文>\n"
}

// TestBaselineFileMatchesRenderer 是上面那條的**接線檢查**：磁碟上那份必須
// 逐位元組等於 renderBaseline 對「它自己載入的那些 key」的輸出。
//
// 🔴 少了它，renderBaseline 可以修得很乾淨，而 baseline.txt 留著舊的壞尾巴
// —— 兩者在 `go test` 上逐字相同（前一條照樣綠）。修了產生器不等於修了產物。
func TestBaselineFileMatchesRenderer(t *testing.T) {
	b, err := os.ReadFile("baseline.txt")
	if err != nil {
		t.Fatal(err)
	}
	base := load(t, "baseline.txt")
	keys := make([]string, 0, len(base))
	for k := range base {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if got, want := string(b), renderBaseline(keys); got != want {
		t.Errorf("baseline.txt 與 renderBaseline 的輸出不符（跑 -update 重建）\n  磁碟 %q\n  應為 %q", got, want)
	}
}
