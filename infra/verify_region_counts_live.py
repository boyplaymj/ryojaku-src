#!/usr/bin/env python3
"""量 admin_analysis 的 regionCounts[r.Name]++ —— 那一行在空表上結構上跑不到。

🔴 為什麼需要這支：部署後實打 /admin/analysis/games 回 regionCounts={}，
   而 {} 這個讀數對「我改的那一行對不對」**零鑑別力** —— 它與「那一行壞掉」
   長得一模一樣。實查 MahjongClubStg_Games 是 0 筆 ⇒ 迴圈體從來沒執行過。
   所以這支餵一筆合成資料進去，讓那一行真的跑一次，跑完刪掉。

一個前提 ＋ 三格（缺任一個就分不出東西）：
  A **前提**（不是測試格）：種資料前 regionCounts 必須是 {} ——
    不成立就 **rc=2 並在種任何資料之前停**（B/C 的期望值建立在「空表＋只有我種的」之上）
  B 種一筆台北市：regionCounts == {"台北市":1} 且值是 int  （正控＝那一行真的跑了）
  C 再種一筆台北市：變成 2                     （證明它在「累加」不是「設成 1」）
  D 刪掉兩筆：回到 {}                          （證明讀數跟著我的種子動，不是別的東西）
"""
import json, os, time, subprocess, urllib.request, importlib.util, sys

# 🌲 由 __file__ 推導，不依賴呼叫端的 cwd、也不寫死檢出根
_HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "vg", os.path.join(_HERE, "verify_admin_role_gate.py"))
vg = importlib.util.module_from_spec(spec); spec.loader.exec_module(vg)
REGION, TABLE = "ap-southeast-1", "MahjongClubStg_Games"
IDS = []

def aws(args, payload=None):
    cmd = ["aws", "dynamodb", args[0], "--region", REGION, "--table-name", TABLE] + args[1:]
    r = subprocess.run(cmd, input=payload, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("aws 失敗: " + r.stderr[:400])
    return r.stdout

def seed(addr):
    gid = "probe-bareassert-%d" % (time.time() * 1000)
    IDS.append(gid)
    item = {"gameId": {"S": gid},
            "gameInfo": {"M": {"startTime": {"S": "2026-09-12T14:00:00+08:00"}}},
            "location": {"M": {"address": {"S": addr},
                               "latitude": {"N": "25.03"}, "longitude": {"N": "121.56"}}}}
    # 🔴 走 stdin 不走 argv（CLAUDE.md：展開後的內容不進 /proc/<pid>/cmdline）
    aws(["put-item", "--item", "file:///dev/stdin"], json.dumps(item))
    return gid

def cleanup():
    for gid in IDS:
        try: aws(["delete-item", "--key", "file:///dev/stdin"], json.dumps({"gameId": {"S": gid}}))
        except Exception as e: print("  ⚠️ 刪不掉", gid, e)

def region_counts():
    tok = vg.sign({"sub": "s2admin", "role": "super_admin",
                   "exp": int(time.time()) + 600}, vg.get_admin_secret())
    req = urllib.request.Request(vg.REST_BASE + "/admin/analysis/games",
                                 headers={"Authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=45) as r:
        d = json.loads(r.read().decode())
    return d.get("data", d)["regionCounts"]

fail = 0
def cell(name, got, want):
    global fail
    ok = got == want
    print(("  ✅ " if ok else "  🔴 ") + f"{name}: got={json.dumps(got,ensure_ascii=False)} want={json.dumps(want,ensure_ascii=False)}")
    if not ok: fail = 1

# 🔴 A 是**前提**，不是測試格（2026-09-12 修）。舊版把它寫成 cell ⇒ 不成立時 fail=1，
#    而 rc=1 的意思是「程式壞了，去看 handler」。真相是「這張表已經有別人的資料」，
#    處置完全不同（去看是誰寫的，而且此時種子法本身也不再成立 —— B/C 的期望值
#    是「空表 + 我種的」算出來的）。⇒ 前提不成立一律 rc=2，而且**在種任何資料之前**就停。
#    同一個形狀 Codex 在 verify_redeem_code_live.py 的 AuthType 那格抓到，這是順手掃出的第二處。
_pre = region_counts()
if _pre != {}:
    print("  ⚠️ 前提不成立（rc=2）：開跑前 regionCounts 就不是空的 → %s"
          % json.dumps(_pre, ensure_ascii=False))
    print("     本支的期望值建立在「空表 ＋ 只有我種的那幾筆」之上 ⇒ 這次讀數不可讀成通過或失敗。")
    print("     先查 MahjongClubStg_Games 是誰寫的，再決定要不要改判準。")
    sys.exit(2)
print("  ✅ A 前提：種資料前 regionCounts 是空的")

try:
    seed("台北市大安區忠孝東路四段1號"); time.sleep(2)
    rc = region_counts()
    cell("B 一筆台北市", rc, {"台北市": 1})
    if isinstance(rc, dict) and "台北市" in rc:
        t = type(rc["台北市"]).__name__
        print(("  ✅ " if t == "int" else "  🔴 ") + f"B' 值的型別: {t}（期望 int）")
        if t != "int": fail = 1
    seed("台北市信義區市府路45號"); time.sleep(2)
    cell("C 再一筆（驗累加不是設成 1）", region_counts(), {"台北市": 2})
finally:
    cleanup(); time.sleep(2)
    try: cell("D 刪光後回到空（證明讀數跟著我的種子動）", region_counts(), {})
    except Exception as e: print("  ⚠️ D 量不到:", e); fail = 2

print()
print("✅ 前提 ＋ B/B\'/C/D 全過" if fail == 0 else ("🔴 有格子沒過" if fail == 1 else "⚠️ 設備問題，不可讀成通過"))
sys.exit(fail)
