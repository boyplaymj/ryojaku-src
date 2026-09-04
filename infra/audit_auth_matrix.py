import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BE   = os.path.join(ROOT, "backend")
MAN  = json.load(open(os.path.join(ROOT, "infra/functions.manifest.json")))["functions"]
YAML = open(os.path.join(ROOT, "infra/02-app.generated.yaml")).read()

# ---- 層2：從 generated yaml 抽每顆函式實際掛的 authorizer ----
def logical(name):
    return "Fn" + "".join(p.capitalize() for p in re.split(r"[-_]", name))
WS_ROUTES = dict(re.findall(r"RouteKey:\s*'([^']+)'(.*?)(?=^  \w|\Z)", YAML, re.S|re.M))
def ws_protected(path):
    blk = WS_ROUTES.get((path or "").strip(), "")
    return "AuthorizerId" in blk

def gw_authorizer(fname, f=None):
    if f and f.get("apiType") == "WEBSOCKET":
        rk = (f.get("path") or "").strip()
        if rk in ("$disconnect",):
            return "WS·$disconnect(無需)"
        if ws_protected(rk):
            return "WsAuthorizer"
        return "WS·由$connect繼承" if rk not in ("$connect",) else "無"
    lid = logical(fname)
    m = re.search(r"^  %s:\n(.*?)(?=^  \w|\Z)" % re.escape(lid), YAML, re.S | re.M)
    if not m: return "—(不在模板)"
    blk = m.group(1)
    a = re.findall(r"Authorizer:\s*(\w+)", blk)
    return a[0] if a else "無"

# ---- 層3：掃 handler 取身分的方式 ----
PATS = [
 ("AUTHZ_CTX",  r"Authorizer(?:UserID|UserIDV2)\("),
 ("GUI_OK",     r"(\w+)\s*,\s*(\w+)\s*:?=\s*(?:shared\.)?GetUserIdentifier"),
 ("VERIFY",     r"VerifyToken(?:WithUserPwGate|WithPwGate)?\("),
 ("RAW_QUERY",  r'QueryStringParameters\[\s*"(?:userId|lineID)"\s*\]'),
 ("RAW_BODY",   r'(?i)\buserId\b"\s*:\s*|UserID\s+string\s+`json:"userId'),
 # 🔴 角色守衛有**兩個載體**，只掃字面字串等於只看見一半：
 # 值住在共用套件 adminrole 裡（adminrole.Allows(claims, adminrole.Admin, …)），
 # 那條路上「admin」三個字**不會出現在 handler 原始碼裡**。
 # 實測 14 支用 adminrole 的端點在補這條之前全部讀成「N·未取身分」——
 # 與「真的沒查角色」逐字相同。用**值的來源**定址，不用外觀。
 #
 # 🔴🔴 而「提到角色」不等於「會拒絕」（2026-09-04 Codex P2 打回）。初版把
 # adminrole.Of / SubjectOf / 角色常數 / 字面字串全算成守衛 ——
 # 那些只是**讀**或**記錄** role，沒有任何拒絕路徑。誤報方向是最壞的那個：
 # 「其實沒有守衛」會被印成「有守衛」⇒ 缺口被這份報表親手蓋住。
 # ⇒ 拆成兩條，判定只採 GATE，REF 另外列出來。
 #
 # GATE 刻意收到「if !」這個**拒絕形狀**，不只是「呼叫了 Allows」——
 # 呼叫了而不用回傳值一樣不會拒絕。實測目前 16 個呼叫點**全部**是這個形狀
 # （7×Admin+SuperAdmin／5×SuperAdmin／2+2×其他組合），所以收緊不損失涵蓋。
 # ⚠️ 代價是 `ok := adminrole.Allows(…); if !ok {` 這種寫法會被漏掉 ——
 # 那是**故意選的方向**：漏報只多一行 ⚠️ 給人看，誤報會讓缺口消失。
 ("ROLE_GATE",  r"\bif\s+!\s*adminrole\.(?:Allows|RoleAllows)\s*\("),
 ("ROLE_REF",   r'adminrole\.(?:Allows|RoleAllows|Of|SubjectOf|ClaimString|Admin|SuperAdmin|Moderator)\b|"(?:super_admin|admin)"'),
]
# 🔴 剝註解後再掃。初版直接對原始碼跑正則，命中了 chat-ws-connect 註解裡
# 「原本這裡直接吃 request.QueryStringParameters["userId"]」這句描述性文字，
# 把一個已經修好的端點誤報成洞。被註解掉的程式碼照樣命中是正則掃碼的經典假陽性。
def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)      # 區塊註解
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)       # 整行註解
    src = re.sub(r"(?<!:)//[^\n\"`]*$", "", src, flags=re.M)  # 行尾註解(避開 http:// 與字串)
    return src

