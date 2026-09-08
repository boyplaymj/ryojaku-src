#!/usr/bin/env bash
# [A3-n / N1] `report_stage2_adoption.py` 的**端到端**驗收。
#
# 🔴 這支存在的理由：那份報表最重要的那一格 —— **分母 > 0 時真的印出百分比** ——
#    在本機**跑不到**。staging 的 `Games` 是 0 筆，`A3-m` 又還沒部署
#    ⇒ 日常怎麼跑都只會走到 rc=2「量不到」那條路。
#    「賣點剛好落在唯一沒有尺的那一格」是個已知的坑，所以這裡自己造一張
#    **臨時表**把那條路走一次，跑完就刪。
#
# 🔴 為什麼不寫進 `MahjongClubStg_Games`：那是真的 staging 表。
#    造一張自己的表，測完 `delete-table`，對任何既有資料零接觸。
#
# 成本：PAY_PER_REQUEST、5 列、跑完立刻刪 ⇒ 實質 $0（不觸發 COST_CONTROL 四件套，
#       那套只適用於會燒 LLM／付費 API 的功能）。
#
# 用法：bash verify_stage2_adoption.sh
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置失敗／量不到（不可讀成通過）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REGION="${AWS_REGION:-ap-southeast-1}"
TBL="sml-a3n-probe-DELETEME-$$"
SINCE=1000000            # 假的「A3-m 部署時刻」，與 selftest 同一個值

cleanup() {
  aws dynamodb delete-table --table-name "$TBL" --region "$REGION" >/dev/null 2>&1 \
    && echo "[cleanup] 已刪除臨時表 $TBL" \
    || echo "🔴 [cleanup] 臨時表 $TBL 刪不掉 —— 請手動確認（PAY_PER_REQUEST 空表≈\$0，但不要留著）"
}
trap cleanup EXIT

die() { echo "🔴 前置失敗／量不到（本輪什麼都沒驗到）：$*" >&2; exit 2; }

echo "══ 造一張臨時表 $TBL ══"
aws dynamodb create-table --table-name "$TBL" --region "$REGION" \
  --attribute-definitions AttributeName=gameId,AttributeType=S \
  --key-schema AttributeName=gameId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST >/dev/null || die "create-table 失敗"
aws dynamodb wait table-exists --table-name "$TBL" --region "$REGION" || die "表沒有變成 ACTIVE"

# 五列，刻意涵蓋四個桶：saved 2／not_saved 1（屬性不存在）／out_of_window 1／unknown 1
put() { aws dynamodb put-item --table-name "$TBL" --region "$REGION" --item "$1" >/dev/null \
        || die "put-item 失敗：$1"; }
put '{"gameId":{"S":"g1"},"createdAt":{"N":"1000001"},"venueFeatures":{"L":[{"S":"無菸"},{"S":"有電梯"},{"S":"手動桌"}]}}'
put '{"gameId":{"S":"g2"},"createdAt":{"N":"1000002"},"venueFeatures":{"L":[{"S":"雀菸"},{"S":"一樓"},{"S":"電動桌:商密特 E500"}]}}'
put '{"gameId":{"S":"g3"},"createdAt":{"N":"1000003"}}'
put '{"gameId":{"S":"g4"},"createdAt":{"N":"999999"},"venueFeatures":{"L":[{"S":"無菸"}]}}'
put '{"gameId":{"S":"g5"},"venueFeatures":{"L":[{"S":"無菸"}]}}'

# 🔴 `--page-limit 2` 不是裝飾：五列一頁掃得完的話，`LastEvaluatedKey` 那條路
#    一次都不會走到 ⇒「分頁寫對了」與「分頁從來沒被執行過」在綠燈上相同。
echo
echo "══ 跑報表（--page-limit 2 逼出多頁）══"
OUT="$(python3 "$HERE/report_stage2_adoption.py" --since "$SINCE" --table "$TBL" \
       --page-limit 2 --json 2>/tmp/a3n-e2e-err.txt)"
RC=$?
echo "$OUT"
echo "--- stderr ---"; cat /tmp/a3n-e2e-err.txt

fails=0
chk() { # chk 名稱 條件成立?
  if [ "$2" = "1" ]; then echo "✅ $1"; else echo "❌ $1"; fails=$((fails+1)); fi
}
j() { echo "$OUT" | python3 -c "import json,sys;print(json.load(sys.stdin)$1)"; }

