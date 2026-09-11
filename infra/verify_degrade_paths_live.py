#!/usr/bin/env python3
# 兩條**刻意降級**的路徑：欄位缺席時不擋整個請求，而是退一步繼續。
#
# 用法：python3 verify_degrade_paths_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# ── 這兩條為什麼難驗 ──────────────────────────────────────────────
#
# 🔴 它們要證明的是**某件事沒有發生**（少一個顯示名、少一則通知），
#    而「刻意跳過」與「這個功能根本壞了」在讀數上**逐字相同** —— 兩邊都是「沒有」。
#    ⇒ 每一條都配一個「**有資料時它會發生**」的對照，成對才有鑑別力。
#
# D：accept 的 `registration["displayName"]` 缺席 ⇒ 退成 ""，請求仍成功
#      D1 缺 displayName → 200，且 Games.joinedPlayers 那筆的 displayName == ""
#      D2（對照）有 displayName → 200，且那筆 displayName == 我放進去的值
#      ⇒ 兩者**不同**才證明 D1 是「退成空字串」，不是「這欄位永遠寫不進去」
#
# E：reject 的通知收件人 `registration["userId"]` 缺席 ⇒ 跳過通知，請求仍成功
#      E1 缺 userId → 200，且該 gameId 的 Notifications == 0
#      E2（對照）有 userId → 200，且該 gameId 的 Notifications == 1
#      ⇒ 兩者**不同**才證明 E1 是「跳過」，不是「通知從來就發不出去」
#
# 🔴 E 那條的背景：它在**拒絕已經寫進資料庫之後**。若在那裡回 5xx，客戶端會以為
#    失敗而重試，**而資料其實已經改了** —— 比少一則通知糟得多。所以刻意降級。
#
# ⚠️ 寫入面積：Users 2、Games 4、Registrations 4、Notifications（accept/reject 會發）。
#    全部直接寫 DDB 或由端點產生，跑完逐筆刪掉並 read-back。
#    Notifications 的 key 是 notificationId ⇒ 只能 Scan ＋ gameId 過濾。

import base64, hashlib, hmac, json, os, subprocess, sys, time
import urllib.error, urllib.request

REGION="ap-southeast-1"; PREFIX="MahjongClubStg_"; MARK="DGPROBE-DELETEME"
DEFAULT_BASE="https://ryojaku-api.boyplaymj.com"
TOTAL=FAIL=0; LAST=""

def pass_(m):
    global TOTAL; TOTAL+=1; print(f"  ✅ {m}")
def fail_(m):
    global TOTAL,FAIL; TOTAL+=1; FAIL+=1
    print(f"  ❌ {m}")
    if LAST: print(f"      指紋：{LAST}")
def die(m): print(f"\n🔴 前置失敗（本輪什麼都沒驗到）：{m}"); sys.exit(2)
def b64(r): return base64.urlsafe_b64encode(r).decode().rstrip("=")
def sign(p,s):
    h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
    q=b64(json.dumps(p,separators=(",",":")).encode())
    return f"{h}.{q}.{b64(hmac.new(s.encode(),f'{h}.{q}'.encode(),hashlib.sha256).digest())}"
def sh(a):
    r=subprocess.run(a,capture_output=True,text=True); return r.returncode,r.stdout,r.stderr
def ddb(*a): return sh(["aws","dynamodb",*a,"--region",REGION])

def req(base, path, token, payload):
    global LAST
    r=urllib.request.Request(base+path, method="POST", data=json.dumps(payload).encode())
    r.add_header("Content-Type","application/json"); r.add_header("Authorization","Bearer "+token)
    try:
        with urllib.request.urlopen(r,timeout=30) as resp: c,b=resp.status,resp.read().decode("utf-8","replace")
    except urllib.error.HTTPError as e: c,b=e.code,e.read().decode("utf-8","replace")
    except Exception as e:
        LAST=f"connection error: {e}"; return 0,str(e)
    LAST=f"{c} body={b[:150]!r}"
    return c,b

