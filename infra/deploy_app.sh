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
VPUB=$(get /ryojaku/stg/VAPID_PUBLIC_KEY)
VPRIV=$(get /ryojaku/stg/VAPID_PRIVATE_KEY)
VSUB=$(get /ryojaku/stg/VAPID_SUBSCRIBER)

# 非機密設定(明碼 String)。未建參數者留空 → 由 CFN Default 接手。
# ⚠️ GOOGLE_CLIENT_ID / MAIL_FROM 的 Default 指向工程師的 jiomj.com,不是我方 SES 身分,
#    沒設就會 Google 登入 fail-closed、寄信被 SES 退 MessageRejected。故此處明確警告。
opt(){ aws ssm get-parameter --region "$REGION" --name "$1" --query 'Parameter.Value' --output text 2>/dev/null || true; }
GCID=$(opt /ryojaku/stg/GOOGLE_CLIENT_ID)
MFROM=$(opt /ryojaku/stg/MAIL_FROM)
APPURL=$(opt /ryojaku/stg/APP_BASE_URL)
EXTRA=()
[ -n "$GCID" ]   && EXTRA+=("GoogleClientId=$GCID") || echo "⚠️  未設 /ryojaku/stg/GOOGLE_CLIENT_ID → Google 登入將 fail-closed(見 DEPLOY_PREREQS ②)"
[ -n "$MFROM" ]  && EXTRA+=("MailFrom=$MFROM")      || echo "⚠️  未設 /ryojaku/stg/MAIL_FROM → 沿用 no-reply@jiomj.com,SES 未驗證會退信(見 DEPLOY_PREREQS ①)"
[ -n "$APPURL" ] && EXTRA+=("AppBaseUrl=$APPURL")

python3 gen_app_template.py
exec ~/.local/bin/sam deploy --config-env stg -t 02-app.generated.yaml \
  --no-confirm-changeset --no-fail-on-empty-changeset --resolve-s3 --region "$REGION" \
  --parameter-overrides \
    "TablePrefix=MahjongClubStg_" "Stage=stg" \
    "EncryptionKey=$ENC" "JwtSecret=$JWT" \
    "VapidPublicKey=$VPUB" "VapidPrivateKey=$VPRIV" "VapidSubscriber=$VSUB" \
    "${EXTRA[@]}"
