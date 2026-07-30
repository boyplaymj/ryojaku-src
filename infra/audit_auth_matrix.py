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
 ("ROLE",       r'"(?:super_admin|admin)"'),
]
# 🔴 剝註解後再掃。初版直接對原始碼跑正則，命中了 chat-ws-connect 註解裡
# 「原本這裡直接吃 request.QueryStringParameters["userId"]」這句描述性文字，
# 把一個已經修好的端點誤報成洞。被註解掉的程式碼照樣命中是正則掃碼的經典假陽性。
def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)      # 區塊註解
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)       # 整行註解
    src = re.sub(r"(?<!:)//[^\n\"`]*$", "", src, flags=re.M)  # 行尾註解(避開 http:// 與字串)
    return src

def scan(pp):
    d = os.path.join(BE, pp)
    if not os.path.isdir(d): return None, "目錄不存在"
    src = ""
    for dp,_,fs in os.walk(d):
        for f in fs:
            if f.endswith(".go"):
                src += strip_comments(open(os.path.join(dp,f), errors="ignore").read()) + "\n"
    if not src: return None, "無 .go"
    hits = {}
    for k,p in PATS:
        hits[k] = re.findall(p, src)
    return hits, None

rows = []
for f in MAN:
    name, pp = f["name"], f.get("projectPath","")
    hits, err = scan(pp)
    if err:
        verdict, detail = "?", err
    else:
        gui = hits["GUI_OK"]
        gui_ignored = [g for g in gui if g[1] == "_"]
        gui_checked = [g for g in gui if g[1] != "_"]
        if hits["AUTHZ_CTX"]:
            verdict = "A·authorizer取身分"
        elif gui_ignored:
            verdict = "🔴C·GetUserIdentifier忽略verified"
        elif gui_checked:
            verdict = "B·GetUserIdentifier檢查verified"
        elif hits["VERIFY"]:
            verdict = "B·程式內自驗JWT"
        elif hits["RAW_QUERY"]:
            verdict = "🔴D·直接讀query param"
        else:
            verdict = "N·未取身分"
        detail = f"gui_ok={len(gui_checked)} gui_ign={len(gui_ignored)} raw={len(hits['RAW_QUERY'])}"
    rows.append(dict(name=name, auth=f.get("auth"), api=f.get("apiType"),
                     method=f.get("method"), path=f.get("path"),
                     gw=gw_authorizer(name, f), handler=verdict, detail=detail))

json.dump(rows, open("/tmp/auth_matrix.json","w"), ensure_ascii=False, indent=1)
print(f"{'函式':<26}{'宣稱':<7}{'Gateway':<20}{'Handler 取身分'}")
print("-"*96)
for r in sorted(rows, key=lambda r:(r["auth"] or "", r["name"])):
    print(f"{r['name']:<26}{r['auth'] or '-':<7}{r['gw']:<20}{r['handler']}")
