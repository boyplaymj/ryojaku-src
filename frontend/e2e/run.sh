#!/usr/bin/env bash
# e2e/run.sh — 起 dev server → 跑瀏覽器實跑 → 收尾。用法：`npm run e2e`
#
# rc：0 全過／1 有測試沒過／2 腳本爆了／3 量不到（中途重載）／4 環境缺東西（playwright 找不到）
#     5 測試通過，但**收尾沒收乾淨**（port 沒釋放，或根本判不出來）
# 🔴 4 跟 1 不可混為一談：4 是「沒有儀器」，不是「量到失敗」。
# 🔴 5 為什麼要有自己的碼（2026-09-07 覆驗第二輪抓到）：原本收尾失敗只印一行 stderr，
#    rc 照樣是測試的 rc ⇒ **那道「port 一定放掉了」的保證沒有 exit code**，
#    而下一次撞 `--strictPort` 會看起來像「port 被別人佔著」。
#    ⚠️ 5 只在「測試本身通過」時才蓋上去 —— 測試紅了就保留 1/2/3/4，
#      那是更重要的訊號，不可以被收尾問題遮掉。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$(dirname "$HERE")"
PORT="${E2E_PORT:-5199}"
# 🔴 只留一份真值：dev server 的 VITE_API_BASE_URL 與腳本要 stub 的那個 URL 是**同一個**。
#    兩邊各寫一次的話，改了其中一邊 ⇒ T10 拿不到 profile、走不到 onCreate（會紅，不會靜默）。
API_BASE="http://127.0.0.1:$PORT/__e2e_no_backend"
# [A3-p] harness／spec 可由環境變數換掉，**預設值就是原本那一對** ——
# 加第二支驗收（編輯頁）時不必複製整支 run.sh，而 `npm run e2e` 的行為逐字不變。
# 🔴 生成檔名跟著 harness 走：兩支共用同一個 `_generated.harness.html` 的話，
#    並行或連跑時後者會覆蓋前者，而症狀是「跑到了另一支的頁面」——
#    畫面正常、斷言亂紅，最難查的那種。
HARNESS="${E2E_HARNESS:-e2e/createGroupWizard.harness.tsx}"
SPEC="${E2E_SPEC:-createGroupWizard.e2e.cjs}"
HARNESS_BASE="$(basename "$HARNESS" .harness.tsx)"
GEN="$HERE/_generated.$HARNESS_BASE.harness.html"
VITE_LOG="$(mktemp -t ryojaku-e2e-vite-XXXXXX.log)"
VITE_PID=""
VITE_PORT_PIDS=""

# 🔴 只 kill 那個背景 subshell 是**不夠的**：`( … npx vite … ) &` 的 npx／node 是它的
#    子孫，父行程死了它們會被 init 收養、繼續佔著 port（2026-09-06 實測，第一版就是這樣
#    留下一個孤兒 dev server —— 而腳本印的是 rc=0，外觀完全正常）。
#    ⇒ 收尾要連「真的佔著這個 port 的那些 pid」一起收。那份名單在啟動成功後才抓，
#      所以不會誤殺「port 本來就被別人佔著」那種情況（那種會在 --strictPort 直接起不來）。
# 「等到 port 真的釋放」那段住在隔壁，因為它的兩條失敗路徑在真實環境造不出來
# ⇒ 抽出去才有尺（`portwait.test.sh`，含把 ss／fuser 一起遮蔽的反控）。
#    ⚠️ 刻意不在這裡寫「幾條」—— 那個數字加一條測試就自動說謊，而且零徵兆。
#      要知道幾條就去跑它，它自己會把 `N 過 / M 紅` 印出來。
# 🔴 少了它就**不是** rc=5,是 rc=4。沒有守衛的話:source 失敗 ⇒ `wait_port_release`
#    變成 command not found(127)⇒ CLEANUP_STATE=127 ⇒ 回 rc=5「收尾沒收乾淨」——
#    而真相是「沒有儀器」。同一個 rc 講兩件不同的事,查的方向就錯了。
. "$HERE/portwait.sh" || {
  echo "❌ [設備] 載入不了 $HERE/portwait.sh —— 收尾的 port 判定整段不存在。" >&2
  echo "   （rc=4 是『沒有儀器』;這種情況**不可以**回 rc=5,那是另一件事。）" >&2
  exit 4
}

# 🔴 「有沒有起過 server」用**自己的旗標**，不要用 `VITE_PORT_PIDS` 當代理：
#    後者是 `fuser` 的產物，fuser 一不可用它就是空的 ⇒ 等待整段被跳過，
#    而那正是最需要等的時候（實測遮蔽 fuser：rc=0、全綠、零警告、port 還在監聽）。
VITE_STARTED=0
CLEANUP_STATE=0     # 0=乾淨 1=等不到 2=判不出來

