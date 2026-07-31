#!/usr/bin/env bash
# 安全回歸測試 —— 針對已修好的認證缺陷，防止重構後靜默復發。
#
# 用法：bash infra/security_regression.sh [--cleanup-orphans]
# 需要：aws cli（stg 權限）、curl、python3（含 cryptography）、
#       SSM 讀取 /ryojaku/stg/ENCRYPTION_KEY 的權限（用於密文正控）
# 退出碼：0 = 全過；非 0 = 有斷言失敗、前置失敗，或清理後仍有殘留
#
# ── 設計要點（都是實際踩過才寫下來的）─────────────────────────────────
#
# 🔴 每個「應該被擋」都配一個「應該要通」。
#    只驗攻擊被擋的話，「功能整個壞掉」會跟「修好了」長得一模一樣 ——
#    全部 401／全部遮蔽同樣能讓所有斷言變綠。
#
# 🔴 EXIT trap 必須保留進入時的 $?。
#    初版寫成 `trap 內 [ $FAIL != 0 ] && exit 1; exit 0`，結果主流程 `exit 1`
#    （例如註冊失敗）被 trap 覆蓋成 rc=0 —— 一項斷言都沒跑卻回報成功，
#    這是一支安全測試最糟的失敗模式。已實驗證實並修正。
#
# 🔴 清理只認「本次執行」產生的東西（MARK／HOST／GID），不做跨帳號的孤兒清掃。
#    初版會刪掉「userId 不在 Users 表」的所有列 —— 那是**資料修復**不是測試清理，
#    未來若有合法的 legacy／外部／延遲寫入紀錄，會被這支測試腳本靜默刪除。
#    需要清前幾輪殘骸時，明確加 --cleanup-orphans（並且該路徑才需要完整的 Users 清單）。
set -uo pipefail

REGION=${REGION:-ap-southeast-1}
API=${API:-https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg}
PREFIX=${PREFIX:-MahjongClubStg_}
SSM_ENC_KEY=${SSM_ENC_KEY:-/ryojaku/stg/ENCRYPTION_KEY}
MARK="SECREG-DELETEME"
CLEAN_ORPHANS=0
[ "${1:-}" = "--cleanup-orphans" ] && CLEAN_ORPHANS=1

