#!/usr/bin/env bash
# 來源身分錨點（Ed25519）**產出端**。契約：
#   /opt/sml/repo/tools/ryojaku-webapp/modules/distribution.md §10（§10.2 格式／§10.4 產出端）。
# 驗證端是另一支（A3，`checks/origin_anchor_verify.sh`），本支**不做**線上驗證。
#
# 產出 <outdir>/.well-known/ryojaku-origin.json：
#   {"v":1,"payload_b64":"<base64(payload JSON)>","sig_b64":"<base64(Ed25519 sig)>"}
# 🔴 簽章輸入是 `payload_b64` **那串字的 ASCII 位元組本身**（不是 payload JSON）——
#    驗證端一個位元組都不必重組（§10.2 寫了為什麼）。
#
# 🔴 私鑰**絕不進 argv**：只收「檔案路徑」或 stdin（`--key -`），
#    stdin 那份落在 umask 077 的暫存檔並由 trap 刪掉。這支刻意不依賴 AWS ——
#    A3 與日後的驗收要能離線重現；綁死 SSM 就變成「只有部署時才驗得了」。
#
# 用法：
#   gen-origin-anchor.sh --key <priv.pem|-> --origin https://<host> --env <stg|preview> \
#       --index <dist/index.html> --out <outdir> [--build-id <id>] [--frontend-dir <git 目錄>] \
#       [--built-at <RFC3339 UTC>]
#   --build-id 未給 ⇒ 由 --frontend-dir（預設本支所在目錄）`git rev-parse --short HEAD`，髒樹加 -dirty。
#   --built-at 未給 ⇒ 現在（UTC）。給的話只為了讓兩次產出可逐位元組比對（驗收用）。
#
# 產完當場**自我驗證一次**：用私鑰推出的公鑰跑 `openssl pkeyutl -verify -rawin`，不過就 rc≠0
# 並**刪掉**產物（簽壞的錨點上線之後，A3 轉紅會被讀成「來源被換掉了」）。
#
# rc：0 產出並自驗通過／1 輸入不對或自驗不過（**沒有產物留下**）／
#     2 設備問題（openssl 不支援 ed25519、缺 jq）—— rc=2 不可讀成通過。
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)   # 🌲 不寫死檢出根

KEY=""; ORIGIN=""; ENVN=""; INDEX=""; OUT=""; BUILD_ID=""; FRONTEND_DIR="$HERE"; BUILT_AT=""
usage(){ sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --key)          KEY=${2:?--key 要值}; shift 2 ;;
    --origin)       ORIGIN=${2:?--origin 要值}; shift 2 ;;
    --env)          ENVN=${2:?--env 要值}; shift 2 ;;
    --index)        INDEX=${2:?--index 要值}; shift 2 ;;
    --out)          OUT=${2:?--out 要值}; shift 2 ;;
    --build-id)     BUILD_ID=${2:?--build-id 要值}; shift 2 ;;
    --frontend-dir) FRONTEND_DIR=${2:?--frontend-dir 要值}; shift 2 ;;
    --built-at)     BUILT_AT=${2:?--built-at 要值}; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    # 🔴 未知旗標一律中止，不可 fall-through（本機正典：「未知旗標 fail-open 落進 main()」那條）。
    *) echo "❌ 未知參數 '$1'" >&2; usage; exit 1 ;;
  esac
done

