#!/usr/bin/env bash
# `gen-origin-anchor.sh`（來源身分錨點・產出端）與它接進 `deploy-stg.sh` 那段的驗收。
# 契約：/opt/sml/repo/tools/ryojaku-webapp/modules/distribution.md §10.2／§10.4。
#
# 兩組格子：
#   G 組 直接打產生器（正控 ＋ 反控 a–h）—— 驗簽由**本支自己**跑 openssl，不信產生器自報的「自驗通過」。
#   E 組 把 deploy-stg.sh **複製**到沙盒、PATH 前面塞假的 aws／npm，端到端走一次 —— 沒有 AWS、
#        不動真的 dist/。它問的是 §10.4 的五點在**那支腳本裡**有沒有真的接上（缺金鑰中止／顯式豁免／
#        origin 取自 $SUBDOMAIN／排除大批 sync／單獨 cp 帶 no-cache）。
#
# 🔴 這一行刻意**不寫格數**：格數只有一個來源 `EXPECT_CELLS`，抬頭／收尾都讀它，實跑不符一律 rc=2。
# rc：0 每格相符／1 有格子不符／2 設備問題（落點 tmpfs、openssl 不支援 ed25519、突變錨點漂了、
#     格數不符）—— rc=2 不可讀成通過。
set -uo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)   # 🌲 不寫死檢出根
GEN="$HERE/gen-origin-anchor.sh"
DEPLOY="$HERE/deploy-stg.sh"
EXPECT_CELLS=19   # 唯一的格數來源

for f in "$GEN" "$DEPLOY"; do [ -r "$f" ] || { echo "rc=2 找不到 $f"; exit 2; }; done
for t in openssl jq base64 sha256sum git; do command -v "$t" >/dev/null || { echo "rc=2 缺 $t"; exit 2; }; done
openssl list -public-key-algorithms 2>/dev/null | grep -qi ED25519 || { echo "rc=2 openssl 不支援 ED25519"; exit 2; }

LAND=${DOC_CTRL_TMPDIR:-/opt/sml/.buildtmp}
case "$(df -PT "$LAND" 2>/dev/null | awk 'NR==2{print $2}')" in
  tmpfs|ramfs) echo "rc=2 落點 $LAND 是 tmpfs＝RAM，換一個"; exit 2 ;;
  "") echo "rc=2 落點 $LAND 不存在"; exit 2 ;;
esac
umask 077
D=$(mktemp -d "$LAND/ryo-oa-test-XXXXXX") || { echo "rc=2 建不出暫存目錄"; exit 2; }
trap 'rm -rf "$D"' EXIT INT TERM
export TMPDIR="$D/tmp"; mkdir -p "$TMPDIR"   # 產生器的暫存也落在 xfs，不落 /tmp

n=0; bad=0
cell() {  # <名> <期望> <實得>
  n=$((n+1))
  if [ "$2" = "$3" ]; then printf '  ok    %-52s %s\n' "$1" "$3"
  else printf '  FAIL  %-52s 期望=[%s] 實得=[%s]\n' "$1" "$2" "$3"; bad=$((bad+1)); fi
}
anchor() { jq -r "$2" "$1/.well-known/ryojaku-origin.json" 2>/dev/null; }
payload() { anchor "$1" .payload_b64 | base64 -d | jq -r "$2"; }
# 本支自己的驗簽（不經產生器）：<dir> <pub.pem> → pass/FAIL
verify() {
  local m="$D/v.msg" s="$D/v.sig"
  jq -rj .payload_b64 "$1/.well-known/ryojaku-origin.json" > "$m"
  jq -rj .sig_b64 "$1/.well-known/ryojaku-origin.json" | base64 -d > "$s"
  if openssl pkeyutl -verify -pubin -inkey "$2" -rawin -in "$m" -sigfile "$s" >/dev/null 2>&1; then echo pass; else echo FAIL; fi
}

