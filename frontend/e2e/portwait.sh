#!/usr/bin/env bash
# e2e/portwait.sh —— 「等到 port 真的釋放」那段邏輯，抽出來讓它可以被單獨測試。
#
# 為什麼要抽出來（2026-09-07，覆驗第二輪）：這段原本寫在 run.sh 的 `cleanup()` 裡，
# 而它的兩條失敗路徑（等不到／探測不出來）**在真實環境裡造不出來** ——
# 要讓「自己起的 dev server 在 SIGTERM＋SIGKILL 之後 8 秒還佔著 port」是不可能的。
# ⇒ 那兩條分支永遠不會被執行到，於是「寫對了」與「寫成恆真」在結果上逐字相同。
# 抽成函式＋可注入的探測器之後，它們就有尺了（`portwait.test.sh`）。
#
# 🔴 探測是**三態**，不是布林：busy／free／**unknown**。
#    原本用 `fuser "$PORT/tcp" >/dev/null 2>&1` 的 rc 當布林 ——
#    fuser 不可用（rc=127）、權限不足、任何 fatal error **全都被讀成「port 空著」**。
#    實測（遮蔽 fuser）：rc=0、11/11 全綠、零警告，而**跑完 port 還在監聽**。
#    那是 fail-open，而且外觀與正常完全相同。
#    ⇒ 判不出來就回 unknown，由呼叫端 fail-closed。
#
# ⚠️ 誠實的限制：`fuser` 的 rc=1 同時代表「沒有行程使用」與部分錯誤，man page 沒有
#    給它們不同的碼 ⇒ 走 fuser 這條路時，free 與某些錯誤仍然分不開。
#    所以**優先用 `ss`**（它的 rc 有意義），fuser 只是退路。

# 可注入（測試用）：吃 <port>，印 busy|free|unknown
PORT_PROBE_CMD="${PORT_PROBE_CMD:-}"
# 可注入（測試用）：吃 <signal> <pid...>
PORT_KILL_CMD="${PORT_KILL_CMD:-}"
PORTWAIT_TICK="${PORTWAIT_TICK:-0.1}"
PORTWAIT_GRACE_TICKS="${PORTWAIT_GRACE_TICKS:-50}"   # 5 秒
PORTWAIT_KILL_TICKS="${PORTWAIT_KILL_TICKS:-30}"     # SIGKILL 之後再 3 秒

port_probe() {
  local p="$1" out rc
  # 🔴 一律用 `${X:-}` 展開：呼叫端可能 `set -u` 且沒設這兩個變數（測試裡 unset 過就炸過一次）。
  if [ -n "${PORT_PROBE_CMD:-}" ]; then "$PORT_PROBE_CMD" "$p"; return 0; fi

  if command -v ss >/dev/null 2>&1; then
    out="$(ss -ltnH "sport = :$p" 2>/dev/null)"; rc=$?
    if [ "$rc" -eq 0 ]; then
      [ -n "$out" ] && echo busy || echo free
      return 0
    fi
    # ss 在但跑失敗 ⇒ 不敢說 free，往下試 fuser
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser "$p/tcp" >/dev/null 2>&1
    case $? in
      0) echo busy; return 0 ;;
      1) echo free; return 0 ;;   # ⚠️ 見檔頭：這個 1 與部分錯誤分不開
      *) : ;;
    esac
  fi

  echo unknown
}

# port_pids <port> —— 印出佔著這個 port 的 pid（空白分隔）。判不出來就印空字串。
# 🔴 也要多來源，理由與 port_probe 同一個：原本只有 `fuser`，而**取 pid 與判狀態
#    共用同一個工具** ⇒ fuser 一不可用，「拿不到 pid」與「port 是空的」一起發生，
#    於是收不掉那個被 init 收養的 npx/node，而外觀完全正常。
#    實測（只遮蔽 fuser、ss 仍可用）：修好 port_probe 之後這個情況會回 rc=5 並留下
#    一個佔著 port 的孤兒 —— 那是**正確的回報**，但能收掉更好。
port_pids() {
  local p="$1" out
  if [ -n "${PORT_PIDS_CMD:-}" ]; then "$PORT_PIDS_CMD" "$p"; return 0; fi
  if command -v ss >/dev/null 2>&1; then
    out="$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | tr '\n' ' ')"
    if [ -n "$out" ]; then echo "$out"; return 0; fi
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser "$p/tcp" 2>/dev/null | tr -s ' '
    return 0
  fi
  echo ""
}

port_kill() {   # $1=signal, 其餘=pids
  local sig="$1"; shift
  [ $# -eq 0 ] && return 0
  if [ -n "${PORT_KILL_CMD:-}" ]; then "$PORT_KILL_CMD" "$sig" "$@"; return 0; fi
  kill "$sig" "$@" 2>/dev/null
  return 0
}

# wait_port_release <port> "<pids>"
#   rc 0 = 已釋放   1 = 等不到（SIGKILL 之後仍佔著）   2 = 判不出來（fail-closed）
wait_port_release() {
  local port="$1" pids="${2:-}" waited=0 st
  while [ "$waited" -lt "$PORTWAIT_GRACE_TICKS" ]; do
    st="$(port_probe "$port")"
    [ "$st" = free ] && return 0
    [ "$st" = unknown ] && return 2
    sleep "$PORTWAIT_TICK"; waited=$((waited+1))
  done

  # 寬限期用完 ⇒ 升級。🔴 只殺「啟動成功後記錄下來的那些 pid」，不碰別人的。
  # shellcheck disable=SC2086
  port_kill -9 $pids

  waited=0
  while [ "$waited" -lt "$PORTWAIT_KILL_TICKS" ]; do
    st="$(port_probe "$port")"
    [ "$st" = free ] && return 0
    [ "$st" = unknown ] && return 2
    sleep "$PORTWAIT_TICK"; waited=$((waited+1))
  done
  return 1
}