# ---- 設備 ----
command -v jq >/dev/null 2>&1 || { echo "rc=2 缺 jq" >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || { echo "rc=2 缺 openssl" >&2; exit 2; }
openssl list -public-key-algorithms 2>/dev/null | grep -qi 'ED25519' || {
  echo "rc=2 這顆 openssl 不支援 ED25519（$(openssl version)）" >&2; exit 2; }

# ---- 輸入 ----
[ -n "$KEY" ]    || { echo "❌ 缺 --key（私鑰檔路徑，或 - 走 stdin）" >&2; exit 1; }
[ -n "$ORIGIN" ] || { echo "❌ 缺 --origin" >&2; exit 1; }
[ -n "$ENVN" ]   || { echo "❌ 缺 --env" >&2; exit 1; }
[ -n "$INDEX" ]  || { echo "❌ 缺 --index" >&2; exit 1; }
[ -n "$OUT" ]    || { echo "❌ 缺 --out" >&2; exit 1; }
case "$ORIGIN" in
  https://*) ;;
  *) echo "❌ --origin 要以 https:// 開頭（§10.2：https://<SUBDOMAIN>），拿到 [$ORIGIN]" >&2; exit 1 ;;
esac
case "$ORIGIN" in
  */) echo "❌ --origin 結尾不可帶斜線（§10.2；A3 ③ 是逐字比），拿到 [$ORIGIN]" >&2; exit 1 ;;
esac
case "$ENVN" in stg|preview) ;; *) echo "❌ --env 只收 stg / preview，拿到 [$ENVN]" >&2; exit 1 ;; esac
[ -r "$INDEX" ] || { echo "❌ 讀不到 --index $INDEX" >&2; exit 1; }
if [ -n "$BUILT_AT" ]; then
  echo "$BUILT_AT" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || {
    echo "❌ --built-at 要是 RFC3339 UTC（YYYY-MM-DDTHH:MM:SSZ），拿到 [$BUILT_AT]" >&2; exit 1; }
fi

# ---- 私鑰：只在檔案裡，永遠不進 argv ----
WORK=$(umask 077; mktemp -d "${TMPDIR:-/tmp}/.ryojaku-oa.XXXXXX")
trap 'rm -rf "$WORK"' EXIT INT TERM
if [ "$KEY" = "-" ]; then
  KEYFILE="$WORK/priv.pem"
  (umask 077; cat > "$KEYFILE")
else
  [ -r "$KEY" ] || { echo "❌ 讀不到私鑰檔 $KEY" >&2; exit 1; }
  KEYFILE="$KEY"
fi
[ "$(wc -c < "$KEYFILE")" -gt 1 ] || { echo "❌ 私鑰是空的（0/1 byte）—— SSM 取值失敗常長這樣" >&2; exit 1; }
# 🔴 演算法要明講：實測 `pkeyutl -sign -rawin` 拿 EC P-256 私鑰**照樣簽得出來**，
#    而 A3 用釘住的 Ed25519 公鑰驗 ⇒ 必紅、而原因看不出來。
ALG=$(openssl pkey -in "$KEYFILE" -noout -text 2>/dev/null | head -1 || true)
case "$ALG" in
  "ED25519 Private-Key:") ;;
  "") echo "❌ 私鑰解析不出來（不是 PEM？）" >&2; exit 1 ;;
  *)  echo "❌ 私鑰不是 Ed25519（$ALG）" >&2; exit 1 ;;
esac
PUB="$WORK/pub.pem"
openssl pkey -in "$KEYFILE" -pubout -out "$PUB" 2>/dev/null || { echo "❌ 推不出公鑰" >&2; exit 1; }
# key_id：公鑰 raw 32 bytes 的 sha256 前 16 hex（§10.2：診斷，不是判準）。
# SPKI DER 是 12 bytes 前綴 + 32 bytes raw ⇒ 取尾 32。
RAW_LEN=$(openssl pkey -in "$KEYFILE" -pubout -outform DER 2>/dev/null | tail -c 32 | wc -c)
[ "$RAW_LEN" -eq 32 ] || { echo "❌ 公鑰 raw 長度不是 32（$RAW_LEN）" >&2; exit 1; }
KEY_ID=$(openssl pkey -in "$KEYFILE" -pubout -outform DER 2>/dev/null | tail -c 32 | sha256sum | cut -c1-16)