cleanup() {
  local exit_rc=$?
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
  [ -n "$VITE_PORT_PIDS" ] && kill $VITE_PORT_PIDS 2>/dev/null
  rm -f "$GEN"

  # 🔴 `kill` 只是「送出訊號」，不是「已經退出」。實測（2026-09-07，覆驗者抓到）：
  #    腳本回 rc 的那一刻 **6/6 次 port 都還在監聽**，約 0.1 秒後才消失。
  #    不是孤兒（它會自己走完），但「rc 回來了」與「port 已釋放」是兩件事 ——
  #    緊接著重跑就會撞 `--strictPort`，而那個失敗看起來會像「port 被別人佔著」。
  if [ "$VITE_STARTED" = 1 ]; then
    wait_port_release "$PORT" "$VITE_PORT_PIDS"
    CLEANUP_STATE=$?
    case "$CLEANUP_STATE" in
      # 診斷也走 `port_pids`（ss 優先），不要退回裸 `fuser` —— 收尾判定已經是多來源了，
      # 這一行還單押 fuser 的話，最需要線索的那種環境（沒有 fuser）剛好印不出東西。
      1) echo "⚠️ [e2e] 收尾後 port $PORT 仍被佔著（SIGKILL 之後又等了 3 秒）。占用者：$(port_pids "$PORT")" >&2 ;;
      2) echo "⚠️ [e2e] 判不出 port $PORT 的狀態（ss 與 fuser 都問不出來）—— 這**不是**「已經放掉了」。" >&2 ;;
    esac
  fi

  # 🔴 vite 的 log 是 `mktemp` 出來的,原本**從來沒有人刪它** —— 實測累積到 402 個檔,
  #    而 TMPDIR 是 /opt/sml/.buildtmp（真的硬碟,不是 tmpfs ⇒ 重開機也不會消失）。
  #    ⚠️ 但不可以無條件刪:rc≠0 時它是唯一的線索。⇒ 只在「全乾淨」時刪,否則印出路徑。
  if [ "$exit_rc" = 0 ] && [ "$CLEANUP_STATE" = 0 ]; then
    rm -f "$VITE_LOG"
  else
    echo "[e2e] vite log 留著（rc=$exit_rc cleanup=$CLEANUP_STATE）：$VITE_LOG" >&2
  fi

  # 🔴 收尾失敗必須影響 rc，否則那道保證沒有 exit code（見檔頭 rc=5）。
  #    只在測試本身通過時蓋上去：測試紅了保留原本的 1/2/3/4。
  if [ "$exit_rc" = 0 ] && [ "$CLEANUP_STATE" != 0 ]; then
    echo "[e2e] rc=5（測試通過，但收尾沒收乾淨：CLEANUP_STATE=$CLEANUP_STATE）" >&2
    trap - EXIT      # 免得 exit 又觸發一次自己
    exit 5
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
if [ ! -f "$FRONTEND/$HARNESS" ]; then
  echo "❌ [設備] 找不到 harness：$FRONTEND/$HARNESS" >&2
  exit 4
fi
sed "s#src=\"/index.tsx\"#src=\"/$HARNESS\"#" "$FRONTEND/index.html" > "$GEN"
grep -q "$HARNESS" "$GEN" || { echo "❌ [設備] harness html 生成後找不到新入口。" >&2; exit 4; }

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
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/e2e/$(basename "$GEN")"; then break; fi
  sleep 1
done
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/e2e/$(basename "$GEN")"; then
  echo "❌ [設備] dev server 起不來（60 秒）。log：" >&2
  tail -20 "$VITE_LOG" >&2
  exit 4
fi
VITE_PORT_PIDS="$(port_pids "$PORT")"
VITE_STARTED=1

# ── 4. 跑
echo "[e2e] 開跑"
if [ ! -f "$HERE/$SPEC" ]; then
  echo "❌ [設備] 找不到 spec：$HERE/$SPEC" >&2
  exit 4
fi
NODE_PATH="$PW_NODE_PATH" E2E_PORT="$PORT" E2E_API_BASE="$API_BASE" \
  E2E_HARNESS_URL="/e2e/$(basename "$GEN")" node "$HERE/$SPEC"
RC=$?

echo "[e2e] rc=$RC"
if [ "$RC" = "3" ]; then
  echo "[e2e] dev server 那頭的重載紀錄："
  grep -n 'reloading\|optimized' "$VITE_LOG" || echo "  （vite log 沒有重載紀錄 —— 重載來源要另外查）"
fi
exit $RC
