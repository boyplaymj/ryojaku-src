#!/bin/bash
# [B1-c2b] 建立 venue 主表（正典 PLAYER_APP_REDESIGN.md §5.3／§12）。
#
# 🔴 刻意**不給 TABLE_PREFIX 預設值**，沒設就退出。
#    程式端的 tablePrefix() 預設是 "MahjongClub_"（prod），但這個 AWS 帳號
#    （380931373365）實查只有 MahjongClubStg_* 那一套 —— 若腳本照抄那個預設，
#    在這裡跑就會建出一張叫 MahjongClub_Venues 的表，而它永遠不會被任何 lambda 用到。
#    而「用了預設值」與「講對了 prod」在腳本輸出上**逐字相同**：兩者都印
#    「Table ... created successfully」。⇒ 只能 fail-closed。
#
# 🔴 **不建 GSI**，這是刻意的，判準寫在下面。
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"

if [ -z "${TABLE_PREFIX:-}" ]; then
  echo "🔴 TABLE_PREFIX 未設。這支腳本不給預設值 —— 見檔頭。" >&2
  echo "   stg: TABLE_PREFIX=MahjongClubStg_ bash $0" >&2
  echo "   prod: TABLE_PREFIX=MahjongClub_ bash $0   （先確認你在對的帳號）" >&2
  exit 2
fi

TABLE_NAME="${TABLE_PREFIX}Venues"

echo "AWS 身分："
aws sts get-caller-identity --output json

if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "表 $TABLE_NAME 已存在，不動它。"
  aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" \
    --query '{Keys:Table.KeySchema,GSI:Table.GlobalSecondaryIndexes[].IndexName,Billing:Table.BillingModeSummary.BillingMode,Items:Table.ItemCount}' \
    --output json
  exit 0
fi

echo "建立表 $TABLE_NAME …"
aws dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions AttributeName=venueId,AttributeType=S \
  --key-schema AttributeName=venueId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" >/dev/null

aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
echo "✅ $TABLE_NAME 建好了（PAY_PER_REQUEST，無 GSI）"

# --- 為什麼現在不建 GSI（判準留在這裡，不是留在對話裡）---
#
# 既有的 Games 表實查也是 PK-only ＋ 一個 status-createdAt-index，
# 而且它有 Geohash 欄位卻**沒有** geohash 索引 ⇒ 地圖查詢目前本來就不靠索引。
#
# venue 初期的量級是「幾十筆」（麻將館要付費建立、自建場只在有場次時顯示），
# Scan 一張小表比多養一個 GSI 便宜 —— GSI 要付儲存費，而且每次寫入都放大。
#
# 🔴 什麼時候該回來加（可檢查的判準，不是「感覺變慢時」）：
#   - venue 筆數 > 500，或
#   - 列表端點的 Scan 單次消耗 > 20 RCU（CloudWatch ConsumedReadCapacityUnits ÷ 呼叫數）
#
# ⚠️ 加 GSI 之前先讀這條坑：DDB 對 key 屬性**型別不符是直接拒寫**，不是稀疏跳過。
#    所以要拿來當 GSI key 的欄位，必須「不存在」或「型別正確」，不能有空字串
#    （空字串當 key 會被拒）。目前 Venue 的 geohash 在 ApproxLocation 底下（巢狀），
#    GSI 不能用巢狀屬性當 key ⇒ 真要做的話得先拉到頂層並回填。
#    現在不拉，是因為那是為一個還沒有需求的路徑改設計；筆數少的時候回填很容易。
