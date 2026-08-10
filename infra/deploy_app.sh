#!/usr/bin/env bash
# 部署計算層 stack。機密於部署時從 SSM SecureString 解密，以 NoEcho 參數注入
# （CFN 禁止 ssm-secure 動態引用用於 Lambda env）。值不落地、不進 git。
set -euo pipefail
cd "$(dirname "$0")"
REGION=ap-southeast-1
export TMPDIR=/opt/sml/ryojaku-src/.tmp SAM_CLI_TELEMETRY=0
mkdir -p "$TMPDIR"
get(){ aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption --query 'Parameter.Value' --output text; }
ENC=$(get /ryojaku/stg/ENCRYPTION_KEY)
JWT=$(get /ryojaku/stg/JWT_SECRET)
AJWT=$(get /ryojaku/stg/ADMIN_JWT_SECRET)   # D5：admin 專用簽章金鑰
VPUB=$(get /ryojaku/stg/VAPID_PUBLIC_KEY)
VPRIV=$(get /ryojaku/stg/VAPID_PRIVATE_KEY)
VSUB=$(get /ryojaku/stg/VAPID_SUBSCRIBER)

# 非機密設定(明碼 String)。未建參數者留空 → 由 CFN Default 接手。
# ⚠️ GOOGLE_CLIENT_ID / MAIL_FROM 的 Default 指向工程師的 jiomj.com,不是我方 SES 身分,
#    沒設就會 Google 登入 fail-closed、寄信被 SES 退 MessageRejected。故此處明確警告。
opt(){ aws ssm get-parameter --region "$REGION" --name "$1" --query 'Parameter.Value' --output text 2>/dev/null || true; }
# 🔴 SecureString 專用的「可缺席」取值：一定要 --with-decryption。
#    少了它 aws cli **不會報錯**，而是回傳密文 —— 部署會成功、LINE 登入卻永遠換不到
#    token，症狀指向 LINE 而不是這裡。用 get() 不行（那支 set -e 下缺參數會中止整個部署，
#    但 channel secret 在申請下來之前本來就該允許缺席並 fail-closed）。
optsec(){ aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true; }
GCID=$(opt /ryojaku/stg/GOOGLE_CLIENT_ID)
LCID=$(opt /ryojaku/stg/LINE_LOGIN_CHANNEL_ID)
LCSEC=$(optsec /ryojaku/stg/LINE_LOGIN_CHANNEL_SECRET)
MFROM=$(opt /ryojaku/stg/MAIL_FROM)
APPURL=$(opt /ryojaku/stg/APP_BASE_URL)
EXTRA=()
[ -n "$GCID" ]   && EXTRA+=("GoogleClientId=$GCID") || echo "⚠️  未設 /ryojaku/stg/GOOGLE_CLIENT_ID → Google 登入將 fail-closed(見 DEPLOY_PREREQS ②)"
[ -n "$LCID" ]   && EXTRA+=("LineLoginChannelId=$LCID") || echo "⚠️  未設 /ryojaku/stg/LINE_LOGIN_CHANNEL_ID → LINE 登入將 fail-closed(見 DEPLOY_PREREQS ④)"
# ID 有設、secret 沒設 → web 的 code 交換一定失敗。這種半套狀態要明講,
# 否則症狀會是「Google 能登入、LINE 按下去就 401」,查起來會先懷疑 LINE 那邊。
[ -n "$LCSEC" ]  && EXTRA+=("LineLoginChannelSecret=$LCSEC") || echo "⚠️  未設 /ryojaku/stg/LINE_LOGIN_CHANNEL_SECRET → LINE **web** 登入(code 交換)將 fail-closed(見 DEPLOY_PREREQS ④)"
[ -n "$MFROM" ]  && EXTRA+=("MailFrom=$MFROM")      || echo "⚠️  未設 /ryojaku/stg/MAIL_FROM → 沿用 no-reply@jiomj.com,SES 未驗證會退信(見 DEPLOY_PREREQS ①)"
[ -n "$APPURL" ] && EXTRA+=("AppBaseUrl=$APPURL")

python3 gen_app_template.py

# ---------------------------------------------------------------------------
# 機密傳遞：走臨時 samconfig，不走命令列。
#
# 🔴 原本這裡是 `sam deploy --parameter-overrides "JwtSecret=$JWT" ...`。
# 本檔開頭寫「值不落地、不進 git」—— 那兩點都成立，但漏了第三個面向：
# **命令列參數會進 process cmdline**，於是整個部署期間（數分鐘），主機上任何
# 使用者一句 `ps -ef` 就能讀到 JWT_SECRET／ADMIN_JWT_SECRET／ENCRYPTION_KEY／
# VAPID 私鑰的明文（/proc/<pid>/cmdline 對同機使用者可讀，不需 root）。
# 2026-07-30 實際發生過：例行 `ps` 診斷就把六個 secret 全印了出來。
#
# 改走 --config-file：值只存在於一個 umask 077 建立的暫存檔，位於 .tmp/
# （.gitignore:30 已涵蓋，git check-ignore 實證），並由 trap 在任何結束路徑刪除。
# 檔案短暫落地是刻意的取捨 —— 0600 檔案只有 owner 與 root 讀得到，
# 遠比「整個部署期間對全體本機使用者敞開的 cmdline」窄。
# ---------------------------------------------------------------------------
PARAMS=("TablePrefix=MahjongClubStg_" "Stage=stg"
        "EncryptionKey=$ENC" "JwtSecret=$JWT" "AdminJwtSecret=$AJWT"
        "VapidPublicKey=$VPUB" "VapidPrivateKey=$VPRIV" "VapidSubscriber=$VSUB"
        "${EXTRA[@]}")

# fail-closed：值若含 " 或 \ 或換行會破壞 TOML 字串，可能被靜默截斷成錯誤的參數。
# 寧可中止也不要送出一個「看起來成功、其實金鑰是半截」的部署。
for kv in "${PARAMS[@]}"; do
  case "$kv" in
    *'"'*|*'\'*) echo "❌ 參數含 TOML 不安全字元，中止：${kv%%=*}" >&2; exit 1;;
  esac
  [ "$(printf '%s' "$kv" | wc -l)" -eq 0 ] || { echo "❌ 參數含換行，中止：${kv%%=*}" >&2; exit 1; }
done

umask 077
CFG="$TMPDIR/samcfg.$$.toml"
trap 'rm -f "$CFG"' EXIT INT TERM
grep -v '^[[:space:]]*parameter_overrides' samconfig.toml > "$CFG"
{
  printf 'parameter_overrides = [\n'
  for kv in "${PARAMS[@]}"; do printf '  "%s",\n' "$kv"; done
  printf ']\n'
} >> "$CFG"
chmod 600 "$CFG"

~/.local/bin/sam deploy --config-file "$CFG" --config-env stg -t 02-app.generated.yaml \
  --no-confirm-changeset --no-fail-on-empty-changeset --resolve-s3 --region "$REGION"
