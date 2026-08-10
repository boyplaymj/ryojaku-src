#!/usr/bin/env bash
# F-2 探針／回歸測試 —— WebSocket `sendMessage` 的房間層授權。
#
# 用法：bash infra/ws_room_authz_probe.sh
# 退出碼：0 = 房間層授權有效（攻擊被擋 + 正控通過）；1 = 攻擊成立或正控壞掉；其他 = 前置失敗
#
# ⚠️ **每次執行註冊 2 個帳號**，而 app-register 限流是「每 IP 每小時 10 次」。
#    要重跑而不想再吃額度，把上一輪印出的 REUSE 那行整段貼回來當環境變數即可。
#
# ── 為什麼判準是「資料表裡有沒有那筆訊息」，不是 WS 回應 ─────────────────
#
# 🔴 WebSocket 的 sendMessage 路由是 fire-and-forget：handler 回 403 也不會有東西送回客戶端
#    （沒有 PostToConnection 就沒有下行訊息）。所以「客戶端沒收到錯誤」跟「訊息被寫進去了」
#    長得一模一樣。判準必須落在**獨立於受測程式自我回報**的通道上 —— 這裡是直接 Query
#    `ChatMessages` 表，看那筆訊息在不在。
#
# 🔴 每個「應該被擋」都配一個「應該要通」。
#    只驗攻擊被擋的話，「WS 整條鏈壞掉」（連線失敗、authorizer 掛了、Lambda 500）
#    會跟「修好了」長得一模一樣 —— 兩者都是 ChatMessages 裡什麼都沒有。
#    所以 ②【正控】成員送訊息必須寫得進去；它失敗時本腳本回報的是「前置/功能壞了」
#    而不是「安全修補回歸」。
#
# 🔴 EXIT trap 必須保留進入時的 $?（照 security_regression.sh 踩過的坑）。
set -uo pipefail

