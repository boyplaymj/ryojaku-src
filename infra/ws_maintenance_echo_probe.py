#!/usr/bin/env python3
"""B3-f 的最後一塊：**在真連線上**量「維護幀推得出去」與「自己的訊息會回音」。

用法：python3 infra/ws_maintenance_echo_probe.py
退出碼：0 = 兩個宣稱都成立；1 = 斷言失敗；2 = 前置／設備失敗（＝沒量到，別讀成通過）

── 這支在補的是哪一塊 ──────────────────────────────────────────────────

502fb7b 的 commit 訊息自己列了「未驗」第一項：

    「發話者收得到自己的回音」目前是**讀程式碼**得到的結論，沒在真連線上量過，
    而整條解除路徑掛在它上面。

frontend/utils/maintenanceSignal.ts 的 noteMaintenanceOver() 也把同一句話寫成
⚠️：真瀏覽器端到端驗證前不要把它當已證實。單元測試餵的是**我自己造的幀**，
所以它證明的是「收到這種幀時判讀正確」，不是「這種幀真的會來」。

🔴 判準落在「同一條 WebSocket 連線上實際收到的幀」，不落在 ChatMessages 表。
   ws_room_authz_probe.sh 刻意選了查表當判準，因為它問的是「訊息有沒有被寫進去」；
   本支問的是**下行**通道，寫進去與推回來是兩件事 —— 事實上 2026-09-02 實測，
   訊息寫得進去而一幀都推不出來（WS_API_ENDPOINT 未設 ＋ 角色缺 ManageConnections），
   兩種故障在 ChatMessages 上逐字相同。

🔴 P1 與 P2 互為反控，缺一不可：
   P1（旗標 OFF）必須收到**自己的回音**、且**不可**收到 system 幀；
   P2（旗標 ON）必須收到 **system/maintenance 幀**、且**不可**收到回音。
   只做 P2 的話，「維護幀推得出去」與「這條連線收得到任何東西」分不開；
   只做 P1 的話，維護分支有沒有推那一幀完全沒被碰到。
   P3 再把旗標關回去重送一次 —— 那正是前端 noteMaintenanceOver() 的觸發條件，
   它必須在**同一條連線**上成立，否則「提示出得來、永遠消不掉」。

⚠️ 會對 stg 寫入：
   - 翻 MahjongClubStg_AdminConfigs 的 maintenanceMode（收尾 delete-item 還原成
     「item 不存在」＝原始狀態，不是寫 false）。
   - 建一間 ChatRooms／ChatUserMemberships 的測試房（收尾刪掉，含房內訊息）。
   - 註冊一個帳號（app-register 限流 10/hr/IP）。可用 REUSE 行沿用上一輪的：
       E2E_USER_ID=... E2E_TOKEN=... python3 infra/ws_maintenance_echo_probe.py
"""

import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

REGION = os.environ.get("AWS_REGION", "ap-southeast-1")
API = os.environ.get("E2E_API", "https://ryojaku-api.boyplaymj.com")
WS = os.environ.get("E2E_WS", "wss://ryojaku-ws.boyplaymj.com")
PREFIX = os.environ.get("E2E_PREFIX", "MahjongClubStg_")
CFG_TABLE = os.environ.get("E2E_TABLE", PREFIX + "AdminConfigs")
MARK = "WSECHO-DELETEME"

RC_PRE = 2  # 前置失敗與斷言失敗分開 —— 混在一起會讓「沒測到」偽裝成「測過且通過」
rc = 0


def ok(m):
    print(f"  ✅ {m}")


def fail(m):
    global rc
    print(f"  ❌ {m}")
    rc = 1


def die(m):
    print(f"\n❌ 前置失敗（沒量到，不是通過）：{m}")
    raise SystemExit(RC_PRE)


def aws(args, allow_fail=False):
    p = subprocess.run(["aws", *args, "--region", REGION],
                       capture_output=True, text=True)
    if p.returncode != 0 and not allow_fail:
        die(f"aws {' '.join(args[:2])} 失敗：{p.stderr.strip()[:300]}")
    return p.stdout


# ── 旗標 ────────────────────────────────────────────────────────────────
def flag_set(v):
    aws(["dynamodb", "put-item", "--table-name", CFG_TABLE, "--item",
         json.dumps({"info_key": {"S": "maintenanceMode"},
                     "info_value": {"S": str(v)}})])