def scan_src(src):
    """對**已剝註解**的原始碼跑所有樣式。抽出來是為了讓 --selftest 能餵合成原始碼：
    反控不能只靠人手改一次正則再重跑，那種反控下次沒有人會再做一遍。"""
    return {k: re.findall(p, src) for k, p in PATS}

def verdict_of(hits):
    """回 (身分判定, 角色判定)。兩者正交，所以分開回、在版面上接成後綴。"""
    gui = hits["GUI_OK"]
    gui_ignored = [g for g in gui if g[1] == "_"]
    gui_checked = [g for g in gui if g[1] != "_"]
    if hits["AUTHZ_CTX"]:      ident = "A·authorizer取身分"
    elif gui_ignored:          ident = "🔴C·GetUserIdentifier忽略verified"
    elif gui_checked:          ident = "B·GetUserIdentifier檢查verified"
    elif hits["VERIFY"]:       ident = "B·程式內自驗JWT"
    elif hits["RAW_QUERY"]:    ident = "🔴D·直接讀query param"
    else:                      ident = "N·未取身分"
    # 🔴 只有 GATE 算守衛。有 REF 沒 GATE 要**講出來**而不是靜靜當成沒有 ——
    # 「提到角色卻不拒絕」正是最值得看一眼的那種列。
    if hits["ROLE_GATE"]:      role = "+角色守衛"
    elif hits["ROLE_REF"]:     role = "+角色參考(未見拒絕)"
    else:                      role = ""
    return ident, role

def scan(pp):
    d = os.path.join(BE, pp)
    if not os.path.isdir(d): return None, "目錄不存在"
    src = ""
    for dp,_,fs in os.walk(d):
        for f in fs:
            if f.endswith(".go"):
                src += strip_comments(open(os.path.join(dp,f), errors="ignore").read()) + "\n"
    if not src: return None, "無 .go"
    return scan_src(src), None

# ============================================================================
# --selftest：角色判定的反控（2026-09-04，Codex P2 要求）
#
# 🔴 為什麼要有這段：上一版的反控是「我手動把樣式換成永不命中的字串再跑一次」。
# 那種反控**只發生過一次**，下次改樣式沒有任何東西會再做一遍 ——
# 而它要防的正是「規則放寬到把非守衛也算成守衛」這種悄悄的退化。
# ⇒ 反控要能重跑，才叫反控。
#
# 判定的是 verdict_of()，餵的是合成原始碼（不是真檔）：這一層要驗的是
# 「哪種寫法算守衛」這條規則本身，不是 repo 現在剛好長什麼樣。
# 真檔那一側由上面的報表負責（而它會印分母）。
SELFTEST = [
 # (名稱, 合成原始碼, 期望角色判定)
 ("T1 正控：if !Allows 是拒絕形狀",
  'if !adminrole.Allows(claims, adminrole.Admin) { return deny() }', "+角色守衛"),
 ("T2 🔴Codex 指定的反控：拿掉 Allows、只留角色常數 ⇒ 必須不再算守衛",
  'log.Printf("role=%s", adminrole.Admin)', "+角色參考(未見拒絕)"),
 ("T3 只讀 role（Of）不拒絕 ⇒ 參考",
  'role := adminrole.Of(claims)', "+角色參考(未見拒絕)"),
 ("T4 只取 subject（SubjectOf）⇒ 參考",
  'sub := adminrole.SubjectOf(claims)', "+角色參考(未見拒絕)"),
 ("T5 字面字串 \"admin\" 不是守衛（它可能只是欄位值或日誌）",
  'attr := map[string]string{"role": "admin"}', "+角色參考(未見拒絕)"),
 ("T6 呼叫 Allows 但**不用回傳值** ⇒ 不算守衛（收緊的重點）",
  'adminrole.Allows(claims, adminrole.Admin)', "+角色參考(未見拒絕)"),
 ("T7 RoleAllows 也是守衛（同套件的第二支拒絕原語）",
  'if !adminrole.RoleAllows(role, adminrole.SuperAdmin) { return deny() }', "+角色守衛"),
 ("T8 完全沒提到角色 ⇒ 空字串（不是「參考」）",
  'x := request.Body', ""),
 ("T9 守衛與參考並存時，守衛勝出（真實 authorizer 就長這樣）",
  'if !adminrole.Allows(claims, adminrole.Admin) { return nil, err }\n'
  'log.Printf("%s", adminrole.Of(claims))', "+角色守衛"),
 # 🔴 身分那一維也要有一條，否則「我只改到角色」這件事沒有東西釘住
 ("T10 身分判定不受本次改動影響（正交）",
  'uid := AuthorizerUserID(request)', "A·authorizer取身分"),
]

