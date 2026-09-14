#!/usr/bin/env bash
# 部署 Console（両雀後台）到 S3 + CloudFront。設計冊 tools/ryojaku-admin-migration/DESIGN.md P4 / D1 / D6。
#
# ⚠️ API 位址是「唯一真實來源在這裡」。repo 的 .gitignore 刻意擋掉 .env.*（機密規則，不開洞），
#    所以不放 .env.staging；改由本腳本以 shell 環境變數注入 —— Vite 會直接讀 VITE_ 開頭的變數。
#    api.ts 缺這個變數時會直接 throw（fail-closed），不會退回任何預設位址。
#
# 用法：./deploy.sh [stg]     （目前只有 stg；prod 待 D5/D7 拍板後再開）
set -euo pipefail
cd "$(dirname "$0")"

ENV=${1:-stg}
case "$ENV" in
  stg)
    # 結尾必須帶 stage 路徑 /stg —— api.ts 是 BASE_URL + '/admin/...' 串接的，漏掉會整片 403。
    API_BASE="https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg"
    S3_PREFIX="s3://boyplaymj-image/ryojaku-console/"
    DIST_ID="E36SRAMFE1PZRD"
    URL="https://ryojaku-console.boyplaymj.com"
    ;;
  *)
    echo "❌ 未知環境 '$ENV'（目前只支援 stg）" >&2; exit 1 ;;
esac

echo "▶ 環境=$ENV  API=$API_BASE"

# 🔴 D5-c2 家規台數表：**出貨前先問「DDB 那一列跟得上嗎」**
#    （正典 /opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c 紀律 4）。
#    允許的狀態是 DDB.version >= 這包 bundle 的 version（播種比發版快）；
#    反過來代表**忘了播種** —— App 會抓到 DDB 那份舊表，而玩家看到的台數就是錯的。
#
# 🔴 接在**這裡**的理由：「bundle 比 DDB 新」這件事在 s3 sync 那一刻才成真，
#    而這支是它必然經過的路。放在 npm ci 之前是為了 fail fast
#    （也讓「被擋下」那條路可以端到端實測而不會真的動到線上）。
#
# 🔴 量的是 src/engine/mahjong-tai/fan_table.json（後台） —— **build 的輸入**，不是 dist 裡那份。
#    兩者之間隔著 vite。這個界線是真的，不要讀成「dist 已經驗過」。
#
# ⚠️ preview 與 stg 共用同一套後端（見上面 case 那段）⇒ 都對 stg 那張表。
# ⚠️ 守衛在另一個 repo。找不到就**中止**，不是跳過 —— 靜默跳過的守衛
#    與從沒裝過長得一模一樣。臨時豁免：SKIP_RULESET_SEED_CHECK=1（顯式）。
RULESET_GUARD="${RULESET_GUARD:-/opt/sml/repo/tools/mahjong-tai/check_ruleset_seeded.py}"
if [ "${SKIP_RULESET_SEED_CHECK:-0}" = "1" ]; then
  echo "⚠️  SKIP_RULESET_SEED_CHECK=1 ⇒ 跳過家規表播種檢查（顯式豁免）"
elif [ ! -f "$RULESET_GUARD" ]; then
  echo "❌ 找不到家規表守衛 $RULESET_GUARD" >&2
  echo "   它在另一個 repo（sml/tools/mahjong-tai）。要換路徑用 RULESET_GUARD=..." >&2
  echo "   確定要跳過：SKIP_RULESET_SEED_CHECK=1 $0 $*" >&2
  exit 1
else
  rgrc=0
  python3 "$RULESET_GUARD" --stage stg --table-json "$(pwd)/src/engine/mahjong-tai/fan_table.json" || rgrc=$?
  case "$rgrc" in
    0) ;;
    1|3) echo "❌ 家規台數表：DDB 那一列跟不上這包 bundle（判定與修法見上方），中止部署" >&2; exit 1 ;;
    *)   echo "❌ 家規台數表守衛**沒量到**（rc=$rgrc，設備問題）—— 讀數作廢，不是「沒問題」，一樣中止" >&2; exit 1 ;;
  esac
fi

