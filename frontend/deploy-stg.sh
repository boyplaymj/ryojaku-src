#!/usr/bin/env bash
# 部署両雀「玩家端」到 staging（OAC 私有桶 + CloudFront）。
# 對照組：admin_frontend/deploy.sh 是後台 Console 的同款腳本，兩者刻意保持一致。
#
# ⚠️ 不要用同目錄的 deploy-to-s3.sh —— 那是工程師的，指向他自己帳號的 bucket mahjongclub-app
#    與 distribution E3I3J0SFSPTE2W（我方帳號實測 AccessDenied / NoSuchDistribution），
#    而且會把桶開成 public-read。首次開通請先跑 ./provision-stg-cdn.sh。
#
# 用法：./deploy-stg.sh [stg]
set -euo pipefail
cd "$(dirname "$0")"

ENV=${1:-stg}
case "$ENV" in
  stg)
    # 自訂網域（P0）。⚠️ 結尾「沒有」/stg —— base path mapping 掛在根，stage 由網域自己解析。
    # 這裡刻意不寫 *.execute-api.* 原始位址：App 會把它烘進 binary，API Gateway 一旦重建
    # （換帳號／換 region／IaC 重跑）ID 就變，所有已安裝的 App 同時變磚，且 iOS 還要等審核。
    API_BASE="https://ryojaku-api.boyplaymj.com"
    WS_BASE="wss://ryojaku-ws.boyplaymj.com"
    SUBDOMAIN="${SUBDOMAIN:-ryojaku-stg.boyplaymj.com}"
    S3_PREFIX="s3://boyplaymj-image/ryojaku-app-stg/"
    ;;
  *)
    echo "❌ 未知環境 '$ENV'（目前只支援 stg；prod 待玩家端驗收後再開）" >&2; exit 1 ;;
esac

# distribution 以 alias 反查，不硬編 —— 免得 provision 重建後這裡忘了同步而打到舊的。
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items!=null] | [?contains(Aliases.Items, '$SUBDOMAIN')].Id | [0]" \
  --output text)
[ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ] || {
  echo "❌ 找不到 $SUBDOMAIN 的 CloudFront distribution，請先跑 ./provision-stg-cdn.sh" >&2; exit 1; }

echo "▶ 環境=$ENV  API=$API_BASE"
echo "  WS=$WS_BASE"
echo "  目標=$S3_PREFIX  dist=$DIST_ID  URL=https://$SUBDOMAIN"

[ -d node_modules ] || npm ci
# 兩個變數都是 fail-closed：apiService.ts 缺 API 會 throw，chatService.ts 缺 WS 會拒絕連線。
# 這是刻意的 —— 工程師原本把 prod 的 WS（ek5dythoh9…/prod）寫死到連 env 都蓋不掉。
VITE_API_BASE_URL="$API_BASE" VITE_WS_BASE_URL="$WS_BASE" npm run build

# 出貨前自我驗證：我方 staging 位址要在，工程師的四個正式位址一個都不准殘留。
BUNDLE=$(ls dist/assets/*.js)
for want in ryojaku-api.boyplaymj.com ryojaku-ws.boyplaymj.com; do
  grep -q "$want" $BUNDLE || { echo "❌ bundle 沒烘進 $want，中止" >&2; exit 1; }
done
if grep -qE "yg7y0xkb50|00pox0hvv4|5yas775i27|ek5dythoh9" $BUNDLE; then
  echo "❌ bundle 殘留工程師正式環境位址，中止" >&2; exit 1
fi
# P0 護欄：任何 *.execute-api.* 原始位址都不准進 bundle（含我方自己的 9mu0vajn38 / xb0exhv770）。
# 理由同上：這包 dist 就是 Capacitor 的 webDir，會原封不動變成手機上改不掉的那份。
if grep -q "execute-api" $BUNDLE; then
  echo "❌ bundle 殘留 execute-api 原始位址（App 重建 API 就變磚），中止" >&2; exit 1
fi
echo "✔ bundle 位址檢查通過"

# 快取分三層。這裡跟 Console 版不同 —— 玩家端是 PWA，多了 sw.js / manifest 兩個「不可長快取」的檔：
#   assets/**            檔名帶 hash → 可永久快取
#   其餘圖檔（public/）  檔名不帶 hash → 只給 1 小時，改圖才不會卡住
#   index/sw/manifest    絕不可快取 —— sw.js 一旦被 CDN 快取，使用者會卡在舊 service worker，
#                        連之後改版都推不動（PWA 最典型的坑）
aws s3 sync dist/assets/ "${S3_PREFIX}assets/" --delete \
  --cache-control "public,max-age=31536000,immutable" --only-show-errors

aws s3 sync dist/ "$S3_PREFIX" --delete \
  --exclude "assets/*" --exclude "index.html" --exclude "sw.js" --exclude "manifest.webmanifest" \
  --cache-control "public,max-age=3600" --only-show-errors

aws s3 cp dist/index.html "${S3_PREFIX}index.html" \
  --cache-control "no-cache,must-revalidate" --content-type "text/html; charset=utf-8" --only-show-errors
aws s3 cp dist/sw.js "${S3_PREFIX}sw.js" \
  --cache-control "no-cache,must-revalidate" --content-type "application/javascript; charset=utf-8" --only-show-errors
aws s3 cp dist/manifest.webmanifest "${S3_PREFIX}manifest.webmanifest" \
  --cache-control "no-cache,must-revalidate" --content-type "application/manifest+json" --only-show-errors

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query "Invalidation.{id:Id,status:Status}" --output json

echo "✅ 部署完成 → https://$SUBDOMAIN"
