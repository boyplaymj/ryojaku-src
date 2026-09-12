#!/usr/bin/env bash
# 安全回歸測試 —— 針對已修好的認證缺陷，防止重構後靜默復發。
#
# 用法：bash infra/security_regression.sh [--cleanup-orphans]
# 需要：aws cli（stg 權限）、curl、python3（含 cryptography）、
#       SSM 讀取 /ryojaku/stg/ENCRYPTION_KEY 的權限（用於密文正控）
# 退出碼：0 = 全過；非 0 = 有斷言失敗、前置失敗，或清理後仍有殘留
#
# ⚠️ **每小時最多跑 5 次**：本腳本每次註冊 2 個帳號，而 app-register 的限流是
#    「每 IP 每小時 10 次」（`app_register/main.go` 的 CheckRateLimit(…, 10, 3600)）。
#    超過後註冊會回「嘗試次數過多」，腳本會在前置階段明確失敗（不會偽裝成安全斷言失敗）。
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
# 🔴 EQUIP 與 FAIL 刻意分開（2026-09-12）：
#    FAIL＝被測物壞了（去看程式）／EQUIP＝儀器自己沒跑成（去看基礎設施）。
#    合在一起的話，「掃描器讀不懂某個檔」會被外層通知成「安全回歸」——
#    而假警報訓練出來的忽略是不可逆的。
EQUIP=0
# 🔴 斷言總數一律由程式自己數，不准手寫。
#    先前的檢查點與報告寫「17 項」，實際只有 16 —— 沒有來源的手抄數字不會報錯，
#    只會被複製（外部查驗者照著引用了一次）。TOTAL 掛在 pass/fail 上，
#    日後新增斷言會自動計入，不必再有人回頭數 check 的次數。
#    ⚠️ pass/fail 必須在父 shell 執行才計得到數（同 :47 的子 shell 陷阱）。
TOTAL=0
pass(){ echo "  ✅ $1"; TOTAL=$((TOTAL+1)); }
fail(){ echo "  ❌ $1"; TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); }
check(){ # $1=描述 $2=實際 $3=期望
  if [ "$2" = "$3" ]; then pass "$1（$2）"; else fail "$1：得到 $2，期望 $3"; fi
}

GID=""; HOST=""; OUTSIDER=""

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
      | T="$T" KEYS="$keys" HOST="$HOST" GID="$GID" OUTSIDER="$OUTSIDER" MARK="$MARK" REGION="$REGION" MODE="$mode" python3 -c "
