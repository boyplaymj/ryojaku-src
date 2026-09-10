#!/usr/bin/env bash
# maintenance_public_routes_probe.sh 的自檢。
#
# 用法：bash infra/maintenance_probe_selftest.sh
# rc：0 = 全過；1 = 有測試失敗；2 = 設備問題（＝沒測到，不可讀成通過）
#
# ── 為什麼要有這支 ────────────────────────────────────────────────────
#
# 本尊會翻 stg 的維護開關、會註冊真帳號，跑一次的代價不小，而且要 E2E 帳密。
# 2026-09-10 那次修改（機密退出 argv ＋ 收尾補上帳號清理）**沒辦法靠跑本尊驗證**
# ⇒ 把可驗的那些函式拆出來單獨打。
#
# 🔴 分三種尺，混在一起就會自我證明：
#   (a) **真的 DDB**：`user_exists` 打線上表，配正控（拿一個確定存在的 id）
#       與反控（拿一個確定不存在的 id）。少了正控，「回報不存在」與
#       「這個函式永遠回不存在」逐字相同。
#   (b) **本機 echo server**：`hit()` 送出去的 header／body 對不對，
#       以及**執行當下機密在不在 `/proc/<pid>/cmdline`**。
#   (c) **接線**：把 `user_exists`／`flag_read` 換成固定值，看 `cleanup` 的 rc
#       有沒有跟著動 —— 「有算、有印」不等於「有接上」。
#
# ⚠️ 界線：本支不驗「維護中公開 route 照常可用」那些斷言 —— 那要真的翻旗標，
#    只有本尊做得到。這支驗的是本尊的**管路**，不是它的**結論**。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

PASS=0; FAILN=0
t_ok(){ PASS=$((PASS+1)); printf '  ✅ %s\n' "$*"; }
t_bad(){ FAILN=$((FAILN+1)); printf '  ❌ %s\n' "$*"; }
t_die(){ printf '\n🔴 [設備] 沒測到：%s\n' "$*"; exit 2; }

# ── 起本機 echo server ──────────────────────────────────────────────────
# ⚠️ 用 PID 收，**不要 `pkill -f`** —— 那會殺到別條 session 跑的同名腳本。
PORT=${SELFTEST_PORT:-8793}
SRV_PY=$(mktemp /tmp/mpst-srv.XXXXXX.py)
cat > "$SRV_PY" <<PY
import http.server, json, time
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _r(self):
        if self.path.startswith('/slow'): time.sleep(3)
        n=int(self.headers.get('Content-Length') or 0)
        body=self.rfile.read(n).decode() if n else ''
        out=json.dumps({"headers":dict(self.headers),"body":body,
                        "data":{"userId":"SELFTEST-UID-FROM-SERVER"}}).encode()
        self.send_response(200); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(out))); self.end_headers(); self.wfile.write(out)
    do_GET=_r; do_POST=_r
http.server.HTTPServer(('127.0.0.1',$PORT),H).serve_forever()
PY
python3 "$SRV_PY" >/dev/null 2>&1 &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null; rm -f "$SRV_PY"' EXIT
for _ in $(seq 25); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/ping" && break
  sleep 0.2
done
curl -s -o /dev/null "http://127.0.0.1:$PORT/ping" || t_die "本機 echo server 起不來（port $PORT）"

# ── 只載函式，不跑主流程 ────────────────────────────────────────────────
export PROBE_LIB_ONLY=1
export E2E_EMAIL=selftest@example.invalid E2E_PASSWORD=not-a-real-password
export E2E_API="http://127.0.0.1:$PORT"
# shellcheck source=/dev/null
. infra/maintenance_public_routes_probe.sh || t_die "source 探針失敗"
[ -n "${BODYFILE:-}" ] && [ -n "${NEWUID_FILE:-}" ] || t_die "source 成功但 BODYFILE/NEWUID_FILE 沒設 —— 探針結構變了"
type hit >/dev/null 2>&1 || t_die "source 成功但沒有 hit() —— PROBE_LIB_ONLY 的位置跑掉了"

echo "══ A. hdrs()：header 組得對不對 ══"
[ "$(hdrs 'TOK' 'BODY' | wc -l)" = 2 ] && t_ok "A1 有 auth 有 body → 兩行" || t_bad "A1 期望兩行"
[ "$(hdrs '' '' | wc -l)" = 0 ] && t_ok "A2 兩者皆無 → 零行（空 header 檔 curl 吃得下，已實測）" || t_bad "A2 期望零行"
hdrs 'TOK' '' | grep -q '^Authorization: Bearer TOK$' && t_ok "A3 只有 auth → 只出 Authorization" || t_bad "A3 Authorization 那行不對"
hdrs 'TOK' '' | grep -q 'Content-Type' && t_bad "A4【反控】沒 body 不該出 Content-Type" || t_ok "A4【反控】沒 body 就沒有 Content-Type"

