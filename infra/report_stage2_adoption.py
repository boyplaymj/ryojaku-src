#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[A3-n / N1] 第二段採用率＝`venueFeatures 非空 ÷ 全部（限 A3-m 之後建的）`

正典：/opt/sml/repo/tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §15.2 的 `A3-n` 小節。
使用者 2026-09-08 拍板：`A3-n` **只做 N1**（N2「明確按跳過」與 N3「開表單分母」不做）。

用法：
    python3 report_stage2_adoption.py --since 2026-09-10T12:00:00+08:00
    python3 report_stage2_adoption.py --since 1757000000 --json
    python3 report_stage2_adoption.py --selftest

退出碼：
    0 = 有讀數（分母 > 0）
    2 = **量不到**（分母 0／掃不完／`--since` 沒給或不合法）——**不可讀成「沒人用」**
    3 = selftest 有條沒過

━━ 這支為什麼可以零新表零新欄位 ━━━━━━━━━━━━━━━━━━━━━━━━━━

`A3-m` 之後，第一段送出的 payload 被 `toStage1Payload()` 收窄 ⇒ `venueFeatures`
**必定是空的**；而第二段儲存時三個「(必填)」保證至少寫進 3 個值。
⇒ **`venueFeatures` 非空 ⟺ 第二段真的儲存過。** 這是精確的，不是近似。

🔴 **而這條等價只對 `createdAt >= A3-m 部署時刻` 的局成立** —— 更早的局兩段寫在
   同一次寫入裡，那些列的 `venueFeatures` 非空只代表「建局時填了」，
   對「第二段有沒有被回頭補」**零鑑別力**。
   ⇒ `--since` 是**必填**，本支不給預設值：預設成 0／epoch 會把那些列靜靜算進分母，
     而算出來的百分比看起來完全正常。

🔴 **不可以改用 `updatedAt > createdAt` 當代理。** 實查有**五條**別的路徑會動
   `updatedAt`（報名 `web_register:288`／接受報名 `accept_registration:438`／
   取消局 `cancel_game:359`／退款 `:455`／過期掃描 `search_games:136`）
   ⇒ 那個判準對「第二段有沒有補」幾乎零鑑別力。

━━ 三個一定要跟讀數一起講的界線 ━━━━━━━━━━━━━━━━━━━━━━━━

🔴 **① TTL 把觀察窗封在 30 天內。** `Games` 的 `expiresAt = createdAt + 30 天`
   且該表 TTL 是 ENABLED（實查 2026-09-08）⇒ **更早的列已經被刪掉了**，
   不是「沒有人建局」。所以有效窗的**下緣**是 `max(--since, 現在 − 30 天)`，
   不管 `--since` 填多早。DDB 的 TTL 刪除可延遲最多約 48 小時 ⇒ 邊界是模糊的。
   ⇒ 本支會把有效窗印出來。**引用讀數時要一起講，否則會把「被 TTL 刪掉」
     讀成「那段時間沒人建局」。**

🔴 **② 分母 0 不是 0%。** 沒有列可以算的時候本支**不印百分比**、rc=2。
   `OBSERVABILITY.md §1.1`：**查不到 ≠ 沒人用。**
   ⚠️ 2026-09-08 現況：`A3-m`／`A3-p` **都還沒部署**，staging 的 `Games` 是 **0 筆**
   ⇒ 現在跑它必然是 rc=2。那是**設計上的正確結果**，不是這支壞了。

🔴 **③ N1 回答不了 §4.4 那句「降低放棄率」。** 它問的是「第二段值不值得留」。
   §4.4 的直接指標是 N3（`建局數 ÷ 開表單人數`），而分母現在零紀錄。
   ⇒ **這支的綠燈不可以拿來把 `[A3]` 打勾。**
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys

REGION = os.environ.get("AWS_REGION") or "ap-southeast-1"
TABLE = "MahjongClubStg_Games"

# `Games` 的 TTL：建立時 `expiresAt = now + 30 天`（`mahjongclub_web_create_game/main.go:391`）。
TTL_DAYS = 30

