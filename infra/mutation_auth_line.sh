#!/usr/bin/env bash
# LINE Login／信箱軟門檻 —— 突變測試（可重跑的鑑別力證據）。
#
# 為什麼要有這支：`go test` 全綠只證明「目前沒壞」，不證明「壞了會被抓到」。
# 一個永遠回 nil 的守衛、一個恆真的斷言，在全綠的畫面上跟真貨長得一模一樣。
# 這支逐條把守衛拿掉，要求對應測試**由綠轉紅**；沒轉紅就代表那條斷言沒有鑑別力。
#
# 跑法：bash infra/mutation_auth_line.sh
# 退出碼：0=每一發都轉紅（守衛有效） / 1=有守衛拿掉後測試仍全過
#
# ⚠️ 本腳本會就地改寫原始碼再還原。任何結束路徑（含 Ctrl-C）都會 trap 還原，
#    結尾另有逐位元組比對，確認沒有把突變留在工作樹裡。
set -uo pipefail
cd "$(dirname "$0")/../backend"
export TMPDIR=${TMPDIR:-/opt/sml/.buildtmp}
mkdir -p "$TMPDIR"

LINE_GO=cmd/lambdas/shared/line.go
GATE_GO=cmd/lambdas/shared/authgate.go
BAK=$(mktemp -d "$TMPDIR/mut.XXXXXX")
cp "$LINE_GO" "$BAK/line.go"
cp "$GATE_GO" "$BAK/authgate.go"

restore() { cp "$BAK/line.go" "$LINE_GO"; cp "$BAK/authgate.go" "$GATE_GO"; }
trap 'restore; rm -rf "$BAK"' EXIT INT TERM

FAIL=0

# apply <檔案> <原文> <替換> —— 探針必須**剛好命中一次**，否則中止。
# （命中 0 次＝改到別的地方去了、測試當然不會紅；命中多次＝順手改壞無關的行。
#   兩種都會讓這支腳本吐出好看但無意義的結果。）
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

# mut <描述> <檔案> <原文> <替換> <預期轉紅的測試 regex>
mut() {
  local desc=$1 file=$2 old=$3 new=$4 test_re=$5
  restore
  if ! apply "$file" "$old" "$new"; then
    echo "❌ [$desc] 突變沒套用（探針沒打中）"; FAIL=1; return
  fi
  if go test ./cmd/lambdas/shared/ -run "$test_re" >/dev/null 2>&1; then
    echo "❌ [$desc] 拿掉守衛後測試仍全過 → 該斷言沒有鑑別力"; FAIL=1
  else
    echo "✅ [$desc] 拿掉守衛 → 測試轉紅"
  fi
}

R_FIELD=TestVerifyLINEIDToken_RejectsEachInvalidField
R_NONCE=TestVerifyLINEIDToken_NonceForwardedAndChecked
R_CFG=TestVerifyLINEIDToken_NoChannelIDConfigured
R_JSON=TestVerifyLINEIDToken_NonJSONResponseIsRejected
R_S500=TestVerifyLINEIDToken_RejectsNon200WithValidBody
R_REQ=TestVerifyLINEIDToken_NonceRequired
R_GATE=TestShouldBlockTrustAction_Matrix