# ---- payload ----
INDEX_SHA=$(sha256sum -- "$INDEX" | cut -d' ' -f1)
if [ -z "$BUILD_ID" ]; then
  BUILD_ID=$(git -C "$FRONTEND_DIR" rev-parse --short HEAD 2>/dev/null) || {
    echo "❌ --build-id 未給，而 $FRONTEND_DIR 不是 git 檢出（給 --build-id 或 --frontend-dir）" >&2; exit 1; }
  # 髒樹加 -dirty（§10.2）。只看已追蹤檔（untracked 在共用工作樹上永遠有，會讓每一版都 -dirty），
  # 且只看 --frontend-dir 這棵子樹（build 的輸入是它，不是整個 monorepo）。
  if [ -n "$(git -C "$FRONTEND_DIR" status --porcelain --untracked-files=no -- . 2>/dev/null)" ]; then
    BUILD_ID="$BUILD_ID-dirty"
  fi
fi
[ -n "$BUILT_AT" ] || BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

PAYLOAD=$(jq -cn --arg origin "$ORIGIN" --arg env "$ENVN" --arg sha "$INDEX_SHA" \
                 --arg build "$BUILD_ID" --arg at "$BUILT_AT" --arg kid "$KEY_ID" \
  '{origin:$origin, env:$env, index_sha256:$sha, build_id:$build, built_at:$at, key_id:$kid}')
PAYLOAD_B64=$(printf '%s' "$PAYLOAD" | base64 -w0)

# ---- 簽：輸入是 payload_b64 那串字的 ASCII 位元組（無換行）----
MSG="$WORK/msg"; SIG="$WORK/sig.bin"
printf '%s' "$PAYLOAD_B64" > "$MSG"
openssl pkeyutl -sign -inkey "$KEYFILE" -rawin -in "$MSG" -out "$SIG" 2>/dev/null || { echo "❌ 簽章失敗" >&2; exit 1; }
[ "$(wc -c < "$SIG")" -eq 64 ] || { echo "❌ 簽章不是 64 bytes（$(wc -c < "$SIG")）" >&2; exit 1; }
SIG_B64=$(base64 -w0 < "$SIG")

# ---- 寫檔（先寫暫存，再 mv 進落點）----
DEST_DIR="$OUT/.well-known"; DEST="$DEST_DIR/ryojaku-origin.json"
mkdir -p "$DEST_DIR"
TMP_OUT="$WORK/ryojaku-origin.json"
jq -cn --arg p "$PAYLOAD_B64" --arg s "$SIG_B64" '{v:1, payload_b64:$p, sig_b64:$s}' > "$TMP_OUT"

# ---- 自我驗證：用**寫出來的那個檔**（不是記憶體裡的變數）＋推出的公鑰 ----
VMSG="$WORK/vmsg"; VSIG="$WORK/vsig.bin"
jq -rj '.payload_b64' "$TMP_OUT" > "$VMSG"
jq -rj '.sig_b64' "$TMP_OUT" | base64 -d > "$VSIG"
if ! openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$VMSG" -sigfile "$VSIG" >/dev/null 2>&1; then
  echo "❌ 自我驗證不過：剛簽出來的錨點用自己的公鑰驗不過 ⇒ 不留產物" >&2; exit 1
fi
# 檔內的 payload 解回來要等於我要簽的那份（擋 base64/jq 這一段把字串弄壞）
[ "$(base64 -d < "$VMSG")" = "$PAYLOAD" ] || { echo "❌ 檔內 payload_b64 解回來與原 payload 不同 ⇒ 不留產物" >&2; exit 1; }

mv -f "$TMP_OUT" "$DEST"
echo "✔ 來源身分錨點 → $DEST"
echo "  origin=$ORIGIN env=$ENVN build_id=$BUILD_ID built_at=$BUILT_AT"
echo "  index_sha256=$INDEX_SHA"
echo "  key_id=$KEY_ID（診斷用，不是 A3 的判準）"
echo "  自驗：pkeyutl -verify -rawin 通過（公鑰由私鑰推出）"
