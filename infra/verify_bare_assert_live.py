#!/usr/bin/env python3
# 裸型別斷言修正的**行為**驗收：欄位缺席時應回 500「資料異常」，不是 panic 成 502。
#
# 用法：
#   EXPECT=502 python3 verify_bare_assert_live.py   # 部署前（舊版，應該是壞的）
#   python3 verify_bare_assert_live.py              # 部署後（預設期望 500）
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# ── 為什麼一定要先量 before ──────────────────────────────────────
#
# 🔴 只跑部署後那一次，「500」證明不了是這次修的 —— 它跟「本來就回 500」逐字相同。
#    判準是**兩次讀數的差**：部署前 502（panic 的形狀）、部署後 500（handler 主動回的）。
#    這條規矩抄自同目錄的 `verify_venue_privacy_live.py`。
#
# ── 情境是「造一筆缺欄位的紀錄」，不是等它自然發生 ───────────────
#
# A：Games 那列**沒有 hostUserId** ⇒ 打到 `game["hostUserId"].(string)`
# B：Games 正常（主揪＝我），但 Registrations 那列**沒有 status**
#    ⇒ 打到 `registration["status"].(string)`
# C（**撐 A/B 的正控**）：兩列都正常、而我**不是**主揪 ⇒ 應回 403「只有主揪」
#    少了 C，「A/B 拿到 5xx」與「這個端點對任何輸入都 5xx」分不出來。
#
# ⚠️ 502 與 500 的 body 形狀不同，一併斷言：
#    502 是 API Gateway 的 `{"message":"Internal server error"}`；
#    500 是 handler 自己的 `{"success":false,"error":"資料異常，請稍後再試"}`。
#    只比狀態碼的話，「handler 主動回 500」與「某層代我回了 500」分不出來。
#
# ⚠️ 寫入面積：Users 2、Games 2、Registrations 2（全部直接寫 DDB，跑完刪掉並 read-back）。
#    三條路由本身不會寫（A/B 在斷言處就中止，C 在 403 早退）。

import base64, hashlib, hmac, json, os, subprocess, sys, time
import urllib.error, urllib.request

REGION="ap-southeast-1"; PREFIX="MahjongClubStg_"; MARK="BAPROBE-DELETEME"
DEFAULT_BASE="https://ryojaku-api.boyplaymj.com"
EXPECT_BROKEN = int(os.environ.get("EXPECT", "500"))
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
    r.add_header("Content-Type","application/json")
    r.add_header("Authorization","Bearer "+token)     # 不進 argv
    try:
        with urllib.request.urlopen(r,timeout=30) as resp: c,b=resp.status,resp.read().decode("utf-8","replace")
    except urllib.error.HTTPError as e: c,b=e.code,e.read().decode("utf-8","replace")
    except Exception as e:
        LAST=f"connection error: {e}"; return 0,str(e)
    LAST=f"{c} body={b[:160]!r}"
    return c,b

def check_broken(label, code, body):
    """期望 EXPECT_BROKEN。502 與 500 的 body 形狀不同，一併斷言。"""
    if code != EXPECT_BROKEN:
        fail_(f"{label}：得到 {code}，期望 {EXPECT_BROKEN}　body={body[:110]!r}"); return
    if EXPECT_BROKEN == 502:
        if "Internal server error" in body:
            pass_(f"{label}（502 · gateway 的 panic 形狀）{body[:60]!r}")
        else:
            fail_(f"{label}：502 但 body 不是 gateway 的形狀 ⇒ 分不出是不是 panic　body={body[:110]!r}")
    else:
        if "資料異常" in body:
            pass_(f"{label}（500 · handler 主動回的）{body[:70]!r}")
        else:
            fail_(f"{label}：500 但 body 不是 handler 的「資料異常」⇒ 可能是別層代回的　body={body[:110]!r}")

