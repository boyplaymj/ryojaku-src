#!/usr/bin/env bash
# kill switch 的**涵蓋不到的那一半**：公開 route 在維護中是否照常可用。
#
# 用法：E2E_EMAIL=... E2E_PASSWORD=... bash infra/maintenance_public_routes_probe.sh
# 退出碼：0 = 宣稱成立；1 = 斷言失敗；2 = 前置/設備失敗（＝沒量到，別讀成通過）
#
# ── 這支在補的是哪一塊 ──────────────────────────────────────────────────
#
# maintenance.go 檔頭宣稱：「公開 route 沒有 authorizer，本開關對它們完全無效 ——
# 開了 kill switch，登入與註冊照常可用。」前幾輪只打過 GET /app-version-config 一條，
# POST 那些（app-login / app-register）一條都沒打過。
#
# 🔴 判準：被擋的指紋是「**403 且 x-amzn-errortype: AccessDeniedException**」——
#    那是 API Gateway authorizer 的 Deny，不是 handler 自己回的東西。
#    只看 403 不夠：handler 自己也可能因為別的理由回 403，兩者混在一起就分不出
#    「被開關擋住」與「這個請求本來就不合法」。
#
# 🔴 每一格「應該通」都配一個**同一次翻轉裡**的「應該被擋」（GET /chat/rooms 帶合法
#    token）。少了它，「公開 route 回 200」與「旗標根本沒開起來」逐字相同。
#
# ── 結構那一半（本腳本不重跑，記錄依據）──────────────────────────────
#
# 經驗量測只能打有限條。結構論證涵蓋全部 24 條，兩條腿：
#   (a) `shared.IsMaintenanceMode` 的**生產呼叫端只有兩個**（grep，排除測試）：
#       mahjongclub_authorizer/main.go:31 與 mahjongclub_chat_ws_send_message/main.go:61。
#       ⇒ 維護模式只可能經由 user authorizer 或 WS sendMessage 顯現。
#   (b) 對線上 REST API 9mu0vajn38 逐 method 查 authorizerId：24 條 method 的
#       authorizationType 是 NONE（沒掛任何 authorizer）。
#   ⇒ 這 24 條結構上不可能吐出 authorizer 的 Deny。本腳本打的是其中的代表樣本。
#   ⚠️ (a) 是原始碼層，(b) 是線上部署層。前者不保證「線上跑的就是這份碼」——
#      那一環靠前幾輪已量到的「翻旗標 → 受保護 route 真的轉 403」補上。
#
# 🔴 而這件事的意義比檔頭寫的大。檔頭只講「登入與註冊照常可用」（聽起來像好事），
#    但同一批公開 route 裡還有 /auth/change-password、/auth/logout-all、/auth/unbind
#    —— 都是**會改帳號狀態**的操作。緊急封鎖期間它們照樣打得進來。
#    這不是 bug（沒有 authorizer 就是沒有），但「kill switch 拉下去 = 全站凍結」
#    這個直覺是錯的，值得寫下來。
#
# ⚠️ 會對 stg 寫入：翻 maintenanceMode 旗標；並在維護中註冊一個
#    DELETEME 帳號（app-register 限流每 IP 每小時 10 次，本腳本用 1 次）。
#    收尾一律 delete-item 還原成「item 不存在」（＝原始狀態，不是寫 false）。
set -uo pipefail

