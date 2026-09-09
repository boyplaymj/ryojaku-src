#!/usr/bin/env bash
# [B1-c2d-3] venue 三支端點的路由與 authorizer 驗證。
#
# 🔴 這支答的是一個很窄的問題：**路由建上了嗎，而且 authorizer 真的在擋嗎。**
#    它不驗業務邏輯（那要真 token）、不驗 DDB、不驗地址授權。
#
# 判準來自部署前實測的基線（2026-09-09）：
#   403 "Missing Authentication Token" ＝ **路由不存在**
#       —— 亂打一條路徑得到的是同一個碼與同一句話，兩者逐字相同
#   401 "Unauthorized"                 ＝ 路由存在 ＋ authorizer 擋下了
#
# ⇒ 所以「不帶 token 得到 401」同時證明了兩件事，而 403 兩件都不成立。
#
# 🔴 反控不可省：若整個 API 因為某種原因一律回 401，只驗「三支回 401」會假綠。
#    C2（亂打的路徑必須是 403）就是分辨那件事的那把尺。
# 🔴 正控不可省：若 authorizer 整個壞掉、每支都回 403，只驗「亂打回 403」也會假綠。
#    C1（既有已掛閘的端點必須 401）分辨那件事。
#
# rc: 0 全通過 / 1 有項目不符 / 2 設備問題（拿不到 API URL、curl 不可用）—— 2 不可讀成通過。
set -uo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"
STACK="${STACK:-ryojaku-app-stg}"

command -v curl >/dev/null || { echo "🔴 [設備] 沒有 curl"; exit 2; }
API=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue" --output text 2>/dev/null)
[ -n "$API" ] && [ "$API" != "None" ] || { echo "🔴 [設備] 拿不到 RestApiUrl（stack=$STACK）"; exit 2; }
echo "API: $API"

fail=0
hit() { # $1 路徑  $2 期望碼  $3 說明  [$4 method，預設 POST]
  local body code method
  method="${4:-POST}"
  body=$(mktemp)
  if [ "$method" = "GET" ]; then
    code=$(curl -s -o "$body" -w '%{http_code}' "$API/$1" --max-time 20)
  else
    code=$(curl -s -o "$body" -w '%{http_code}' -X POST "$API/$1" \
             -H 'Content-Type: application/json' -d '{}' --max-time 20)
  fi
  if [ -z "$code" ] || [ "$code" = "000" ]; then
    echo "🔴 [設備] 打不到 $1（curl 沒有回應碼）"; rm -f "$body"; return 2
  fi
  if [ "$code" = "$2" ]; then
    printf '  ✅ %-34s %s  %s\n' "$1" "$code" "$3"
  else
    printf '  ❌ %-34s %s（期望 %s）%s\n     回應：%s\n' "$1" "$code" "$2" "$3" "$(head -c 120 "$body")"
    fail=$((fail+1))
  fi
  rm -f "$body"
}

echo "── 受測：venue 三支（不帶 token，期望 401＝路由在且閘門擋下）"
hit create-venue  401 "建立場地"
hit venue-detail  401 "查詢場地（安全承重）"
hit admin/venues  401 "後台審核"

echo "── 受測：公開列表（刻意**沒有** authorizer，期望 200）"
echo "   🔴 這一項的期望碼與上面三支相反，那是刻意的：它回的是白名單型別"
echo "      （PublicVenueCard，結構上不含 exactAddress／ownerId），沒有東西可被冒名取得。"
echo "      若它回 401 ⇒ 有人替它掛了 authorizer，未登入瀏覽地圖那條路就斷了。"
hit venue-list 200 "公開場地列表" GET

echo "── C1 正控：既有已掛 authorizer 的端點也必須 401"
echo "   （若它變成 403，代表 authorizer 整組壞了，上面三個 401 就不能證明是我的路由對）"
hit create-game 401 "既有端點"

echo "── C2 反控：不存在的路徑必須是 403，不是 401"
echo "   （若它也回 401，代表 401 沒有鑑別力，上面全部作廢）"
hit definitely-not-a-route-xyz 403 "不存在的路徑"

if [ "$fail" -eq 0 ]; then
  echo "✅ 6/6 通過：四支路由已建上；三支的 authorizer 在擋，venue-list 刻意開放。"
  echo "⚠️ 界線：這**沒有**驗到業務邏輯、DDB 讀寫、或地址授權判斷 —— 那些要真 token。"
  exit 0
fi
echo "❌ $fail 項不符"
exit 1