echo "── shared/line.go：id_token 驗證守衛 ──"
mut "iss 檢查"              "$LINE_GO" 'if vr.Iss != lineExpectedIssuer {'        'if false {' "$R_FIELD"
mut "aud 檢查"              "$LINE_GO" 'if vr.Aud != channelID {'                 'if false {' "$R_FIELD"
mut "sub 非空檢查"          "$LINE_GO" 'if vr.Sub == "" {'                        'if false {' "$R_FIELD"
mut "exp 過期檢查"          "$LINE_GO" 'if time.Now().Unix() >= vr.Exp {'         'if false {' "$R_FIELD"
mut "200 帶 error 欄位"     "$LINE_GO" 'if vr.Error != "" {'                      'if false {' "$R_FIELD"
# ⚠️ 這一發不是「把守衛換成 if false」，而是**把程式碼改回修補前的原樣**。
#    原本寫 `vr.Exp > 0 && ...`，於是 exp 缺欄位／0／負數會短路成「沒過期」＝一張
#    永不過期的票（Codex 2026-08-10 覆核指出）。單純拿掉 `vr.Exp <= 0` 那段沒有用：
#    後面那道 `now >= vr.Exp` 在 exp=0 時照樣會擋，兩道守衛重疊，測試不會轉紅。
#    要釘住的是「短路寫法」本身，所以探針必須還原成那個寫法。
mut "exp 短路回歸（缺失/0/負數）" "$LINE_GO" '	if vr.Exp <= 0 {
		return nil, errors.New("missing exp")
	}
	if time.Now().Unix() >= vr.Exp {' '	if vr.Exp > 0 && time.Now().Unix() >= vr.Exp {' "$R_FIELD"
# 同理：400 帶 error 會被 vr.Error 那道攔下、502 回 HTML 會被 JSON 解析失敗攔下，
# 所以狀態碼檢查要靠「狀態碼壞、內容全好」那一格才驗得到。
mut "非 200 檢查"           "$LINE_GO" 'if resp.StatusCode != http.StatusOK {'    'if false {' "$R_S500"
mut "nonce 相符檢查"        "$LINE_GO" 'if vr.Nonce != nonce {'                   'if false {' "$R_NONCE"
mut "channelID fail-closed" "$LINE_GO" 'if channelID == "" {'                     'if false {' "$R_CFG"
mut "nonce 必填"            "$LINE_GO" '	if strings.TrimSpace(nonce) == "" {
		return nil, ErrLineNonceRequired
	}
' '' "$R_REQ"
# 這一發不是拿掉守衛，而是**退回改動前的寫法**（「非空才比對」）。
# 那個寫法本身就是可繞過的旋鈕：不帶 nonce 就整道跳過，而且測試不會紅
# ——因為當時所有案例都乖乖帶了 nonce。要釘住的是「可跳過」這件事。
mut "nonce 可選旗標回歸" "$LINE_GO" '	if strings.TrimSpace(nonce) == "" {
		return nil, ErrLineNonceRequired
	}
' '	if nonce == "" {
		return &LineIdentity{Sub: "skipped"}, nil
	}
' "$R_REQ"

echo "── shared/authgate.go：信箱軟門檻 ──"
# ① 把 LINE 帳號的放行拿掉（＝退回加 hasEmail 維度之前的行為）
mut "無信箱帳號放行" "$GATE_GO" '	if !hasEmail {
		return false // 沒有信箱可驗
	}
' '' "$R_GATE"
# ② 門檻改成永遠不擋 —— 這一發專門檢查矩陣裡有沒有「必須擋」的正控。
#    只驗放行案例的話，一個恆假的門檻也會全過。
mut "門檻恆不擋（驗正控存在）" "$GATE_GO" '	return !verified
}' '	return false
}' "$R_GATE"

restore
echo "── 端點層：consume 必須早於 verify（原始碼順序檢查）──"
# ⚠️ 誠實說明強度：這是**原始碼順序**檢查，不是行為測試。
#   「同一個 nonce 只能消耗一次」是 DDB conditional update 的性質，要 E2E 才驗得到
#   （見 AUTH_SYSTEM_DESIGN §5.G）。這裡只保證沒有人把兩行對調或刪掉其中一行 ——
#   對調的話 verify 會先打 LINE，我們的端點就變成 LINE verify 的預言機。
for f in cmd/lambdas/apis/mahjongclub_auth_line/main.go \
         cmd/lambdas/apis/mahjongclub_auth_bind_line/main.go; do
  # 只看實際呼叫（行尾有 "(ctx," ），避開註解裡提到函式名的情況。
  c_line=$(grep -n 'shared\.ConsumeLineNonce(ctx,' "$f" | head -1 | cut -d: -f1)
  v_line=$(grep -n 'shared\.VerifyLINEIDToken(ctx,' "$f" | head -1 | cut -d: -f1)
  if [ -z "$c_line" ] || [ -z "$v_line" ]; then
    echo "❌ ${f##*/}：找不到 ConsumeLineNonce 或 VerifyLINEIDToken 的呼叫"; FAIL=1
  elif [ "$c_line" -ge "$v_line" ]; then
    echo "❌ ${f##*/}：ConsumeLineNonce(第 $c_line 行) 沒有早於 VerifyLINEIDToken(第 $v_line 行)"; FAIL=1
  else
    echo "✅ ${f##*/}：consume(L$c_line) → verify(L$v_line)"
  fi
done

echo "── 還原後回歸 ──"
if ! go test ./cmd/lambdas/shared/ 2>&1 | tail -3; then FAIL=1; fi
for f in "$LINE_GO:line.go" "$GATE_GO:authgate.go"; do
  if ! diff -q "${f%%:*}" "$BAK/${f##*:}" >/dev/null; then
    echo "❌ ${f%%:*} 沒有還原乾淨（工作樹被留下突變）"; FAIL=1
  fi
done
[ $FAIL -eq 0 ] && echo "✅ 全部守衛皆具鑑別力，原始碼已逐位元組還原" || echo "❌ 有項目未通過"
exit $FAIL