def game_item(gid):
    rc,out,_=ddb("get-item","--table-name",PREFIX+"Games","--key",
                 json.dumps({"gameId":{"S":gid}}),"--consistent-read")
    if rc!=0 or not out.strip(): return None
    return json.loads(out).get("Item")

def notif_ids(gid):
    rc,out,_=ddb("scan","--table-name",PREFIX+"Notifications",
                 "--filter-expression","gameId = :g",
                 "--expression-attribute-values",json.dumps({":g":{"S":gid}}),
                 "--projection-expression","notificationId")
    if rc!=0 or not out.strip(): return []
    return [i["notificationId"]["S"] for i in json.loads(out).get("Items",[])]

def main():
    base=os.environ.get("RYOJAKU_API_BASE",DEFAULT_BASE).rstrip("/")
    ts=int(time.time()); DN=f"{MARK}-NAME-{ts}"
    me, player = f"{MARK}-HOST-{ts}", f"{MARK}-PLAYER-{ts}"
    G={k:f"{MARK}-G{k}-{ts}" for k in ("D1","D2","E1","E2")}
    R={k:f"{MARK}-R{k}-{ts}" for k in ("D1","D2","E1","E2")}
    print("══ 前置 ══"); print(f"  API：{base}")
    rc,out,err=sh(["aws","ssm","get-parameter","--region",REGION,"--name","/ryojaku/stg/JWT_SECRET",
                   "--with-decryption","--query","Parameter.Value","--output","text"])
    if rc!=0: die(f"讀不到 JWT_SECRET：{err.strip()[:200]}")
    secret=out.strip()
    for uid in (me,player):
        rc,_,e=ddb("put-item","--table-name",PREFIX+"Users","--item",
                   json.dumps({"userId":{"S":uid},"displayName":{"S":MARK},"points":{"N":"0"}}))
        if rc!=0: die(f"建不出 {uid}：{e.strip()[:200]}")
    tok=sign({"userId":me,"email":f"dg{ts}@example.com","exp":ts+3600},secret)

    def put_game(gid):
        rc,_,e=ddb("put-item","--table-name",PREFIX+"Games","--item",json.dumps({
            "gameId":{"S":gid},"placeName":{"S":MARK},"hostUserId":{"S":me},
            "currentPlayers":{"N":"1"},"playersNeeded":{"N":"3"},"status":{"S":"recruiting"}}))
        if rc!=0: die(f"建不出 Game {gid}：{e.strip()[:200]}")
    def put_reg(rid,gid,*,with_user=True,with_name=None):
        item={"registrationId":{"S":rid},"gameId":{"S":gid},"status":{"S":"pending"}}
        if with_user: item["userId"]={"S":player}
        if with_name is not None: item["displayName"]={"S":with_name}
        rc,_,e=ddb("put-item","--table-name",PREFIX+"Registrations","--item",json.dumps(item))
        if rc!=0: die(f"建不出 Registration {rid}：{e.strip()[:200]}")

    for k in G: put_game(G[k])
    put_reg(R["D1"],G["D1"], with_name=None)   # 缺 displayName
    put_reg(R["D2"],G["D2"], with_name=DN)     # 對照：有 displayName
    put_reg(R["E1"],G["E1"], with_user=False)  # 缺 userId
    put_reg(R["E2"],G["E2"])                   # 對照：有 userId
    print("  建了 4 組（D1 缺 displayName／D2 對照／E1 缺 userId／E2 對照）")

    try:
        print("\n══ D·accept 的 displayName 降級（成對才有鑑別力）══")
        names={}
        for k in ("D1","D2"):
            c,b=req(base,"/registrations/accept",tok,{"registrationId":R[k]})
            if c==200: pass_(f"D {k} accept 仍然成功（200）{b[:55]!r}")
            else: fail_(f"D {k} accept：得到 {c}，期望 200　body={b[:110]!r}"); continue
            item=game_item(G[k])
            jp=(item or {}).get("joinedPlayers",{}).get("L",[])
            if len(jp)!=1:
                fail_(f"D {k} Games.joinedPlayers 有 {len(jp)} 筆，期望 1（讀不到就無法比對）"); continue
            names[k]=jp[0].get("M",{}).get("displayName",{}).get("S","<缺欄位>")
        if "D1" in names and "D2" in names:
            if names["D1"]=="" : pass_(f"D1 落地的 displayName 是空字串 ⇒ 真的退了一步")
            else: fail_(f"D1 落地的 displayName 是 {names['D1']!r}，期望 ''")
            if names["D2"]==DN: pass_(f"D2 對照·落地的 displayName 是我放的值")
            else: fail_(f"D2 落地的 displayName 是 {names['D2']!r}，期望 {DN!r}")
            if names["D1"]!=names["D2"]:
                pass_(f"D 承重·兩者不同（{names['D1']!r} vs 有值）⇒ D1 是降級，不是「這欄位永遠寫不進去」")
            else:
                fail_("D 承重·兩者相同 ⇒ 分不出「降級」與「這欄位根本沒作用」")

        print("\n══ E·reject 的通知降級（成對才有鑑別力）══")
        counts={}
        for k in ("E1","E2"):
            c,b=req(base,"/registrations/reject",tok,{"registrationId":R[k]})
            if c==200: pass_(f"E {k} reject 仍然成功（200）{b[:55]!r}")
            else: fail_(f"E {k} reject：得到 {c}，期望 200　body={b[:110]!r}"); continue
            time.sleep(2)
            counts[k]=len(notif_ids(G[k]))
        if "E1" in counts and "E2" in counts:
            if counts["E1"]==0: pass_("E1 該 gameId 的通知 0 則 ⇒ 真的跳過了")
            else: fail_(f"E1 該 gameId 的通知 {counts['E1']} 則，期望 0")
            if counts["E2"]==1: pass_("E2 對照·該 gameId 的通知 1 則")
            else: fail_(f"E2 該 gameId 的通知 {counts['E2']} 則，期望 1")
            if counts["E1"]!=counts["E2"]:
                pass_(f"E 承重·兩者不同（{counts['E1']} vs {counts['E2']}）⇒ E1 是跳過，不是「通知從來就發不出去」")
            else:
                fail_(f"E 承重·兩者相同（都是 {counts['E1']}）⇒ 分不出「跳過」與「通知功能壞了」")
    finally:
        print("\n══ 清理（每一筆都 read-back；有殘留 ⇒ rc=2）══")
        left=[]; n_notif=0
        def drop(table,key,label):
            ddb("delete-item","--table-name",PREFIX+table,"--key",json.dumps(key))
            rc,out,_=ddb("get-item","--table-name",PREFIX+table,"--key",json.dumps(key),"--consistent-read")
            if rc!=0 or (out.strip() and json.loads(out).get("Item")): left.append(label)
        for k in G:
            for nid in notif_ids(G[k]):
                n_notif+=1; drop("Notifications",{"notificationId":{"S":nid}},f"Notifications/{nid}")
        for k in R: drop("Registrations",{"registrationId":{"S":R[k]}},f"Registrations/{R[k]}")
        for k in G: drop("Games",{"gameId":{"S":G[k]}},f"Games/{G[k]}")
        for uid in (me,player): drop("Users",{"userId":{"S":uid}},f"Users/{uid}")
        if left:
            print("  🔴 有殘留刪不掉："+"、".join(left))
            print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過，但清理沒歸零 ⇒ rc=2（本輪不可信）"); sys.exit(2)
        print(f"  ✅ 全部刪掉且 read-back 確認不存在（Users 2／Games 4／Registrations 4／Notifications {n_notif}）")
    print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過")
    sys.exit(1 if FAIL else 0)

if __name__=="__main__": main()
