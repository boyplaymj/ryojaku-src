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