import sys,json,os,subprocess
keys=json.loads(os.environ['KEYS']); host=os.environ['HOST']; gid=os.environ['GID']
outsider=os.environ.get('OUTSIDER','')
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
    # 🔴 每新增一個測試主體,都必須同時加進這個判準。
    #    2026-07-31 實際踩到:加了第二個帳號(email 不含 MARK)卻沒加進來,
    #    於是它的 AuthIdentities/AuthTokens 被漏掉 —— 而清理與驗收共用這個判準,
    #    所以腳本一邊留下殘骸、一邊回報「已清空」。
    blob=json.dumps(i,ensure_ascii=False)
    return ((mark in blob.lower()) or (host and host in blob)
            or (gid and gid in blob) or (outsider and outsider in blob))
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
    # 🔴 這條是**明確的破壞性清理**，比一般掃描更不能靜默成功：
    #    任何一步失敗都必須計入 FAIL，否則「什麼都沒刪」與「刪乾淨了」外觀相同。
    #    故全程走 aws_json（會設錯誤旗標），刪除失敗也直接判失敗。
    local live users_json
    users_json=$(aws_json dynamodb scan --region "$REGION" --table-name "${PREFIX}Users" \
                 --projection-expression "userId" --output json) || users_json=""
    if [ -z "$users_json" ]; then
      echo "  ❌ 取不到 Users 清單，孤兒清掃中止（不當成通過）"
      FAIL=$((FAIL+1))
      live="INCOMPLETE"
    else
      live=$(printf '%s' "$users_json" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('LastEvaluatedKey'): print('INCOMPLETE'); raise SystemExit
print(','.join(i['userId']['S'] for i in d.get('Items',[])))
")
    fi
    if [ -z "$live" ] || [ "$live" = "INCOMPLETE" ]; then
      echo "  ⚠️ Users 清單不完整或取不到，跳過孤兒清掃（避免誤刪合法資料）"
      [ "$live" = "INCOMPLETE" ] && { echo "  ❌ 清單不完整本身即為失敗"; FAIL=$((FAIL+1)); }
    else
      local otables okeys oscan
      otables=$(aws_json dynamodb list-tables --region "$REGION" --query 'TableNames' --output text) \
        || { echo "  ❌ list-tables 失敗，孤兒清掃中止"; FAIL=$((FAIL+1)); otables=""; }
      for T in $(printf '%s' "$otables" | tr '\t' '\n' | grep "^${PREFIX}"); do
        okeys=$(aws_json dynamodb describe-table --region "$REGION" --table-name "$T" \
               --query 'Table.KeySchema[].AttributeName' --output json) || continue
        oscan=$(aws_json dynamodb scan --region "$REGION" --table-name "$T" --output json) || continue
        printf '%s' "$oscan" \
          | T="$T" KEYS="$okeys" LIVE="$live" REGION="$REGION" python3 -c "
import sys,json,os,subprocess
keys=json.loads(os.environ['KEYS']); live=set(os.environ['LIVE'].split(','))
table=os.environ['T']; region=os.environ['REGION']
try: d=json.load(sys.stdin)
except Exception as e:
    print(f'  ❌ 孤兒掃描結果無法解析（{table}）：{e}', file=sys.stderr); raise SystemExit(2)
if d.get('LastEvaluatedKey'):
    print(f'  ❌ {table} 未分頁完，孤兒清掃不可信', file=sys.stderr); raise SystemExit(2)
def uid(i):
    for k in ('userId','UserID','hostUserId','viewerId','targetUserId','authorId'):
        if k in i: return list(i[k].values())[0]
    return None
for i in d.get('Items',[]):
    u=uid(i)
    if not u or u in live or not all(k in i for k in keys): continue
    r=subprocess.run(['aws','dynamodb','delete-item','--region',region,'--table-name',table,
                      '--key',json.dumps({k:i[k] for k in keys})], capture_output=True)
    if r.returncode!=0:
        print(f'  ❌ 孤兒刪除失敗（{table}）：{r.stderr.decode()[:160]}', file=sys.stderr); raise SystemExit(2)
    print(f'  刪孤兒 {table.split(\"_\",1)[-1]} ← {u}')
"
        [ $? -ne 0 ] && echo 1 >> "$AWS_ERR_FLAG"
      done
      aws_failed && { echo "  ❌ 孤兒清掃期間有失敗"; FAIL=$((FAIL+1)); }
    fi
  fi

  rm -f "$AWS_ERR_FLAG"
  # 主流程失敗優先；主流程成功但清理有問題也要紅
  [ "$rc" != "0" ] && { echo "  （主流程以 rc=$rc 結束）"; exit "$rc"; }
  [ "$FAIL" != "0" ] && exit 1
  exit 0
}
# ── 併發鎖 ─────────────────────────────────────────────────────────────
# 🔴 鎖在**這支**不在外殼，因為最可能相撞的是「排程」與「有人手動 bash 這支」——
#    鎖如果只寫在每日外殼裡，直接跑本檔的那條路完全不受保護，
#    而那正是人最常走的路。（2026-09-04 掛上 sml-ryojaku-secreg.timer 時發現：
#    外殼原本的鎖檔路徑跟著 STATE_DIRECTORY 走 ⇒ 排程用 /var/lib/…、手動用
#    /opt/sml/.buildtmp/… ⇒ 兩把不同的鎖，等於沒鎖。）
#
# 🔴 為什麼非鎖不可：`MARK` 是**常數**。兩次併行執行的 cleanup 會在全表掃描裡
#    把對方正在用的列刪掉 ⇒ 兩邊都紅，而且紅得像安全回歸。
#
# ⚠️ 界線：這是**本機**的鎖。從別台機器同時跑仍然會撞（腳本自己的檔頭就寫了
#    「從別的 IP 跑」是限流的解法之一）—— 那種情況本鎖看不到，也擋不住。
#
# 🔴 一定要在 `trap cleanup EXIT` **之前**取得。裝了 trap 之後才失敗退出的話，
#    cleanup 會帶著空的 HOST/GID 跑一次全表掃描，而 mine() 只靠常數 MARK 就會命中
#    ——「因為搶不到鎖而退出」會順手刪掉**正在跑的那一輪**的資料。
SECREG_LOCK=${SECREG_LOCK:-/tmp/ryojaku-secreg.lock}
SECREG_LOCK_WAIT=${SECREG_LOCK_WAIT:-600}
exec 8>"$SECREG_LOCK" || { echo "  ❌ 開不了鎖檔 $SECREG_LOCK"; exit 1; }
if ! flock -w "$SECREG_LOCK_WAIT" 8; then
  # 走前置失敗那條路（rc=1、沒有 summary 行）⇒ 每日外殼會判成「沒測到」而不是
  # 「安全回歸」。這正是它該被歸的類。
  echo "  ❌ 等了 ${SECREG_LOCK_WAIT}s 仍拿不到併發鎖（$SECREG_LOCK）——"
  echo "     另一輪安全回歸測試正在跑。本次**一條斷言都沒跑**，不是安全問題。"
  exit 1
