#!/usr/bin/env bash
# [B5-a] 自建場座標位移 ＋ create-venue 自助 type 閘 —— 突變測試（可重跑的鑑別力證據）。
#
# 為什麼要有這支：`go test` 全綠只證明「目前沒壞」，不證明「壞了會被抓到」。
# 一個「一律不位移」的 BlurredApproxLocation、一個恆真的 IsSelfServeVenueType，
# 在全綠的畫面上跟真貨長得一模一樣。這支逐發改壞原始碼，要求**指名的那一條**測試轉紅。
#
# 跑法：bash backend/mutation_venue_blur.sh
# 退出碼：0=每一發都被指名的那條殺掉 / 1=有存活、紅錯條、或設備問題 / 2=基準線就不綠
#
# 🔴 歸因是**精確比對**測試名（`--- FAIL: <name>` 逐字相等），不是前綴／子字串 ——
#    TestX 與 TestX2 用前綴會黏在一起，「被 X2 殺掉」印成「被 X 殺掉」而逐字相同。
# 🔴 非預期存活一律 rc=1，不會印了 ❌ 還 return 0。
# 🔴 編不過的突變體 ≡ 被殺掉的突變體（外觀相同）⇒ 先編譯再量，編不過算設備問題。
#
# ⚠️ 本腳本會就地改寫原始碼再還原。任何結束路徑（含 Ctrl-C）都會 trap 還原，
#    結尾另有逐位元組比對，確認沒有把突變留在工作樹裡。

# ── 🔴 看板閘門：跑突變一定要掛進度 embed（判準只有一份，見 require-board.sh）──
/opt/sml/repo/tools/bgtask/require-board.sh "$@" || exit $?

set -uo pipefail
cd "$(dirname "$0")"
export TMPDIR=${TMPDIR:-/opt/sml/.buildtmp}
mkdir -p "$TMPDIR"

BLUR_GO=cmd/lambdas/shared/venue_blur.go
DTO_GO=cmd/lambdas/shared/venue_dto.go
MAIN_GO=cmd/lambdas/apis/mahjongclub_web_create_venue/main.go
PKG_SHARED=./cmd/lambdas/shared/
PKG_HANDLER=./cmd/lambdas/apis/mahjongclub_web_create_venue/

BAK=$(mktemp -d "$TMPDIR/mutblur.XXXXXX")
cp "$BLUR_GO" "$BAK/venue_blur.go"
cp "$DTO_GO"  "$BAK/venue_dto.go"
cp "$MAIN_GO" "$BAK/main.go"
restore() { cp "$BAK/venue_blur.go" "$BLUR_GO"; cp "$BAK/venue_dto.go" "$DTO_GO"; cp "$BAK/main.go" "$MAIN_GO"; }
# 訊號 handler 必須自己 exit，清理只掛 EXIT（理由見 infra/mutation_auth_line.sh）。
trap 'restore; rm -rf "$BAK"' EXIT
trap 'echo "[中斷] 交給 EXIT trap 還原"; exit 130' INT TERM HUP

# apply <檔案> <原文> <替換> —— 探針必須剛好命中一次。
apply() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
n = src.count(old)
if n != 1:
    sys.stderr.write(f"探針命中 {n} 次（應為 1）：{old!r}\n")
    sys.exit(2)
open(path, 'w').write(src.replace(old, new))
PY
}

# red_tests <pkg> —— 印出轉紅的測試名（每行一個，精確名稱）。量測器壞掉時印 __METER_BROKEN__。
red_tests() {
  local out
  out=$(go test "$1" -count=1 -run '^TestB5a_' -v 2>&1)
  if echo "$out" | grep -qE '^(FAIL|ok)[[:space:]]+mahjongclub-backend'; then
    echo "$out" | sed -nE 's/^--- FAIL: ([^ ]+) .*/\1/p'
  else
    echo "__METER_BROKEN__"
  fi
}

echo "── 基準線（未突變）──"
if ! go build $PKG_SHARED $PKG_HANDLER; then echo "🔴 基準線編不過"; exit 2; fi
for pkg in $PKG_SHARED $PKG_HANDLER; do
  base=$(red_tests "$pkg")
  if [ -n "$base" ]; then echo "🔴 基準線就有紅（$pkg）：$base"; exit 2; fi
