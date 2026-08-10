#!/usr/bin/env bash
# 一次性：為玩家端 staging 開通 CloudFront + Route53。跑過一次就不用再跑（本腳本可重複執行，已存在會跳過）。
#
# 為什麼不用工程師的 deploy-to-s3.sh：
#   那支指向 bucket mahjongclub-app / distribution E3I3J0SFSPTE2W，兩者都在「工程師自己的 AWS 帳號」
#   （我方帳號實測 GetBucketLocation→AccessDenied、GetDistribution→NoSuchDistribution）。
#   它同時會把桶開成 public-read + S3 website。我方一律走 OAC 私有桶，沿用 Console 那套。
#
# 沿用的既有資源（都不新建）：
#   桶   boyplaymj-image        —— 四道 public access block 全開，只靠 OAC 供流量
#   OAC  E3P906FWBYTA8I         —— 與 jiomj / ryojaku-console 共用
#   憑證 *.boyplaymj.com 萬用憑證 —— 所以不必簽新 ACM、不必等 DNS 驗證
set -euo pipefail

SUBDOMAIN="${SUBDOMAIN:-ryojaku-stg.boyplaymj.com}"
S3_PREFIX_PATH="/ryojaku-app-stg"          # 桶內路徑，對應 CloudFront OriginPath
BUCKET="boyplaymj-image"
BUCKET_DOMAIN="boyplaymj-image.s3.ap-southeast-1.amazonaws.com"
OAC_ID="E3P906FWBYTA8I"
CERT_ARN="arn:aws:acm:us-east-1:380931373365:certificate/a20607ce-63e4-4197-8771-5ddc770034a8"  # *.boyplaymj.com
ZONE_ID="Z09356601JX6VL1ZSUE2I"            # boyplaymj.com
ACCOUNT="380931373365"
# CachingOptimized（AWS 託管），與 jiomj / ryojaku-console 同一組
CACHE_POLICY="658327ea-f89d-4fab-a63d-7e88639e58f6"

echo "▶ 子網域=$SUBDOMAIN  桶路徑=s3://$BUCKET$S3_PREFIX_PATH"

# ── 1. CloudFront distribution ───────────────────────────────────────────────
# 用 alias 反查，所以重跑不會開出第二個。
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items!=null] | [?contains(Aliases.Items, '$SUBDOMAIN')].Id | [0]" \
  --output text 2>/dev/null || echo "None")

if [ "$DIST_ID" != "None" ] && [ -n "$DIST_ID" ]; then
  echo "✔ distribution 已存在：$DIST_ID（跳過建立）"