REGION=${AWS_REGION:-ap-southeast-1}
API=${E2E_API:-https://ryojaku-api.boyplaymj.com}
TABLE=${E2E_TABLE:-MahjongClubStg_AdminConfigs}
EMAIL=${E2E_EMAIL:-}
PASSWORD=${E2E_PASSWORD:-}

FAIL=0
RC_PRE=2
say(){ printf '%s\n' "$*"; }
ok(){ say "  ✅ $*"; }
bad(){ say "  ❌ $*"; FAIL=1; }
die(){ say ""; say "❌ 前置失敗（沒量到，不是通過）：$*"; exit $RC_PRE; }

[ -n "$EMAIL" ] && [ -n "$PASSWORD" ] || die "缺 E2E_EMAIL / E2E_PASSWORD"

# hit <方法> <路徑> [body] [authHeader] → 印 "<status>|<errortype>"
# errortype 取自 x-amzn-errortype，authorizer 的 Deny 會帶 AccessDeniedException。
hit(){
  local m=$1 p=$2 body=${3:-} auth=${4:-}
  local hdrfile; hdrfile=$(mktemp /tmp/ryojaku-pub-hdr.XXXXXX)
  local code
  if [ -n "$body" ]; then
    code=$(curl -s -o /dev/null -D "$hdrfile" -w '%{http_code}' -X "$m" "$API$p" \
      -H 'Content-Type: application/json' ${auth:+-H "Authorization: Bearer $auth"} -d "$body")
  else
    code=$(curl -s -o /dev/null -D "$hdrfile" -w '%{http_code}' -X "$m" "$API$p" \
      ${auth:+-H "Authorization: Bearer $auth"})
  fi
  local et; et=$(grep -i '^x-amzn-errortype:' "$hdrfile" | tr -d '\r' | awk '{print $2}')
  rm -f "$hdrfile"
  printf '%s|%s' "$code" "${et:--}"
}
# 「被 authorizer 擋住」的指紋
denied(){ [ "${1%%|*}" = "403" ] && [ "${1##*|}" = "AccessDeniedException" ]; }

flag_on(){  aws dynamodb put-item --region "$REGION" --table-name "$TABLE" \
              --item '{"info_key":{"S":"maintenanceMode"},"info_value":{"S":"true"}}' >/dev/null; }
flag_del(){ aws dynamodb delete-item --region "$REGION" --table-name "$TABLE" \
              --key '{"info_key":{"S":"maintenanceMode"}}' >/dev/null; }
flag_read(){ aws dynamodb get-item --region "$REGION" --table-name "$TABLE" \
              --key '{"info_key":{"S":"maintenanceMode"}}' --consistent-read \
              --query 'Item.info_value.S' --output text 2>/dev/null; }

cleanup(){
  rc=$?   # 🔴 先存起來，否則下面任何一條指令都會把它蓋掉
  say ""
  say "── 收尾 ──"
  flag_del
  local after; after=$(flag_read)
  if [ -z "$after" ] || [ "$after" = "None" ]; then
    say "  旗標已還原成 (item 不存在) ✅"
  else
    say "  ❌ 旗標沒還原乾淨，讀回 = $after —— 請手動 delete-item"
    rc=1
  fi
  say ""
  [ "$rc" = 0 ] && say "✅ 全部斷言通過  rc=0" || say "❌ 有斷言失敗或前置失敗  rc=$rc"
  say "=== END-OF-RUN ==="
  exit $rc
}
trap cleanup EXIT

# ── P0 前置 ─────────────────────────────────────────────────────────────
say "══ P0 前置 ══"
BEFORE=$(flag_read)
[ -z "$BEFORE" ] || [ "$BEFORE" = "None" ] || [ "$BEFORE" = "false" ] \
  || die "開跑前旗標就是 '$BEFORE' —— 拒跑，否則量到的『被擋』不是我造成的"
say "  旗標起始值 = ${BEFORE:-(item 不存在)} → 視為 OFF"

# 拿一把合法 user token 當「應該被擋」那格的見證。
LOGIN=$(curl -s -X POST "$API/app-login" -H 'Content-Type: application/json' \
        -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$TOKEN" ] || die "拿不到合法 token（帳密錯？回應：$(printf '%s' "$LOGIN" | head -c 160)）"
say "  已取得合法 user token（長度 ${#TOKEN}）"

# ── P1 正控：旗標 OFF ───────────────────────────────────────────────────
say ""
say "══ P1 正控：旗標 OFF —— 這些路本來就通 ══"
R=$(hit GET /chat/rooms "" "$TOKEN");        say "  [受保護] GET /chat/rooms        → $R"
[ "${R%%|*}" = "200" ] || die "正控壞了：OFF 時受保護 route 回 $R（期望 200）"
R=$(hit GET /app-version-config);            say "  [公開GET] GET /app-version-config → $R"
[ "${R%%|*}" = "200" ] || die "正控壞了：OFF 時 app-version-config 回 $R"
R=$(hit POST /app-login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
say "  [公開POST] POST /app-login       → $R"
[ "${R%%|*}" = "200" ] || die "正控壞了：OFF 時 app-login 回 $R"
ok "OFF 基線成立（受保護與公開都通）"

# ── P2 旗標 ON ──────────────────────────────────────────────────────────
say ""
say "══ P2 旗標 ON —— 受保護要被擋，公開要照常 ══"
flag_on
NOW=$(flag_read); [ "$NOW" = "true" ] || die "旗標沒寫進去（讀回 $NOW）"
say "  旗標 = true"

# 🔴 差分見證：少了這格，下面每個 200 都可能只是「旗標根本沒開」
R=$(hit GET /chat/rooms "" "$TOKEN"); say "  [受保護] GET /chat/rooms        → $R"
if denied "$R"; then ok "受保護 route 確實被 authorizer Deny（403 + AccessDeniedException）⇒ 開關真的開著"
else bad "受保護 route 沒被擋（$R）—— 旗標沒生效，本輪其餘的 200 全部不算數"; fi

# /user-profile 特別點名：它決定「哪一種登入方式在維護中還能用」。
# email/密碼登入不打它（profile 由 /app-login 自帶，authService.ts:60）⇒ 維護中登得進去；
# Google／LINE 登入走 adoptSession，**會**打它 ⇒ 撞 403 後 throw 並清掉半套 session。
# ⚠️ 後半是讀碼推論：真的跑一次 Google／LINE 登入需要真 OAuth，未實打。
R=$(hit GET /user-profile "" "$TOKEN"); say "  [受保護] GET /user-profile      → $R"
if denied "$R"; then ok "/user-profile 在維護中被 Deny ⇒ Google／LINE 登入路徑會撞到它（機制成立）"
else bad "/user-profile 沒被擋（$R）—— 它應該是受保護的"; fi

say ""
say "  ── 檔頭點名的三條 ──"
R=$(hit GET /app-version-config); say "  GET  /app-version-config → $R"
if [ "${R%%|*}" = "200" ]; then ok "公開 GET 照常（複製前幾輪）"; else bad "期望 200，實得 $R"; fi

R=$(hit POST /app-login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
say "  POST /app-login          → $R"
if [ "${R%%|*}" = "200" ]; then ok "🔴 維護中**登入照常可用** —— 檔頭這句第一次被實打"
else bad "期望 200，實得 $R —— 檔頭「登入照常可用」不成立"; fi

NEWMAIL="pubprobe+$(date +%s)@example.com"
R=$(hit POST /app-register "{\"email\":\"$NEWMAIL\",\"password\":\"PubProbe12345!\",\"displayName\":\"PUBPROBE-DELETEME\"}")
say "  POST /app-register       → $R  ($NEWMAIL)"
if [ "${R%%|*}" = "200" ]; then ok "🔴 維護中**註冊照常可用** —— 檔頭這句第一次被實打"
elif [ "${R%%|*}" = "429" ]; then bad "回 429：這是**註冊限流**不是 kill switch，本格沒量到（每 IP 每小時 10 次）"
else bad "期望 200，實得 $R"; fi

say ""
say "  ── 檔頭沒點名，但會改帳號狀態的公開 POST（帶 garbage token，不產生副作用）──"
for path in /auth/change-password /auth/logout-all /auth/unbind /auth/forgot-password; do
  case "$path" in
    /auth/forgot-password) BODY='{"email":"nobody-pubprobe@example.com"}' ; AUTHZ='' ;;
    *)                     BODY='{"probe":true}'                          ; AUTHZ='garbage' ;;
  esac
  R=$(hit POST "$path" "$BODY" "$AUTHZ")
  if denied "$R"; then bad "$path 被 authorizer 擋住（$R）—— 與『無 authorizer』的結構事實矛盾"
  else ok "POST $path → $R（不是 Deny ⇒ 維護中仍到得了 handler）"; fi
done

# ── P3 還原 ─────────────────────────────────────────────────────────────
say ""
say "══ P3 還原 ══"
flag_del
R=$(hit GET /chat/rooms "" "$TOKEN"); say "  [受保護] GET /chat/rooms → $R"
if [ "${R%%|*}" = "200" ]; then ok "受保護 route 回到 200 —— 可逆"
else bad "還原後仍是 $R"; fi

exit $FAIL
