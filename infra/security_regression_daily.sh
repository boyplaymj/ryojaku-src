#!/usr/bin/env bash
# 安全回歸套件的**每日排程外殼** —— 給 `security_regression.sh` 一個「會自己跑」的觸發器。
#
# 為什麼需要這支（2026-09-04，稽核冊 SECURITY_AUDIT_2026-09-03 §9b 待辦①）：
#   `security_regression.sh` 已經有 exit code、有正控反控、有 parsers selftest，
#   36 條斷言一條不缺 —— 但它**只在有人想到的時候才被執行**。
#   本 repo 已經有過一模一樣的形狀：`verify_geo_numbers.py` 紅了三天沒人知道，
#   因為缺的不是守衛，是「有人會跑它」。
#   ⇒ 守衛有三層，不是兩層：①註解 ②有 exit code ③**有東西會去觸發它**。
#      第②層與第③層在 repo 裡長得一模一樣（都是一支寫得很好的腳本躺著）。
#      本支就是第③層。判別法：問「它上一次是誰、因為什麼跑的」。
#
# 🔴 受測物是**線上 stg**，不是任何一棵工作樹。但**儀器**（那支腳本本身）
#    一定要釘在**已提交的 master**，不可以直接跑 /opt/sml/ryojaku-src 裡的版本：
#    那是多條 session 共用的樹，隨時躺著別人未提交的中間狀態。在共用樹上跑，
#    紅燈同時可能是「stg 真的回歸了」與「有人正在改這支腳本」—— 兩者在輸出上
#    逐字相同，而分不出來的告警會被訓練成忽略，且不可逆。
#    代價講明白：它**看不見**還在工作樹裡、尚未提交的守衛改動（那由人自己跑負責），
#    也**只追 master**。
#
# 🔴 一定要 flock。`MARK="SECREG-DELETEME"` 是**常數**，兩次併行執行會在
#    cleanup 的全表掃描裡互相刪掉對方正在用的列 ⇒ 兩邊都紅，而且紅得像安全回歸。
#    排程每天一次不會自撞，但「排程 + 有人手動跑」很容易撞。
#
# ⚠️ 限流：底層腳本每次註冊 **2 個帳號**，而 app-register 是每 IP 每小時 10 次
#    ⇒ 本機每小時最多 5 次。每日排程佔掉其中 1 次。
#
# ── rc 對照（照抄 sml-geo-verify / sml-tianwang-audit 的分法）────────────
#   0 = 全綠（沒發文，或只發了心跳）
#   2 = 有事要講，**而且已經講出去了**        ← 與 0 一起算 unit 成功（見 .service）
#   1 = 有事要講卻**沒講出去**（發文失敗）—— 這比紅燈本身嚴重，它讓之後每次紅燈都靜音
#   3 = 設備問題：worktree 準備失敗／樹不乾淨／找不到腳本
#
# 🔴 「設備問題」與「安全回歸」必須分開講，而分法**不是關鍵字白名單**
#    （手挑清單漏掉的那項零徵兆）。判準是**結構的**：底層腳本在跑完所有斷言後
#    必定印一行 `══ 斷言：通過 P / 共 N（失敗 F）══`。
#      · 那行不存在  ⇒ 前置就掛了（註冊限流／API 不可達／AWS 權限）⇒ **沒測到**，不是回歸
#      · 那行存在且 F>0                                        ⇒ 斷言紅燈
#      · 那行存在、F=0，但腳本 rc≠0                            ⇒ 掛在**清理**（殘留／AWS 失敗）
#    這三種的處置完全不同，壓成一種等於沒報。
#
# 🔴 還有第四種，它是**全綠的形狀**：`TOTAL` 是「跑到的斷言數」不是「應有的斷言數」
#    （底層腳本自己的檔尾就寫了這個盲區）。有人把幾條斷言刪掉／或腳本悄悄少跑一段，
#    F=0、rc=0、畫面全綠，而涵蓋範圍靜靜縮水。⇒ 本支把上一次成功的 N 存起來，
#    **掉了就叫**。這是那個盲區唯一的載體。
set -uo pipefail