# ---- 假件 ----
openssl genpkey -algorithm ed25519 -out "$D/k1.pem" 2>/dev/null
openssl genpkey -algorithm ed25519 -out "$D/k2.pem" 2>/dev/null
openssl pkey -in "$D/k1.pem" -pubout -out "$D/k1.pub" 2>/dev/null
openssl pkey -in "$D/k2.pem" -pubout -out "$D/k2.pub" 2>/dev/null
openssl genpkey -algorithm ec -pkeyopt ec_paramgen_curve:P-256 -out "$D/ec.pem" 2>/dev/null
printf '<!DOCTYPE html><html><head><title>両雀</title></head><body>app</body></html>' > "$D/index.html"
AT=2026-09-17T00:00:00Z
ORG=https://ryojaku-stg.boyplaymj.com

echo "== $EXPECT_CELLS 格（G 組：產生器／E 組：deploy-stg.sh 沙盒端到端）"

# ---- G 正控 ----
mkdir -p "$D/o1"
"$GEN" --key "$D/k1.pem" --origin "$ORG" --env stg --index "$D/index.html" --out "$D/o1" --build-id abc1234 --built-at "$AT" >"$D/o1.log" 2>&1
cell "G1 正控：產出 rc=0、v==1、三欄都在" "0 1 3" \
  "$? $(anchor "$D/o1" .v) $(jq -r 'has("v") and has("payload_b64") and has("sig_b64") | if . then 3 else 0 end' "$D/o1/.well-known/ryojaku-origin.json" 2>/dev/null)"
IDX_SHA=$(sha256sum "$D/index.html" | cut -c1-64)
cell "G2 正控：payload 欄位 == 餵進去的值" "$ORG|stg|$IDX_SHA|abc1234|$AT" \
  "$(payload "$D/o1" '[.origin,.env,.index_sha256,.build_id,.built_at]|join("|")')"
cell "G3 正控：本支自己用 k1 公鑰驗簽（不信產生器自報）" pass "$(verify "$D/o1" "$D/k1.pub")"
KID=$(openssl pkey -in "$D/k1.pem" -pubout -outform DER 2>/dev/null | tail -c 32 | sha256sum | cut -c1-16)
cell "G4 正控：key_id == sha256(raw pub32)[:16]（本支自算）" "$KID" "$(payload "$D/o1" .key_id)"
mkdir -p "$D/o1s"
"$GEN" --key - --origin "$ORG" --env stg --index "$D/index.html" --out "$D/o1s" --build-id abc1234 --built-at "$AT" < "$D/k1.pem" >/dev/null 2>&1
cell "G5 正控：--key - 走 stdin ⇒ 與檔案路徑逐位元組相同（Ed25519 確定性）" same \
  "$(cmp -s "$D/o1/.well-known/ryojaku-origin.json" "$D/o1s/.well-known/ryojaku-origin.json" && echo same || echo differ)"

# ---- G 反控 ----
# a：payload_b64 改一個位元組（第 5 個字元換成別的 base64 字元）⇒ 本支驗簽必須紅
mkdir -p "$D/oa/.well-known"
PB=$(anchor "$D/o1" .payload_b64); c=${PB:4:1}; [ "$c" = A ] && r=B || r=A
jq -c --arg p "${PB:0:4}$r${PB:5}" '.payload_b64=$p' "$D/o1/.well-known/ryojaku-origin.json" > "$D/oa/.well-known/ryojaku-origin.json"
cell "a 反控：payload_b64 改一個位元組 ⇒ 驗不過" FAIL "$(verify "$D/oa" "$D/k1.pub")"
cell "b 反控：換一把金鑰（k2 公鑰）驗 ⇒ 驗不過" FAIL "$(verify "$D/o1" "$D/k2.pub")"
# c：origin 來自參數 —— 換一個 SUBDOMAIN，產出的 origin 必須跟著變
mkdir -p "$D/oc"
"$GEN" --key "$D/k1.pem" --origin https://ryojaku-preview.boyplaymj.com --env preview --index "$D/index.html" --out "$D/oc" --build-id abc1234 --built-at "$AT" >/dev/null 2>&1
cell "c 反控：換 --origin ⇒ origin 欄位跟著變（且 ≠ stg 那份）" "https://ryojaku-preview.boyplaymj.com differ" \
  "$(payload "$D/oc" .origin) $([ "$(payload "$D/oc" .origin)" = "$(payload "$D/o1" .origin)" ] && echo same || echo differ)"
