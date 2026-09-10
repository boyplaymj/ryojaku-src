#!/usr/bin/env bash
# kill switch 的**涵蓋不到的那一半**：公開 route 在維護中是否照常可用。
#
# 用法：E2E_EMAIL=... E2E_PASSWORD=... bash infra/maintenance_public_routes_probe.sh
# 退出碼：0 = 宣稱成立；1 = 斷言失敗；
#         2 = 前置/設備失敗，**或收尾沒歸零**（兩者都是「這一輪的結果不可信」）
#   🔴 2026-09-10 把「旗標沒還原」從 1 改成 2，並讓「探針帳號沒清乾淨」也走 2。
#      理由：那兩件都不是斷言失敗，是**這一輪的前提破了**。同一類別給不同的 rc，
#      下游就分不出「量到問題」與「根本不該採信」。（與姊妹探針
#      verify_venue_privacy_live.py／e2e/venue-live.cjs 的約定一致。）
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
# ⚠️ 寫入面積（2026-09-10 逐支 handler 查過才寫的，**比本行原本寫的大**）：
#   ① `AdminConfigs`：maintenanceMode 旗標 → 收尾 delete-item 還原成「item 不存在」
#      （＝原始狀態，不是寫 false）。
#   ② `Users`：維護中註冊的 DELETEME 帳號一列（app-register 限流每 IP 每小時 10 次，本腳本用 1 次）。
#   ③ `AuthTokens`：**register handler 自己還會寫一列**
#      （`mahjongclub_app_register` → `shared.IssueToken(PurposeVerifyEmail)`），
#      key 是 `tokenHash`，而明碼只出現在信裡 ⇒ **我們算不出那把 key**，只能用
#      `userId` scan 找。這張表有開 TTL（`expiresAt`，24h）會自己收，
#      但 TTL 刪除可以延遲到 48h ⇒ **不靠它**，收尾主動刪掉。
#   🔴 本段 2026-09-10 之前只寫了「註冊一個 DELETEME 帳號」，而收尾**一列都沒刪** ——
#      實查線上 Users 表當時躺著 2 筆（兩次跑各留一筆）。宣告的面積小於實際面積，
#      而收尾的面積是 0：三個數字互不相等，外觀上完全看不出來。
#
# ⚠️ 一個**條件性**的副作用（現況不成立，但會變）：register 會 `SendVerifyEmail`
#    寄到 `pubprobe+<ts>@example.com`。本帳號的 SES 目前在 **sandbox**
#    （`aws sesv2 get-account` → `ProductionAccessEnabled: false`）⇒ 寄給未驗證位址
#    會被 SES 直接 reject，**不產生退信**。⚠️ 一旦開通 production access，
#    這支每跑一次就是一封寄往 example.com 的**硬退信**（會算進退信率）。
#    ⇒ 開通那天要回來把收件位址換成自己控制的網域。
#
# 🔴 機密不進 argv（根指令那條）：本支的 curl **一律**用 `-H @<(…)`／
#    `--data-binary @<(…)`，展開後的 token 與密碼只出現在 `/dev/fd/NN`。
#    2026-09-10 之前有三處把機密攤在 argv（`/proc/<pid>/cmdline` 全機可讀）：
#    `hit()` 的 `-H "Authorization: Bearer $auth"`、以及兩處 `-d "{…$PASSWORD…}"`。
#    量法與正反控見 §15.5（正控：舊寫法確實量得到；反控：新寫法量到 0）。
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

# 🔴 回應內容存這裡（每次 hit 覆寫）。以前是 `-o /dev/null`，於是這支
#    **連自己註冊出了哪個 userId 都不知道** ⇒ 結構上清不掉它建的東西。
#    ⚠️ 它會裝到 JWT（/app-login 的回應）⇒ mktemp（0600）＋收尾刪除，不可留在 /tmp。
BODYFILE=$(mktemp /tmp/ryojaku-pub-body.XXXXXX) || { echo "mktemp 失敗"; exit 2; }
chmod 600 "$BODYFILE"
# 註冊出來的 userId 存檔（不是變數）：`hit` 在 $( ) 裡跑是 subshell，
# 而且 trap 收尾要讀得到它，即使中間 die。
NEWUID_FILE=$(mktemp /tmp/ryojaku-pub-uid.XXXXXX) || { echo "mktemp 失敗"; exit 2; }
# 本支要清的另外兩張表。TABLE 只是旗標那張，不夠用。
PREFIX=${E2E_TABLE_PREFIX:-MahjongClubStg_}
USERS_TABLE=${PREFIX}Users
AUTHTOKENS_TABLE=${PREFIX}AuthTokens