REPO=${SECREG_REPO:-/opt/sml/ryojaku-src}
BRANCH=${SECREG_BRANCH:-master}
WT=${SECREG_WT:-/opt/sml/.buildtmp/secreg-verify-wt}
REL=infra/security_regression.sh
# 📈股市收件匣 —— 與 sml-notify-failure.sh／sml-geo-verify／sml-tianwang-audit 同一個落點。
# 2026-09-01 使用者拍板：告警集中在一處，才有「這裡沒聲音＝沒事」這個可讀的預設。
CHANNEL=${SECREG_CHANNEL:-1522142940355362828}
POSTER=${SECREG_POSTER:-/opt/sml/repo/tools/discord-post/post_message.py}
# 全綠時每隔這麼多天發一次心跳。**不可以關掉**：全綠靜音的話，「一切正常」與
# 「這支排程早就死了」在 Discord 上長得一模一樣 —— 那正是本支存在的理由本身。
HEARTBEAT_DAYS=${SECREG_HEARTBEAT_DAYS:-7}
# 🔴 預設值刻意跟 unit 的 StateDirectory= **同一個路徑**，不是隨手挑的暫存目錄。
#    2026-09-04 掛排程時實際踩到：原本預設 /opt/sml/.buildtmp/secreg-verify，
#    而排程跑起來 STATE_DIRECTORY=/var/lib/sml-ryojaku-secreg ⇒ 排程與手動各自
#    一份 state，`best_total`（縮水偵測的基準）跟著分家 —— 兩邊都「有紀錄」，
#    而那個基準對另一邊零鑑別力。同一件事沒有兩個正本。
STATE_DIR=${STATE_DIRECTORY:-/var/lib/sml-ryojaku-secreg}
STATE=$STATE_DIR/state.json
RUN_TIMEOUT=${SECREG_TIMEOUT:-900}
DRY=${SECREG_DRY_RUN:-0}          # 1 = 準備 worktree 但不真跑（給接線驗收用）

# ── 判讀函式：把一次執行歸成六類之一 ────────────────────────────────────
# 用法：eval "$(classify <log 檔> <腳本 rc> <歷史最高斷言數>)"
#       → 設定 KIND / TOTAL / NFAIL
#
# 🔴 分法是**結構的**，不是關鍵字白名單：底層腳本跑完所有斷言後必定印一行
#    `══ 斷言：通過 P / 共 N（失敗 F）══`。有沒有那一行，把「沒測到」與
#    「測了而且紅了」切開。用關鍵字清單的話，新增一種前置失敗就會被誤判成回歸，
#    而漏掉的那一項零徵兆。
#
# 🔴 順序有意義，不可重排：timeout 要排在最前面（逾時的 log 可能剛好也含
#    半行 summary）；shrunk 要排在最後（它是**全綠的形狀**，只有前面全部
#    不成立時才輪得到它）。
classify() {
    local log="$1" rc="$2" best="$3" sumline total nfail kind
    sumline=$(grep -E '^══ 斷言：通過 ' "$log" 2>/dev/null | tail -1)
    total=$(printf '%s' "$sumline" | sed -n 's/.*共 \([0-9]\+\).*/\1/p')
    nfail=$(printf '%s' "$sumline" | sed -n 's/.*失敗 \([0-9]\+\).*/\1/p')
    if [ "$rc" = 124 ]; then
        kind=timeout
    elif [ -z "$sumline" ] || [ -z "$total" ]; then
        kind=precondition      # 沒跑到斷言階段 ⇒ 沒測到，不是回歸
    elif [ "${nfail:-0}" -gt 0 ]; then
        kind=assert            # 斷言紅燈
    elif [ "$rc" != 0 ]; then
        kind=cleanup           # 斷言全綠，掛在清理／殘留
    elif [ "$total" -lt "$best" ]; then
        kind=shrunk            # 全綠，但守衛自己縮水了
    else
        kind=green
    fi
    printf 'KIND=%s; TOTAL=%s; NFAIL=%s\n' "$kind" "${total:-}" "${nfail:-}"
}