# d：index_sha256 真的來自那個檔 —— 改 index.html 一個位元組
mkdir -p "$D/od"; sed 's/app/apq/' "$D/index.html" > "$D/index2.html"
"$GEN" --key "$D/k1.pem" --origin "$ORG" --env stg --index "$D/index2.html" --out "$D/od" --build-id abc1234 --built-at "$AT" >/dev/null 2>&1
cell "d 反控：index.html 改一個位元組 ⇒ index_sha256 變、且等於新檔 sha" "differ $(sha256sum "$D/index2.html" | cut -c1-64)" \
  "$([ "$(payload "$D/od" .index_sha256)" = "$IDX_SHA" ] && echo same || echo differ) $(payload "$D/od" .index_sha256)"
# e：自驗有牙 —— 產生器副本突變成「簽的是 index 的位元組、不是 payload_b64」⇒ 必須 rc=1 且不留產物
MUT="$D/gen-mut.sh"; ANCH='openssl pkeyutl -sign -inkey "$KEYFILE" -rawin -in "$MSG" -out "$SIG"'
hits=$(grep -cF "$ANCH" "$GEN"); [ "$hits" = 1 ] || { echo "rc=2 突變錨點命中 $hits 次（要恰好 1）⇒ 尺沒對準"; exit 2; }
sed "s|$ANCH|openssl pkeyutl -sign -inkey \"\$KEYFILE\" -rawin -in \"\$INDEX\" -out \"\$SIG\"|" "$GEN" > "$MUT"; chmod +x "$MUT"
cmp -s "$GEN" "$MUT" && { echo "rc=2 突變沒打出去（副本與原檔相同）"; exit 2; }
mkdir -p "$D/oe"
"$MUT" --key "$D/k1.pem" --origin "$ORG" --env stg --index "$D/index.html" --out "$D/oe" --build-id abc1234 --built-at "$AT" >/dev/null 2>&1; erc=$?
cell "e 反控：自驗有牙 —— 簽錯位元組的突變 ⇒ rc=1 且無產物" "1 absent" "$erc $([ -e "$D/oe/.well-known/ryojaku-origin.json" ] && echo present || echo absent)"
mkdir -p "$D/of"
"$GEN" --key "$D/ec.pem" --origin "$ORG" --env stg --index "$D/index.html" --out "$D/of" --build-id x >/dev/null 2>&1; frc=$?
cell "f 反控：EC P-256 私鑰（-rawin 照樣簽得出）⇒ rc=1 且無產物" "1 absent" "$frc $([ -e "$D/of/.well-known/ryojaku-origin.json" ] && echo present || echo absent)"
mkdir -p "$D/og"
"$GEN" --key "$D/nope.pem" --origin "$ORG" --env stg --index "$D/index.html" --out "$D/og" --build-id x >/dev/null 2>&1; grc=$?
cell "g 反控：私鑰檔不存在 ⇒ rc=1 且無產物" "1 absent" "$grc $([ -e "$D/og/.well-known/ryojaku-origin.json" ] && echo present || echo absent)"
mkdir -p "$D/oh"
"$GEN" --key "$D/k1.pem" --origin "$ORG/" --env stg --index "$D/index.html" --out "$D/oh" --build-id x >/dev/null 2>&1; hrc=$?
cell "h 反控：--origin 帶尾斜線（A3 ③ 逐字比會紅）⇒ rc=1" 1 "$hrc"

# ---- E 組：deploy-stg.sh 沙盒端到端（假 aws／npm，不碰 AWS、不碰真 dist/）----
SB="$D/sandbox"; mkdir -p "$SB/bin" "$SB/app/dist/assets" "$SB/app/node_modules"
cp "$DEPLOY" "$GEN" "$SB/app/"
( cd "$SB/app" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init )
cp "$D/index.html" "$SB/app/dist/index.html"; : > "$SB/app/dist/sw.js"; : > "$SB/app/dist/manifest.webmanifest"
printf 'x("https://ryojaku-api.boyplaymj.com","wss://ryojaku-ws.boyplaymj.com")' > "$SB/app/dist/assets/index-abc.js"
cat > "$SB/bin/aws" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$AWS_LOG"
case "$1 $2" in
  "cloudfront list-distributions") echo E2FAKE ;;
  "ssm get-parameter")
    case "$*" in
      *ORIGIN_SIGNING_KEY*) [ -n "${FAKE_ORIGIN_KEY:-}" ] && [ -r "$FAKE_ORIGIN_KEY" ] && cat "$FAKE_ORIGIN_KEY" || exit 255 ;;
      *) exit 255 ;;
    esac ;;
  "cloudfront create-invalidation") echo '{"id":"I1","status":"InProgress"}' ;;
  *) : ;;