REGION=${REGION:-ap-southeast-1}
API=${API:-https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg}
WS=${WS:-wss://xb0exhv770.execute-api.ap-southeast-1.amazonaws.com/stg}
PREFIX=${PREFIX:-MahjongClubStg_}
MARK="WSPROBE-DELETEME"

FAIL=0
RC_PRE=2   # 前置失敗用 2，與斷言失敗的 1 分開 —— 混在一起會讓「沒測到」偽裝成「測過且安全」

say(){ printf '%s\n' "$*"; }

# ── 前置：兩個帳號 ────────────────────────────────────────────────
TS=$(date +%s)
ROOM="GAME_${MARK}_${TS}"

REGISTERED=0
if [ -n "${HOST_ID:-}" ] && [ -n "${HOST_T:-}" ] && [ -n "${OUT_ID:-}" ] && [ -n "${OUT_T:-}" ]; then
  say "══ 沿用既有帳號（未吃註冊額度）══"
else
  REGISTERED=1
  say "══ 建立測試帳號 ══"
  reg(){ curl -s -X POST "$API/app-register" -H 'Content-Type: application/json' \
         -d "{\"email\":\"wsprobe$1+$TS@example.com\",\"password\":\"WsProbe12345!\",\"displayName\":\"$MARK\"}"; }
  pick(){ python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
print(d.get('token','') if '$1'=='t' else (d.get('data') or d.get('user') or {}).get('userId',''))"; }

  R1=$(reg 1); HOST_ID=$(printf '%s' "$R1" | pick u); HOST_T=$(printf '%s' "$R1" | pick t)
  R2=$(reg 2); OUT_ID=$(printf '%s' "$R2" | pick u);  OUT_T=$(printf '%s' "$R2" | pick t)
  # 前置失敗一律在這裡喊停。放它流到斷言階段的話，「第二個帳號沒註冊成功」會顯示成
  # 「攻擊被擋」（沒帳號就送不出訊息，表裡自然沒東西）—— 一支永遠報平安的安全測試。
  for v in HOST_ID HOST_T OUT_ID OUT_T; do
    [ -n "${!v}" ] || { say "  ❌ 前置失敗：$v 為空。最常見原因是 app-register 限流（每 IP 每小時 10 次，本腳本每次用 2 次）。"
                        say "     回應1：$(printf '%s' "$R1" | head -c 160)"
                        say "     回應2：$(printf '%s' "$R2" | head -c 160)"; exit $RC_PRE; }
  done
  # 只在「這輪真的註冊了」時印 REUSE —— 被 security_regression.sh 呼叫時是沿用它的帳號，
  # 那條路徑不該把上游的 token 再吐一次到輸出裡。
  say "  REUSE: HOST_ID=$HOST_ID HOST_T=$HOST_T OUT_ID=$OUT_ID OUT_T=$OUT_T"
fi
say "  成員     $HOST_ID"
say "  非成員   $OUT_ID"
say "  房間     $ROOM"

# 只有 HOST 是成員的聊天室。非成員刻意**不**建 membership —— 那正是受測的那件事。
aws dynamodb put-item --region "$REGION" --table-name "${PREFIX}ChatUserMemberships" --item "{
  \"UserID\":{\"S\":\"$HOST_ID\"},\"LastMessageTime#RoomID\":{\"S\":\"$ROOM\"},
  \"RoomID\":{\"S\":\"$ROOM\"},\"Title\":{\"S\":\"$MARK\"},
  \"UnreadCount\":{\"N\":\"0\"},\"ExpiryTime\":{\"N\":\"1900000000\"}}" >/dev/null || {
  say "  ❌ 前置失敗：建立 membership 失敗"; exit $RC_PRE; }

cleanup(){
  rc=$?   # 🔴 先存起來，否則下面任何一條指令都會把它蓋掉
  say ""
  say "── 清理 ──"
  # 只刪本次 ROOM 的訊息與 membership，不做跨帳號孤兒清掃
  aws dynamodb query --region "$REGION" --table-name "${PREFIX}ChatMessages" \
    --key-condition-expression "RoomID = :r" \
    --expression-attribute-values "{\":r\":{\"S\":\"$ROOM\"}}" \
    --query 'Items[].{t:"Timestamp#MessageID".S}' --output text 2>/dev/null | while read -r t; do
      [ -n "$t" ] && aws dynamodb delete-item --region "$REGION" --table-name "${PREFIX}ChatMessages" \
        --key "{\"RoomID\":{\"S\":\"$ROOM\"},\"Timestamp#MessageID\":{\"S\":\"$t\"}}" >/dev/null 2>&1
    done
  for u in "$HOST_ID" "$OUT_ID"; do
    aws dynamodb delete-item --region "$REGION" --table-name "${PREFIX}ChatUserMemberships" \
      --key "{\"UserID\":{\"S\":\"$u\"},\"LastMessageTime#RoomID\":{\"S\":\"$ROOM\"}}" >/dev/null 2>&1
  done
  say "  ✅ 本次房間資料已清空"
  if [ "$REGISTERED" = "1" ]; then
    # 帳號刻意留著，讓下一輪貼 REUSE 行沿用而不吃註冊額度。但留下來就會被忘掉，
    # 所以把「怎麼清」連同兩個實際踩到的坑一起印出來，而不是只寫在註解裡。
    say ""
    say "  ⚠️ 本輪**新註冊**了兩個帳號且刻意保留（供 REUSE）。不再重跑的話請清掉："
    say "     for u in $HOST_ID $OUT_ID; do"
    say "       aws dynamodb delete-item --region $REGION --table-name ${PREFIX}Users --key \"{\\\"userId\\\":{\\\"S\\\":\\\"\$u\\\"}}\"; done"
    say "     # AuthIdentities 的 key 是 identity（不是 identityKey），而且 identity 是 DynamoDB **保留字**，"
    say "     # 過濾一定要用 --expression-attribute-names，否則回 ValidationException；"
    say "     # 那個錯誤若被 2>/dev/null 吞掉，就會顯示成「0 筆殘留」= 清乾淨了。（2026-08-10 實際踩過）"
    say "     # AuthTokens 另有 2 筆（PK=tokenHash），要用 userId 過濾才找得到 —— 光刪 Users 不會連帶消失。"
  fi
  exit $rc
}
trap cleanup EXIT

# ── 送訊息（WebSocket）─────────────────────────────────────────────
# 回傳字串：SENT（送出且連線正常）／CONNECT_FAIL:<原因>
wssend(){
  TOKEN="$1" ROOM_ID="$2" BODY="$3" WSURL="$WS" python3 - <<'PY'
import asyncio, json, os, sys
import websockets

async def main():
    url = f"{os.environ['WSURL']}?token={os.environ['TOKEN']}"
    try:
        async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
            await ws.send(json.dumps({
                "action": "sendMessage",
                "roomId": os.environ["ROOM_ID"],
                "content": os.environ["BODY"],
                "type": "text",
            }))
            # handler 是 fire-and-forget，這裡不等回應；只留一點時間讓 Lambda 收完再斷線。
            await asyncio.sleep(3)
            print("SENT")
    except Exception as e:
        print(f"CONNECT_FAIL:{type(e).__name__}:{e}")

asyncio.run(main())
PY
}

# 判準：直接查表。回傳命中筆數。
seen(){ aws dynamodb query --region "$REGION" --table-name "${PREFIX}ChatMessages" \
        --key-condition-expression "RoomID = :r" \
        --filter-expression "SenderID = :s" \
        --expression-attribute-values "{\":r\":{\"S\":\"$ROOM\"},\":s\":{\"S\":\"$1\"}}" \
        --query 'length(Items)' --output text 2>/dev/null || echo ERR; }

say ""
say "══ ① 非成員對他人房間送訊息 → 不得寫入 ══"
A_WS=$(wssend "$OUT_T" "$ROOM" "$MARK-attack")
say "  WS：$A_WS"
case "$A_WS" in CONNECT_FAIL:*)
  # 非成員連不上 ≠ 房間層授權有效。$connect 只驗身分，任何合法帳號都該連得上；
  # 連不上代表前置壞了（token 失效／authorizer 異常），此時攻擊沒被真的執行過。
  say "  ❌ 前置失敗：非成員連不上 WS，攻擊未實際執行 —— 不可據此宣稱已擋下"; exit $RC_PRE ;;
esac
sleep 2
A_N=$(seen "$OUT_ID")

say ""
say "══ ②【正控】成員對自己房間送訊息 → 必須寫得進去 ══"
C_WS=$(wssend "$HOST_T" "$ROOM" "$MARK-control")
say "  WS：$C_WS"
case "$C_WS" in CONNECT_FAIL:*) say "  ❌ 前置失敗：成員連不上 WS"; exit $RC_PRE ;; esac
sleep 2
C_N=$(seen "$HOST_ID")

say ""
say "══ 判定（判準＝ChatMessages 表，不採信 WS 回應）══"
say "  非成員寫入筆數：$A_N（期望 0）"
say "  成員寫入筆數：  $C_N（期望 ≥1）"

if [ "$C_N" = "ERR" ] || [ "$A_N" = "ERR" ]; then
  say "  ❌ 前置失敗：查表出錯，判準不可用"; exit $RC_PRE
fi
if [ "$C_N" -lt 1 ]; then
  # 正控倒了就不准對安全性下結論 —— 這時候「攻擊也寫不進去」只是因為整條鏈都不通。
  say "  ❌ 正控失敗：成員自己也送不進去 ⇒ WS 聊天鏈路壞了，本次不對房間層授權下結論"
  exit $RC_PRE
fi
if [ "$A_N" -gt 0 ]; then
  say "  🔴 F-2 成立：非成員的訊息被寫進他人房間（且會觸發廣播／未讀數／推播）"
  FAIL=1
else
  say "  ✅ 房間層授權有效：非成員被擋，成員正常"
fi

exit $FAIL