FAIL=0
pass(){ echo "  ✅ $1"; }
fail(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check(){ # $1=描述 $2=實際 $3=期望
  if [ "$2" = "$3" ]; then pass "$1（$2）"; else fail "$1：得到 $2，期望 $3"; fi
}

GID=""; HOST=""

# 🔴 錯誤旗標用**檔案**不用變數。
#    第一版寫成 `AWS_ERR=1`,但每個呼叫都長成 `x=$(aws_json ...)` —— 命令替換是子 shell,
#    變數改動傳不回父行程,於是旗標永遠是 0,AWS 全數失敗仍然綠燈。
#    (這是本腳本第四個假綠,而且是「修好」之後才產生的;靠自己的失敗注入測試才抓到。)
AWS_ERR_FLAG=$(mktemp)
aws_failed(){ [ -s "$AWS_ERR_FLAG" ]; }

# 🔴 包一層,讓 AWS 失敗不再被吞掉。
#    原本 `aws ... 2>/dev/null | python`：指令失敗 → stdin 空 → json 解析失敗 →
#    python 印 0 → 「0 筆殘留」→ 綠燈。權限不足／節流／表不存在全都會這樣靜默過關。
#    這是本腳本第三次踩到同一個假綠家族(前兩次是 trap 覆蓋 rc、殘留只印不計分)。
aws_json(){ # 用法：aws_json <aws 參數...>；成功印 JSON 回 0，失敗印錯誤到 stderr 回非 0
  local out rc err
  err=$(mktemp)
  out=$(aws "$@" 2>"$err"); rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ❌ AWS 失敗（aws $*）：$(head -c 200 "$err" | tr '\n' ' ')" >&2
    echo 1 >> "$AWS_ERR_FLAG"
  else
    printf '%s' "$out"
  fi
  rm -f "$err"
  return "$rc"
}

# 全表掃描：把 python 判斷式套到每張表。$1=模式 delete|count。結果由 stdout 回傳筆數。
# 任何一步失敗 → AWS_ERR=1，呼叫端據此判定為失敗（絕不當成 0 筆）。
sweep(){
  local mode="$1" total=0 tables keys scanjson n
  tables=$(aws_json dynamodb list-tables --region "$REGION" --query 'TableNames' --output text) \
    || { echo 0; return 1; }
  for T in $(printf '%s' "$tables" | tr '\t' '\n' | grep "^${PREFIX}"); do
    keys=$(aws_json dynamodb describe-table --region "$REGION" --table-name "$T" \
           --query 'Table.KeySchema[].AttributeName' --output json) || continue
    scanjson=$(aws_json dynamodb scan --region "$REGION" --table-name "$T" --output json) || continue
    n=$(printf '%s' "$scanjson" \
      | T="$T" KEYS="$keys" HOST="$HOST" GID="$GID" MARK="$MARK" REGION="$REGION" MODE="$mode" python3 -c "
import sys,json,os,subprocess
keys=json.loads(os.environ['KEYS']); host=os.environ['HOST']; gid=os.environ['GID']
mark=os.environ['MARK'].lower(); table=os.environ['T']; region=os.environ['REGION']
mode=os.environ['MODE']
# 🔴 解析失敗一律 rc=2,**不印 0** —— 把錯誤講成「沒有殘留」正是上一版的 bug。
try: d=json.load(sys.stdin)
except Exception as e:
    print(f'  ❌ 掃描結果無法解析（{table}）：{e}', file=sys.stderr); raise SystemExit(2)
items=d.get('Items',[])
if d.get('LastEvaluatedKey'):
    # 未分頁完 → 這一頁的 0 筆不代表整表 0 筆,同樣是假綠,故判為失敗。
    print(f'  ❌ {table} 掃描未分頁完（LastEvaluatedKey 仍在）', file=sys.stderr); raise SystemExit(2)
def mine(i):
    blob=json.dumps(i,ensure_ascii=False)
    return (mark in blob.lower()) or (host and host in blob) or (gid and gid in blob)
hit=0
for i in items:
    if not mine(i) or not all(k in i for k in keys): continue
    hit+=1
    if mode=='delete':
        r=subprocess.run(['aws','dynamodb','delete-item','--region',region,'--table-name',table,
                          '--key',json.dumps({k:i[k] for k in keys})],
                         capture_output=True)
        if r.returncode!=0:
            print(f'  ❌ 刪除失敗（{table}）：{r.stderr.decode()[:160]}', file=sys.stderr); raise SystemExit(2)
        print(f'  刪 {table.split(\"_\",1)[-1]}', file=sys.stderr)
print(hit)
")
    if [ $? -ne 0 ] || [ -z "$n" ]; then echo 1 >> "$AWS_ERR_FLAG"; continue; fi
    total=$((total + n))
  done
  echo "$total"
  return 0
}

cleanup(){
  local rc=$?          # 🔴 先接住主流程的退出碼，別讓 cleanup 覆蓋它
  echo
  echo "── 清理 ──"
  sweep delete >/dev/null
  local left
  left=$(sweep count)
  # 🔴 先看 AWS_ERR 再看筆數 —— 指令失敗時 left 也會是 0，
  #    若照舊只看 left 就會把「掃不到」講成「沒有殘留」。
  if aws_failed; then
    echo "  ❌ 清理／掃描期間有 AWS 呼叫失敗 —— 無法確認是否清空（不當成通過）"
    FAIL=$((FAIL+1))
  elif [ "$left" = "0" ]; then
    echo "  ✅ 本次測試資料已清空"
  else
    echo "  ❌ 仍有 $left 筆殘留"; FAIL=$((FAIL+1))
  fi

  if [ "$CLEAN_ORPHANS" = "1" ]; then
    echo "── 孤兒清掃（--cleanup-orphans）──"
    # 只有這條路徑才需要完整 Users 清單，因此必須分頁；抓不全就中止，
    # 否則會把「沒掃到那頁的合法使用者」的關聯資料當成孤兒刪掉。
    local live
    live=$(aws dynamodb scan --region "$REGION" --table-name "${PREFIX}Users" \
           --projection-expression "userId" --output json --no-paginate 2>/dev/null \
           | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('LastEvaluatedKey'): print('INCOMPLETE'); raise SystemExit
print(','.join(i['userId']['S'] for i in d.get('Items',[])))
")
    if [ -z "$live" ] || [ "$live" = "INCOMPLETE" ]; then
      echo "  ⚠️ Users 清單不完整或取不到，跳過孤兒清掃（避免誤刪合法資料）"
    else
      for T in $(aws dynamodb list-tables --region "$REGION" --query 'TableNames' --output text \
                 | tr '\t' '\n' | grep "^${PREFIX}"); do
        keys=$(aws dynamodb describe-table --region "$REGION" --table-name "$T" \
               --query 'Table.KeySchema[].AttributeName' --output json)
        aws dynamodb scan --region "$REGION" --table-name "$T" --output json 2>/dev/null \
          | T="$T" KEYS="$keys" LIVE="$live" REGION="$REGION" python3 -c "
import sys,json,os,subprocess
keys=json.loads(os.environ['KEYS']); live=set(os.environ['LIVE'].split(','))
table=os.environ['T']; region=os.environ['REGION']
try: items=json.load(sys.stdin).get('Items',[])
except Exception: raise SystemExit
def uid(i):
    for k in ('userId','UserID','hostUserId','viewerId','targetUserId','authorId'):
        if k in i: return list(i[k].values())[0]
    return None
for i in items:
    u=uid(i)
    if not u or u in live or not all(k in i for k in keys): continue
    subprocess.run(['aws','dynamodb','delete-item','--region',region,'--table-name',table,
                    '--key',json.dumps({k:i[k] for k in keys})],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f'  刪孤兒 {table.split(\"_\",1)[-1]} ← {u}')
"
      done
    fi
  fi

  rm -f "$AWS_ERR_FLAG"
  # 主流程失敗優先；主流程成功但清理有問題也要紅
  [ "$rc" != "0" ] && { echo "  （主流程以 rc=$rc 結束）"; exit "$rc"; }
  [ "$FAIL" != "0" ] && exit 1
  exit 0
}
trap cleanup EXIT

lineid(){ python3 -c "
import sys,json
d=json.load(sys.stdin); g=(d.get('data') or {}).get('game') or {}
print('VISIBLE' if (g.get('contactInfo') or {}).get('lineId') else 'MASKED')
" 2>/dev/null || echo ERR; }

echo "══ 建立測試資料 ══"
TS=$(date +%s)
TEST_LINE_ID="U${MARK}lineid"
REG=$(curl -s -X POST "$API/app-register" -H 'Content-Type: application/json' \
      -d "{\"email\":\"secreg+$TS@example.com\",\"password\":\"SecReg12345!\",\"displayName\":\"$MARK\"}")
[ -z "$REG" ] && { echo "  ❌ 註冊無回應（API 不可達？）：API=$API"; exit 1; }
HOST=$(echo "$REG" | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
print((d.get('data') or d.get('user') or {}).get('userId',''))")
HT=$(echo "$REG"  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
[ -z "$HOST" ] && { echo "  ❌ 註冊失敗：$REG"; exit 1; }
echo "  主辦人 $HOST"

# 直接補齊前置條件：信箱驗證閘（SES 未通）、開團所需點數、以及可被洩漏的 LINE ID
aws dynamodb update-item --region "$REGION" --table-name "${PREFIX}Users" \
  --key "{\"userId\":{\"S\":\"$HOST\"}}" \
  --update-expression "SET lineId = :l, emailVerified = :t, points = :p" \
  --expression-attribute-values "{\":l\":{\"S\":\"$TEST_LINE_ID\"},\":t\":{\"BOOL\":true},\":p\":{\"N\":\"500\"}}" >/dev/null \
  || { echo "  ❌ 補前置條件失敗"; exit 1; }

GID=$(curl -s -X POST "$API/create-game?userId=$HOST" -H "Authorization: Bearer $HT" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"one-time\",\"gameType\":\"基本三將\",\"placeName\":\"$MARK\",\"location\":\"regression\",\"latitude\":25.03,\"longitude\":121.56,\"needPlayers\":3,\"stakes\":\"t\",\"startTime\":\"2026-12-31T10:00:00Z\",\"rules\":[],\"features\":[],\"restrictions\":[]}" \
  | python3 -c "import sys,json;print((json.load(sys.stdin).get('data') or {}).get('gameID',''))")
[ -z "$GID" ] && { echo "  ❌ 建團失敗"; exit 1; }
echo "  團局 $GID"

# 產生一段合法的 LINE 密文（供密文路徑正控用）。repo 內只有解密沒有加密，故自行 Seal。
CIPHER=$(ENC=$(aws ssm get-parameter --region "$REGION" --name "$SSM_ENC_KEY" \
         --with-decryption --query 'Parameter.Value' --output text 2>/dev/null) \
         PLAIN="$TEST_LINE_ID" python3 -c "
import os,base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
enc=os.environ.get('ENC','')
if not enc: raise SystemExit
key=base64.b64decode(enc); nonce=os.urandom(12)
ct=AESGCM(key).encrypt(nonce, os.environ['PLAIN'].encode(), None)
print(base64.urlsafe_b64encode(nonce+ct).decode())
" 2>/dev/null)

echo
echo "══ F-1 game-detail：授權不得採信自稱身分 ══"
check "① 匿名不帶身分 → 遮蔽" \
  "$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\"}" | lineid)" MASKED
check "② 匿名把 hostUserId 當 lineID【原攻擊鏈】→ 遮蔽" \
  "$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\",\"lineID\":\"$HOST\"}" | lineid)" MASKED
check "③ 匿名把明文 LINE id 當 lineID → 遮蔽（舊 fallback 不得復活）" \
  "$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\",\"lineID\":\"$TEST_LINE_ID\"}" | lineid)" MASKED
check "④【正控】主辦人帶有效 JWT → 可見" \
  "$(curl -s -X POST "$API/game-detail" -H "Authorization: Bearer $HT" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\"}" | lineid)" VISIBLE
if [ -n "$CIPHER" ]; then
  check "⑤【正控】合法 LINE 密文當 lineID → 可見（密文即憑證，此路徑不可壞）" \
    "$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\",\"lineID\":\"$CIPHER\"}" | lineid)" VISIBLE
else
  fail "⑤【正控】無法產生 LINE 密文（缺 ENCRYPTION_KEY 讀取權或 cryptography 套件）—— 此路徑未受覆蓋"
fi

echo
echo "══ event-get-upload-url：必須驗證身分 ══"
check "⑥ 未帶憑證 → 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/event-get-upload-url" \
     -H 'Content-Type: application/json' -d '{"userId":"APP_FAKE","fileName":"x.png","contentType":"image/png"}')" 401
check "⑦【正控】帶有效 token → 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/event-get-upload-url" -H "Authorization: Bearer $HT" \
     -H 'Content-Type: application/json' -d '{"userId":"APP_SOMEONE_ELSE","fileName":"x.png","contentType":"image/png"}')" 200

echo
if [ "$FAIL" = "0" ]; then echo "══ 全部通過 ══"; else echo "══ 有 $FAIL 項失敗 ══"; fi
# 雙保險：這裡就把 FAIL 反映到退出碼，trap 再依 $? 與清理結果做最終判定。
# 只靠 trap 讀 $FAIL 的話，日後有人改動 trap 就會再次假綠。
exit $(( FAIL > 0 ? 1 : 0 ))
