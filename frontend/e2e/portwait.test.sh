#!/usr/bin/env bash
# e2e/portwait.test.sh —— portwait.sh 的正控與反控。用法：bash e2e/portwait.test.sh
#
# 🔴 這份存在的理由：`wait_port_release` 的兩條失敗路徑在真實環境裡造不出來
#    （要「自己起的 dev server 在 SIGTERM＋SIGKILL 之後 8 秒還佔著 port」）。
#    沒有這份的話，「寫對了」與「寫成恆真」在結果上逐字相同。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "✅ $1（$3）"; else FAIL=$((FAIL+1)); echo "❌ $1 — 期望 $3，實得 $2"; fi; }

export PORTWAIT_TICK=0.01 PORTWAIT_GRACE_TICKS=3 PORTWAIT_KILL_TICKS=2

# 假探測器：吃 /tmp 檔裡的腳本序列，每次呼叫吐一行
STATE="$(mktemp -d)"
trap 'rm -rf "$STATE"' EXIT
cat > "$STATE/probe" <<'EOF'
#!/usr/bin/env bash
seq_file="$PROBE_SEQ"; n_file="$PROBE_N"
n=$(cat "$n_file" 2>/dev/null || echo 0)
line=$(sed -n "$((n+1))p" "$seq_file")
[ -z "$line" ] && line=$(tail -1 "$seq_file")   # 用完就重複最後一個
echo $((n+1)) > "$n_file"
echo "$line"
EOF
cat > "$STATE/kill" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$KILL_LOG"
EOF
chmod +x "$STATE/probe" "$STATE/kill"
export PORT_PROBE_CMD="$STATE/probe" PORT_KILL_CMD="$STATE/kill"
export PROBE_SEQ="$STATE/seq" PROBE_N="$STATE/n" KILL_LOG="$STATE/killlog"

reset() { printf '%s\n' "$@" > "$PROBE_SEQ"; : > "$PROBE_N"; : > "$KILL_LOG"; }

. "$HERE/portwait.sh"

# ── T1 一開始就 free ⇒ rc 0，而且**不該**動用 SIGKILL
reset free
wait_port_release 5199 "111 222"; rc=$?
ok "T1 一開始就 free → rc 0" "$rc" 0
ok "T1 沒有升級 SIGKILL（正控：這條若也殺，T3 的殺傷就沒有意義）" "$(wc -l < "$KILL_LOG")" 0

# ── T2 前兩次 busy、之後 free ⇒ 還是 rc 0（等得到）
reset busy busy free
wait_port_release 5199 "111"; rc=$?
ok "T2 busy,busy,free → rc 0" "$rc" 0
ok "T2 也不該升級 SIGKILL" "$(wc -l < "$KILL_LOG")" 0

# ── T3 永遠 busy ⇒ 升級 SIGKILL、最終 rc 1
reset busy
wait_port_release 5199 "111 222"; rc=$?
ok "T3 永遠 busy → rc 1（等不到）" "$rc" 1
ok "T3 有升級 SIGKILL 且帶上那些 pid" "$(cat "$KILL_LOG")" "-9 111 222"

# ── T4 判不出來 ⇒ rc 2（fail-closed），且**不**亂殺
reset unknown
wait_port_release 5199 "111"; rc=$?
ok "T4 unknown → rc 2（fail-closed，不是當成 free）" "$rc" 2
ok "T4 不該殺任何東西（判不出來就不動手）" "$(wc -l < "$KILL_LOG")" 0

# ── T5 unknown 出現在寬限期用完之後 ⇒ 仍然是 2，不可以被 rc 1 蓋掉
reset busy busy busy unknown
wait_port_release 5199 "111"; rc=$?
ok "T5 升級後才 unknown → rc 2（不明優先於「等不到」）" "$rc" 2

# ── T6/T7 真的探一次（不注入）：沒人用的 port → free；自己起一個 listener → busy
unset PORT_PROBE_CMD
FREE_PORT=5391
ok "T6 沒人用的 port → free" "$(port_probe $FREE_PORT)" free
python3 -c "
import socket,time,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(('127.0.0.1',$FREE_PORT)); s.listen(1)
sys.stderr.write('up\n'); sys.stderr.flush(); time.sleep(6)
" 2>/dev/null &
LISTENER=$!
sleep 1
ok "T7 自己起一個 listener → busy（正控：少了它，T6 的 free 可能只是恆真）" "$(port_probe $FREE_PORT)" busy
kill $LISTENER 2>/dev/null; wait $LISTENER 2>/dev/null

# ── T9/T10 port_pids：真的起一個 listener，要抓得到它的 pid（而且是**那一個**）
python3 -c "
import socket,time,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(('127.0.0.1',$FREE_PORT)); s.listen(1)
time.sleep(6)
" &
L2=$!
sleep 1
GOT="$(port_pids $FREE_PORT | tr -d ' ')"
ok "T9 port_pids 抓得到那個 listener 的 pid" "$GOT" "$L2"
kill $L2 2>/dev/null; wait $L2 2>/dev/null
sleep 0.3
ok "T10 反控：listener 走了之後 port_pids 是空的（少了它，T9 可能只是恆真）" "$(port_pids $FREE_PORT | tr -d ' ')" ""

# ── T8 兩個探測工具都不可用 ⇒ unknown（不是 free）
BINDIR="$(mktemp -d)"
ok "T8 ss 與 fuser 都不可用 → unknown" "$(PATH="$BINDIR" /bin/bash -c ". '$HERE/portwait.sh'; port_probe 5391")" unknown
rm -rf "$BINDIR"

echo
echo "=== portwait: $PASS 過 / $FAIL 紅 ==="
[ "$FAIL" -eq 0 ]
