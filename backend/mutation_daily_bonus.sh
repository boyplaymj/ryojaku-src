#!/usr/bin/env bash
# [/daily-bonus] REST_V1 契約測試 —— 突變測試（可重跑的鑑別力證據）。
#
# 為什麼要有這支：`go test` 全綠只證明「目前沒壞」，不證明「壞了會被抓到」。
# 上一輪（2026-09-10 早上）那四發是**手動**跑的，只留在 commit 訊息裡 ——
# 而只寫在訊息裡的預期永遠不會失敗。這支把它們變成可重跑的。
#
# 跑法：bash backend/mutation_daily_bonus.sh
# 退出碼：0=每一發都被指名的那條殺掉 / 1=有存活、紅錯條、或設備問題 / 2=基準線就不綠
#
# 🔴 M4（`userID := ""`）是本輪的主角：上一輪它**存活**，因為當時沒有任何一條測試
#    讓 handler 帶著合法身分走過 401 那道閘（走過去下一步就是碰真表）。
#    dynamoClient 改成 ddbAPI 介面之後，T6～T10 才量得到這條線。
#
# 🔴 歸因是**精確比對**測試名（`--- FAIL: <name>` 逐字相等），不是前綴／子字串 ——
#    這裡有 TestT1 與 TestT10，前綴比對恰好會把該分開的兩者黏在一起。
# 🔴 編不過的突變體 ≡ 被殺掉的突變體（外觀相同）⇒ 先編譯再量，編不過算設備問題。
# 🔴 非預期存活一律 rc=1，不會印了 ❌ 還 return 0。
#
# ⚠️ 已知還沒有尺的（不是遺漏，是還沒補，寫在這裡免得下次讀成「都測過了」）：
#    ① 連續天數 >7 歸 1 的循環重置 ② 交易失敗 ⇒ 409 的那條路
#    ③ recordShadowLog 的函式本體（測試裡被整個換掉，見 main.go 那段註解）
#
# ⚠️ 本腳本會就地改寫原始碼再還原。任何結束路徑（含 Ctrl-C）都會 trap 還原，
#    結尾另有逐位元組比對，確認沒有把突變留在工作樹裡。

# ── 🔴 看板閘門：跑突變一定要掛進度 embed（判準只有一份，見 require-board.sh）──
# 🔴 這裡的路徑**刻意寫死另一棵樹的根**：require-board.sh 住在 /opt/sml/repo，
#    而本檔住在 /opt/sml/ryojaku-src ⇒ 由 `$0` 推導只會推到 ryojaku-src，那是錯的。
#    tree-locality 守衛擋的是「同一棵樹裡的另一個檔」，這一條是跨 repo，不同回事。
#    留一個環境變數當出口：在 worktree／別台機器上可以覆蓋。
SML_REPO_TOOLS=${SML_REPO_TOOLS:-/opt/sml/repo/tools}
"$SML_REPO_TOOLS/bgtask/require-board.sh" "$@" || exit $?

set -uo pipefail
cd "$(dirname "$0")"
export TMPDIR=${TMPDIR:-/opt/sml/.buildtmp}
mkdir -p "$TMPDIR"

DIR=cmd/lambdas/apis/mahjongclub_daily_bonus
MAIN_GO=$DIR/main.go
TEST_GO=$DIR/main_v1_contract_test.go
PKG=./$DIR/

BAK=$(mktemp -d "$TMPDIR/mutdaily.XXXXXX")
cp "$MAIN_GO" "$BAK/main.go"
cp "$TEST_GO" "$BAK/main_v1_contract_test.go"
restore() { cp "$BAK/main.go" "$MAIN_GO"; cp "$BAK/main_v1_contract_test.go" "$TEST_GO"; }
# 訊號 handler 必須自己 exit，清理只掛 EXIT。
trap 'restore; rm -rf "$BAK"' EXIT
trap 'echo "[中斷] 交給 EXIT trap 還原"; exit 130' INT TERM HUP

# apply <檔案> <原文> <替換> —— 探針必須剛好命中一次。
apply() {
  python3 - "$1" "$2" "$3" <<'PYAPPLY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding='utf-8').read()
n = src.count(old)
if n != 1:
    sys.stderr.write("探針命中 %d 次（應為 1）：%r\n" % (n, old))
    sys.exit(2)
open(path, 'w', encoding='utf-8').write(src.replace(old, new))
PYAPPLY
}