def main():
    base=os.environ.get("RYOJAKU_API_BASE",DEFAULT_BASE).rstrip("/")
    ts=int(time.time())
    me, other = f"{MARK}-ME-{ts}", f"{MARK}-OTHER-{ts}"
    gA, gB, gC = f"{MARK}-GA-{ts}", f"{MARK}-GB-{ts}", f"{MARK}-GC-{ts}"
    rA, rB, rC = f"{MARK}-RA-{ts}", f"{MARK}-RB-{ts}", f"{MARK}-RC-{ts}"
    print("══ 前置 ══"); print(f"  API：{base}　期望的壞掉形狀：{EXPECT_BROKEN}")
    rc,out,err=sh(["aws","ssm","get-parameter","--region",REGION,"--name","/ryojaku/stg/JWT_SECRET",
                   "--with-decryption","--query","Parameter.Value","--output","text"])
    if rc!=0: die(f"讀不到 JWT_SECRET：{err.strip()[:200]}")
    secret=out.strip()
    for uid in (me,other):
        rc,_,e=ddb("put-item","--table-name",PREFIX+"Users","--item",
                   json.dumps({"userId":{"S":uid},"displayName":{"S":MARK},"points":{"N":"0"}}))
        if rc!=0: die(f"建不出 {uid}：{e.strip()[:200]}")
    tok=sign({"userId":me,"email":f"ba{ts}@example.com","exp":ts+3600},secret)

    def put_game(gid, host):
        item={"gameId":{"S":gid},"placeName":{"S":MARK},
              "currentPlayers":{"N":"1"},"playersNeeded":{"N":"3"},"status":{"S":"recruiting"}}
        if host is not None: item["hostUserId"]={"S":host}     # A 刻意不放
        rc,_,e=ddb("put-item","--table-name",PREFIX+"Games","--item",json.dumps(item))
        if rc!=0: die(f"建不出 Game {gid}：{e.strip()[:200]}")
    def put_reg(rid, gid, status):
        item={"registrationId":{"S":rid},"gameId":{"S":gid},
              "userId":{"S":other},"displayName":{"S":MARK}}
        if status is not None: item["status"]={"S":status}     # B 刻意不放
        rc,_,e=ddb("put-item","--table-name",PREFIX+"Registrations","--item",json.dumps(item))
        if rc!=0: die(f"建不出 Registration {rid}：{e.strip()[:200]}")

    put_game(gA, None);  put_reg(rA, gA, "pending")   # A：Game 缺 hostUserId
    put_game(gB, me);    put_reg(rB, gB, None)        # B：Registration 缺 status
    put_game(gC, other); put_reg(rC, gC, "pending")   # C：都正常，而我不是主揪
    print(f"  建了 3 組（A 缺 hostUserId／B 缺 status／C 正常但我不是主揪）")

    try:
        print("\n══ C 正控·撐著 A/B（少了它,「A/B 壞掉」與「這端點對任何輸入都 5xx」分不出來）══")
        c,b=req(base,"/registrations/accept",tok,{"registrationId":rC})
        if c==403 and "只有主揪" in b: pass_(f"C 正常資料 ＋ 我不是主揪（403 · 擁有權檢查）{b[:60]!r}")
        else: fail_(f"C：得到 {c}，期望 403「只有主揪」　body={b[:110]!r}")

        print(f"\n══ A 承重·Games 缺 hostUserId（期望 {EXPECT_BROKEN}）══")
        c,b=req(base,"/registrations/accept",tok,{"registrationId":rA})
        check_broken("A POST /registrations/accept", c, b)

        print(f"\n══ B 承重·Registrations 缺 status（期望 {EXPECT_BROKEN}）══")
        c,b=req(base,"/registrations/accept",tok,{"registrationId":rB})
        check_broken("B POST /registrations/accept", c, b)

        print(f"\n══ A2 同一個洞在 reject 上（期望 {EXPECT_BROKEN}）══")
        c,b=req(base,"/registrations/reject",tok,{"registrationId":rA})
        check_broken("A2 POST /registrations/reject", c, b)
    finally:
        print("\n══ 清理（每一筆都 read-back；有殘留 ⇒ rc=2）══")
        left=[]
        def drop(table,key,label):
            ddb("delete-item","--table-name",PREFIX+table,"--key",json.dumps(key))
            rc,out,_=ddb("get-item","--table-name",PREFIX+table,"--key",json.dumps(key),"--consistent-read")
            if rc!=0 or (out.strip() and json.loads(out).get("Item")): left.append(label)
        for rid in (rA,rB,rC): drop("Registrations",{"registrationId":{"S":rid}},f"Registrations/{rid}")
        for gid in (gA,gB,gC): drop("Games",{"gameId":{"S":gid}},f"Games/{gid}")
        for uid in (me,other): drop("Users",{"userId":{"S":uid}},f"Users/{uid}")
        if left:
            print("  🔴 有殘留刪不掉："+"、".join(left))
            print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過，但清理沒歸零 ⇒ rc=2（本輪不可信）"); sys.exit(2)
        print("  ✅ 8 筆全部刪掉且 read-back 確認不存在")
    print(f"\n══ 結果 ══\n  {TOTAL-FAIL}/{TOTAL} 過")
    sys.exit(1 if FAIL else 0)

if __name__=="__main__": main()
