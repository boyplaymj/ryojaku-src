#!/usr/bin/env bash
# 維護提示的 WS 那一半（B3-f）—— 突變測試（可重跑的鑑別力證據）。
#
# 為什麼要有這支：`go test` / `run-tests.mjs` 全綠只證明「目前沒壞」，
# 不證明「壞了會被抓到」。這支逐條把守住的行為破壞掉，要求對應測試由綠轉紅。
#
# 跑法：bash infra/mutation_ws_maintenance.sh
# 退出碼：0=五發都被預期的那條測試殺掉 / 1=有存活或量測器壞掉 / 2=基準線就不綠
#
# 🔴 每一發都要回答三個問題，缺一不可：
#   ①真的改到了嗎（替換次數必須是 1；改不到就是設備問題，不是「突變成立」）
#   ②改完還是合法程式嗎（編不過的突變體 ≡ 被殺掉的突變體，外觀完全相同）
#   ③紅的是**哪一條**（「有沒有紅」零鑑別力 —— 可能只是撞到別的守衛）
#
# 🔴 2026-09-02 的教訓寫在 fails_frontend 上面：本腳本第一版用 TAP 的 `not ok`
#    抓失敗，而 runner 已被改成 spec reporter ⇒ 0 命中被讀成「沒有失敗」，
#    三發真的殺掉測試的突變全被報成「存活」。所以兩支 fails_* 都改成
#    **拿 rc 交叉比對**：rc 與抓到的名字對不起來就喊 __METER_BROKEN__。
#
# ⚠️ 本腳本會就地改寫原始碼再還原。所有結束路徑（含 Ctrl-C）都 trap 還原，
#    結尾另有 MUTANT_PROBE 殘留檢查與 git status 確認。
# 每一發都要回答三個問題，缺一不可：
#   ①真的改到了嗎（替換次數必須是 1）
#   ②改完還是合法程式嗎（編不過的突變體 ≡ 被殺掉的突變體，外觀相同）
#   ③紅的是**哪一條**（「有沒有紅」零鑑別力：可能撞到別的守衛）
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN=backend/cmd/lambdas/apis/mahjongclub_chat_ws_send_message/main.go
SIG=frontend/utils/maintenanceSignal.ts
GOPKG=./cmd/lambdas/apis/mahjongclub_chat_ws_send_message/
export TMPDIR=/opt/sml/.buildtmp

restore() { git -C "$SRC" checkout -- "$MAIN" "$SIG" 2>/dev/null; }
trap restore EXIT INT TERM