# red_tests —— 印出轉紅的測試名（每行一個，精確名稱）。量測器壞掉時印 __METER_BROKEN__。
red_tests() {
  local out
  out=$(go test "$PKG" -count=1 -run '^TestT' -v 2>&1)
  if echo "$out" | grep -qE '^(FAIL|ok)[[:space:]]+mahjongclub-backend'; then
    echo "$out" | sed -nE 's/^--- FAIL: ([^ ]+) .*/\1/p'
  else
    echo "__METER_BROKEN__"
  fi
}

echo "── 基準線（未突變）──"
if ! go build "$PKG"; then echo "🔴 基準線編不過"; exit 2; fi
base=$(red_tests)
if [ -n "$base" ]; then echo "🔴 基準線就有紅：$base"; exit 2; fi
echo "  T1～T10 全綠 ✓"

pass=0; fail=0
# mut <描述> <檔案> <原文> <替換> <預期轉紅的測試（精確名）>
mut() {
  local desc=$1 file=$2 old=$3 new=$4 want=$5
  echo
  echo "===== $desc ====="
  restore
  if ! apply "$file" "$old" "$new"; then
    echo "  🔴 [設備] 探針沒打中 —— 這一發不算突變，不可讀成通過"; fail=$((fail+1)); return
  fi
  if ! go build "$PKG" >/dev/null 2>&1; then
    echo "  🔴 [設備] 突變體編不過 —— 它會讓測試紅得像被殺掉"; fail=$((fail+1)); return
  fi
  local got
  got=$(red_tests)
  if echo "$got" | grep -qx '__METER_BROKEN__'; then
    echo "  🔴 [設備] 量測器自己壞了 —— 這一發沒有結論"; fail=$((fail+1)); return
  fi
  if [ -z "$got" ]; then
    echo "  ❌ 存活：沒有任何測試轉紅 ⇒ 這個行為沒有守衛"; fail=$((fail+1)); return
  fi
  echo "  轉紅的是："; echo "$got" | sed 's/^/     - /'
  if echo "$got" | grep -Fxq -- "$want"; then
    echo "  ✅ 殺掉，且紅的正是指名那條（$want）"; pass=$((pass+1))
  else
    echo "  ❌ 紅了，但**不是**指名那條（預期 $want）⇒ 撞到別的守衛，指名的斷言仍未被考驗"
    fail=$((fail+1))
  fi
}

# ── 上一輪那四發（M1～M3 原本就被殺；M4 是本輪補的主角）──
mut "M1 cookies 被列進 REST 合法鍵（讓 T3 恆真）" "$TEST_GO" \
  '	"body": true, "isBase64Encoded": true,' \
  '	"body": true, "isBase64Encoded": true, "cookies": true,' \
  TestT4_V2ResponseTypeDoesEmitCookies

mut "M2 OPTIONS 判斷永遠不成立（回到讀 v2 欄位取零值的效果）" "$MAIN_GO" \
  '	if request.HTTPMethod == "OPTIONS" {' \
  '	if request.HTTPMethod == "__NEVER_MATCHES__" {' \
  TestT1_OptionsReadsV1HTTPMethod

mut "M3 errorResponse 一律回 200（fail-open）" "$MAIN_GO" \
  '	return events.APIGatewayProxyResponse{StatusCode: statusCode, Headers: headers, Body: string(body)}, nil' \
  '	return events.APIGatewayProxyResponse{StatusCode: 200, Headers: headers, Body: string(body)}, nil' \
  TestT2_NoAuthorizerIs401

# 🔴 這一發是本輪的理由。上一輪它存活，而它是四發裡最重要的形狀。
mut "M4 身分永遠讀不到（userID 寫死空字串）" "$MAIN_GO" \
  '	userID := shared.AuthorizerUserID(request)' \
  '	userID := ""
	_ = shared.AuthorizerUserID(request)' \
  TestT6_ValidAuthorizerClaimsAsThatUser

# ── 身分的「值」有沒有被用出去：M4 只打「有沒有 401」，這幾發打「拿去做什麼」──
mut "M5 查昨天用寫死的身分（401 那關照樣過）" "$MAIN_GO" \
  '	prevClaim, err := getClaimRecord(ctx, userID, yesterdayStr)' \
  '	prevClaim, err := getClaimRecord(ctx, "APP_HARDCODED", yesterdayStr)' \
  TestT7_StreakLookupUsesTheAuthorizedUserID

mut "M6 DailyClaims 寫入寫死的身分" "$MAIN_GO" \
  '		UserID:          userID,' \
  '		UserID:          "APP_HARDCODED",' \
  TestT6_ValidAuthorizerClaimsAsThatUser