echo "══ B. hit()：真的送出去長什麼樣（打本機 echo server）══"
R=$(hit POST /echo '{"k":"v-selftest"}' 'TOK-SELFTEST')
[ "${R%%|*}" = "200" ] && t_ok "B1 回 200（$R）" || t_bad "B1 期望 200，實得 $R"
python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
h={k.lower():v for k,v in d["headers"].items()}
assert h.get("authorization")=="Bearer TOK-SELFTEST", h.get("authorization")
assert h.get("content-type")=="application/json", h.get("content-type")
assert d["body"]=="{\"k\":\"v-selftest\"}", d["body"]
' "$BODYFILE" 2>/dev/null && t_ok "B2 header 與 body 一字不差地送到了（＝process substitution 沒改變語意）" \
  || t_bad "B2 送出去的內容不對：$(head -c 200 "$BODYFILE")"
grep -q 'SELFTEST-UID-FROM-SERVER' "$BODYFILE" && t_ok "B3 回應內容真的落進 BODYFILE（舊版 -o /dev/null ⇒ 這格必紅）" \
  || t_bad "B3 BODYFILE 裡沒有回應內容"
R=$(hit GET /echo)
[ "${R%%|*}" = "200" ] && t_ok "B4 無 body 無 auth 的 GET 也走得通（空 header 檔）" || t_bad "B4 實得 $R"

echo "══ C. 機密在不在 argv —— 本支最承重的一格 ══"
# 🔴 C1 是**正控**：故意用舊寫法，它必須被量到。
#    少了它，C2 的 0 與「這把尺根本讀不到 argv」逐字相同。
# 🔴 底下那行 curl 刻意保留「機密進 argv」的形狀，但用的是**字面常數**
#    （沒有變數展開 ⇒ 沒有真的機密會外洩）。這是 argv-secret-guard 的判準
#    「展開落在認證參數位置」為什麼放行它的原因 —— 不是繞過守衛，
#    是這一行本來就沒有機密可洩。改成變數的話守衛會擋，而且**擋得對**。
SEC_T='SELFTEST-TOKEN-ZZZ'; SEC_P='SELFTEST-PW-YYY'
[ "$SEC_T" = 'SELFTEST-TOKEN-ZZZ' ] && [ "$SEC_P" = 'SELFTEST-PW-YYY' ] \
  || t_die "C 組的字面值與掃描目標漂掉了（下面那行 curl 是硬寫的，兩邊必須一致）"

scan_argv(){ local needle=$1 hits=0 p
  for p in $(pgrep -x curl 2>/dev/null); do
    tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qF "$needle" && hits=$((hits+1))
  done; printf '%s' "$hits"; }

curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/slow" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer SELFTEST-TOKEN-ZZZ' \
  -d '{"password":"SELFTEST-PW-YYY"}' >/dev/null 2>&1 &
OLD_BG=$!; sleep 1
c_t=$(scan_argv "$SEC_T"); c_p=$(scan_argv "$SEC_P"); wait $OLD_BG 2>/dev/null
if [ "$c_t" -ge 1 ] && [ "$c_p" -ge 1 ]; then
  t_ok "C1【正控】舊寫法：token 與 password 確實出現在 /proc/<pid>/cmdline（$c_t／$c_p）"
else
  t_bad "C1【正控】沒成立（$c_t／$c_p）⇒ 這把尺量不到 argv，C2 的 0 沒有意義"
fi

hit POST /slow "{\"password\":\"$SEC_P\"}" "$SEC_T" >/dev/null 2>&1 &
NEW_BG=$!; sleep 1
n_t=$(scan_argv "$SEC_T"); n_p=$(scan_argv "$SEC_P"); wait $NEW_BG 2>/dev/null
if [ "$n_t" = 0 ] && [ "$n_p" = 0 ]; then
  t_ok "C2 現在的 hit()：argv 裡量到 0 次 token、0 次 password"
else
  t_bad "C2 hit() 仍然把機密送進 argv（token=$n_t password=$n_p）"
fi