# hdrs <auth> <body>：把這次要用的 header 一行一條印出來，交給 `curl -H @<(hdrs …)`。
# 🔴 它存在的唯一理由是**不要讓機密經過 argv**：走 process substitution 的話
#    argv 上看到的是 `@/dev/fd/63`，展開後的 token 只活在那個 pipe 裡。
#    ⚠️ 這是把「全機任何 user 可讀」降到「同 user/root 可讀」，**不是消滅機密**。
hdrs(){
  local auth=${1:-} body=${2:-}
  [ -n "$body" ] && printf 'Content-Type: application/json\n'
  [ -n "$auth" ] && printf 'Authorization: Bearer %s\n' "$auth"
  return 0
}

# hit <方法> <路徑> [body] [authHeader] → 印 "<status>|<errortype>"
# errortype 取自 x-amzn-errortype，authorizer 的 Deny 會帶 AccessDeniedException。
# 副作用：回應內容寫進 $BODYFILE（呼叫端要用就自己去讀 —— 本函式常在 $( ) 裡跑，
#         那是 subshell，設全域變數傳不回去，只有寫檔才過得來）。
hit(){
  local m=$1 p=$2 body=${3:-} auth=${4:-}
  local hdrfile; hdrfile=$(mktemp /tmp/ryojaku-pub-hdr.XXXXXX)
  : > "$BODYFILE"
  local code
  if [ -n "$body" ]; then
    code=$(curl -s -o "$BODYFILE" -D "$hdrfile" -w '%{http_code}' -X "$m" "$API$p" \
      -H @<(hdrs "$auth" "$body") --data-binary @<(printf '%s' "$body"))
  else
    code=$(curl -s -o "$BODYFILE" -D "$hdrfile" -w '%{http_code}' -X "$m" "$API$p" \
      -H @<(hdrs "$auth" ""))
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

# user_exists <userId> → 0=還在 1=不存在 2=讀不出來（不知道 ⇒ 不可以當成乾淨）
user_exists(){
  local out
  out=$(aws dynamodb get-item --region "$REGION" --table-name "$USERS_TABLE" \
          --key "{\"userId\":{\"S\":\"$1\"}}" --consistent-read \
          --projection-expression userId --output json 2>/dev/null) || return 2
  # 🔴 查無資料時 aws cli 回的是**空字串**，不是 `{}`（rc 仍為 0）。
  #    姊妹探針 venue-live.cjs 就是漏了這一點 ⇒ JSON.parse('') 丟例外 ⇒ 假紅。
  [ -z "${out//[[:space:]]/}" ] && return 1
  printf '%s' "$out" | grep -q '"Item"' && return 0 || return 1
}

# authtoken_hashes <userId> → 每行一個 tokenHash
# 🔴 這裡**只能 scan**：key 是 tokenHash，而明碼只出現在信裡 ⇒ 我們算不出 key。
#    ⚠️ 因此本函式依賴「aws cli 會自己翻頁」這個工具的性質（實測成立：
#      --page-size 1 強制多次呼叫仍回全部）。姊妹探針改用 GetItem 正是為了
#      不依賴它 —— 這一支沒有那個選項，所以把依賴寫在這裡，不要假裝沒有。
authtoken_hashes(){
  aws dynamodb scan --region "$REGION" --table-name "$AUTHTOKENS_TABLE" \
    --filter-expression 'userId = :u' --expression-attribute-values "{\":u\":{\"S\":\"$1\"}}" \
    --projection-expression tokenHash --output json 2>/dev/null \
  | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(3)
for i in d.get("Items",[]): print(i["tokenHash"]["S"])'
}

cleanup(){
  rc=$?   # 🔴 先存起來，否則下面任何一條指令都會把它蓋掉
  say ""
  say "── 收尾（寫入面積必須歸零）──"
  local problems=()

  # ① 旗標
  flag_del
  local after; after=$(flag_read)
  if [ -z "$after" ] || [ "$after" = "None" ]; then
    say "  ① 旗標已還原成 (item 不存在) ✅"
  else
    problems+=("旗標沒還原乾淨，讀回 = $after —— 請手動 delete-item")
  fi

  # ②③ 探針帳號與它的 AuthTokens
  local uid; uid=$(cat "$NEWUID_FILE" 2>/dev/null)
  if [ -z "$uid" ]; then
    say "  ②③ 沒有註冊出 userId ⇒ 沒有帳號要刪（若上面 register 回了 200，那一格已判紅）"
  else
    # AuthTokens 先刪 —— 刪完 Users 之後就沒有東西指向它了，順序反了會留孤兒。
    local h n=0
    while IFS= read -r h; do
      [ -n "$h" ] || continue
      aws dynamodb delete-item --region "$REGION" --table-name "$AUTHTOKENS_TABLE" \
        --key "{\"tokenHash\":{\"S\":\"$h\"}}" >/dev/null 2>&1 || problems+=("AuthTokens 刪不掉 $h")
      n=$((n+1))
    done < <(authtoken_hashes "$uid")
    say "  ③ AuthTokens：刪了 $n 列（依 userId=$uid）"
    aws dynamodb delete-item --region "$REGION" --table-name "$USERS_TABLE" \
      --key "{\"userId\":{\"S\":\"$uid\"}}" >/dev/null 2>&1 || problems+=("Users 刪不掉 $uid")

    # read-back：「刪除指令回 0」與「東西還在」不可以同形。
    user_exists "$uid"; local ue=$?
    case $ue in
      0) problems+=("Users/$uid 仍在表上") ;;
      2) problems+=("Users/$uid read-back 讀不出來 ⇒ 不知道還在不在") ;;
      *) say "  ② Users：$uid 已刪，GetItem 讀回不存在 ✅" ;;
    esac
    local leftover; leftover=$(authtoken_hashes "$uid" | grep -c . || true)
    if [ "${leftover:-0}" != "0" ]; then problems+=("AuthTokens 仍有 $leftover 列指向 $uid")
    else say "  ③ AuthTokens：重掃 userId=$uid 為 0 列 ✅"; fi
  fi

  rm -f "$BODYFILE" "$NEWUID_FILE"

  if [ "${#problems[@]}" -gt 0 ]; then
    say ""
    say "  ❌ 收尾沒有歸零（${#problems[@]} 項）："
    local m; for m in "${problems[@]}"; do say "      · $m"; done
    say "  ⇒ rc=2：斷言另計，但這一輪**留下了東西** ⇒ 結果不可信。"
    rc=2
  fi

  say ""
  case "$rc" in
    0) say "✅ 全部斷言通過  rc=0" ;;
    2) say "❌ 沒量到／收尾沒歸零  rc=2（不可讀成通過，也不等於量到失敗）" ;;
    *) say "❌ 有斷言失敗  rc=$rc" ;;
  esac
  say "=== END-OF-RUN ==="
  exit $rc
}
# 🔴 供 `infra/maintenance_probe_selftest.sh` source 進去單獨驗那些函式用：
#    只要函式，不跑主流程、**也不裝 trap**（裝了的話測試一結束就會去翻線上旗標）。
#    ⚠️ 刻意不做成 `--selftest` 旗標：這支的主流程會寫線上表，一個打錯的
#      argv 就變成「本來只想跑測試，結果翻了 stg 的維護開關」。
#      要跑測試的人得**明講**自己是在載函式庫。
if [ "${PROBE_LIB_ONLY:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

trap cleanup EXIT

# ── P0 前置 ─────────────────────────────────────────────────────────────
say "══ P0 前置 ══"
BEFORE=$(flag_read)
[ -z "$BEFORE" ] || [ "$BEFORE" = "None" ] || [ "$BEFORE" = "false" ] \
  || die "開跑前旗標就是 '$BEFORE' —— 拒跑，否則量到的『被擋』不是我造成的"
say "  旗標起始值 = ${BEFORE:-(item 不存在)} → 視為 OFF"

# 拿一把合法 user token 當「應該被擋」那格的見證。
# 🔴 改走 hit()：原本這裡是裸 curl，把 $PASSWORD 直接展開進 `-d` ⇒ 密碼進 argv。
R=$(hit POST /app-login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" < "$BODYFILE" 2>/dev/null)
[ -n "$TOKEN" ] || die "拿不到合法 token（帳密錯？$R，回應開頭：$(head -c 160 "$BODYFILE")）"
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
# 🔴 立刻把 userId 撈出來寫進 $NEWUID_FILE —— **在任何斷言之前**。
#    收尾要靠它才刪得掉；而斷言若中途 die，trap 仍然讀得到這個檔。
#    ⚠️ 200 才有 userId；非 200 時留空，收尾那邊會據此走不同的話術
#    （「沒建成所以沒東西要刪」與「建成了但撈不到 id」必須分開，後者是要人去查的）。
# ⚠️ 檔名走 argv、**不要**用 `python3 - <<'PY' < "$BODYFILE"` ——
#    `-` 是「程式從 stdin 讀」，再把 stdin 導到 body 檔就是兩者搶同一個 fd。
python3 - "$BODYFILE" "$NEWUID_FILE" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
except Exception:
    d = {}
uid = ((d.get("data") or {}).get("userId") or "") if isinstance(d, dict) else ""
with open(sys.argv[2], "w") as f:
    f.write(uid)
PY
NEWUID=$(cat "$NEWUID_FILE" 2>/dev/null)
say "  POST /app-register       → $R  ($NEWMAIL)  userId=${NEWUID:-(沒撈到)}"
if [ "${R%%|*}" = "200" ] && [ -z "$NEWUID" ]; then
  bad "註冊回 200 卻撈不到 data.userId —— **收尾將無法刪除它**，請手動查 displayName=PUBPROBE-DELETEME"
fi
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