# 分類結果（三桶 ＋ 一個「不在窗內」）。
# 🔴 `UNKNOWN` 那一桶刻意存在：`createdAt` 缺漏的列**不可以**被塞進任一邊 ——
#    塞進分母會稀釋、塞進「未儲存」會誣賴，而兩種錯在百分比上都看不出來。
SAVED, NOT_SAVED, UNKNOWN, OUT_OF_WINDOW = "saved", "not_saved", "unknown", "out_of_window"


def _has_declaration(vf):
    """`venueFeatures` 這一欄算不算「第二段真的儲存過」。

    🔴 三種「空」在 DDB 上長得不一樣，全部都要算成**沒有**：
       ① 屬性根本不存在（Go 端 `dynamodbav:"venueFeatures,omitempty"` ⇒ 空切片不落地）
       ② 空 list
       ③ 只有空字串／空白的 list（不是 Go 端寫的，但外部工具寫得出來）
    """
    if not isinstance(vf, list):
        return False
    return any(isinstance(x, str) and x.strip() != "" for x in vf)


def classify(item, since_epoch):
    """一列 `Games` → 四桶之一。純函式，selftest 打的就是它。"""
    created = item.get("createdAt")
    if not isinstance(created, (int, float)):
        return UNKNOWN
    # 邊界含在內：`--since` 給的是 A3-m 部署那一刻，那一刻之後建的都算。
    if created < since_epoch:
        return OUT_OF_WINDOW
    return SAVED if _has_declaration(item.get("venueFeatures")) else NOT_SAVED


def tally(items, since_epoch):
    out = {SAVED: 0, NOT_SAVED: 0, UNKNOWN: 0, OUT_OF_WINDOW: 0}
    for it in items:
        out[classify(it, since_epoch)] += 1
    return out


def parse_since(raw):
    """ISO8601 或 unix 秒 → epoch 秒。看不懂就回 None（呼叫端 rc=2，不猜）。"""
    if raw is None:
        return None
    raw = raw.strip()
    if raw.lstrip("-").isdigit():
        return int(raw)
    try:
        # 允許 `Z`；沒帶時區的一律當成**本地時間**（與 datetime-local 那邊同一個約定）
        v = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if v.tzinfo is None:
            v = v.astimezone()
        return int(v.timestamp())
    except ValueError:
        return None


# ── DDB ────────────────────────────────────────────────────────────────
def _aws(args):
    p = subprocess.run(["aws", *args, "--region", REGION],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"aws {' '.join(args[:2])} rc={p.returncode}: {p.stderr.strip()[:300]}")
    return json.loads(p.stdout or "{}")


def _unwrap(av):
    """DDB AttributeValue → python。只認本支用得到的幾種型別。"""
    if "S" in av:
        return av["S"]
    if "N" in av:
        n = av["N"]
        return int(n) if "." not in n else float(n)
    if "L" in av:
        return [_unwrap(x) for x in av["L"]]
    if "NULL" in av:
        return None
    if "BOOL" in av:
        return av["BOOL"]
    return av  # 其餘原樣帶著（本支不會拿它做判斷）


def scan_games(table, page_limit=None):
    """整張表掃完。回 (items, complete)。

    🔴 **手動分頁，不用 CLI 的自動分頁。** 自動分頁掃不完的時候會靜靜少給幾筆，
       而「少了幾筆」與「真的只有這些」在結果上逐字相同 ——
       那正是這支最怕的那種失真（分母被低估，百分比照樣印得出來）。
       ⇒ 自己跟 `LastEvaluatedKey`，任何一頁失敗就回 `complete=False` ⇒ rc=2。
    """
    items, start_key, complete = [], None, True
    for _ in range(1000):          # 防呆上限：staging 這張表遠小於此
        args = ["dynamodb", "scan", "--table-name", table, "--no-paginate",
                "--projection-expression", "#g,#c,#v",
                "--expression-attribute-names",
                json.dumps({"#g": "gameId", "#c": "createdAt", "#v": "venueFeatures"})]
        if page_limit:
            args += ["--limit", str(page_limit)]
        if start_key:
            args += ["--exclusive-start-key", json.dumps(start_key)]
        try:
            page = _aws(args)
        except RuntimeError as e:
            print(f"🔴 掃描中斷：{e}", file=sys.stderr)
            return items, False
        items += [{k: _unwrap(v) for k, v in raw.items()} for raw in page.get("Items", [])]
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            break
    else:
        complete = False           # 迴圈跑滿仍有 LastEvaluatedKey ⇒ 沒掃完
    return items, complete and not start_key