echo "══ D. user_exists()：打真的 DDB，正反控都要 ══"
LIVE_UID=$(aws dynamodb scan --region "$REGION" --table-name "$USERS_TABLE" \
  --max-items 1 --projection-expression userId --output json 2>/dev/null \
  | python3 -c 'import sys,json
try: print(json.load(sys.stdin)["Items"][0]["userId"]["S"])
except Exception: print("")')
[ -n "$LIVE_UID" ] || t_die "撈不到任何線上 userId ⇒ D 這組沒有正控可用"
user_exists "$LIVE_UID"; rc=$?
[ "$rc" = 0 ] && t_ok "D1【正控】確定存在的 id → 回『還在』" || t_bad "D1 期望 0，實得 $rc ⇒ 這函式可能永遠說不存在"
user_exists "SELFTEST-NO-SUCH-USER-$(date +%s)"; rc=$?
[ "$rc" = 1 ] && t_ok "D2【反控】確定不存在的 id → 回『不存在』（含 aws cli 回空字串那個坑）" || t_bad "D2 期望 1，實得 $rc"

echo "══ E. authtoken_hashes()：也打真的 DDB ══"
# 🔴 E1 單獨是**沒有鑑別力**的：「期望 0 行」跟「這函式永遠回空」長得一樣。
#    ⇒ 先自己種一列真的進 AuthTokens 當正控（E0），撈到了才有資格談 E1。
#    ⚠️ 這是本支唯一會寫線上表的地方：一列合成的 tokenHash，馬上刪掉並讀回。
E_UID="SELFTEST-AT-$(date +%s)-$$"
E_HASH="selftest-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
aws dynamodb put-item --region "$REGION" --table-name "$AUTHTOKENS_TABLE" \
  --item "{\"tokenHash\":{\"S\":\"$E_HASH\"},\"userId\":{\"S\":\"$E_UID\"},\"purpose\":{\"S\":\"selftest\"},\"expiresAt\":{\"N\":\"$(( $(date +%s) + 900 ))\"},\"createdAt\":{\"N\":\"$(date +%s)\"}}" \
  >/dev/null 2>&1 || t_die "種不進 AuthTokens ⇒ E 這組沒有正控可用（不是通過）"
n=$(authtoken_hashes "$E_UID" | grep -c . || true)
[ "$n" = 1 ] && t_ok "E0【正控】自己種的那一列撈得到（1 行）⇒ 這函式不是永遠回空" \
  || t_bad "E0【正控】期望 1 行，實得 $n ⇒ 下面的 0 沒有意義"
authtoken_hashes "$E_UID" | grep -qF "$E_HASH" && t_ok "E0b 撈回來的 tokenHash 就是種進去那個（不是別人的列）" \
  || t_bad "E0b 撈回來的 tokenHash 對不上"
aws dynamodb delete-item --region "$REGION" --table-name "$AUTHTOKENS_TABLE" \
  --key "{\"tokenHash\":{\"S\":\"$E_HASH\"}}" >/dev/null 2>&1
n=$(authtoken_hashes "$E_UID" | grep -c . || true)
[ "$n" = 0 ] && t_ok "E0c 刪掉之後重撈 → 0 行（＝清理路徑本身走得通）" || t_bad "E0c 刪不掉，仍有 $n 行殘留"
n=$(authtoken_hashes "SELFTEST-NO-SUCH-USER-$(date +%s)" | grep -c . || true)
[ "$n" = 0 ] && t_ok "E1【反控】從沒存在過的 userId → 0 行" || t_bad "E1 期望 0 行，實得 $n"

echo "══ F. cleanup() 的接線：讀回說『還在』時，rc 有沒有真的變 2 ══"
FAKE_UID="SELFTEST-NOSUCH-$(date +%s)"   # 真的不存在 ⇒ 底下的 delete-item 是 no-op
run_cleanup(){   # $1=user_exists 回值  $2=flag_read 回的字串  $3=NEWUID 內容 → 印 rc
  ( BODYFILE=$(mktemp /tmp/mpst-b.XXXXXX); NEWUID_FILE=$(mktemp /tmp/mpst-u.XXXXXX)
    printf '%s' "$3" > "$NEWUID_FILE"
    eval "user_exists(){ return $1; }"
    eval "flag_read(){ printf '%s' '$2'; }"
    flag_del(){ :; }
    true; cleanup >/dev/null 2>&1 ); printf '%s' $?
}
r=$(run_cleanup 1 '' "$FAKE_UID"); [ "$r" = 0 ] && t_ok "F1【正控】讀回『不存在』＋旗標乾淨 → rc=0" || t_bad "F1 期望 rc=0，實得 $r"
r=$(run_cleanup 0 '' "$FAKE_UID"); [ "$r" = 2 ] && t_ok "F2 讀回『仍在表上』 → rc=2" || t_bad "F2 期望 rc=2，實得 $r"
r=$(run_cleanup 2 '' "$FAKE_UID"); [ "$r" = 2 ] && t_ok "F3 讀回『讀不出來』（不知道）→ rc=2，不可當成乾淨" || t_bad "F3 期望 rc=2，實得 $r"
r=$(run_cleanup 1 'true' "$FAKE_UID"); [ "$r" = 2 ] && t_ok "F4 旗標沒還原 → rc=2（2026-09-10 由 1 改成 2）" || t_bad "F4 期望 rc=2，實得 $r"
r=$(run_cleanup 0 '' ''); [ "$r" = 0 ] && t_ok "F5【反控】沒有 userId 時整段跳過 → rc=0（否則 F2 可能只是『它永遠回 2』）" || t_bad "F5 期望 rc=0，實得 $r"

echo ""
echo "══ 結果：$PASS 過／$FAILN 失敗 ══"
[ "$FAILN" = 0 ] || exit 1
echo "✅ 全部通過。⚠️ 界線：本支驗的是探針的管路（header/body/argv/清理接線），"
echo "   **不驗**『維護中公開 route 照常可用』那些結論 —— 那要真的翻旗標，只有本尊做得到。"