def flag_delete():
    aws(["dynamodb", "delete-item", "--table-name", CFG_TABLE, "--key",
         json.dumps({"info_key": {"S": "maintenanceMode"}})], allow_fail=True)


def flag_read():
    out = aws(["dynamodb", "get-item", "--table-name", CFG_TABLE, "--key",
               json.dumps({"info_key": {"S": "maintenanceMode"}}),
               "--consistent-read"])
    if not out.strip():
        return None
    return (json.loads(out).get("Item") or {}).get("info_value", {}).get("S")


# ── 一條連線走完全程 ────────────────────────────────────────────────────
#
# 🔴 這裡刻意**只開一條連線**，中途翻旗標，不是為了省事：
#    維護模式開著時 WS 的 $connect authorizer 會直接回 **403**（kill switch 擋新連線），
#    所以「每輪重連」的寫法在 P2 根本連不上，量到的是 authorizer 而不是 sendMessage。
#    2026-09-02 第一版就是這樣紅的 —— 而它報的是前置失敗，不是斷言失敗，這點救了我。
#    ⚠️ 更重要的是：B3-f 修的本來就是「開關拉下去時**已經連著**的那批人」
#    （main.go 的註解寫得很清楚）。共用一條連線不是妥協，它就是受測情境本身。
async def _session(token, room, marks, listen_s, flag_ops):
    import websockets
    loop = asyncio.get_running_loop()
    out = {}
    url = f"{WS}?token={token}"
    async with websockets.connect(url, open_timeout=20, close_timeout=5) as ws:
        # 🔴 這個等待不是保險，是必要的：$connect handler 要先把 ConnectionID 寫進
        #    ChatConnections，廣播迴圈才查得到這條連線。送太快的話「沒登錄完」會
        #    表現成「收不到回音」—— 與真的推不出去逐字相同。
        await asyncio.sleep(3)
        for phase, content in marks:
            op = flag_ops.get(phase)
            if op is not None:
                # 阻塞式 aws CLI 丟到 executor，免得卡住 event loop 而漏收幀。
                await loop.run_in_executor(None, op)
                await asyncio.sleep(2)
            await ws.send(json.dumps({"action": "sendMessage", "roomId": room,
                                      "content": content, "type": "text"}))
            frames = []
            deadline = time.monotonic() + listen_s
            while True:
                left = deadline - time.monotonic()
                if left <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    break
                except Exception as e:              # 連線被對方關掉等
                    frames.append({"__raw_error__": f"{type(e).__name__}:{e}"})
                    break
                try:
                    frames.append(json.loads(raw))
                except Exception:
                    frames.append({"__unparsed__": str(raw)[:200]})
            out[phase] = frames
    return out


def run_session(token, room, marks, flag_ops, listen_s=12):
    try:
        res = asyncio.run(_session(token, room, marks, listen_s, flag_ops))
    except Exception as e:
        die(f"WS 連線失敗 {type(e).__name__}:{e} —— 什麼都沒量到")
    for phase, frames in res.items():
        print(f"  [{phase}] 收到 {len(frames)} 幀："
              f"{json.dumps(frames, ensure_ascii=False)[:400]}")
    return res


def has_echo(frames, self_id, content):
    return any(f.get("senderId") == self_id and f.get("content") == content
               for f in frames)


def has_maintenance(frames):
    return any(f.get("type") == "system" and f.get("event") == "maintenance"
               for f in frames)


# 🔴 判準必須綁在**那一則訊息的內容**上，不能用「表裡有幾筆」。
#    第一版寫的是 n1=count() … n2=count() 然後斷言 n2==n1，而改成「一條連線走完
#    三個 phase」之後，兩次 count 都發生在連線關閉之後 ⇒ **同一個讀數比兩次**，
#    那條斷言恆真。空比較與正確比較在版面上逐字相同（都印綠燈）。
def msg_exists(room, content):
    out = aws(["dynamodb", "query", "--table-name", PREFIX + "ChatMessages",
               "--key-condition-expression", "RoomID = :r",
               # 🔴 Content 是 DynamoDB 保留字，一定要走 --expression-attribute-names，
               #    否則回 ValidationException。（同一個坑 ws_room_authz_probe.sh 註解裡
               #    也記過一次：那個錯誤若被吞掉，會顯示成「0 筆」＝ 剛好是本測的期望值。）
               "--filter-expression", "#c = :c",
               "--expression-attribute-names", json.dumps({"#c": "Content"}),
               "--expression-attribute-values",
               json.dumps({":r": {"S": room}, ":c": {"S": content}}),
               "--query", "length(Items)", "--output", "text"])
    return int(out.strip() or -1)