done
echo "  兩個套件 B5a 全綠 ✓"

pass=0; fail=0
# mut <描述> <檔案> <原文> <替換> <套件> <預期轉紅的測試（精確名）>
mut() {
  local desc=$1 file=$2 old=$3 new=$4 pkg=$5 want=$6
  echo
  echo "===== $desc ====="
  restore
  if ! apply "$file" "$old" "$new"; then
    echo "  🔴 [設備] 探針沒打中 —— 這一發不算突變，不可讀成通過"; fail=$((fail+1)); return
  fi
  if ! go build $PKG_SHARED $PKG_HANDLER >/dev/null 2>&1; then
    echo "  🔴 [設備] 突變體編不過 —— 它會讓測試紅得像被殺掉"; fail=$((fail+1)); return
  fi
  local got
  got=$(red_tests "$pkg")
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

# ── 規則 1／2：home 位移、hall／event 不位移 ──
mut "M1 home 不再位移（跟 hall 一起原樣回傳）" "$BLUR_GO" \
'	case VenueTypeHall, VenueTypeEvent:
		return loc' \
'	case VenueTypeHall, VenueTypeEvent, VenueTypeHome:
		return loc' \
"$PKG_SHARED" TestB5a_Blur_HomeMovesWithinRange

mut "M2 hall 也被位移" "$BLUR_GO" \
'	case VenueTypeHall, VenueTypeEvent:
		return loc' \
'	case VenueTypeEvent:
		return loc' \
"$PKG_SHARED" TestB5a_Blur_HallAndEventUnchanged

mut "M3 認不得的 type 放行精確座標（fail-open）" "$BLUR_GO" \
'	switch venueType {
	case VenueTypeHall, VenueTypeEvent:
		return loc
	}' \
'	if venueType != VenueTypeHome {
		return loc
	}' \
"$PKG_SHARED" TestB5a_Blur_UnknownTypeIsBlurred

# ── 規則 3：清空 PlaceName／Geohash ──
mut "M4 PlaceName／Geohash 沒清掉" "$BLUR_GO" \
'	out := VenueLocation{Latitude: loc.Latitude, Longitude: loc.Longitude}' \
'	out := loc' \
"$PKG_SHARED" TestB5a_Blur_HomeClearsPlaceNameAndGeohash

# ── 規則 4：距離與方位真的由 rnd 決定 ──
# ⚠️ 固定 300 落在 [300,500] 內 ⇒ T1 照樣綠，只有 DistanceFollowsRnd 抓得到。
mut "M5 距離固定 300" "$BLUR_GO" \
'	distance := HomeBlurMinMeters + float64(HomeBlurMaxMeters-HomeBlurMinMeters)*unit(rnd())' \
'	distance := float64(HomeBlurMinMeters); _ = unit(rnd())' \
"$PKG_SHARED" TestB5a_Blur_DistanceFollowsRnd

mut "M6 方位固定正北" "$BLUR_GO" \
'	bearing := 2 * math.Pi * unit(rnd())' \
'	bearing := 0.0; _ = unit(rnd())' \
"$PKG_SHARED" TestB5a_Blur_BearingFollowsRnd

mut "M7 rnd 越界不夾制（≥1 直接用）" "$BLUR_GO" \
'	if r >= 1 {
		return math.Nextafter(1, 0)
	}' \
'' \
"$PKG_SHARED" TestB5a_Blur_RndOutOfContractIsClamped

mut "M8 rnd=nil 時不位移" "$BLUR_GO" \
'	if rnd == nil {
		rnd = rand.Float64
	}' \
'	if rnd == nil {
		_ = rand.Float64
		return out
	}' \
"$PKG_SHARED" TestB5a_Blur_NilRndStillBlurs

# ── 規則 5：極區換算 ──
# 🔴 夾制改 0：math.Cos(π/2)=6e-17 ⇒ 經度算成 7e13（有限、不是 NaN），環繞後看起來像座標。
#    只斷言「不是 NaN」的尺對這一發零鑑別力。
mut "M9 |cos(lat)| 夾制常數改 0" "$BLUR_GO" \
'const minAbsCosLat = 0.01' \
'const minAbsCosLat = 0' \
"$PKG_SHARED" TestB5a_Blur_PolarLongitudeStaysSane