# --- 替換器：改不到就 rc=2（設備問題），不可讀成「突變成立」 ----------------
apply() {  # apply <file> <old> <new>
  python3 - "$SRC/$1" "$2" "$3" <<'PY'
import sys, io
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(path, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print(f"APPLY-FAIL 替換次數={n}（必須是 1）", file=sys.stderr); sys.exit(2)
io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
print("APPLY-OK")
PY
}

fails_backend() {
  local out rc names
  out=$( cd "$SRC/backend" && ALLOW_DEV_JWT_SECRET=true go test -count=1 "$GOPKG" 2>&1 ); rc=$?
  names=$(printf '%s\n' "$out" | grep -oE '^[[:space:]]*--- FAIL: [A-Za-z]+' | sed 's/.*FAIL: //' | sort -u)
  if [ "$rc" -ne 0 ] && [ -z "$names" ]; then echo "__METER_BROKEN__ rc=$rc 但抓不到任何失敗名"; return; fi
  if [ "$rc" -eq 0 ] && [ -n "$names" ]; then echo "__METER_BROKEN__ rc=0 但抓到失敗名"; return; fi
  printf '%s\n' "$names"
}
compiles_backend() { ( cd "$SRC/backend" && go build ./cmd/... >/dev/null 2>&1 ); }

# 🔴 這支第一版是壞的，壞法值得留著：它 grep TAP 的 `not ok`，而 runner 已被
#    改成 spec reporter（✖ / ℹ fail N）⇒ 0 命中被讀成「沒有失敗」，於是三發真的
#    殺掉測試的突變全被報成「存活」。空輸出與全過在那支尺上逐字相同。
#    修法不只是換 pattern，是**把 rc 拿來交叉比對**：rc 與抓到的名字不一致 ⇒ 尺壞了。
fails_frontend() {
  local out rc names
  out=$( cd "$SRC/frontend" && node scripts/run-tests.mjs 2>&1 ); rc=$?
  names=$(printf '%s\n' "$out" | grep -E '^[[:space:]]*✖ ' | grep -v 'failing tests' \
          | sed -E 's/^[[:space:]]*✖ //; s/ \([0-9.]+ms\)$//' | sort -u)
  if [ "$rc" -ne 0 ] && [ -z "$names" ]; then echo "__METER_BROKEN__ rc=$rc 但抓不到任何失敗名"; return; fi
  if [ "$rc" -eq 0 ] && [ -n "$names" ]; then echo "__METER_BROKEN__ rc=0 但抓到失敗名"; return; fi
  printf '%s\n' "$names"
}
compiles_frontend() { ( cd "$SRC/frontend" && npx tsc --noEmit >/dev/null 2>&1 ); }

# --- 基準線：必須全綠，否則後面每一發都沒有意義 ----------------------------
echo "===== 基準線 ====="
b=$(fails_backend); f=$(fails_frontend)
[ -z "$b" ] && echo "  後端 0 fail ✓" || { echo "  🔴 後端基準線就有紅：$b"; exit 2; }
[ -z "$f" ] && echo "  前端 0 fail ✓" || { echo "  🔴 前端基準線就有紅：$f"; exit 2; }

pass=0; fail=0
probe() {  # probe <名稱> <backend|frontend> <file> <old> <new> <預期紅的關鍵字>
  local name="$1" side="$2" file="$3" old="$4" new="$5" want="$6"
  echo
  echo "===== $name ====="
  restore
  if ! apply "$file" "$old" "$new" >/dev/null 2>&1; then
    echo "  🔴 [設備] 替換失敗 —— 這一發不算突變，不可讀成通過"; fail=$((fail+1)); return
  fi
  echo "  ①替換成立"
  if [ "$side" = backend ]; then
    if compiles_backend; then echo "  ②仍可編譯"; else
      echo "  🔴 [設備] 突變體編不過 —— 它會讓測試紅得像被殺掉"; fail=$((fail+1)); return; fi
    got=$(fails_backend)
  else
    if compiles_frontend; then echo "  ②型別仍通過"; else
      echo "  🔴 [設備] 突變體 tsc 不過"; fail=$((fail+1)); return; fi
    got=$(fails_frontend)
  fi
  if echo "$got" | grep -q '__METER_BROKEN__'; then
    echo "  🔴 [設備] 量測器自己壞了：$got —— 這一發沒有結論，不可讀成存活也不可讀成殺掉"
    fail=$((fail+1)); return
  fi
  if [ -z "$got" ]; then
    echo "  🔴 存活：沒有任何測試轉紅 ⇒ 這個行為沒有守衛"; fail=$((fail+1)); return
  fi
  echo "  ③轉紅的是："; echo "$got" | sed 's/^/     - /'
  if echo "$got" | grep -q -- "$want"; then
    echo "  ✅ 殺掉，且紅的正是預期那條（含「$want」）"; pass=$((pass+1))
  else
    echo "  🔴 紅了，但**不是**預期那條（預期含「$want」）⇒ 撞到別的守衛，我的斷言仍未被考驗"
    fail=$((fail+1))
  fi
}

# ── M1 後端：把推送整行拿掉（原始缺陷本身） ────────────────────────────────
probe "M1 後端·拿掉維護提示推送" backend "$MAIN" \
'		notifySenderBlocked(ctx, request.RequestContext.ConnectionID)
' '		// MUTANT_PROBE: 推送被拿掉
' 'TestHandlerMaintenanceModeBlocksExistingConnection'

# ── M2 後端：把推送移到維護分支外面（每則訊息都推） ────────────────────────
probe "M2 後端·推送移出維護分支" backend "$MAIN" \
'	if maintenanceCheck(ctx) {
		log.Printf("[chat-ws-send-message] 維護模式（kill switch）開啟，拒絕發言 conn=%s", request.RequestContext.ConnectionID)
		notifySenderBlocked(ctx, request.RequestContext.ConnectionID)
' '	notifySenderBlocked(ctx, request.RequestContext.ConnectionID) // MUTANT_PROBE: 移出分支
	if maintenanceCheck(ctx) {
		log.Printf("[chat-ws-send-message] 維護模式（kill switch）開啟，拒絕發言 conn=%s", request.RequestContext.ConnectionID)
' 'TestHandlerMaintenanceOffFallsThrough'

# ── M3 前端：系統幀不再被吞掉（會漏進 ChatContext 觸發 fetchRooms） ────────
probe "M3 前端·系統幀不吞掉" frontend "$SIG" \
'    return { consumed: true, event: raise ? MAINTENANCE_EVENT : null };' \
'    return { consumed: false, event: raise ? MAINTENANCE_EVENT : null }; /*MUTANT_PROBE*/' \
'吞掉'

# ── M4 前端：解除不再比對是不是自己發的 ────────────────────────────────────
probe "M4 前端·回音不比對 senderId" frontend "$SIG" \
'  if (data?.senderId && data.senderId === selfUserId && noteMaintenanceOver()) {' \
'  if (data?.senderId && noteMaintenanceOver()) { /*MUTANT_PROBE*/' \
'別人的訊息不算解除'

# ── M5 前端：把強訊號降級成 noteOk 的語意（要求同一條路曾被擋） ────────────
probe "M5 前端·強訊號降級成同路徑才解除" frontend "$SIG" \
'export function noteMaintenanceOver(): boolean {
  if (blockedPaths.size === 0) return false;
' 'export function noteMaintenanceOver(): boolean {
  if (blockedPaths.size === 0) return false;
  if (!blockedPaths.has(WS_SEND_PATH)) return false; /*MUTANT_PROBE*/
' '強訊號'

restore
echo
echo "===== 結果 ====="
echo "殺掉 $pass / 存活或設備問題 $fail"
echo "=== 殘留檢查（必須是 0；harness 被砍時突變體會留在工作樹）==="
grep -rn 'MUTANT_PROBE' "$SRC/$MAIN" "$SRC/$SIG" | wc -l
git -C "$SRC" status --short "$MAIN" "$SIG"
echo "END-OF-MUTATION"
[ "$fail" -eq 0 ]