# ── 報表 ───────────────────────────────────────────────────────────────
def fmt_ts(epoch):
    return dt.datetime.fromtimestamp(epoch).astimezone().isoformat(timespec="seconds")


def report(counts, since_epoch, now_epoch, complete, table, as_json):
    denom = counts[SAVED] + counts[NOT_SAVED]
    ttl_floor = now_epoch - TTL_DAYS * 86400
    eff_start = max(since_epoch, ttl_floor)
    out = {
        "table": table,
        "since": since_epoch,
        "ttl_floor": ttl_floor,
        "effective_window_start": eff_start,
        "window_capped_by_ttl": ttl_floor > since_epoch,
        "scan_complete": complete,
        "counts": counts,
        "denominator": denom,
        "rate": (counts[SAVED] / denom) if denom else None,
    }
    if as_json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print("══ A3-n / N1：第二段採用率 ══")
        print(f"表：{table}（{REGION}）")
        print(f"--since：{fmt_ts(since_epoch)}")
        print(f"TTL 下緣（現在 −{TTL_DAYS} 天）：{fmt_ts(ttl_floor)}")
        print(f"🔴 有效窗起點：{fmt_ts(eff_start)}"
              + ("　← **被 TTL 卡住**，比 --since 晚" if out["window_capped_by_ttl"] else ""))
        print(f"掃描完整：{'是' if complete else '否'}")
        print("--")
        print(f"第二段儲存過（venueFeatures 非空）：{counts[SAVED]}")
        print(f"未儲存（跳過／離開／還沒回來補）　：{counts[NOT_SAVED]}")
        print(f"分母（＝上面兩者相加）　　　　　　：{denom}")
        print(f"窗外（--since 之前建的，這把尺對它零鑑別力）：{counts[OUT_OF_WINDOW]}")
        print(f"不明（沒有 createdAt，兩邊都不算）　　　　　：{counts[UNKNOWN]}")
        print("--")
    if not complete:
        print("\n🔴 rc=2 量不到：**這張表沒有掃完**。分母被低估，而低估的百分比"
              "跟正確的長得一模一樣 —— 不要引用上面任何數字。", file=sys.stderr)
        return 2
    if denom == 0:
        # 🔴 分母 0 有**三種**成因，處置完全不同 —— 印同一句話等於把它們合流，
        #    而那正是本冊要修的那個病（「沒人用」與「沒埋點」在報表上長得一樣）。
        total = sum(counts.values())
        if total == 0:
            why = ("這張表**一列都沒有**。\n"
                   "   ⚠️ 2026-09-08 現況：`A3-m`／`A3-p` 都還沒部署、staging Games 0 筆\n"
                   "      ⇒ 現在跑出這個結果是**設計上正確的**，不是這支壞了。")
        elif counts[OUT_OF_WINDOW] and not counts[UNKNOWN]:
            why = (f"有 {total} 列，但**全部都在窗外**（`createdAt` 早於 --since）。\n"
                   "   ⇒ 要嘛 `--since` 給晚了，要嘛 A3-m 之後真的還沒有人建過局。\n"
                   "     這兩件事本支分不出來 —— 不要挑一個講。")
        elif counts[UNKNOWN] and not counts[OUT_OF_WINDOW]:
            why = (f"有 {total} 列，但**全部沒有 `createdAt`**。\n"
                   "   ⇒ 這通常代表表名給錯了（掃到了不是 Games 的表），\n"
                   "     或是投影／欄位名漂掉了。先確認表名，不要改斷言。")
        else:
            why = (f"有 {total} 列，但窗內一列都沒有"
                   f"（窗外 {counts[OUT_OF_WINDOW]}、不明 {counts[UNKNOWN]}）。")
        print(f"\n🔴 rc=2 量不到：**分母是 0，所以沒有讀數**（不是 0%）。\n   {why}\n"
              "   `OBSERVABILITY.md §1.1`：查不到 ≠ 沒人用。", file=sys.stderr)
        return 2
    # 🔴 `--json` 時這幾行要走 stderr。第一版直接 print 到 stdout ⇒
    #    輸出是「JSON ＋ 一段中文」，`json.load` 當場 `Extra data` ——
    #    而人眼看那份輸出**完全正常**（該有的都在）。抓到它的是 e2e 那支的 E3～E8，
    #    不是我讀程式讀出來的。
    tail = sys.stderr if as_json else sys.stdout
    print(f"✅ 第二段採用率 = {counts[SAVED]}/{denom} = {counts[SAVED] / denom * 100:.1f}%", file=tail)
    print("⚠️ 這個數字回答的是「第二段值不值得留」，**不是** §4.4 的「降低放棄率」", file=tail)
    print("   —— 後者是 N3（建局數 ÷ 開表單人數），分母目前零紀錄。不可拿本讀數把 [A3] 打勾。", file=tail)
    return 0