esac
SH
printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/bin/npm"; chmod +x "$SB/bin/aws" "$SB/bin/npm"
run_deploy() {  # <log 名> [ENV=… 覆寫...] → rc；每次都從乾淨的 dist/.well-known 開始
  local log="$D/$1.awslog"; shift; : > "$log"; rm -rf "$SB/app/dist/.well-known"
  ( cd "$SB/app" && env PATH="$SB/bin:$PATH" AWS_LOG="$log" SKIP_RULESET_SEED_CHECK=1 SKIP_ENGINE_VERSION_CHECK=1 \
      "$@" bash ./deploy-stg.sh stg ) > "$D/deploy.out" 2>&1; echo $?
}
# E1 缺金鑰 ⇒ 中止，且**一條上傳都沒發生**（中止點在 sync 之前）
rc=$(run_deploy e1)
cell "E1 缺 SSM 金鑰 ⇒ 部署中止 rc=1、s3 sync/cp 0 次" "1 0" "$rc $(grep -cE '^s3 (sync|cp) ' "$D/e1.awslog")"
# E2 顯式豁免 ⇒ 走完，但錨點不產、不傳（sync 仍排除它 ⇒ 桶裡舊的留著）
rc=$(run_deploy e2 SKIP_ORIGIN_ANCHOR=1)
cell "E2 SKIP_ORIGIN_ANCHOR=1 ⇒ 部署走完 rc=0、錨點不產、cp 0 次" "0 absent 0" \
  "$rc $([ -e "$SB/app/dist/.well-known/ryojaku-origin.json" ] && echo present || echo absent) $(grep -cE '^s3 cp .*ryojaku-origin\.json' "$D/e2.awslog")"
# E3 有金鑰 ⇒ 產出、origin == https://$SUBDOMAIN（腳本預設 stg 值）、本支用 k1 公鑰驗得過
rc=$(run_deploy e3 FAKE_ORIGIN_KEY="$D/k1.pem")
cell "E3 有金鑰 ⇒ rc=0、錨點 origin==https://ryojaku-stg.boyplaymj.com、k1 驗得過" "0 https://ryojaku-stg.boyplaymj.com pass" \
  "$rc $(payload "$SB/app/dist" .origin) $(verify "$SB/app/dist" "$D/k1.pub")"
cell "E4 index_sha256 == 沙盒 dist/index.html 的 sha（簽的是會上傳的那份）" "$(sha256sum "$SB/app/dist/index.html" | cut -c1-64)" "$(payload "$SB/app/dist" .index_sha256)"
cell "E5 大批 sync 排除錨點 ＋ 單獨 cp 帶 no-cache 與 application/json" "1 1" \
  "$(grep -cE '^s3 sync .*--exclude \.well-known/ryojaku-origin\.json' "$D/e3.awslog") $(grep -cE '^s3 cp dist/\.well-known/ryojaku-origin\.json .*--cache-control no-cache,must-revalidate --content-type application/json' "$D/e3.awslog")"
# E6 換 SUBDOMAIN ⇒ 錨點 origin 跟著變（少了它，「讀了參數」與「寫死 stg」在 stg 上逐字相同）
rc=$(run_deploy e6 FAKE_ORIGIN_KEY="$D/k1.pem" SUBDOMAIN=ryojaku-alt.example.test)
cell "E6 SUBDOMAIN 換掉 ⇒ 錨點 origin 跟著變" "0 https://ryojaku-alt.example.test" "$rc $(payload "$SB/app/dist" .origin)"

echo
[ "$n" -eq "$EXPECT_CELLS" ] || { echo "rc=2 格數不符：宣告 $EXPECT_CELLS，實跑 $n"; exit 2; }
[ "$bad" -eq 0 ] || { echo "rc=1 有 $bad 格不符"; exit 1; }
echo "rc=0 $n 格讀數相符（G 組：產生器正控＋反控／E 組：deploy-stg.sh 沙盒端到端，未碰 AWS）"