else
  # CallerReference 必須唯一；用子網域當值，等同天然的冪等鍵。
  cat > /tmp/ryojaku-stg-dist.json <<JSON
{
  "CallerReference": "$SUBDOMAIN-v1",
  "Comment": "両雀 玩家端 staging",
  "Aliases": { "Quantity": 1, "Items": ["$SUBDOMAIN"] },
  "DefaultRootObject": "index.html",
  "Origins": { "Quantity": 1, "Items": [{
    "Id": "s3-$BUCKET-app-stg",
    "DomainName": "$BUCKET_DOMAIN",
    "OriginPath": "$S3_PREFIX_PATH",
    "S3OriginConfig": { "OriginAccessIdentity": "" },
    "OriginAccessControlId": "$OAC_ID",
    "CustomHeaders": { "Quantity": 0 },
    "ConnectionAttempts": 3, "ConnectionTimeout": 10
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-$BUCKET-app-stg",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 2, "Items": ["HEAD","GET"],
      "CachedMethods": { "Quantity": 2, "Items": ["HEAD","GET"] } },
    "Compress": true,
    "CachePolicyId": "$CACHE_POLICY"
  },
  "CustomErrorResponses": { "Quantity": 2, "Items": [
    { "ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 0 },
    { "ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 0 }
  ]},
  "ViewerCertificate": {
    "ACMCertificateArn": "$CERT_ARN",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "PriceClass": "PriceClass_200",
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "Enabled": true
}
JSON
  DIST_ID=$(aws cloudfront create-distribution --distribution-config file:///tmp/ryojaku-stg-dist.json \
    --query "Distribution.Id" --output text)
  echo "✔ 已建立 distribution：$DIST_ID"
fi

CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query "Distribution.DomainName" --output text)
echo "  CloudFront 網域：$CF_DOMAIN"

# ── 2. 桶 policy 白名單 ──────────────────────────────────────────────────────
# ⚠️ 這步漏了就是整站 403。policy 用 SourceArn 陣列逐一列出 distribution，
#    新開的 distribution 不在陣列裡 → OAC 帶著簽章來、S3 照樣拒絕。
#    一定要 append：陣列裡另外三個（image ×2、jiomj、console）動到任何一個都會弄掛別的站。
NEW_ARN="arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID"
# 這份就是回滾點。任何一步失敗都用它還原：
#   aws s3api put-bucket-policy --bucket boyplaymj-image --policy file:///tmp/ryojaku-bucket-policy.json
aws s3api get-bucket-policy --bucket "$BUCKET" --query Policy --output text > /tmp/ryojaku-bucket-policy.json

# 既有四站的正控探針。URL 是實際挑過、**現況都回 200** 的（2026-08-10 實測）：
#   image ×2 沒有 OriginPath，所以指到桶根的真實物件；jiomj 的 app 在 /admin/；console 有 DefaultRootObject。
PROBES=(
  "https://image.boyplaymj.com/autoreply/000b4f5bfd8f.png"
  "https://image.boyplaymj.link/autoreply/000b4f5bfd8f.png"
  "https://jiomj.boyplaymj.com/admin/"
  "https://ryojaku-console.boyplaymj.com/"
)
probe_all() {   # 回傳非 0 = 有站不是 200
  local bad=0 u code
  for u in "${PROBES[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$u" || echo 000)
    if [ "$code" = "200" ]; then printf "    ✔ %s  %s\n" "$code" "$u"
    else printf "    ✘ %s  %s\n" "$code" "$u"; bad=1; fi
  done
  return $bad
}

echo "  ▸ 寫回前正控（四站必須都是 200）"
probe_all || {
  echo "❌ 動手前就有站不是 200 —— 先查清楚原因。" >&2
  echo "   這時候不能繼續：探針起點若不是綠的，事後就分不出「我弄壞的」與「本來就壞的」。" >&2
  exit 1
}

# 🔴 `|| rc=$?` 不可省。這支 python 拿 exit code 當控制流（10=要寫回），而本檔開頭有
#    `set -e` —— 裸呼叫一個回傳非 0 的指令會**當場中止整支腳本**，下一行的 `rc=$?` 根本
#    不會執行。實測過：中止碼 10，於是 distribution 建好了、桶 policy 沒更新、DNS 沒建，
#    留下一個對全世界 403 的站；而且重跑也修不好（ARN 永遠加不進去 → 永遠 exit 10 → 永遠中止）。
#    加上 `|| rc=$?` 讓它變成「受測試的指令」，set -e 就不會觸發。
rc=0
python3 - "$NEW_ARN" <<'PY' || rc=$?
import json, sys
arn = sys.argv[1]
p = json.load(open('/tmp/ryojaku-bucket-policy.json'))
for st in p['Statement']:
    cond = st.get('Condition', {}).get('StringEquals', {})
    if 'AWS:SourceArn' not in cond:
        continue
    arns = cond['AWS:SourceArn']
    if isinstance(arns, str):          # 單一 ARN 時 AWS 會存成字串而非陣列
        arns = [arns]
    if arn in arns:
        print(f'✔ 桶 policy 已含 {arn}（跳過）')
        sys.exit(0)
    arns.append(arn)
    cond['AWS:SourceArn'] = arns
    json.dump(p, open('/tmp/ryojaku-bucket-policy-new.json', 'w'), indent=2)
    print(f'→ 將 {arn} 加入白名單（原有 {len(arns)-1} 個全保留）')
    sys.exit(10)
print('❌ 找不到帶 AWS:SourceArn 的 statement，中止', file=sys.stderr)
sys.exit(1)
PY
ROLLBACK="aws s3api put-bucket-policy --bucket $BUCKET --policy file:///tmp/ryojaku-bucket-policy.json"

if [ $rc -eq 10 ]; then
  aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/ryojaku-bucket-policy-new.json
  echo "✔ 桶 policy 已送出"

  # ── 讀回驗證（這才是真正的證據）─────────────────────────────────────────
  # 從 AWS 讀回實際生效的 policy，斷言它與寫回前**只差一個新增的 ARN**，其餘完全相同。
  # 為什麼用結構差分而不是只檢查「4 個 ARN 還在」：後者放得過「順手改了 Action/Resource/Effect」
  # 這類改動。也不能只靠下面的 HTTP 探針 —— CloudFront 有快取，權限被拔掉後
  # **邊緣節點仍可能回 200**，那會是一個看起來很安心的假綠燈。
  aws s3api get-bucket-policy --bucket "$BUCKET" --query Policy --output text > /tmp/ryojaku-bucket-policy-readback.json
  python3 - "$NEW_ARN" <<'PY' || { echo "❌ 讀回驗證失敗 → 立刻回滾：$ROLLBACK" >&2; exit 1; }
import json, sys
arn = sys.argv[1]

def split(path):
    p = json.load(open(path))
    arns = None
    for st in p['Statement']:
        c = st.get('Condition', {}).get('StringEquals', {})
        if 'AWS:SourceArn' in c:
            a = c['AWS:SourceArn']
            arns = set([a] if isinstance(a, str) else a)
            c['AWS:SourceArn'] = '<REDACTED-FOR-DIFF>'   # 挖掉才能比「其餘部分」
    return p, arns

before, ba = split('/tmp/ryojaku-bucket-policy.json')
after,  aa = split('/tmp/ryojaku-bucket-policy-readback.json')

ok = True
if before != after:
    print('❌ 除了 SourceArn 之外還有東西被改到（Action / Resource / Effect / Principal…）', file=sys.stderr)
    ok = False
expected = ba | {arn}
if aa != expected:
    if ba - aa:
        print(f'❌ 原有 ARN 消失了：{sorted(ba - aa)}', file=sys.stderr)
    if aa - expected:
        print(f'❌ 多出非預期的 ARN：{sorted(aa - expected)}', file=sys.stderr)
    if arn not in aa:
        print(f'❌ 新 ARN 沒寫進去：{arn}', file=sys.stderr)
    ok = False
if ok:
    print(f'✔ 讀回驗證通過：原有 {len(ba)} 個 ARN 全在，新增 1 個，其餘結構未變')
sys.exit(0 if ok else 1)
PY

  echo "  ▸ 寫回後正控（既有四站不可以掛）"
  # ⚠️ 誠實說明強度：這是 smoke test 不是證明 —— CloudFront 快取可能讓已壞掉的站仍回 200。
  #    真正的證據是上面那道結構差分；這裡是第二層保險，抓「差分沒看出來但實際壞了」。
  probe_all || { echo "❌ 有既有站掛了 → 立刻回滾：$ROLLBACK" >&2; exit 1; }

elif [ $rc -ne 0 ]; then
  exit $rc
fi

# ── 3. Route53 A/AAAA alias ─────────────────────────────────────────────────
# Z2FDTNDATAQYW2 是 CloudFront 的固定 hosted zone id（全球唯一常數，非本帳號的 zone）。
cat > /tmp/ryojaku-stg-dns.json <<JSON
{ "Comment": "両雀 玩家端 staging", "Changes": [
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$SUBDOMAIN", "Type": "A",
      "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "$CF_DOMAIN", "EvaluateTargetHealth": false } } },
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$SUBDOMAIN", "Type": "AAAA",
      "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "$CF_DOMAIN", "EvaluateTargetHealth": false } } }
]}
JSON
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --change-batch file:///tmp/ryojaku-stg-dns.json --query "ChangeInfo.Status" --output text
echo "✔ DNS 已 UPSERT（A + AAAA）"

echo
echo "✅ 開通完成"
echo "   DIST_ID=$DIST_ID"
echo "   URL=https://$SUBDOMAIN"
echo "   下一步：把 DIST_ID 填進 deploy-stg.sh，然後跑 ./deploy-stg.sh"
echo "   注意 distribution 首次部署要 ~5-15 分鐘才會全球生效。"