mut "M7 Users 加點加到別人頭上" "$MAIN_GO" \
  '					Key: map[string]types.AttributeValue{
						"userId": &types.AttributeValueMemberS{Value: userID},
					},' \
  '					Key: map[string]types.AttributeValue{
						"userId": &types.AttributeValueMemberS{Value: "APP_HARDCODED"},
					},' \
  TestT6_ValidAuthorizerClaimsAsThatUser

mut "M8 影子帳本記到別人頭上" "$MAIN_GO" \
  '	go recordShadowLog(userID, totalReward)' \
  '	go recordShadowLog("APP_HARDCODED", totalReward)' \
  TestT6_ValidAuthorizerClaimsAsThatUser

# ⚠️ 這一發會讓 T6 等三秒才紅（channel 逾時）——那正是「沒發生」與「還在飛」的分界。
mut "M9 影子帳本整步沒接上（呼叫被拿掉）" "$MAIN_GO" \
  '	go recordShadowLog(userID, totalReward)' \
  '	_ = recordShadowLog' \
  TestT6_ValidAuthorizerClaimsAsThatUser

# ── 「先擋再做事」：401 之前不可以碰表 ──
mut "M10 擋人之前先讀了設定（先 I/O 再 401）" "$MAIN_GO" \
  '	userID := shared.AuthorizerUserID(request)
	if userID == "" {' \
  '	userID := shared.AuthorizerUserID(request)
	_, _, _ = getRewardsConfig(ctx)
	if userID == "" {' \
  TestT9_UnauthorizedTouchesNoTable

# ── 日期／設定／加碼 ──
mut "M11 日期用 UTC 不用台北" "$MAIN_GO" \
  '	loc, _ := time.LoadLocation("Asia/Taipei")' \
  '	loc, _ := time.LoadLocation("UTC")' \
  TestT10_DateIsTaipeiNotUTC

# ⚠️ `_ = yesterdayStr` 不是裝飾：少了它 Go 會因「宣告未使用」編不過，
#    而編不過會被（正確地）判成設備問題 —— 那一發等於沒打。
mut "M12 查「今天」而不是「昨天」（連續天數永遠是 1）" "$MAIN_GO" \
  '	prevClaim, err := getClaimRecord(ctx, userID, yesterdayStr)' \
  '	prevClaim, err := getClaimRecord(ctx, userID, todayStr)
	_ = yesterdayStr' \
  TestT7_StreakLookupUsesTheAuthorizedUserID

mut "M13 設定沒被讀進去（一律用程式預設 10／50）" "$MAIN_GO" \
  '	return base, bonus, nil' \
  '	_, _ = base, bonus
	return 10, 50, nil' \
  TestT6_ValidAuthorizerClaimsAsThatUser

mut "M14 第 7 天的加碼永遠不成立" "$MAIN_GO" \
  '	if consecutiveDays == 7 {' \
  '	if consecutiveDays == 8 {' \
  TestT7_StreakLookupUsesTheAuthorizedUserID

# ── 尺自己的反控：假件必須真的按 key 回答 ──
# 🔴 少了這一發，把 fakeDDB 改成「對任何 key 都回同一筆」也會全綠，
#    而那樣 T7／T8 對「身分」這一維其實零鑑別力。
mut "M15 假件的 key 不含值（所有 key 撞在一起）" "$TEST_GO" \
  '			parts = append(parts, k+"="+s.Value)' \
  '			parts = append(parts, k+"="+s.Value[:0])' \
  TestT8_DifferentUserDoesNotInheritTheStreak

restore
echo
echo "── 還原後回歸（整包，不只 T*）──"
if ! go test "$PKG" -count=1 2>&1 | tail -3; then fail=$((fail+1)); fi
for f in "$MAIN_GO:main.go" "$TEST_GO:main_v1_contract_test.go"; do
  if ! diff -q "${f%%:*}" "$BAK/${f##*:}" >/dev/null; then
    echo "❌ ${f%%:*} 沒有還原乾淨（工作樹被留下突變）"; fail=$((fail+1))
  fi
done

echo
echo "===== 結果 ====="
echo "殺 $pass／存活或設備問題 $fail"
[ $fail -eq 0 ] && echo "✅ 每一發都被指名的那條殺掉，原始碼已逐位元組還原" || echo "❌ 有項目未通過"
[ $fail -eq 0 ]