# ── 安裝漂移檢查 ───────────────────────────────────────────────────────
# unit 檔有兩份：版控裡的 infra/sml-ryojaku-secreg.{service,timer}（正本）與
# /etc/systemd/system/ 底下**真的會被執行**的那份。systemd 只看後者。
# 🔴 這個坑本機已經記過好幾次：「腳本在版控、註冊不在版控」⇒ 換機器靜默失效，
#    而失效的樣子跟「一切正常但很安靜」逐字相同。這裡把它變成有讀數的東西。
# ⚠️ 界線：它只比**檔案內容**。unit 被 disable、timer 被 mask、或有 drop-in
#    override 疊上去，它一律看不到（那幾種要看 systemctl 自己）。
UNIT_DIR=${SECREG_UNIT_DIR:-/etc/systemd/system}
check_install() {  # $1=樹根；印出差異描述，沒差異則不印任何東西
    local src="$1" u out=""
    for u in sml-ryojaku-secreg.service sml-ryojaku-secreg.timer; do
        if [ ! -f "$UNIT_DIR/$u" ]; then
            out="$out
· \`$UNIT_DIR/$u\` **不存在** —— 版控裡有正本，但這台機器沒註冊過。"
        elif ! cmp -s "$src/infra/$u" "$UNIT_DIR/$u"; then
            out="$out
· \`$u\` 已安裝的那份與版控正本**不一致**（systemd 執行的是已安裝的那份）。"
        fi
    done
    printf '%s' "$out"
}

if [ "${1:-}" = "--check-install" ]; then
    D=$(check_install "${2:-$(cd "$(dirname "$0")/.." && pwd)}")
    if [ -z "$D" ]; then echo "✅ unit 檔：版控正本與 $UNIT_DIR 一致"; exit 0; fi
    echo "🟠 unit 檔漂移：$D"; exit 1
fi

# ── --selftest：只驗 classify，不碰 AWS／不發文／不建 worktree ───────────
if [ "${1:-}" = "--selftest" ]; then
    T=$(mktemp -d); n=0; bad=0
    t() {  # t <名稱> <log 內容> <rc> <best> <期望 KIND>
        n=$((n+1)); printf '%s\n' "$2" > "$T/l"
        local KIND TOTAL NFAIL
        eval "$(classify "$T/l" "$3" "$4")"
        if [ "$KIND" = "$5" ]; then echo "  ✅ T$n $1（$KIND）"
        else echo "  ❌ T$n $1：得到 $KIND，期望 $5"; bad=$((bad+1)); fi
    }
    SUM_OK='══ 斷言：通過 36 / 共 36（失敗 0）══'
    SUM_RED='══ 斷言：通過 26 / 共 36（失敗 10）══'
    echo "── classify selftest ──"
    t "全綠"                     "$SUM_OK"                       0   36 green
    t "斷言紅燈"                 "$SUM_RED"                      1   36 assert
    t "前置就掛（沒有 summary）" '  ❌ 註冊失敗：{"error":"嘗試次數過多"}' 1 36 precondition
    t "逾時"                     "$SUM_OK"                       124 36 timeout
    t "斷言全綠但清理沒收乾淨"   "$SUM_OK"                       1   36 cleanup
    t "全綠但縮水"               '══ 斷言：通過 20 / 共 20（失敗 0）══' 0 36 shrunk
    # 🔴 反控：沒有這幾條的話，「把 kind 寫死成 green」也會讓上面全綠。
    t "【反控】首次執行 best=0 不可判成縮水" "$SUM_OK"           0   0  green
    t "【反控】斷言數變多是正常的"           "$SUM_OK"           0   30 green
    t "【反控】空 log ＋ rc=0 仍是沒測到"    ''                  0   36 precondition
    # 🔴 這條讓 `[ -z "$total" ]` 那半不是贅字：summary 被截斷（有那行、抓不到數字）
    #    時，"$total" 拿去做 -gt/-lt 比較會是語法錯，而外觀是「判成了 assert」。
    t "summary 被截斷仍是沒測到"             '══ 斷言：通過 36 / 共 '  0 36 precondition
    # 🔴 這條釘住「先看 nfail 再看 rc」：清理失敗與斷言紅燈的 rc 都是 1，
    #    只有 summary 裡的失敗數分得出來。順序寫反的話它會變成 cleanup。
    t "斷言紅＋rc=1 要判 assert 不是 cleanup" "$SUM_RED"         1   36 assert
    rm -rf "$T"
    echo "── 通過 $((n - bad)) / $n ──"
    [ "$bad" = 0 ] || exit 1
    exit 0
fi

mkdir -p "$STATE_DIR" || exit 3
LOG=$STATE_DIR/last-run.log
NOW=$(date +%s)
STAMP=$(date -Iseconds)

# 🔴 鎖檔路徑**固定**，不可以跟著 STATE_DIR 走。
#    這正是上面那段講的同一個坑的另一半：鎖檔若在 STATE_DIR 底下，排程與手動
#    會各鎖各的檔，而 flock 的語意是「鎖同一個 inode 才互斥」⇒ 兩把不同的鎖
#    ＝沒有鎖，但外觀（程式裡有 flock、log 也不會有任何抱怨）跟鎖好了一樣。
# 🔴 這把鎖護的是**乾淨 worktree**（checkout -f 會把另一輪腳下的樹換掉）。
#    護「stg 測試資料」的是另一把，在 security_regression.sh 自己裡面 ——
#    因為那條路人可以繞過本外殼直接走。兩把鎖**必須是不同的檔**，
#    同一個檔的話本外殼持著它、子行程再去 flock 就自己鎖死自己。
WRAPPER_LOCK=${SECREG_WRAPPER_LOCK:-/tmp/ryojaku-secreg-wrapper.lock}
exec 9>"$WRAPPER_LOCK"
if ! flock -n 9; then
    echo "[secreg] 另一次執行正在跑，本次跳過（$STAMP）"
    exit 0
fi

read_state() {   # read_state <key> <預設>
    python3 - "$STATE" "$1" "$2" <<'PY' 2>/dev/null || echo "$2"
import json, sys
try:
    print(json.load(open(sys.argv[1])).get(sys.argv[2], sys.argv[3]))
except Exception:
    print(sys.argv[3])
PY
}
write_state() {  # write_state <rc> <sha> <red_streak> <last_post_epoch> <best_total>
    python3 - "$STATE" "$1" "$2" "$3" "$4" "$5" "${DRIFT_SHA:--}" "$STAMP" <<'PY'
import json, sys
p, rc, sha, streak, last_post, best, drift, stamp = sys.argv[1:9]
json.dump({"last_rc": int(rc), "last_sha": sha, "red_streak": int(streak),
           "last_post_epoch": int(last_post), "best_total": int(best),
           "drift_sha": drift, "last_run": stamp},
          open(p, "w"), ensure_ascii=False, indent=1)
PY
}
post() { printf '%s' "$1" | python3 "$POSTER" "$CHANNEL" >/dev/null 2>&1; }

PREV_STREAK=$(read_state red_streak 0)
LAST_POST=$(read_state last_post_epoch 0)
BEST_TOTAL=$(read_state best_total 0)

fail_equipment() {   # 設備問題：講出去，然後 rc=3
    local why="$1"
    echo "[secreg] 🔴 設備問題：$why"
    if ! post "🛡️🔴 **両雀 安全回歸守衛：跑不起來**
$why

（這不是「守衛紅了」，是**守衛根本沒跑**。放著不管的症狀是：以後每天都靜靜地什麼都沒驗。）
排程：\`sml-ryojaku-secreg.timer\`　外殼：\`$REL 的姊妹檔 security_regression_daily.sh\`"; then
        echo "[secreg] 🔴 而且**通知也沒送出去** —— 只剩 OnFailure 那條路"
    fi
    write_state 3 "-" "$PREV_STREAK" "$NOW" "$BEST_TOTAL"
    exit 3
}

# ── ① 準備乾淨 worktree（釘在 master 的當前 commit）─────────────────────
SHA=$(git -C "$REPO" rev-parse "refs/heads/$BRANCH" 2>/dev/null) \
    || fail_equipment "讀不到 $REPO 的 refs/heads/$BRANCH"
SHORT=${SHA:0:8}
SUBJECT=$(git -C "$REPO" log -1 --format=%s "$SHA" 2>/dev/null)

prep_ok=0
: > "$LOG.prep"
if [ -e "$WT/.git" ]; then
    if git -C "$WT" checkout --detach -f "$SHA" >>"$LOG.prep" 2>&1 \
       && git -C "$WT" clean -xdff >>"$LOG.prep" 2>&1; then
        prep_ok=1
    fi
fi
if [ $prep_ok = 0 ]; then
    # .buildtmp 有每日 GC（--days 2），樹被回收掉是正常的，這條路就是自癒。
    rm -rf "$WT"
    git -C "$REPO" worktree prune >>"$LOG.prep" 2>&1
    git -C "$REPO" worktree add --detach -f "$WT" "$SHA" >>"$LOG.prep" 2>&1 \
        || fail_equipment "建不出 worktree $WT（詳見 $LOG.prep）"
fi

# 🔴 這幾行是本設計唯一的支點，不可省：**「我跑的是乾淨的 master」這句話本身要有讀數**。
#    少了它，樹被誰弄髒、或 checkout 悄悄失敗時，跑出來的紅／綠都不知道是誰的。
GOT=$(git -C "$WT" rev-parse HEAD 2>/dev/null)
[ "$GOT" = "$SHA" ] || fail_equipment "worktree HEAD=$GOT，期望 $SHA"
DIRT=$(git -C "$WT" status --porcelain 2>/dev/null | head -5)
[ -z "$DIRT" ] || fail_equipment "驗收用的 worktree 不乾淨（clean -xdff 之後仍有改動）：
\`\`\`
$DIRT
\`\`\`"
[ -f "$WT/$REL" ] || fail_equipment "$WT/$REL 不存在"

DRIFT=$(check_install "$WT")
DRIFT_SHA=$(printf '%s' "$DRIFT" | sha256sum | cut -c1-12)
PREV_DRIFT=$(read_state drift_sha "-")
[ -n "$DRIFT" ] && echo "[secreg] 🟠 unit 檔漂移：$DRIFT"

if [ "$DRY" = 1 ]; then
    echo "[secreg] DRY_RUN：worktree 已就緒 @ $SHORT（$WT），未執行守衛"
    exit 0
fi

# ── ② 跑套件 ────────────────────────────────────────────────────────────
T0=$SECONDS
# 🔴 不接管線取 rc（管線的 rc 是最後一支的）。輸出先落檔再讀。
# 🔴 **絕不帶 --cleanup-orphans**：那是破壞性的資料修復，不該由無人看管的排程執行。
if (cd "$WT/infra" && TMPDIR=/opt/sml/.buildtmp timeout "$RUN_TIMEOUT" \
        bash security_regression.sh) >"$LOG" 2>&1; then
    RC=0
else
    RC=$?
fi
DUR=$((SECONDS - T0))

# ── ③ 判讀：先分「有沒有跑到斷言階段」，再分紅在哪 ──────────────────────
eval "$(classify "$LOG" "$RC" "$BEST_TOTAL")"
FAILS=$(grep -E '^  ❌|^  ⚠️' "$LOG" | sed 's/^  //' | head -12)

if [ "$KIND" = green ]; then
    [ -n "$TOTAL" ] && [ "$TOTAL" -gt "$BEST_TOTAL" ] && BEST_TOTAL=$TOTAL
    echo "[secreg] ✅ 全綠 ${TOTAL:-?}/${TOTAL:-?} ${DUR}s @ $SHORT"
    AGE_DAYS=$(( (NOW - LAST_POST) / 86400 ))
    if [ "$PREV_STREAK" -gt 0 ]; then
        # 由紅轉綠一定要講：紅的時候吵過人，好了卻不吭聲的話，
        # 讀的人手上會一直留著一個沒有結局的告警。
        post "🛡️✅ **両雀 安全回歸守衛：紅轉綠**（連紅 $PREV_STREAK 次之後）
\`$SHORT\` $SUBJECT
$TOTAL 條斷言全過　${DUR}s（真打 stg）" && LAST_POST=$NOW
    elif [ "$AGE_DAYS" -ge "$HEARTBEAT_DAYS" ]; then
        post "🛡️✅ **両雀 安全回歸守衛：心跳**（每 ${HEARTBEAT_DAYS} 天一則）
$TOTAL 條斷言全過　${DUR}s（真打 stg）　\`$SHORT\`

這則的用途是**證明排程還活著** —— 全綠靜音的話，「一切正常」跟「這支早就死了」
在這個頻道上長得一模一樣。下一則心跳應在 ${HEARTBEAT_DAYS} 天內出現；沒出現就是它死了。" \
            && LAST_POST=$NOW
    fi
    # 🔴 漂移不會讓安全斷言變紅，所以它**必須有自己的一則** —— 否則它只活在
    #    journal 裡，而 journal 沒有人每天讀。同一個漂移只講一次（DRIFT_SHA 沒變
    #    就不再發），避免天天洗頻把人訓練成忽略。
    if [ -n "$DRIFT" ] && [ "$DRIFT_SHA" != "$PREV_DRIFT" ]; then
        if post "🛡️🟠 **両雀 安全回歸守衛：排程 unit 檔漂移**
安全斷言 $TOTAL 條**全過**，這則講的是另一件事：$DRIFT

版控正本：\`infra/sml-ryojaku-secreg.{service,timer}\`　實際跑的是 \`$UNIT_DIR\` 那份。
對一次：\`bash infra/security_regression_daily.sh --check-install\`"; then
            write_state 0 "$SHA" 0 "$NOW" "$BEST_TOTAL"
            exit 2
        fi
    fi
    write_state 0 "$SHA" 0 "$LAST_POST" "$BEST_TOTAL"
    exit 0
fi

STREAK=$((PREV_STREAK + 1))
case "$KIND" in
  timeout)
    HEAD="🛡️🔴 **両雀 安全回歸守衛：逾時**（連續第 $STREAK 次）"
    WHY="${RUN_TIMEOUT}s 內沒跑完。**這不是回歸，是沒測到。**" ;;
  precondition)
    HEAD="🛡️🟠 **両雀 安全回歸守衛：沒測到**（連續第 $STREAK 次）"
    WHY="前置階段就掛了，**一條安全斷言都沒跑到**（找不到 \`══ 斷言：通過\` 那行）。
最常見原因：\`app-register\` 限流（每 IP 每小時 10 次，本套件每次用 2 次）、
stg API 不可達、或 AWS／SSM 權限掉了。**這不是安全回歸。**" ;;
  assert)
    HEAD="🛡️🔴 **両雀 安全回歸守衛：斷言紅燈**（連續第 $STREAK 次）"
    WHY="$NFAIL / $TOTAL 條斷言失敗。這是**真打 stg** 的讀數 —— 單元測試綠不代表線上是修好的那一版。" ;;
  cleanup)
    HEAD="🛡️🟠 **両雀 安全回歸守衛：斷言全綠，但清理沒收乾淨**（連續第 $STREAK 次）"
    WHY="$TOTAL 條斷言全過，掛在清理階段（殘留未刪，或掃描期間 AWS 呼叫失敗）。
**安全面沒有壞消息**，但 stg 表裡可能留著本次的測試資料。" ;;
  shrunk)
    HEAD="🛡️🟠 **両雀 安全回歸守衛：全綠，而它自己縮水了**（連續第 $STREAK 次）"
    WHY="本次只跑到 **$TOTAL** 條斷言，之前最多跑到 **$BEST_TOTAL** 條。
rc=0、一條都沒紅 —— 但**涵蓋範圍掉了 $((BEST_TOTAL - TOTAL)) 條**。
可能是有人刪掉斷言，也可能是腳本悄悄少跑一段。全綠不等於全驗。" ;;
esac

BODY="$HEAD
儀器釘在**乾淨 master**：\`$SHORT\` $SUBJECT　（受測物是**線上 stg**）
rc=$RC　${DUR}s

$WHY
\`\`\`
${FAILS:-（沒抓到 ❌ 行，直接看下面那份日誌）}
\`\`\`
重現：\`cd $WT/infra && bash security_regression.sh\`　（本次輸出留在 \`$LOG\`）"

[ -n "$DRIFT" ] && BODY="$BODY
⚠️ 順帶一提，unit 檔也有漂移：$DRIFT"

if post "$BODY"; then
    write_state "$RC" "$SHA" "$STREAK" "$NOW" "$BEST_TOTAL"
    echo "[secreg] ❌ 已通知（kind=$KIND，連續 $STREAK 次）"
    exit 2
fi
write_state "$RC" "$SHA" "$STREAK" "$LAST_POST" "$BEST_TOTAL"
echo "[secreg] 🔴 有事要講卻**未通知**（發文失敗，kind=$KIND）"
exit 1