mut "M10 夾制常數改 1（中緯度也被壓扁）" "$BLUR_GO" \
'const minAbsCosLat = 0.01' \
'const minAbsCosLat = 1' \
"$PKG_SHARED" TestB5a_Blur_MidLatitudeNotClamped

mut "M11 經度不環繞（179.9 往東變 180.3）" "$BLUR_GO" \
'	out.Longitude = wrapLng(loc.Longitude + dLng)' \
'	out.Longitude = loc.Longitude + dLng' \
"$PKG_SHARED" TestB5a_Blur_PolarLongitudeStaysSane

# ── 規則 6：壞座標原樣回傳 ──
mut "M12 NaN／Inf 座標也拿去算" "$BLUR_GO" \
'	if !isFiniteCoord(loc.Latitude) || !isFiniteCoord(loc.Longitude) {
		return out
	}' \
'' \
"$PKG_SHARED" TestB5a_Blur_BrokenCoordsPassThrough

# ── 接線：NewVenueFromCreateRequest 真的呼叫了位移 ──
mut "M13 NewVenueFromCreateRequest 不接位移（回到 2026-09-09 之前的原樣照抄）" "$DTO_GO" \
'		ApproxLocation: BlurredApproxLocation(r.Type, r.ApproxLocation, rnd),' \
'		ApproxLocation: r.ApproxLocation,' \
"$PKG_SHARED" TestB5a_NewVenueFromCreateRequest_BlursHome

# ── ③ 自助 type 閘 ──
# 同一個突變量兩次：純函式那層（shared）與 HTTP 那層（handler）。
# 只量 shared 的話，「函式對了但 handler 沒接」在這裡看不出來。
mut "M14a IsSelfServeVenueType 對 event 回 true（shared 層）" "$BLUR_GO" \
'	case VenueTypeHall, VenueTypeHome:
		return true' \
'	case VenueTypeHall, VenueTypeHome, VenueTypeEvent:
		return true' \
"$PKG_SHARED" TestB5a_IsSelfServeVenueType

mut "M14b IsSelfServeVenueType 對 event 回 true（handler 層）" "$BLUR_GO" \
'	case VenueTypeHall, VenueTypeHome:
		return true' \
'	case VenueTypeHall, VenueTypeHome, VenueTypeEvent:
		return true' \
"$PKG_HANDLER" TestB5a_Handler_RejectsEventBeforeAnyIO

mut "M15 handler 沒接閘（判斷結果被丟掉）" "$MAIN_GO" \
'	if msg := selfServeGate(req.Type); msg != "" {' \
'	if msg := selfServeGate(req.Type); msg != "" && false {' \
"$PKG_HANDLER" TestB5a_Handler_RejectsEventBeforeAnyIO

# 反控那條有沒有牙：閘一律擋（連 hall／home 都 400）。
mut "M16 閘一律擋下（hall／home 也 400）" "$MAIN_GO" \
'	if shared.IsSelfServeVenueType(venueType) {
		return ""
	}' \
'	if shared.IsSelfServeVenueType(venueType) {
		return errVenueNotSelfServe
	}' \
"$PKG_HANDLER" TestB5a_Handler_HallAndHomePassTheGate

restore
echo
echo "── 還原後回歸（兩套件全部測試，不只 B5a）──"
if ! go test $PKG_SHARED $PKG_HANDLER -count=1 2>&1 | tail -2; then fail=$((fail+1)); fi
for f in "$BLUR_GO:venue_blur.go" "$DTO_GO:venue_dto.go" "$MAIN_GO:main.go"; do
  if ! diff -q "${f%%:*}" "$BAK/${f##*:}" >/dev/null; then
    echo "❌ ${f%%:*} 沒有還原乾淨（工作樹被留下突變）"; fail=$((fail+1))
  fi
done

echo
echo "===== 結果 ====="
echo "殺 $pass／存活或設備問題 $fail"
[ $fail -eq 0 ] && echo "✅ 每一發都被指名的那條殺掉，原始碼已逐位元組還原" || echo "❌ 有項目未通過"
[ $fail -eq 0 ]
