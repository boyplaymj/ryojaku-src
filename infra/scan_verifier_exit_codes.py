#!/usr/bin/env python3
"""掃每支驗證腳本「能產生哪些 exit code」—— 用 AST，不用 grep。

🔴 **這支自己被同一個形狀咬過兩次，都留著當紀錄。**

第一次：用 grep 列 `sys.exit(0..9|rc|fail)` 這種**手寫清單**，
漏掉 `sys.exit(main())`（回傳值在別的函式裡）⇒ 兩支被誤判成「沒有 exit」，
其中一支正是拿來當部署迴歸尺的 `verify_admin_role_gate.py`。

第二次（2026-09-12，Codex 覆驗抓到）：改用 AST 之後**只認 `sys.exit`**，
漏掉 **`raise SystemExit(...)`** —— 而 `verify_admin_role_gate.py` 正好有一處。
⇒ **換了工具不等於換掉那個毛病**：AST 版的入口清單一樣是我手寫的，
只是從「字串樣式」變成「節點種類」。判別法是問「還有什麼寫法會結束行程」，
不是問「我的 regex 夠不夠寬」。

⚠️ **已知界線（不要讀成「這支看得到全部」）**：
- `raise SystemExit("字串")` 的 exit code 是 **1**（Python 對非 int 引數印訊息後退 1），
  本支會標成 `SystemExit:str→1`。
- **未捕捉的例外一律 rc=1，而本支看不到它們** —— 那是無窮多種寫法，列不完。
  所以「掃出 0/1/2」不等於「rc=2 真的涵蓋了所有設備問題」。
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
        # ① sys.exit(...) / exit(...) / quit(...)
        if isinstance(n, ast.Call):
            f = n.func
            nm = getattr(f, "attr", None) or getattr(f, "id", None)
            if nm in ("exit", "quit", "_exit"):
                codes |= const_codes(n.args[0] if n.args else None, fnreturns)
        # ② raise SystemExit(...) —— 2026-09-12 補。漏掉它的話，
        #    一個「前提錯誤卻退 1」的路徑在本表上與「根本沒有那條路」逐字相同。
        if isinstance(n, ast.Raise) and n.exc is not None:
            exc = n.exc
            nm = getattr(getattr(exc, "func", exc), "id", None)
            if nm == "SystemExit":
                if isinstance(exc, ast.Call) and exc.args:
                    a = exc.args[0]
                    if isinstance(a, ast.Constant) and not isinstance(a.value, bool) and isinstance(a.value, int):
                        codes.add(str(a.value))
                    elif isinstance(a, ast.Constant):
                        codes.add("SystemExit:str→1")   # 非 int 引數 ⇒ 印訊息後退 1
                    else:
                        codes |= {"SystemExit:" + c for c in const_codes(a, fnreturns)}
                else:
                    codes.add("SystemExit:0")
    print("%-42s %s" % (os.path.basename(p), " ".join(sorted(codes)) or "（掃不到任何結束行程的點）"))