# ── selftest ───────────────────────────────────────────────────────────
def selftest():
    T, F = True, False
    cases = []

    def t(name, got, want):
        cases.append((name, got == want, f"got={got!r} want={want!r}"))

    S = 1_000_000  # 假的 A3-m 部署時刻

    # ① `_has_declaration` 的三種「空」
    t("S1 屬性不存在 ⇒ 沒宣告", _has_declaration(None), F)
    t("S2 空 list ⇒ 沒宣告", _has_declaration([]), F)
    t("S3 只有空白字串 ⇒ 沒宣告", _has_declaration(["", "  "]), F)
    t("S4 有一個真值 ⇒ 有宣告", _has_declaration(["無菸"]), T)
    # 🔴 反控：少了它，`_has_declaration` 直接回 True 也會讓 S4 綠。
    t("S5（反控）混著空白與真值 ⇒ 有宣告", _has_declaration(["", "有電梯"]), T)
    t("S6 不是 list（型別跑掉）⇒ 沒宣告", _has_declaration("無菸"), F)

    # ② `classify` 的四桶
    t("S7 窗內＋有宣告 ⇒ saved",
      classify({"createdAt": S + 1, "venueFeatures": ["無菸"]}, S), SAVED)
    t("S8 窗內＋沒宣告 ⇒ not_saved",
      classify({"createdAt": S + 1}, S), NOT_SAVED)
    t("S9 窗外（createdAt 比 since 早）⇒ out_of_window，**即使有宣告**",
      classify({"createdAt": S - 1, "venueFeatures": ["無菸"]}, S), OUT_OF_WINDOW)
    t("S10 邊界：createdAt == since ⇒ 算在窗內",
      classify({"createdAt": S, "venueFeatures": ["無菸"]}, S), SAVED)
    t("S11 沒有 createdAt ⇒ unknown（不可以塞進任一邊）",
      classify({"venueFeatures": ["無菸"]}, S), UNKNOWN)
    t("S12 createdAt 是字串（型別跑掉）⇒ unknown，不是 not_saved",
      classify({"createdAt": "1000001"}, S), UNKNOWN)

    # ③ `tally`：分母只由 saved+not_saved 組成
    items = [
        {"createdAt": S + 1, "venueFeatures": ["無菸", "有電梯", "手動桌"]},
        {"createdAt": S + 2},
        {"createdAt": S + 3, "venueFeatures": []},
        {"createdAt": S - 5, "venueFeatures": ["無菸"]},
        {"venueFeatures": ["無菸"]},
    ]
    c = tally(items, S)
    t("S13 tally 四桶分開算", c, {SAVED: 1, NOT_SAVED: 2, UNKNOWN: 1, OUT_OF_WINDOW: 1})
    t("S14 分母＝saved+not_saved（不含窗外與不明）", c[SAVED] + c[NOT_SAVED], 3)
    # 🔴 反控：全部都有宣告時率是 1；少了這條，一個「永遠回 saved」的分類器
    #    仍然能讓 S13 以外的多數條通過。
    c2 = tally([{"createdAt": S + 1, "venueFeatures": ["無菸"]}] * 4, S)
    t("S15（反控）全部有宣告 ⇒ saved=4、not_saved=0", (c2[SAVED], c2[NOT_SAVED]), (4, 0))
    c3 = tally([{"createdAt": S + 1}] * 4, S)
    t("S16（反控）全部沒宣告 ⇒ saved=0、not_saved=4", (c3[SAVED], c3[NOT_SAVED]), (0, 4))

    # ④ `parse_since`：看不懂就回 None（呼叫端才有機會 rc=2，不會靜靜當成 0）
    t("S17 unix 秒", parse_since("1757000000"), 1757000000)
    t("S18 ISO 帶時區", parse_since("2026-09-10T12:00:00+08:00"),
      int(dt.datetime.fromisoformat("2026-09-10T12:00:00+08:00").timestamp()))
    t("S19 看不懂 ⇒ None（不猜）", parse_since("下週一"), None)
    t("S20 None ⇒ None", parse_since(None), None)
    # 🔴 反控：`0` 是合法輸入但語意危險（等於不設限）——
    #    這條釘住「它會被解析成 0 而不是 None」，因為 rc=2 的判斷要分得開
    #    「沒給」與「給了 0」。
    t("S21（反控）字串 '0' 解析成 0，不是 None", parse_since("0"), 0)

    # ⑤ `_unwrap`
    t("S22 N 轉 int", _unwrap({"N": "1757000000"}), 1757000000)
    t("S23 L of S", _unwrap({"L": [{"S": "無菸"}, {"S": "有電梯"}]}), ["無菸", "有電梯"])

    bad = [c for c in cases if not c[1]]
    for name, okc, detail in cases:
        print(f"{'✅' if okc else '❌'} {name} — {detail}")
    print(f"\n=== {len(cases) - len(bad)}/{len(cases)} 通過 ===")
    return 3 if bad else 0