def selftest():
    ok = True
    for name, src, want in SELFTEST:
        ident, role = verdict_of(scan_src(strip_comments(src)))
        got = ident if name.startswith("T10") else role
        mark = "✅" if got == want else "❌"
        if got != want: ok = False
        print(f"{mark} {name}\n     期望={want!r} 實得={got!r}")
    print("-"*96)
    print(f"{'✅ 全過' if ok else '❌ 有失敗'}：{len(SELFTEST)} 條")
    return 0 if ok else 1

if "--selftest" in sys.argv:
    sys.exit(selftest())

rows = []
for f in MAN:
    name, pp = f["name"], f.get("projectPath","")
    hits, err = scan(pp)
    if err:
        verdict, detail = "?", err
    else:
        # 🔴 ROLE 這條樣式在初版是**算出來就丟掉的** —— hits 有它，判定鏈一次也沒讀。
        # ⇒ 「有查角色」與「沒查角色」在這一欄上讀數相同，這一欄對 admin 端點零鑑別力。
        ident, role = verdict_of(hits)
        verdict = (ident + " " + role).strip()
        detail = (f"gui={len(hits['GUI_OK'])} raw={len(hits['RAW_QUERY'])} "
                  f"gate={len(hits['ROLE_GATE'])} ref={len(hits['ROLE_REF'])}")
    rows.append(dict(name=name, auth=f.get("auth"), api=f.get("apiType"),
                     method=f.get("method"), path=f.get("path"),
                     gw=gw_authorizer(name, f), handler=verdict, detail=detail))

json.dump(rows, open("/tmp/auth_matrix.json","w"), ensure_ascii=False, indent=1)
print(f"{'函式':<26}{'宣稱':<7}{'Gateway':<20}{'Handler 取身分'}")
print("-"*96)
for r in sorted(rows, key=lambda r:(r["auth"] or "", r["name"])):
    print(f"{r['name']:<26}{r['auth'] or '-':<7}{r['gw']:<20}{r['handler']}")

# ---- 分母一起印：「0 支沒有角色守衛」與「這一欄根本沒鑑別力」在版面上長得一樣 ----
adm = [r for r in rows if r["auth"] == "admin"]
norole = [r for r in adm if "+角色守衛" not in r["handler"]]
print("-"*96)
print(f"宣稱 admin 的端點：{len(adm)} 支，其中 handler 內有角色守衛 {len(adm)-len(norole)} 支")
for r in norole:
    why = "只有角色參考、未見拒絕路徑" if "+角色參考" in r["handler"] else "完全沒提到角色"
    print(f"  ⚠️ {r['name']}：{why}，全靠 Gateway 的 {r['gw']}")
print("ⓘ 本支是**報表不是閘門**（沒有 sys.exit）。「⚠️」不等於有洞 ——")
print("   Gateway authorizer 擋得住的話那是縱深不足、不是缺守衛；要下判定得人去看。")
