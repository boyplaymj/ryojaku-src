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
import ast, io, os, sys, glob, tokenize

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

# ── 閘門（--gate）─────────────────────────────────────────────────────────────
# 判準：**每一支 `verify_*.py` 都必須有一條回 rc=2 的路**，除非它在自己的原始碼裡
# 寫一行 `# RC2-EXEMPT: <理由>`。
#
# 🔴 為什麼是「預設全要 ＋ 顯式豁免」，而不是「推導誰需要」：
#    推導版要維護一份「哪些 import 算外部依賴」的名單（urllib／subprocess／boto3／
#    playwright…），而**那又是一份手寫清單** —— 新腳本改用 `httpx`／`aiohttp` 就會被
#    判成「不需要 rc=2」而靜靜放行。本檔今天已經因為手寫清單被咬過兩次
#    （grep 漏 `sys.exit(main())`、AST 漏 `raise SystemExit`），不再賭第三次。
#    預設全要的代價是「偶爾要寫一行豁免」，而那一行是**被看得見、要寫理由**的。
#
# 🔴 **界線（不要讀成「有 rc=2 就對了」）**：本閘只驗「**那條路存在**」，
#    不驗「設備問題真的會走到它」—— `sys.exit(2)` 寫在一條死分支裡也會過。
#    它擋的是「新腳本從頭到尾沒想過這件事」，那是便宜又真實的失效模式。
EXEMPT_MARK = "RC2-EXEMPT:"


def find_exempt(src):
    """回 (reason, reject_note)。只認**真正的註解 token** ＋ **非空理由**。

    🔴 第一版寫 `if EXEMPT_MARK in ln`（任意行的 substring），比我自己宣告的格式
    `# RC2-EXEMPT: <理由>` **寬得多**（2026-09-12 Codex 覆驗抓到 P2）：
    docstring 裡提到它、字串常數裡寫它、理由留空，全都會放行。
    ⇒ **宣告與實作不符，而不符的方向是「豁免通道被誤開」** —— 那比漏擋更糟，
    因為它看起來完全正常（清單上就是一行 🟡 豁免）。

    🔴 用 `tokenize` 而不是自己判「這行是不是註解」：後者要處理字串裡的 `#`、
    行內註解、三引號…… 那又是一份手寫規則。`tokenize` 的 COMMENT token 就是答案。

    ⚠️ 刻意**不**加「理由至少 N 個字」這種長度門檻 —— 那個數字沒有證據撐著。
    品質靠「理由會被印出來給人看」，不靠字數。
    """
    rejected = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type != tokenize.COMMENT or EXEMPT_MARK not in tok.string:
                continue
            reason = tok.string.split(EXEMPT_MARK, 1)[1].strip()
            if reason:
                return reason, None
            rejected.append("第 %d 行：註解裡有標記但**理由是空的**" % tok.start[0])
    except (tokenize.TokenError, IndentationError, SyntaxError) as e:
        return None, "tokenize 失敗（%s）⇒ 不給豁免" % type(e).__name__
    # 標記出現在非註解處（docstring／字串常數）也要講出來，否則作者會以為標記壞了
    if EXEMPT_MARK in src and not rejected:
        rejected.append("原始碼裡有標記，但**不在註解裡**（docstring／字串不算）")
    return None, "；".join(rejected) if rejected else None


def has_rc2(codes):
    """codes 裡有沒有一條明確通往 2 的路。"""
    return any(c == "2" or c.endswith(":2") for c in codes)


ROOT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") \
    else os.path.dirname(os.path.abspath(__file__))
GATE = "--gate" in sys.argv
rows = []
for p in sorted(glob.glob(os.path.join(ROOT, "verify_*.py"))):
    src = io.open(p, encoding="utf-8").read()
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        # 🔴 解析不了就 rc=2，不可以靜靜跳過 —— 那與「這支沒問題」逐字相同。
        print("%-42s ⚠️ 解析失敗：%s" % (os.path.basename(p), e))
        if "--gate" in sys.argv:
            print("\n⚠️ rc=2：掃描器自己讀不懂那個檔，這一輪不是判定。")
            sys.exit(2)
        continue
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
    exempt, reject_note = find_exempt(src)
    rows.append((os.path.basename(p), codes, exempt, reject_note))
    print("%-42s %s" % (os.path.basename(p), " ".join(sorted(codes)) or "（掃不到任何結束行程的點）"))


if GATE:
    print("-" * 74)
    if not rows:
        print("⚠️ rc=2：一支 verify_*.py 都沒掃到（路徑給錯？）—— 不可讀成通過。")
        sys.exit(2)
    bad = [(n, c, note) for n, c, ex, note in rows if ex is None and not has_rc2(c)]
    exempted = [(n, ex) for n, c, ex, note in rows if ex is not None]
    for n, ex in exempted:
        print("🟡 豁免 %-38s 理由：%s" % (n, ex))
    if bad:
        print("🔴 rc=1：下列 %d 支沒有任何通往 rc=2 的路：" % len(bad))
        for n, c, note in bad:
            print("     %-40s 目前只有：%s" % (n, " ".join(sorted(c)) or "（無）"))
            if note:
                # 🔴 標記寫了卻不算數時一定要講出來，否則「豁免沒生效」與
                #    「我根本沒寫標記」在輸出上逐字相同，作者會以為機制壞了。
                print("       ↳ 豁免不成立：%s" % note)
        print("   約定：0 通過／1 被測物壞了（去看程式）／2 前提已變或設備問題（去看基礎設施）。")
        print("   真的不需要 → 在該檔加一行  # RC2-EXEMPT: <為什麼這支不會有設備問題>")
        sys.exit(1)
    # 🔴 這句第一版寫「%d 支全部有通往 rc=2 的路（豁免 N 支）」—— 那是假的：
    #    被豁免的那幾支正是**沒有**那條路才需要豁免。兩個數字要分開講。
    print("✅ %d 支：%d 支有通往 rc=2 的路，%d 支顯式豁免。"
          % (len(rows), len(rows) - len(exempted), len(exempted)))
    print("⚠️ 界線：本閘只驗『那條路存在』，不驗『設備問題真的會走到它』。")
    sys.exit(0)