fi

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

# 第二個帳號：用來驗「非成員不得取得該聊天室的上傳授權」。
# displayName 帶 MARK，才會被 cleanup 的全表掃描認出來。
REG2=$(curl -s -X POST "$API/app-register" -H 'Content-Type: application/json' \
       -d "{\"email\":\"secreg2+$TS@example.com\",\"password\":\"SecReg12345!\",\"displayName\":\"$MARK\"}")
OUTSIDER_T=$(echo "$REG2" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('token',''))
except Exception: pass")
OUTSIDER=$(echo "$REG2" | python3 -c "import sys,json
try: print((json.load(sys.stdin).get('data') or {}).get('userId',''))
except Exception: pass")
# 🔴 前置失敗必須在這裡就喊停，不能讓它流到斷言階段。
#    實際踩過：REG2 因註冊限流失敗 → OUTSIDER_T 為空 → ⑮ 拿空 token 打，得到 401 而非 403
#    → 畫面顯示「非成員取得同一房間：得到 401，期望 403」，看起來像**安全修補回歸了**，
#    實際只是第二個帳號沒註冊成功。前置失敗偽裝成安全斷言失敗，比直接爆掉更糟。
if [ -z "$OUTSIDER_T" ] || [ -z "$OUTSIDER" ]; then
  echo "  ❌ 第二個測試帳號建立失敗，無法驗「非成員」情境。回應：$(printf '%s' "$REG2" | head -c 200)"
  echo "     最常見原因：app-register 限流（每 IP 每小時 10 次，本腳本每次用 2 次）。"
  echo "     解法：等到下一個整點窗口再跑，或從別的 IP 跑。"
  exit 1
fi

# 建一個只有 HOST 是成員的聊天室（roomId 帶 MARK 以便清理）
CHATROOM="GAME_${MARK}_${TS}"
aws dynamodb put-item --region "$REGION" --table-name "${PREFIX}ChatUserMemberships" --item "{
  \"UserID\":{\"S\":\"$HOST\"},\"LastMessageTime#RoomID\":{\"S\":\"$CHATROOM\"},
  \"RoomID\":{\"S\":\"$CHATROOM\"},\"Title\":{\"S\":\"$MARK\"},
  \"UnreadCount\":{\"N\":\"0\"},\"ExpiryTime\":{\"N\":\"1900000000\"}}" >/dev/null 2>&1

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

# ── 2026-09-04 稽核 findings 1／1b／2／3／7 的真環境播種 ─────────────────
#
# 🔴 遮蔽類斷言一定要先讓「被遮蔽的東西真的存在」。
#    對一個從不填值的欄位斷言「它是空的」永遠會綠 —— 那正是 shared/redact_test.go
#    的反控在單元層擋的東西，在真環境同樣成立（而且這裡更容易漏：
#    create-game 的 payload 根本沒有 contactInfo，所以不播種的話 phone/note 天生是空的）。
SEED_PHONE="0900-${MARK}"
SEED_NOTE="note-${MARK}-free-text"
aws dynamodb update-item --region "$REGION" --table-name "${PREFIX}Games" \
  --key "{\"gameId\":{\"S\":\"$GID\"}}" \
  --update-expression "SET contactInfo = :c" \
  --expression-attribute-values "{\":c\":{\"M\":{\"phone\":{\"S\":\"$SEED_PHONE\"},\"lineId\":{\"S\":\"$TEST_LINE_ID\"},\"note\":{\"S\":\"$SEED_NOTE\"}}}}" >/dev/null \
  || { echo "  ❌ 播種 contactInfo 失敗 —— G-3／G-4 會失去鑑別力，直接中止"; exit 1; }

# 憑證欄位：passwordHash 是註冊時自然產生的，encryptedLineId 不是（要 LINE 綁定）。
# 不播的話 finding 7 那條斷言對「這個帳號本來就沒有這欄」與「修好了」分不出來。
if [ -n "$CIPHER" ]; then
  aws dynamodb update-item --region "$REGION" --table-name "${PREFIX}Users" \
    --key "{\"userId\":{\"S\":\"$HOST\"}}" \
    --update-expression "SET encryptedLineId = :e" \
    --expression-attribute-values "{\":e\":{\"S\":\"$CIPHER\"}}" >/dev/null \
    || { echo "  ❌ 播種 encryptedLineId 失敗"; exit 1; }
fi

# LINE Bot 帳號：後端對這種帳號是拿**明文 LINE id 當 Users 表主鍵**
# （verify-user 的 lineID= 路徑：DecryptLineID → GetUser(明文)）。
# 這一列存在，G-1 的反控才驗得到「LINE 登入 fallback 沒有被關錯」——
# 而那正是 §3b 說「單元測試結構上進不去、只能靠 stg 補」的那一塊。
# userId 內含 MARK ⇒ cleanup 的全表掃描認得出來，不會變孤兒。
aws dynamodb put-item --region "$REGION" --table-name "${PREFIX}Users" --item "{
  \"userId\":{\"S\":\"$TEST_LINE_ID\"},\"displayName\":{\"S\":\"$MARK\"},
  \"accountType\":{\"S\":\"line\"},\"points\":{\"N\":\"0\"},
  \"rating\":{\"N\":\"0\"},\"isVerified\":{\"BOOL\":false},
  \"createdAt\":{\"S\":\"2026-09-04T00:00:00Z\"}}" >/dev/null \
  || { echo "  ❌ 播種 LINE Bot 測試帳號失敗 —— G-1 的反控會失去鑑別力，直接中止"; exit 1; }

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
echo "══ F-4 上傳 key 淨化與類型白名單 ══"
# key 取回後檢查「時間戳之後那一段是否還含分隔符」——
# 只斷言「等於某個字串」的話，我把預期值寫錯就會一起錯；這裡直接驗性質。
upkey(){ curl -s -X POST "$API/event-get-upload-url" -H "Authorization: Bearer $HT" \
  -H 'Content-Type: application/json' \
  -d "$(FN="$1" CT="$2" python3 -c "
import json,os
print(json.dumps({'userId':'x','fileName':os.environ['FN'],'contentType':os.environ['CT']}))")" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin); k=(d.get('data') or {}).get('key')
if not k: print('REJECTED'); raise SystemExit
# events/{年月}/{ts}_{檔名} —— 切掉前兩段後不該再出現 / 或 \\
tail='/'.join(k.split('/')[2:])
print('CLEAN' if ('/' not in tail and chr(92) not in tail) else 'DIRTY')
" 2>/dev/null || echo ERR; }

check "⑧ 帶路徑的檔名 → key 不得跨前綴" "$(upkey '../../avatars/victim/evil.png' 'image/png')" CLEAN
check "⑨ 反斜線路徑 → key 不得跨前綴"   "$(upkey '..\..\x.png' 'image/png')" CLEAN
check "⑩ image/svg+xml → 拒絕（可內嵌 script）" "$(upkey 'x.svg' 'image/svg+xml')" REJECTED
check "⑪ text/html → 拒絕"                "$(upkey 'x.html' 'text/html')" REJECTED
check "⑫【正控】一般 jpg → 通過"           "$(upkey 'photo.jpg' 'image/jpeg')" CLEAN
check "⑬【正控】iPhone HEIC → 通過（白名單不可過窄）" "$(upkey 'IMG_1.heic' 'image/heic')" CLEAN

echo
echo "══ chat-get-upload-url：必須是該聊天室的成員 ══"
chatup(){ curl -s -o /dev/null -w '%{http_code}' -X POST "$API/chat/upload-url" -H "Authorization: Bearer $1" \
  -H 'Content-Type: application/json' \
  -d "{\"roomId\":\"$2\",\"fileName\":\"x.png\",\"contentType\":\"image/png\"}"; }

check "⑭【正控】成員取得上傳授權 → 200" "$(chatup "$HT" "$CHATROOM")" 200
check "⑮ 非成員取得同一房間 → 403"      "$(chatup "$OUTSIDER_T" "$CHATROOM")" 403
check "⑯ 成員帶不存在的房間 → 403"      "$(chatup "$HT" "GAME_${MARK}_NOPE")" 403

echo
echo "══ F-2 WebSocket sendMessage：必須是該聊天室的成員 ══"
# 這段委派給 ws_room_authz_probe.sh —— 它要開 WebSocket 連線（python websockets），
# 塞進這支純 curl 的腳本裡會把兩者都弄髒。
#
# 🔴 沿用本腳本已建的兩個帳號，**不讓它再註冊** —— app-register 每 IP 每小時只有 10 次，
#    本腳本已用掉 2 次；讓子腳本再吃 2 次的話，連跑兩輪就撞限流，而限流的症狀
#    （第二個帳號建不起來）在探針裡會顯示成前置失敗，看起來像測試自己壞了。
#    ⚠️ token 走 export 不走命令列參數：本機 /proc 沒掛 hidepid，argv 是全機可讀的。
PROBE="$(dirname "$0")/ws_room_authz_probe.sh"
if [ -f "$PROBE" ]; then
  WS_OUT=$(HOST_ID="$HOST" HOST_T="$HT" OUT_ID="$OUTSIDER" OUT_T="$OUTSIDER_T" \
           REGION="$REGION" API="$API" PREFIX="$PREFIX" bash "$PROBE" 2>&1)
  WS_RC=$?
  # 🔴 三態，不可壓成二態：0=擋住、1=攻擊成立（安全回歸）、其他=前置失敗（**沒測到**）。
  #    把「沒測到」算成通過，正是這支套件反覆踩過的假綠形狀。
  case "$WS_RC" in
    0) check "⑰ 非成員不得對他人房間送訊息（判準＝ChatMessages 表）" BLOCKED BLOCKED ;;
    1) check "⑰ 非成員不得對他人房間送訊息（判準＝ChatMessages 表）" ATTACK_OK BLOCKED ;;
    *) fail "⑰ WS 房間層授權：探針前置失敗（rc=$WS_RC），本項未測到"
       printf '%s\n' "$WS_OUT" | sed 's/^/      | /' ;;
  esac
