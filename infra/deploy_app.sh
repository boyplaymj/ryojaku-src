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
python3 gen_app_template.py
exec ~/.local/bin/sam deploy --config-env stg -t 02-app.generated.yaml \
  --no-confirm-changeset --no-fail-on-empty-changeset --resolve-s3 --region "$REGION" \
  --parameter-overrides \
    "TablePrefix=MahjongClubStg_" "Stage=stg" \
    "EncryptionKey=$ENC" "JwtSecret=$JWT" \
    "VapidPublicKey=$VPUB" "VapidPrivateKey=$VPRIV" "VapidSubscriber=$VSUB"