# 🔴 用**受支援的** Node 來 build（2026-09-14 補）。
#    起因是量出來的：這支腳本先前直接用 PATH 上的 node，而 SML 主機的
#    /usr/bin/node 是 **18.20.8**，Vite 7 明講要 20.19+ / 22.12+。
#    它印了一行警告然後**照樣建成功**，那包產物也真的出貨了 ——
#    「能跑」與「受支援」是兩件事，而只有前者留得下痕跡。
#
# 🔴 挑選邏輯**不在這裡**：呼叫 scripts/run-tests.mjs --print-node，
#    與測試用的是同一份 findRunner()。在這裡再寫一份 bash 版的話兩份會漂，
#    而漂掉的方向就是上面那句（部署悄悄用了另一個 runtime）。
#
# 做法是搭一個只有 `node` 的暫存 bin 目錄插到 PATH 最前面 ——
# 不能只 export NODE_BIN：`npm` / `tsc` / `vite` 的 shebang 都是
# `#!/usr/bin/env node`，它們認的是 PATH。
#
# ⚠️ 顯式豁免：SKIP_NODE_PICK=1（例如在 CI 上 node 本來就夠新）。
if [ "${SKIP_NODE_PICK:-0}" = "1" ]; then
  echo "⚠️  SKIP_NODE_PICK=1 ⇒ 沿用 PATH 上的 node（顯式豁免）：$(node --version)"
else
  NODE_BIN="$(node scripts/run-tests.mjs --print-node)" || {
    echo "❌ 挑不到夠新的 Node —— 上面那行是原因。" >&2
    echo "   Vite 7 要 20.19+/22.12+，而挑選器的下限是 22.18（與測試共用）。" >&2
    echo "   確定要用手上這個舊的建：SKIP_NODE_PICK=1 $0 $*" >&2
    exit 1
  }
  NODE_ABS="$(command -v "$NODE_BIN" || echo "$NODE_BIN")"
  [ -x "$NODE_ABS" ] || { echo "❌ 挑到的 node 不可執行：$NODE_ABS" >&2; exit 1; }
  NODE_SHIM_DIR="$(mktemp -d)"
  trap 'rm -rf "$NODE_SHIM_DIR"' EXIT
  ln -s "$NODE_ABS" "$NODE_SHIM_DIR/node"
  export PATH="$NODE_SHIM_DIR:$PATH"
  # 🔴 裝完要回頭問一次「現在 PATH 上的 node 是誰」——
  #    少了這一步，shim 沒生效（npm 有自己的 node、PATH 被誰蓋掉…）
  #    與生效在輸出上逐字相同，而那正是這次要修掉的失效方式。
  #    ⚠️ 這裡**不重寫版本比較**：那是 findRunner() 的工作，在 bash 再寫一份
  #    就又多一個會漂的判準（我第一版真的寫了一個 `case` 樣式，而它會把
  #    v22.100 誤判成太舊）。這裡只問一件 shim 自己答得了的事：
  #    **PATH 上的 node 是不是就是挑到的那一個。**
  ACTUAL_BIN="$(command -v node)"
  if [ "$(readlink -f "$ACTUAL_BIN")" != "$(readlink -f "$NODE_ABS")" ]; then
    echo "❌ shim 沒生效：PATH 上的 node 是 $ACTUAL_BIN（挑到的是 $NODE_ABS）" >&2
    exit 1
  fi
  echo "▶ build 用的 node：$(node --version)（$NODE_ABS）"
fi

[ -d node_modules ] || npm ci
VITE_API_BASE_URL="$API_BASE" npm run build

# 出貨前自我驗證：確認烘進 bundle 的是我方位址，且工程師那三個 prod 位址一個都沒殘留。
# （P3 之前 Console 硬編了 yg7y0xkb50 / 00pox0hvv4 / 5yas775i27，誤推上去等於把後台指到別人正式環境。）
BUNDLE=$(ls dist/assets/*.js)
grep -q "$API_BASE" $BUNDLE || { echo "❌ bundle 沒有烘進 $API_BASE，中止" >&2; exit 1; }
if grep -qE "yg7y0xkb50|00pox0hvv4|5yas775i27" $BUNDLE; then
  echo "❌ bundle 殘留工程師 prod 位址，中止" >&2; exit 1
fi
echo "✔ bundle 位址檢查通過"

# 帶 hash 檔名的資產可永久快取；index.html 一定要 no-cache，否則改版後使用者會卡在舊的 JS 參照。
aws s3 sync dist/ "$S3_PREFIX" --delete --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable" --only-show-errors
aws s3 cp dist/index.html "${S3_PREFIX}index.html" \
  --cache-control "no-cache,must-revalidate" --content-type "text/html; charset=utf-8" --only-show-errors

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query "Invalidation.{id:Id,status:Status}" --output json

echo "✅ 部署完成 → $URL"