else
  fail "⑰ 找不到 ws_room_authz_probe.sh —— F-2 回歸未被覆蓋"
fi

# ══════════════════════════════════════════════════════════════════════
#  2026-09-04 稽核（SECURITY_AUDIT_2026-09-03）四個 findings 的真環境守衛
#
#  🔴 為什麼要補：這四個 findings 修好、單元測試綠、突變也殺得掉，但
#     **這支腳本是唯一會打真 stg 的安全套件，而它一節都沒碰到它們**。
#     「有測試」與「線上真的是修好的那一版」是兩件事（部署夾在中間）。
#  🔴 順序也是刻意的：這四組要在**部署之前**先跑一次並且是紅的。
#     部署後才補守衛的話，全綠與「守衛根本沒涵蓋到」長得一模一樣。
# ══════════════════════════════════════════════════════════════════════

# ─── PARSERS-BEGIN ───────────────────────────────────────────────────
# 🔴 這段之間的解析函式由 `security_regression_parsers_selftest.sh` 用**標記**抽出來
#    單獨自測（不寫死行號 —— 行號會隨這支腳本增刪而漂掉，而漂掉之後
#    抽到半段仍然可能「跑得起來」）。改動這段請一併跑那支。
#    理由：這一層正是假綠最容易長出來的地方 —— 例如 sg_ci 若把「找不到那一局」
#    印成 MASKED，所有遮蔽斷言都會通過，而那是搜尋壞掉不是遮蔽有效。
#    真環境每小時只能跑 5 次（註冊限流），不能拿真跑當語法檢查。