# ── 前置 ────────────────────────────────────────────────────────────────
print("══ P0 前置 ══")
try:
    import websockets  # noqa: F401
except Exception as e:
    die(f"載不到 python websockets：{e}")

before = flag_read()
if before is not None and before.lower() == "true":
    die("開跑前旗標就是 true（前一輪沒還原？）—— 拒跑，否則量到的「被擋」不是我造成的")
print(f"  旗標起始值 = {'(item 不存在)' if before is None else before} → 視為 OFF")

USER_ID = os.environ.get("E2E_USER_ID", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
REGISTERED = False
if not (USER_ID and TOKEN):
    ts = int(time.time())
    body = json.dumps({"email": f"wsecho+{ts}@example.com",
                       "password": "WsEcho12345!",
                       "displayName": MARK}).encode()
    req = urllib.request.Request(f"{API}/app-register", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            rb = json.loads(r.read().decode())
    except Exception as e:
        die(f"註冊失敗（最常見原因：app-register 每 IP 每小時 10 次限流）：{e}")
    TOKEN = rb.get("token", "")
    USER_ID = ((rb.get("data") or rb.get("user") or {}).get("userId", ""))
    if not TOKEN or not USER_ID:
        die(f"註冊回 200 但取不到 token/userId：{json.dumps(rb)[:200]}")
    REGISTERED = True
    print(f"  REUSE: E2E_USER_ID={USER_ID} E2E_TOKEN={TOKEN}")
print(f"  帳號 {USER_ID}")

ROOM = f"GAME_{MARK}_{int(time.time())}"
print(f"  房間 {ROOM}")

# 房間本體。Title／StartTime／Address 都給非空值，避免 handler 走「補齊 Games 中繼資料」
# 那條分支（它會去 GetItem 一個不存在的 gameId，跟本測無關的雜訊）。
# MemberIDs 是 stringset（chat_models.go 的 dynamodbav:"MemberIDs,stringset"）。
aws(["dynamodb", "put-item", "--table-name", PREFIX + "ChatRooms", "--item",
     json.dumps({"RoomID": {"S": ROOM}, "GameID": {"S": ROOM},
                 "Title": {"S": MARK}, "StartTime": {"S": "2026-01-01T00:00:00Z"},
                 "Address": {"S": MARK}, "MemberIDs": {"SS": [USER_ID]},
                 "ExpiryTime": {"N": "1900000000"}})])
# 成員資格（shared.IsRoomMember 讀這張）。少了它 handler 在 403 就結束，
# 「非成員遭拒」與「推不出去」會混成同一種沉默。
aws(["dynamodb", "put-item", "--table-name", PREFIX + "ChatUserMemberships",
     "--item", json.dumps({"UserID": {"S": USER_ID},
                           "LastMessageTime#RoomID": {"S": ROOM},
                           "RoomID": {"S": ROOM}, "Title": {"S": MARK},
                           "UnreadCount": {"N": "0"},
                           "ExpiryTime": {"N": "1900000000"}})])
ok("測試房與成員資格已建立")


def cleanup():
    print("\n── 清理 ──")
    flag_delete()
    out = aws(["dynamodb", "query", "--table-name", PREFIX + "ChatMessages",
               "--key-condition-expression", "RoomID = :r",
               "--expression-attribute-values", json.dumps({":r": {"S": ROOM}}),
               "--query", 'Items[]."Timestamp#MessageID".S', "--output", "text"],
              allow_fail=True)
    for t in out.split():
        aws(["dynamodb", "delete-item", "--table-name", PREFIX + "ChatMessages",
             "--key", json.dumps({"RoomID": {"S": ROOM},
                                  "Timestamp#MessageID": {"S": t}})],
            allow_fail=True)
    aws(["dynamodb", "delete-item", "--table-name", PREFIX + "ChatRooms",
         "--key", json.dumps({"RoomID": {"S": ROOM}})], allow_fail=True)
    aws(["dynamodb", "delete-item", "--table-name", PREFIX + "ChatUserMemberships",
         "--key", json.dumps({"UserID": {"S": USER_ID},
                              "LastMessageTime#RoomID": {"S": ROOM}})],
        allow_fail=True)
    print("  ✅ 旗標已還原成「item 不存在」，測試房已刪除")
    if REGISTERED:
        print(f"  ⚠️ 本輪新註冊了帳號 {USER_ID} 且刻意保留（供 REUSE 不吃限流額度）。")
        print(f"     不再重跑請清：aws dynamodb delete-item --region {REGION} "
              f"--table-name {PREFIX}Users --key '{{\"userId\":{{\"S\":\"{USER_ID}\"}}}}'")


try:
    c1 = f"{MARK}-p1-{int(time.time())}"
    c2 = f"{MARK}-p2-{int(time.time())}"
    c3 = f"{MARK}-p3-{int(time.time())}"
    print("\n══ 一條連線走完 P1(OFF) → P2(ON) → P3(OFF) ══")
    res = run_session(TOKEN, ROOM,
                      [("P1", c1), ("P2", c2), ("P3", c3)],
                      {"P2": lambda: flag_set("true"), "P3": flag_delete})
    f1, f2, f3 = res.get("P1", []), res.get("P2", []), res.get("P3", [])

    # ── P1 正控：旗標 OFF ────────────────────────────────────────────────
    print("\n══ P1 正控（旗標 OFF）：自己的訊息必須回音，且不得有 system 幀 ══")
    if has_echo(f1, USER_ID, c1):
        ok("收到自己的回音 ⇒ 廣播迴圈確實不排除發話者（此前只是讀程式碼的結論）")
    else:
        fail("沒收到自己的回音 —— noteMaintenanceOver() 的前提不成立，"
             "維護提示會「出得來、永遠消不掉」")
    if has_maintenance(f1):
        fail("旗標 OFF 卻收到 maintenance 幀 —— 推送被移到維護分支外面了？")
    else:
        ok("旗標 OFF 時沒有 maintenance 幀（對照組）")
    n1 = msg_exists(ROOM, c1)
    if n1 == 1:
        ok("P1 那則訊息確實寫進 ChatMessages（1 筆）")
    else:
        die(f"P1 那則訊息不在表裡（{n1} 筆）—— 整條鏈不通，下面的結果都不算數")

    # ── P2 主判：旗標 ON ─────────────────────────────────────────────────
    print("\n══ P2 主判（旗標 ON・同一條連線）：必須收到 system/maintenance 幀 ══")
    if has_maintenance(f2):
        ok('收到 {"type":"system","event":"maintenance"} ⇒ 503 這次瀏覽器看得到了')
    else:
        fail("維護中沒收到 maintenance 幀 —— 使用者仍然只看到「訊息送不出去」")
    if has_echo(f2, USER_ID, c2):
        fail("維護中竟然收到回音 —— kill switch 沒擋住發言")
    else:
        ok("維護中沒有回音（發言確實被擋下）")
    # 反控就在隔壁：同一支 msg_exists，P1 那則回 1、P2 那則必須回 0。
    # 兩個讀數用的是同一把尺、不同的 needle ⇒ 「尺壞了」會讓 P1 那格先紅。
    n2 = msg_exists(ROOM, c2)
    if n2 == 0:
        ok("P2 那則訊息**不在**表裡 ⇒ 維護中確實沒被寫進去")
    else:
        fail(f"P2 那則訊息竟然寫進去了（{n2} 筆）—— kill switch 沒擋住寫入")

    # ── P3 解除 ─────────────────────────────────────────────────────────
    print("\n══ P3 解除（旗標關回 OFF・同一條連線）：回音必須再次出現 ══")
    if has_echo(f3, USER_ID, c3):
        ok("回音回來了 ⇒ 前端 noteMaintenanceOver() 的觸發條件在真連線上成立")
    else:
        fail("旗標關掉後仍沒有回音 —— 提示消不掉")
    if has_maintenance(f3):
        fail("旗標已關卻還收到 maintenance 幀")
    else:
        ok("旗標關掉後沒有 maintenance 幀")
    n3 = msg_exists(ROOM, c3)
    if n3 == 1:
        ok("P3 那則訊息也寫進去了（1 筆）")
    else:
        fail(f"P3 那則訊息不在表裡（{n3} 筆）—— 旗標關掉後發言仍不通")
finally:
    cleanup()

print(f"\n{'✅ 兩個宣稱都成立' if rc == 0 else '❌ 有斷言失敗'}（rc={rc}）")
sys.exit(rc)