def main():
    ap = argparse.ArgumentParser(description="A3-n / N1 第二段採用率")
    ap.add_argument("--since", help="A3-m 部署時刻（ISO8601 或 unix 秒）。**必填**，本支不給預設值")
    ap.add_argument("--table", default=TABLE)
    ap.add_argument("--json", action="store_true")
    # 🔴 只給**驗證分頁**用。整張表一頁掃得完的時候，`LastEvaluatedKey` 那條路
    #    一次都不會走到 ⇒ 「分頁寫對了」與「分頁從來沒被執行過」在綠燈上相同。
    #    把它調小就能逼出多頁，讓那段程式真的跑過。
    ap.add_argument("--page-limit", type=int, default=None,
                    help="每頁最多幾筆（只給驗證分頁用，不影響結果）")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        return selftest()

    since = parse_since(a.since)
    if since is None:
        print("🔴 rc=2：`--since` 沒給或看不懂。\n"
              "   它是 **A3-m 的部署時刻** —— 更早建的局兩段寫在同一次寫入裡，\n"
              "   把它們算進分母會得到一個「看起來完全正常」的錯數字。\n"
              "   ⚠️ 2026-09-08：`A3-m` 還沒部署 ⇒ **這個值現在還不存在**，\n"
              "      不要為了讓它跑起來而隨便填一個。", file=sys.stderr)
        return 2

    items, complete = scan_games(a.table, a.page_limit)
    now = int(dt.datetime.now().timestamp())
    return report(tally(items, since), since, now, complete, a.table, a.json)


if __name__ == "__main__":
    sys.exit(main())