# 取 verify-user／user-info 回應裡的 data.userId。
# 解析不了印 ERR（不印空字串 —— 空字串會跟「回了一個空 userId」撞在一起）。
data_uid(){ python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print('ERR'); raise SystemExit
v=(d.get('data') or {}).get('userId')
print(v if v else 'EMPTY')
" 2>/dev/null || echo ERR; }

# game-detail 回應裡某個 contactInfo 欄位是 VISIBLE 還是 MASKED。
gd_ci(){ CIF="$1" python3 -c "
import sys,json,os
f=os.environ['CIF']
try: d=json.load(sys.stdin)
except Exception: print('ERR'); raise SystemExit
g=(d.get('data') or {}).get('game') or {}
print('VISIBLE' if (g.get('contactInfo') or {}).get(f) else 'MASKED')
" 2>/dev/null || echo ERR; }

# search-games 結果裡「本次那一局」的某個 contactInfo 欄位。
# 找不到那一局時印 NOTFOUND —— 這很重要：搜不到東西時所有遮蔽斷言都會「通過」，
# 那是假綠。NOTFOUND 與 MASKED 必須分得出來。
sg_ci(){ CIF="$1" SGID="$GID" python3 -c "
import sys,json,os
f=os.environ['CIF']; gid=os.environ['SGID']
try: d=json.load(sys.stdin)
except Exception: print('ERR'); raise SystemExit
for g in ((d.get('data') or {}).get('games') or []):
    if g.get('gameId')==gid:
        print('VISIBLE' if (g.get('contactInfo') or {}).get(f) else 'MASKED'); raise SystemExit
print('NOTFOUND')
" 2>/dev/null || echo ERR; }

# 從 DDB 直接讀一個屬性，用來當「遮蔽前確實有值」的前置自檢。
ddb_attr(){ # $1=表名尾巴 $2=key json $3=屬性名
  aws_json dynamodb get-item --region "$REGION" --table-name "${PREFIX}$1" \
    --key "$2" --output json 2>/dev/null \
  | ATTR="$3" python3 -c "
import sys,json,os
try: d=json.load(sys.stdin)
except Exception: print('ERR'); raise SystemExit
v=(d.get('Item') or {}).get(os.environ['ATTR'])
print('PRESENT' if (v and list(v.values())[0]) else 'ABSENT')
" 2>/dev/null || echo ERR; }

# ─── PARSERS-END ─────────────────────────────────────────────────────

echo
echo "══ G-1 verify-user：userId= 入口必須是驗證過的身分（finding 2）══"
check "⓵ 匿名 ?userId=<主辦人>【原 IDOR 攻擊鏈】→ 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/verify-user?userId=$HOST")" 401
# 🔴 這條不是「回 401」而是「回**自己**」。修法是「不採信 query 的 userId，改用 token 身分」，
#    所以合法登入者查他人不會被拒絕，是被**靜靜換成自己** —— 只斷言狀態碼分不出來。
check "⓶ 登入者帶自己的 token 打 ?userId=<別人> → 回自己的 userId" \
  "$(curl -s -X POST "$API/verify-user?userId=$HOST" -H "Authorization: Bearer $OUTSIDER_T" | data_uid)" "$OUTSIDER"
check "⓷【正控】主辦人帶自己的 token 查自己 → 200 且回自己" \
  "$(curl -s -X POST "$API/verify-user?userId=$HOST" -H "Authorization: Bearer $HT" | data_uid)" "$HOST"
if [ -n "$CIPHER" ]; then
  # 這是「沒關錯」的那一半。少了它，把整支端點改成永遠 401 也會讓上面三條全綠。
  check "⓸【反控】匿名 ?lineID=<合法密文> → 仍走得通（LINE 登入 fallback 不可被關掉）" \
    "$(curl -s -X POST "$API/verify-user?lineID=$(printf '%s' "$CIPHER" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))')" | data_uid)" "$TEST_LINE_ID"
else
  fail "⓸【反控】無法產生 LINE 密文 —— verify-user 的登入 fallback 未受覆蓋"
fi

echo
echo "══ G-2 user-info：不得回傳伺服器端憑證（findings 3 & 7）══"
UI_BODY=$(curl -s "$API/user-info?userId=$HOST" -H "Authorization: Bearer $HT")
# 前置自檢：DDB 裡這兩欄必須真的有值，否則下面四條對「本來就沒這欄」也會綠。
check "⓪a【前置】DDB 的 passwordHash 有值（否則遮蔽斷言零鑑別力）" \
  "$(ddb_attr Users "{\"userId\":{\"S\":\"$HOST\"}}" passwordHash)" PRESENT
check "⓪b【前置】DDB 的 encryptedLineId 有值" \
  "$(ddb_attr Users "{\"userId\":{\"S\":\"$HOST\"}}" encryptedLineId)" PRESENT
check "⓵ 回應不含 passwordHash 這個 key" \
  "$(printf '%s' "$UI_BODY" | grep -c '"passwordHash"')" 0
check "⓶ 回應不含 encryptedLineId 這個 key" \
  "$(printf '%s' "$UI_BODY" | grep -c '"encryptedLineId"')" 0
# 🔴 key 名與「值」是兩層 needle，不是重複寫法：改掉 json tag 而不清空的話，
#    key 那層命中 0 次（看起來通過），只有值那層殺得掉它。
# ⚠️ CIPHER 為空時 `grep -cF ""` 會命中每一行 ⇒ 這條會紅得像「密文外洩」，
#    但真相是「沒有樣本可比」。兩者處置完全不同，所以分開講。
if [ -n "$CIPHER" ]; then
  check "⓷ 回應不含那串密文本身（值那層）" \
    "$(printf '%s' "$UI_BODY" | grep -cF "$CIPHER")" 0
else
  fail "⓷ 無法產生 LINE 密文 —— finding 7 的「值」那層未受覆蓋"
fi
check "⓸【正控】同一次回應仍含自己的 userId（否則 data 整個消失也會綠）" \
  "$(printf '%s' "$UI_BODY" | data_uid)" "$HOST"
check "⓹ 匿名 ?userId=<任意人> → 401（不得 fallback 到 query 身分）" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/user-info?userId=$HOST")" 401

echo
echo "══ G-3 search-games：匿名列表不得回傳聯絡 PII（finding 1）══"
SG_BODY=$(curl -s "$API/search-games")
check "⓪【正控】匿名搜尋結果找得到本次的團（找不到的話下面三條全是假綠）" \
  "$(printf '%s' "$SG_BODY" | sg_ci lineId | sed 's/^\(VISIBLE\|MASKED\)$/FOUND/')" FOUND
check "⓵ 該團的 contactInfo.lineId → 遮蔽" "$(printf '%s' "$SG_BODY" | sg_ci lineId)" MASKED
check "⓶ 該團的 contactInfo.phone → 遮蔽" "$(printf '%s' "$SG_BODY" | sg_ci phone)" MASKED
check "⓷ 該團的 contactInfo.note（自由文字欄）→ 遮蔽" "$(printf '%s' "$SG_BODY" | sg_ci note)" MASKED

echo
echo "══ G-4 game-detail：Phone 與 Note 也要遮（finding 1b）══"
# 既有的 F-1 只釘 lineId。舊的 inline 遮蔽版本清了 lineId 卻漏了 phone ——
# 也就是說 F-1 全綠與「phone 正在外洩」可以同時成立。這一節補的就是那個差額。
GD_ANON=$(curl -s -X POST "$API/game-detail" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\"}")
GD_AUTH=$(curl -s -X POST "$API/game-detail" -H "Authorization: Bearer $HT" -H 'Content-Type: application/json' -d "{\"gameId\":\"$GID\"}")
check "⓵ 匿名 → contactInfo.phone 遮蔽" "$(printf '%s' "$GD_ANON" | gd_ci phone)" MASKED
check "⓶ 匿名 → contactInfo.note 遮蔽"  "$(printf '%s' "$GD_ANON" | gd_ci note)"  MASKED
check "⓷【正控】主辦人帶 JWT → phone 可見（證明播種有效、且沒有遮過頭）" \
  "$(printf '%s' "$GD_AUTH" | gd_ci phone)" VISIBLE
check "⓸【正控】主辦人帶 JWT → note 可見" \
  "$(printf '%s' "$GD_AUTH" | gd_ci note)" VISIBLE

echo
echo "══ G-5 驗證腳本自己的 exit code 約定（rc=2 閘）══"
# 約定：0 通過／1 被測物壞了（去看程式）／2 前提已變或設備問題（去看基礎設施）。
# 每支 infra/verify_*.py 都要有一條通往 rc=2 的路，除非它自己寫 `# RC2-EXEMPT: 理由`。
#
# 🔴 **這裡有一個我沒辦法消掉的取捨，寫明白**：本腳本只有「通過／失敗」兩態，
#    表達不出第三態。閘門回 2（掃描器自己讀不懂某個檔）時我仍然只能記成 FAIL ——
#    也就是本節自己犯了它要防的那個錯。折衷是**把訊息前綴改成 ⚠️**（每日排程
#    會把 `^  ❌|^  ⚠️` 兩種都貼到 Discord），讓人看得出「這是儀器問題不是回歸」。
#    要真的分三態，得先改 security_regression_daily.sh 的 classify()，那是另一件事。
RC2_OUT=$(python3 "$(dirname "$0")/scan_verifier_exit_codes.py" --gate 2>&1); RC2=$?
case "$RC2" in
  0) TOTAL=$((TOTAL+1))
     echo "  ✅ $(printf '%s' "$RC2_OUT" | grep -m1 '^✅' | sed 's/^✅ //')" ;;
  1) TOTAL=$((TOTAL+1))
     echo "  ❌ 有 verify_*.py 沒有通往 rc=2 的路（見下）"; FAIL=$((FAIL+1))
     printf '%s\n' "$RC2_OUT" | grep -E '^🔴|^     ' | head -6 | sed 's/^/       /' ;;
  *) # 🔴 **不計入 TOTAL** —— 它沒有產生判定，算進去會被「通過 N/N」當成通過了。
     echo "  ⚠️ rc=2 閘門自己沒跑成（掃描器讀不懂某個檔）—— 儀器問題，不是回歸"
     EQUIP=$((EQUIP+1))
     printf '%s\n' "$RC2_OUT" | tail -3 | sed 's/^/       /' ;;
