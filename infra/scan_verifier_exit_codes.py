#!/usr/bin/env python3
"""掃每支驗證腳本「能產生哪些 exit code」—— 用 AST，不用 grep。

🔴 第一版我用 grep 列 `sys.exit(0..9|rc|fail)` 這種**手寫清單**，
   漏掉 `sys.exit(main())`（回傳值在別的函式裡）⇒ 兩支被誤判成「沒有 exit」，
   其中一支正是我拿來當迴歸尺的 verify_admin_role_gate.py。
   手挑清單漏掉的那種**零徵兆**，這正是本專案記過的形狀。
"""
import ast, io, os, sys, glob

def const_codes(node, fnreturns):
    """把一個 exit/return 的引數化約成可判讀的描述。"""
    if node is None: return {"0(隱含)"}
    if isinstance(node, ast.Constant):
        return {str(node.value)}
    if isinstance(node, ast.Name):
        return {"var:" + node.id}
    if isinstance(node, ast.Call):
        f = node.func
        name = getattr(f, "id", None) or getattr(f, "attr", None)
        if name in fnreturns:
            return {"→" + name + ":" + c for c in fnreturns[name]}
        return {"call:" + str(name)}
    if isinstance(node, ast.IfExp):
        return const_codes(node.body, fnreturns) | const_codes(node.orelse, fnreturns)
    return {"expr"}

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
for p in sorted(glob.glob(os.path.join(ROOT, "verify_*.py"))):
    src = io.open(p, encoding="utf-8").read()
    tree = ast.parse(src)
    # 先收每個函式的 return 常數
    fnreturns = {}
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        cs = set()
        for r in [n for n in ast.walk(fn) if isinstance(n, ast.Return)]:
            cs |= const_codes(r.value, {})
        fnreturns[fn.name] = cs or {"None"}
    codes = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            f = n.func
            nm = getattr(f, "attr", None) or getattr(f, "id", None)
            if nm == "exit" and (getattr(getattr(f, "value", None), "id", "") == "sys" or nm == "exit"):
                codes |= const_codes(n.args[0] if n.args else None, fnreturns)
    print("%-42s %s" % (os.path.basename(p), " ".join(sorted(codes)) or "（沒有任何 sys.exit）"))
