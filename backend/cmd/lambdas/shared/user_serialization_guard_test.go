package shared

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// allowedUserSerializers lists the ONLY places where a whole shared.User may be
// placed in a JSON-tagged response field. shared.User carries server-side
// credentials (PasswordHash, EncryptedLineID), so serializing it wholesale
// leaks them unless the endpoint strips them first.
//
// user_info is on this list because it strips via buildUserInfoBody /
// stripServerSideCredentials, pinned by that package's own tests.
// (SECURITY_AUDIT_2026-09-03 findings 3 & 7, §4b)
var allowedUserSerializers = map[string]bool{
	"apis/mahjongclub_web_user_info/main.go": true,
}

// TestNoEndpointSerializesWholeUser is the §4b guard: the audit's claim that
// user_info is the only endpoint serializing a full *shared.User was reached by
// reading code. Reading code has no exit code — this does.
//
// 🔴 What this does NOT cover (do not read a green run as "no user data can
// leak"): a `Data interface{}` field assigned a *shared.User at runtime is
// invisible to an AST scan of field types. As of 2026-09-03 every interface{}
// Data assignment in cmd/lambdas builds an explicit field whitelist
// (map[string]interface{}{"displayName": ..., ...}), verified by hand — that
// part is still an eyeball result, and this test cannot keep it true.
func TestNoEndpointSerializesWholeUser(t *testing.T) {
	root := ".."
	if _, err := os.Stat(filepath.Join(root, "apis")); err != nil {
		t.Fatalf("cannot locate cmd/lambdas/apis from %q: %v "+
			"(fail closed: a scan over zero files would look identical to a pass)", root, err)
	}

	var scanned int
	var violations []string

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		f, perr := parser.ParseFile(fset, path, nil, 0)
		if perr != nil {
			return perr
		}
		scanned++

		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)

		// Local aliases such as `type User = shared.User` (create_game does
		// this) would hide the type name from a naive scan.
		aliases := map[string]bool{"shared.User": true}
		ast.Inspect(f, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			if typeName(ts.Type) == "shared.User" {
				aliases[ts.Name.Name] = true
			}
			return true
		})

		ast.Inspect(f, func(n ast.Node) bool {
			field, ok := n.(*ast.Field)
			if !ok || field.Tag == nil {
				return true
			}
			if !strings.Contains(field.Tag.Value, "json:") {
				return true
			}
			if !aliases[strings.TrimPrefix(typeName(field.Type), "*")] {
				return true
			}
			if allowedUserSerializers[rel] {
				return true
			}
			name := "<embedded>"
			if len(field.Names) > 0 {
				name = field.Names[0].Name
			}
			violations = append(violations, rel+": field "+name+" "+field.Tag.Value)
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk failed: %v", err)
	}

	// Print coverage: "0 files checked" must not be able to look like a pass.
	t.Logf("scanned %d non-test .go files under cmd/lambdas", scanned)
	if scanned < 50 {
		t.Fatalf("only %d files scanned — the walk is not reaching the lambdas", scanned)
	}

	if len(violations) > 0 {
		t.Errorf("shared.User is serialized wholesale outside the allowed list "+
			"(it carries PasswordHash / EncryptedLineID):\n  %s\n\n"+
			"→ Either build an explicit field whitelist for that response, or strip "+
			"the credentials and add the file to allowedUserSerializers.",
			strings.Join(violations, "\n  "))
	}
}

func typeName(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + typeName(t.X)
	case *ast.SelectorExpr:
		return typeName(t.X) + "." + t.Sel.Name
	}
	return ""
}
