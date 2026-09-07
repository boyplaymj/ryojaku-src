#!/usr/bin/env bash
# e2e/run.sh — 起 dev server → 跑瀏覽器實跑 → 收尾。用法：`npm run e2e`
#
# rc：0 全過／1 有測試沒過／2 腳本爆了／3 量不到（中途重載）／4 環境缺東西（playwright 找不到）
# 🔴 4 跟 1 不可混為一談：4 是「沒有儀器」，不是「量到失敗」。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$(dirname "$HERE")"
PORT="${E2E_PORT:-5199}"
# 🔴 只留一份真值：dev server 的 VITE_API_BASE_URL 與腳本要 stub 的那個 URL 是**同一個**。
#    兩邊各寫一次的話，改了其中一邊 ⇒ T10 拿不到 profile、走不到 onCreate（會紅，不會靜默）。
API_BASE="http://127.0.0.1:$PORT/__e2e_no_backend"
GEN="$HERE/_generated.harness.html"
VITE_LOG="$(mktemp -t ryojaku-e2e-vite-XXXXXX.log)"
VITE_PID=""
VITE_PORT_PIDS=""

# 🔴 只 kill 那個背景 subshell 是**不夠的**：`( … npx vite … ) &` 的 npx／node 是它的
#    子孫，父行程死了它們會被 init 收養、繼續佔著 port（2026-09-06 實測，第一版就是這樣
#    留下一個孤兒 dev server —— 而腳本印的是 rc=0，外觀完全正常）。
#    ⇒ 收尾要連「真的佔著這個 port 的那些 pid」一起收。那份名單在啟動成功後才抓，
#      所以不會誤殺「port 本來就被別人佔著」那種情況（那種會在 --strictPort 直接起不來）。
port_busy() { fuser "$PORT/tcp" >/dev/null 2>&1; }

cleanup() {
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
  [ -n "$VITE_PORT_PIDS" ] && kill $VITE_PORT_PIDS 2>/dev/null
  rm -f "$GEN"

  # 🔴 `kill` 只是「送出訊號」，不是「已經退出」。實測（2026-09-07，覆驗者抓到）：
  #    腳本回 rc 的那一刻 **6/6 次 port 都還在監聽**，約 0.1 秒後才消失。
  #    不是孤兒（它會自己走完），但「rc 回來了」與「port 已釋放」是兩件事 ——
  #    緊接著重跑就會撞 `--strictPort`，而那個失敗看起來會像「port 被別人佔著」。
  #    ⇒ 等到它真的釋放為止。5 秒不放就升級 SIGKILL，再 3 秒仍不放就**印警告**
  #      （靜默的話，下一次那個莫名其妙的 rc=4 就沒有線索）。
  #    ⚠️ 只在「我們真的起過 server」時才等：早退時 port 上那個是別人的，
  #      空等 8 秒再警告只會製造假訊號。
  if [ -n "$VITE_PORT_PIDS" ]; then
    waited=0
    while port_busy && [ "$waited" -lt 50 ]; do sleep 0.1; waited=$((waited+1)); done
    if port_busy; then
      kill -9 $VITE_PORT_PIDS 2>/dev/null
      [ -n "$VITE_PID" ] && kill -9 "$VITE_PID" 2>/dev/null
      waited=0
      while port_busy && [ "$waited" -lt 30 ]; do sleep 0.1; waited=$((waited+1)); done
    fi
    if port_busy; then
      echo "⚠️ [e2e] 收尾後 port $PORT 仍被佔著（SIGKILL 之後又等了 3 秒）——" >&2
      echo "   下一次重跑會撞 --strictPort 而回 rc=4。占用者：$(fuser "$PORT/tcp" 2>&1 | tr -s ' ')" >&2
    fi
  fi
}
trap cleanup EXIT

# ── 1. 從 index.html **現生** harness 頁面
# 🔴 刻意不把這個 html 提交進版控：它是 index.html 的衍生物（tailwind CDN 設定、
#    leaflet、全域樣式都在裡面）。存一份靜態副本的話，index.html 一改它就靜靜過期，
#    而「過期的 harness」與「正常的 harness」在畫面上長得一模一樣。
if ! grep -q 'src="/index.tsx"' "$FRONTEND/index.html"; then
  echo "❌ [設備] index.html 裡找不到 src=\"/index.tsx\" 這個錨點 —— 入口改過了，harness 生不出來。" >&2
  echo "   請先確認新的入口路徑，再改本腳本的 sed 樣式。不敢猜就不敢跑。" >&2
  exit 4
fi
sed 's#src="/index.tsx"#src="/e2e/createGroupWizard.harness.tsx"#' "$FRONTEND/index.html" > "$GEN"
grep -q 'e2e/createGroupWizard.harness.tsx' "$GEN" || { echo "❌ [設備] harness html 生成後找不到新入口。" >&2; exit 4; }

# ── 2. 找 playwright
#    本機它住在 npx 快取裡（不在任何 node_modules），所以要自己找。
PW_NODE_PATH=""
if ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  for d in "$HOME"/.npm/_npx/*/node_modules; do
    if [ -d "$d/playwright" ]; then PW_NODE_PATH="$d"; break; fi
  done
  if [ -z "$PW_NODE_PATH" ]; then
    echo "❌ [設備] 找不到 playwright。裝法：npx playwright install chromium" >&2
    echo "   （rc=4 的意思是『沒有儀器』，不是『量到失敗』。）" >&2
    exit 4
  fi
fi

# ── 3. 起 dev server
# 🔴 VITE_API_BASE_URL 指向本機死路：`services/apiService.ts` 是 fail-closed，
#    沒設就整個 app 起不來；設成正式位址則會讓這份驗收去戳真後端。
#    Playwright 那端另有一道「非本機請求一律 abort」，兩道獨立。
echo "[e2e] 起 dev server（port $PORT，log: $VITE_LOG）"
(
  cd "$FRONTEND" || exit 1
  VITE_API_BASE_URL="$API_BASE" \
    npx vite --port "$PORT" --strictPort --host 127.0.0.1 >"$VITE_LOG" 2>&1
) &
VITE_PID=$!

for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/e2e/_generated.harness.html"; then break; fi
  sleep 1
done
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/e2e/_generated.harness.html"; then
  echo "❌ [設備] dev server 起不來（60 秒）。log：" >&2
  tail -20 "$VITE_LOG" >&2
  exit 4
fi
VITE_PORT_PIDS="$(fuser "$PORT/tcp" 2>/dev/null | tr -s ' ')"

# ── 4. 跑
echo "[e2e] 開跑"
NODE_PATH="$PW_NODE_PATH" E2E_PORT="$PORT" E2E_API_BASE="$API_BASE" node "$HERE/createGroupWizard.e2e.cjs"
RC=$?

echo "[e2e] rc=$RC"
if [ "$RC" = "3" ]; then
  echo "[e2e] dev server 那頭的重載紀錄："
  grep -n 'reloading\|optimized' "$VITE_LOG" || echo "  （vite log 沒有重載紀錄 —— 重載來源要另外查）"
fi
exit $RC
