#!/usr/bin/env bash
# security_regression.sh 的解析函式自測 —— 不需要 AWS、不需要網路、不燒註冊配額。
#
# 為什麼要單獨有這支：
#   🔴 `security_regression.sh` 每次執行會註冊 2 個帳號，而 app-register 的限流是
#      「每 IP 每小時 10 次」⇒ 真環境**每小時最多跑 5 次**。拿真跑當語法檢查
#      會把配額燒光，而且失敗時分不出「解析寫錯」與「安全修補回歸了」。
#   🔴 解析層是假綠最容易長出來的地方。最典型的一個：`sg_ci` 若把
#      「搜尋結果裡找不到那一局」印成 MASKED，G-3 的三條遮蔽斷言會全部通過 ——
#      而真相是搜尋壞了，不是遮蔽有效。所以 NOTFOUND 與 MASKED 必須分得出來，
#      下面 T10／T11／T14 就是釘這件事的。
#
# 用法：bash infra/security_regression_parsers_selftest.sh
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 抽不到函式（設備問題，讀數作廢，不是「通過」）
set -uo pipefail
cd "$(dirname "$0")/.."
SRC=infra/security_regression.sh

# 🔴 用標記抽，不用行號 —— 行號會隨那支腳本增刪而漂掉，
#    而抽到半段的結果仍然可能「eval 得起來」，那時綠燈是假的。
BLOCK=$(awk '/^# ─── PARSERS-BEGIN/{f=1;next} /^# ─── PARSERS-END/{f=0} f' "$SRC")
if [ -z "$BLOCK" ]; then
  echo "❌ 抽不到 PARSERS 區塊（標記被改掉了？）—— 這是設備問題，不是通過"; exit 2
fi
# 反控：抽出來的東西必須真的含有全部四支函式定義，否則「抽到半段」會偽裝成通過。
for fn in data_uid gd_ci sg_ci ddb_attr; do
  printf '%s' "$BLOCK" | grep -q "^${fn}(){" || {
    echo "❌ 抽出的區塊缺少 ${fn}() —— 標記範圍不對，讀數作廢"; exit 2; }
done

GID="G123"; CIPHER="AAAABBBB"; REGION=x; PREFIX=x
eval "$BLOCK"

N=0; F=0
t(){ N=$((N+1)); if [ "$2" = "$3" ]; then echo "  ✅ $1"; else echo "  ❌ $1：得到 [$2] 期望 [$3]"; F=$((F+1)); fi; }

echo "══ data_uid ══"
t "T1  正常取到 data.userId"        "$(echo '{"data":{"userId":"APP_x"}}' | data_uid)" "APP_x"
t "T2  401 那種沒有 data → EMPTY"   "$(echo '{"success":false,"error":"需要登入"}' | data_uid)" "EMPTY"
t "T3  非 JSON → ERR（不可印空字串，空字串會跟 EMPTY 撞在一起）" \
                                     "$(echo 'not json' | data_uid)" "ERR"
t "T4  data 是 null"                "$(echo '{"data":null}' | data_uid)" "EMPTY"

echo "══ gd_ci（game-detail 的 contactInfo）══"
t "T5  有值 → VISIBLE"              "$(echo '{"data":{"game":{"contactInfo":{"phone":"09"}}}}' | gd_ci phone)" "VISIBLE"
t "T6  空字串 → MASKED"             "$(echo '{"data":{"game":{"contactInfo":{"phone":""}}}}' | gd_ci phone)" "MASKED"
t "T7  欄位不存在 → MASKED（omitempty 會讓遮掉的欄位整個消失）" \
                                     "$(echo '{"data":{"game":{"contactInfo":{}}}}' | gd_ci note)" "MASKED"
t "T8  連 game 都沒有 → MASKED"     "$(echo '{"data":{}}' | gd_ci phone)" "MASKED"

echo "══ sg_ci（search-games 的那一局）══"
t "T9  找到且有值 → VISIBLE"        "$(echo '{"data":{"games":[{"gameId":"G123","contactInfo":{"note":"n"}}]}}' | sg_ci note)" "VISIBLE"
t "T10 找到且已遮 → MASKED"         "$(echo '{"data":{"games":[{"gameId":"G123","contactInfo":{}}]}}' | sg_ci note)" "MASKED"
t "T11 【假綠來源】找不到那一局必須是 NOTFOUND，不可以是 MASKED" \
                                     "$(echo '{"data":{"games":[{"gameId":"OTHER","contactInfo":{}}]}}' | sg_ci note)" "NOTFOUND"
t "T12 空列表 → NOTFOUND"           "$(echo '{"data":{"games":[]}}' | sg_ci note)" "NOTFOUND"
t "T13 只認 gameId 完全相符，不做前綴比對" \
                                     "$(echo '{"data":{"games":[{"gameId":"G1234","contactInfo":{}}]}}' | sg_ci note)" "NOTFOUND"

echo "══ G-3 ⓪ 的 FOUND 正規化 ══"
norm(){ sed 's/^\(VISIBLE\|MASKED\)$/FOUND/'; }
t "T14 VISIBLE → FOUND"             "$(echo '{"data":{"games":[{"gameId":"G123","contactInfo":{"lineId":"U"}}]}}' | sg_ci lineId | norm)" "FOUND"
t "T15 MASKED → FOUND（遮蔽與否都算找得到）" \
                                     "$(echo '{"data":{"games":[{"gameId":"G123","contactInfo":{}}]}}' | sg_ci lineId | norm)" "FOUND"
t "T16 NOTFOUND 不可被正規化成 FOUND（少了這條，G-3 ⓪ 那個正控等於沒有）" \
                                     "$(echo '{"data":{"games":[]}}' | sg_ci lineId | norm)" "NOTFOUND"

echo
echo "══ 斷言：通過 $(( N - F )) / 共 $N（失敗 $F）══"
exit $(( F > 0 ? 1 : 0 ))