chk "E1 分母 > 0 時 rc=0（＝這條路真的走得到，不是永遠停在「量不到」）" "$([ "$RC" = "0" ] && echo 1 || echo 0)"
chk "E2 掃描完整（多頁也要掃完）"            "$([ "$(j '["scan_complete"]')" = "True" ] && echo 1 || echo 0)"
chk "E3 saved=2"                            "$([ "$(j '["counts"]["saved"]')" = "2" ] && echo 1 || echo 0)"
chk "E4 not_saved=1（venueFeatures 屬性不存在）" "$([ "$(j '["counts"]["not_saved"]')" = "1" ] && echo 1 || echo 0)"
chk "E5 out_of_window=1（createdAt 早於 --since，即使有宣告也不算）" "$([ "$(j '["counts"]["out_of_window"]')" = "1" ] && echo 1 || echo 0)"
chk "E6 unknown=1（沒有 createdAt，兩邊都不算）" "$([ "$(j '["counts"]["unknown"]')" = "1" ] && echo 1 || echo 0)"
chk "E7 分母=3（＝saved+not_saved，不含窗外與不明）" "$([ "$(j '["denominator"]')" = "3" ] && echo 1 || echo 0)"
# 🔴 承重：率必須是 2/3，不是 2/5（分母含了窗外與不明）也不是 2/4。
chk "E8 率＝2/3（承重：分母算錯的三種常見寫法都會讓這條紅）" \
    "$(python3 -c "import json,sys;r=json.loads(sys.argv[1])['rate'];print(1 if r is not None and abs(r-2/3)<1e-9 else 0)" "$OUT")"
chk "E9 文字模式印得出百分比（--json 之外那條路也要走過）" \
    "$(python3 "$HERE/report_stage2_adoption.py" --since "$SINCE" --table "$TBL" 2>/dev/null | grep -q '第二段採用率 = 2/3 = 66.7%' && echo 1 || echo 0)"
# 🔴 反控：把 --since 推到全部之後 ⇒ 分母必須變 0 且 rc=2。
#    少了它，「rc=0＋有百分比」可能只是這支永遠都這樣。
python3 "$HERE/report_stage2_adoption.py" --since 9000000000 --table "$TBL" >/dev/null 2>&1
chk "E10（反控）--since 推到全部之後 ⇒ rc=2 量不到（尺不是恆綠）" \
    "$([ "$?" = "2" ] && echo 1 || echo 0)"

# 🔴 E11：掃不完的時候必須 rc=2。這條在正常路徑上**永遠走不到**
#    （表在、權限有、一次就掃完）⇒ 沒有它，「掃不完會擋下來」是純推理。
#    拿一個不存在的表當刺激：aws 回錯 ⇒ scan_games 回 complete=False。
# 🔴🔴 **只斷言 rc=2 是不夠的** —— 表不存在時 items 是空的，分母也會是 0，
#    而分母 0 **同樣**回 rc=2 ⇒ 那條斷言對「掃不完有沒有被擋下來」**零鑑別力**。
#    突變 N7（`return items, False` → `True`）第一版就這樣活下來了：rc 照樣是 2。
#    ⇒ 必須連**理由**一起比：stderr 要出現「沒有掃完」，不是分母 0 那句。
E11OUT="$(python3 "$HERE/report_stage2_adoption.py" --since "$SINCE" \
          --table "sml-a3n-NO-SUCH-TABLE-$$" 2>&1 >/dev/null)"
E11RC=$?
chk "E11（反控）掃不完 ⇒ rc=2 **而且理由是「沒有掃完」**（不是分母 0 那條）" \
    "$([ "$E11RC" = "2" ] && echo "$E11OUT" | grep -q '沒有掃完' && echo 1 || echo 0)"

# 🔴 E13：`--since` 沒給必須擋下來。少了它，那道「不給預設值」的閘沒有任何尺
#    —— 而拿掉它之後最可能的下場是 `created < None` 拋 TypeError，
#    那個 rc 不是 2，訊息也不會提到 --since。
E13OUT="$(python3 "$HERE/report_stage2_adoption.py" --table "$TBL" 2>&1 >/dev/null)"
E13RC=$?
chk "E13 --since 沒給 ⇒ rc=2 且講明它是必填（不可以靜靜當成 0）" \
    "$([ "$E13RC" = "2" ] && echo "$E13OUT" | grep -q -- '--since' && echo 1 || echo 0)"

# 🔴 E12：TTL 那道下緣要真的算進有效窗。--since 給的是 1970 年附近的假時刻，
#    而 Games 的列 30 天後就被 TTL 刪掉 ⇒ 有效窗起點必須是 TTL 下緣、且標示被卡住。
chk "E12 有效窗被 TTL 卡住時要講出來（不然會把「被刪掉」讀成「那段沒人建局」）" \
    "$([ "$(j '["window_capped_by_ttl"]')" = "True" ] \
       && [ "$(j '["effective_window_start"]')" = "$(j '["ttl_floor"]')" ] && echo 1 || echo 0)"

echo
if [ "$fails" = "0" ]; then echo "=== 13/13 通過 ==="; exit 0; fi
echo "=== $((13-fails))/13 通過 ==="; exit 1
