#!/usr/bin/env bash
# 安全回歸測試 —— 針對已修好的認證缺陷，防止重構後靜默復發。
#
# 用法：bash infra/security_regression.sh
# 需要：aws cli（stg 權限）、curl、python3、openssl
# 退出碼：0 = 全過；非 0 = 有斷言失敗（會印出哪一項）
#
# 🔴 為什麼每項都配「正控」：
#    只驗「攻擊被擋住」的話，「功能整個壞掉」也會通過 —— 全部回 401／全部遮蔽，
#    看起來跟修好一模一樣。所以每個「應該被擋」都要有一個「應該要通」作對照。
#
# 🔴 為什麼清理用「全表 × 雙判準」：
#    2026-07-31 實際踩過兩個正交的漏：
#      (1) 判準只比對命名字串 → 漏掉只用 userId 參照的列（AuthTokens／PointTransactions）；
#      (2) 表清單用手挑 → 漏掉開團連帶產生的 ChatRooms／ChatUserMemberships。
#    補一個不會補到另一個，所以兩軸都要放到最寬。
set -uo pipefail

REGION=${REGION:-ap-southeast-1}
API=${API:-https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg}
PREFIX=${PREFIX:-MahjongClubStg_}
MARK="SECREG-DELETEME"

FAIL=0
pass(){ echo "  ✅ $1"; }
fail(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check(){ # $1=描述 $2=實際 $3=期望
  if [ "$2" = "$3" ]; then pass "$1（$2）"; else fail "$1：得到 $2，期望 $3"; fi
}

GID=""; HOST=""
cleanup(){
  echo
  echo "── 清理 ──"
  # 🔴 刻意**不手列表格與 key**：手列必漏（開團會連帶產生 ChatRooms／ChatUserMemberships、
  #    註冊會連帶產生 AuthIdentities／AuthTokens、扣點會產生 PointTransactions）。
  #    改為掃全表，凡「屬於本次測試帳號 或 帶本次標記」者一律刪，key 由 KeySchema 動態取得。
  for T in $(aws dynamodb list-tables --region "$REGION" --query 'TableNames' --output text \
             | tr '\t' '\n' | grep "^${PREFIX}"); do
    keys=$(aws dynamodb describe-table --region "$REGION" --table-name "$T" \
           --query 'Table.KeySchema[].AttributeName' --output json)
    aws dynamodb scan --region "$REGION" --table-name "$T" --output json 2>/dev/null \
      | T="$T" KEYS="$keys" HOST="$HOST" GID="$GID" MARK="$MARK" REGION="$REGION" python3 -c "
import sys,json,os,subprocess
keys=json.loads(os.environ['KEYS']); host=os.environ['HOST']; gid=os.environ['GID']
mark=os.environ['MARK'].lower(); table=os.environ['T']; region=os.environ['REGION']
try: items=json.load(sys.stdin).get('Items',[])
except Exception: raise SystemExit
def owned(i):
    blob=json.dumps(i,ensure_ascii=False)
    if mark in blob.lower(): return True
    if host and host in blob: return True
    if gid and gid in blob: return True
    return False
for i in items:
    if not owned(i): continue
    if not all(k in i for k in keys): continue
    subprocess.run(['aws','dynamodb','delete-item','--region',region,'--table-name',table,
                    '--key',json.dumps({k:i[k] for k in keys})],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f'  刪 {table.split(\"_\",1)[-1]}')
"
  done

  # 全表 × 雙判準掃描（命名字串 OR 參照已刪帳號的孤兒）
  local live
  live=$(aws dynamodb scan --region "$REGION" --table-name "${PREFIX}Users" \
         --projection-expression "userId" --query 'Items[].userId.S' --output text | tr '\t' ',')

  # 🔴 掃掉「前幾輪半途中斷留下的」孤兒 —— 上面的刪除只認本次的 HOST/GID/MARK，
  #    若某輪在建完資料後崩掉，那批資料**永遠不會**被後續任何一輪清到。
  #    防呆：合法帳號清單若為空（scan 失敗）一律跳過，否則會把整張表刪光。
  if [ -z "$live" ] || [ "$live" = "None" ]; then
    echo "  ⚠️ 取不到合法帳號清單，跳過孤兒清掃（避免誤刪）"
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
    if not u or u in live: continue
    if not all(k in i for k in keys): continue
    subprocess.run(['aws','dynamodb','delete-item','--region',region,'--table-name',table,
                    '--key',json.dumps({k:i[k] for k in keys})],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f'  刪孤兒 {table.split(\"_\",1)[-1]} ← {u}')
"
    done
  fi
  local total=0
  for T in $(aws dynamodb list-tables --region "$REGION" --query 'TableNames' --output text \
             | tr '\t' '\n' | grep "^${PREFIX}"); do
    n=$(aws dynamodb scan --region "$REGION" --table-name "$T" --output json 2>/dev/null | LIVE="$live" MARK="$MARK" python3 -c "
import sys,json,os
live=set(os.environ['LIVE'].split(','))
mark=os.environ['MARK'].lower()
try: items=json.load(sys.stdin).get('Items',[])
except Exception: print(0); raise SystemExit
def uid(i):
    for k in ('userId','UserID','hostUserId','viewerId','targetUserId','authorId'):
        if k in i: return list(i[k].values())[0]
    return None
print(len([i for i in items
           if mark in json.dumps(i,ensure_ascii=False).lower()
           or (uid(i) and uid(i) not in live)]))
")
    [ "${n:-0}" != "0" ] && { echo "  ⚠️ 殘留 ${T#$PREFIX}: $n 筆"; total=$((total+n)); }
  done
  if [ "$total" = "0" ]; then echo "  ✅ 全表無殘留"; else echo "  ❌ 殘留合計 $total 筆"; FAIL=$((FAIL+1)); fi

  # 🔴 EXIT trap 不會改變已決定的退出碼 —— 若在這裡才發現殘留，畫面會印 ❌ 但 rc 仍是 0。
  #    必須自己 exit，否則「清理失敗」會變成一個沒人看得到的失敗。
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
REG=$(curl -s -X POST "$API/app-register" -H 'Content-Type: application/json' \
      -d "{\"email\":\"secreg+$TS@example.com\",\"password\":\"SecReg12345!\",\"displayName\":\"$MARK\"}")
HOST=$(echo "$REG" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or d.get('user') or {}).get('userId',''))")
HT=$(echo "$REG"  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
[ -z "$HOST" ] && { echo "  ❌ 註冊失敗：$REG"; exit 1; }
echo "  主辦人 $HOST"

# 直接補齊前置條件：信箱驗證閘（SES 未通）、開團所需點數、以及可被洩漏的 LINE ID
aws dynamodb update-item --region "$REGION" --table-name "${PREFIX}Users" \
  --key "{\"userId\":{\"S\":\"$HOST\"}}" \
  --update-expression "SET lineId = :l, emailVerified = :t, points = :p" \
  --expression-attribute-values "{\":l\":{\"S\":\"U${MARK}lineid\"},\":t\":{\"BOOL\":true},\":p\":{\"N\":\"500\"}}" >/dev/null

GID=$(curl -s -X POST "$API/create-game?userId=$HOST" -H "Authorization: Bearer $HT" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"one-time\",\"gameType\":\"基本三將\",\"placeName\":\"$MARK\",\"location\":\"regression\",\"latitude\":25.03,\"longitude\":121.56,\"needPlayers\":3,\"stakes\":\"t\",\"startTime\":\"2026-12-31T10:00:00Z\",\"rules\":[],\"features\":[],\"restrictions\":[]}" \
  | python3 -c "import sys,json;print((json.load(sys.stdin).get('data') or {}).get('gameID',''))")
[ -z "$GID" ] && { echo "  ❌ 建團失敗"; exit 1; }
echo "  團局 $GID"

echo
echo "══ F-1 game-detail：授權不得採信自稱身分 ══"
check "① 匿名不帶身分 → 遮蔽" \
  "$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\"}" | lineid)" MASKED
check "② 匿名把 hostUserId 當 lineID【原攻擊鏈】→ 遮蔽" \
  "$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\",\"lineID\":\"$HOST\"}" | lineid)" MASKED
check "③ 匿名把明文 LINE id 當 lineID → 遮蔽（舊 fallback 不得復活）" \
  "$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\",\"lineID\":\"U${MARK}lineid\"}" | lineid)" MASKED
# 正控：功能不可斷
check "④【正控】主辦人帶有效 JWT → 可見" \
  "$(curl -s -X POST "$API/game-detail" -H "Authorization: Bearer $HT" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\"}" | lineid)" VISIBLE

echo
echo "══ event-get-upload-url：必須驗證身分 ══"
c1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/event-get-upload-url" \
     -H 'Content-Type: application/json' -d '{"userId":"APP_FAKE","fileName":"x.png","contentType":"image/png"}')
check "⑤ 未帶憑證 → 401" "$c1" 401
c2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/event-get-upload-url" -H "Authorization: Bearer $HT" \
     -H 'Content-Type: application/json' -d '{"userId":"APP_SOMEONE_ELSE","fileName":"x.png","contentType":"image/png"}')
check "⑥【正控】帶有效 token → 200" "$c2" 200

echo
if [ "$FAIL" = "0" ]; then echo "══ 全部通過 ══"; else echo "══ 有 $FAIL 項失敗 ══"; fi
exit $((FAIL > 0))