esac

echo
# ⚠️ 「儀器 N」加在「失敗 N」**後面**：外層 classify() 舊的
#    `失敗 \([0-9]\+\)` 樣式仍然抓得到失敗數，不會因為多一欄就解析錯。
echo "══ 斷言：通過 $(( TOTAL - FAIL )) / 共 $TOTAL（失敗 $FAIL，儀器 $EQUIP）══"
if [ "$FAIL" != "0" ]; then echo "══ 有 $FAIL 項失敗 ══"
elif [ "$EQUIP" != "0" ]; then echo "══ 斷言全綠，但有 $EQUIP 項儀器沒跑成（不是回歸）══"
else echo "══ 全部通過 ══"; fi
# ⚠️ TOTAL 是「跑到的斷言數」不是「應有的斷言數」——腳本若在中途 exit，
#    這個數會偏小。要判斷是否被截斷，看它跟上一次成功執行的數字有沒有掉。
# 雙保險：這裡就把 FAIL 反映到退出碼，trap 再依 $? 與清理結果做最終判定。
# 只靠 trap 讀 $FAIL 的話，日後有人改動 trap 就會再次假綠。
# 🔴 三態：1＝被測物壞了（去看程式）／2＝儀器沒跑成（去看基礎設施）／0＝通過。
#    **FAIL 優先於 EQUIP** —— 真的量到的回歸是更急的訊號，而且它有判定；
#    儀器問題只影響它自己那一格，不使其餘上百條斷言失效。
#    （⚠️ 這與 verify_admin_role_gate.py 的規則相反，那裡 equip 優先 ——
#      因為在那支裡「沒量到」代表整個維度都沒跑，剩下的綠燈撐不起結論。
#      判準是「沒量到的範圍有多大」，不是「哪個碼比較大」。）
#    ⚠️ EXIT trap 會保留這個 rc（它第一件事就是 `local rc=$?`）。
#    trap 裡不再補 EQUIP 判斷 —— 清理階段只會增加 FAIL，補了是死碼。
if [ "$FAIL" -gt 0 ]; then exit 1; elif [ "$EQUIP" -gt 0 ]; then exit 2; else exit 0; fi
