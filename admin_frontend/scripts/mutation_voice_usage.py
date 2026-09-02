#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D6 聚合層（src/utils/voiceUsage.ts）的突變測試 —— 可重跑的鑑別力證據。

為什麼要有這支：`node --test` 全綠只證明「目前沒壞」，不證明「壞了會被抓到」。
本檔每一條規則都是**錯了不會報錯**的那一種（一個數字從 5 變成 3，版面上長得一樣），
所以「測試綠」這件事本身沒有告訴我任何東西 —— 要問的是「把規則改壞，哪一條會紅」。

跑法：
    python3 scripts/mutation_voice_usage.py            # 全套
    python3 scripts/mutation_voice_usage.py --anchors  # 只驗錨點還在（秒級，不掛看板）

退出碼：
    0  每一發都咬到它宣告的測試
    1  有突變存活，或咬到的不含宣告的那條  ← 這是本檔要抓的
    2  設備問題（錨點漂掉／基準線不綠／發數對不上／還原失敗）
       🔴 rc=2 是「量不到」，不可以讀成通過。

🔴 三個坑寫在這裡，因為它們都讓「假通過」與「真通過」在畫面上逐字相同：

  ① **錨點會靜靜漂掉。** 被改的那行換了寫法之後，`replace` 就一次都沒命中，
     而突變體＝原始碼 ⇒ 測試當然全過 ⇒ 報「存活」。那個讀數會叫我去
     「加強一條本來就有效的斷言」，方向完全是反的。
     ⇒ 每一發都先確認**檔案真的變了**，沒變一律 rc=2，不進存活統計。
  ② **`expect ⊆ killed`，不是「有紅就好」。** 只要求交集非空的話，
     一發突變咬到別條測試也會被記成 KILLED，而我宣告的那條其實沒有鑑別力。
  ③ **宣告用測試名，不用編號。** 前面插一條測試就會讓所有編號位移，
     而位移後的集合照樣對得到「某一條」⇒ rc 不會變。
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                      # admin_frontend/
TARGET = ROOT / "src/utils/voiceUsage.ts"
TESTS = ROOT / "src/utils/voiceUsage.test.ts"
NODE = "node-22"
BOARD_GATE = "/opt/sml/repo/tools/bgtask/require-board.sh"

# (代號, 說明, 錨點, 換成什麼, 必須咬到的測試名片段)
MUTANTS = [
    ("M1", "分母 0 時 noDiffRate 回 0 而不是 null",
     "noDiffRate: corrections > 0 ? noDiff / corrections : null,",
     "noDiffRate: corrections > 0 ? noDiff / corrections : 0,",
     "T6"),
    ("M2", "一頁都沒拿到時也算掃完了",
     "const complete = pages.length > 0 && !last?.nextCursor;",
     "const complete = !last?.nextCursor;",
     "T5"),
    ("M3", "毫秒級 ts 不換算",
     "const sec = ts >= MS_THRESHOLD ? Math.floor(ts / 1000) : Math.floor(ts);",
     "const sec = Math.floor(ts);",
     "T8"),
    ("M4", "ts=0 當成有效時間戳（1970）",
     "if (!Number.isFinite(ts) || ts <= 0) return { sec: 0, cls: 'undated' };",
     "if (!Number.isFinite(ts) || ts < 0) return { sec: 0, cls: 'undated' };",
     "T9"),
    ("M5", "認不得的 kind 併進 open",
     "otherEvents += ev.other ?? 0;",
     "open += ev.other ?? 0;",
     "T15"),
    ("M6", "窗邊界由閉區間改成開區間",
     "} else if (sec >= windowStart) {",
     "} else if (sec > windowStart) {",
     "T11"),
    ("M7", "pageEvents 取最後一頁而不是逐頁相加",
     "open += ev.open ?? 0;",
     "open = ev.open ?? 0;",
     "T1"),
    ("M8", "distinctUsers 退化成筆數",
     "if (r.userId) users.add(r.userId);",
     "if (r.userId) users.add(r.userId + String(corrections));",
     "T13"),
    ("M9", "樣本門檻少驗「不重複使用者」那條",
     "if (users.size < SAMPLE_GATE.minDistinctUsers) {",
     "if (false) {",
     "T17"),
    ("M10", "拿 open 次數冒充不重複人數",
     "openDistinctUsers: null,",
     "openDistinctUsers: open,",
     "T14"),
    ("M11", "時鐘超前的 slack 拿掉",
     "if (sec > nowSec + FUTURE_SLACK_SEC) return { sec, cls: 'future' };",
     "if (sec > nowSec) return { sec, cls: 'future' };",
     "T10"),
    ("M12", "asrErrors 跨頁覆寫而不是累加",
     "asrErrors[code] = (asrErrors[code] ?? 0) + n;",
     "asrErrors[code] = n;",
     "T16"),
    ("M13", "掃描未完成時不標「至少」",
     "return complete ? String(n) : `至少 ${n}`;",
     "return String(n);",
     "T3"),
    ("M14", "null 的百分比印成 0%",
     "return rate === null ? '—' : `${(rate * 100).toFixed(digits)}%`;",
     "return rate === null ? '0.0%' : `${(rate * 100).toFixed(digits)}%`;",
     "T6"),
]


def run_tests():
    """跑一次測試，回 (rc, 失敗的測試名集合)。

    🔴 用 TAP 抓失敗**名稱**，不是只看 rc。只看 rc 的話「咬到了」與
       「咬到別條」在輸出上逐字相同，而後者代表我宣告的那條沒有鑑別力。
    """
    p = subprocess.run(
        [NODE, "--test", "--test-reporter=tap", str(TESTS)],
        cwd=ROOT, capture_output=True, text=True,
    )
    failed = set(re.findall(r"^not ok \d+ - (.+)$", p.stdout, re.M))
    return p.returncode, failed


def check_anchors():
    src = TARGET.read_text(encoding="utf-8")
    bad = []
    for code, desc, anchor, _repl, _exp in MUTANTS:
        n = src.count(anchor)
        if n != 1:
            bad.append(f"  {code} 錨點命中 {n} 次（必須恰好 1）：{anchor[:60]}…")
    # 宣告的測試名必須真的存在於測試檔裡，否則 expect 永遠是空集合的成員檢查
    tsrc = TESTS.read_text(encoding="utf-8")
    for code, _desc, _a, _r, exp in MUTANTS:
        if f"'{exp} " not in tsrc:
            bad.append(f"  {code} 宣告的測試名 {exp} 在測試檔裡找不到")
    if bad:
        print("❌ [設備] 錨點／宣告漂掉了：", *bad, sep="\n")
        return False
    print(f"✅ 錨點檢查：{len(MUTANTS)} 發全部恰好命中 1 次，宣告的測試名都存在")
    return True


def main():
    args = sys.argv[1:]
    if "--anchors" in args:
        return 0 if check_anchors() else 2

    rc = subprocess.run([BOARD_GATE, *args]).returncode
    if rc != 0:
        return rc

    if not check_anchors():
        return 2

    base_rc, base_failed = run_tests()
    if base_rc != 0 or base_failed:
        print(f"❌ [設備] 基準線不是綠的（rc={base_rc}，紅：{sorted(base_failed)}）—— "
              "在紅的基準上跑突變，每一發都會「看起來被咬到」")
        return 2
    print("✅ 基準線全綠")

    original = TARGET.read_text(encoding="utf-8")
    backup = Path(tempfile.mkdtemp(prefix="mut-voiceusage-")) / "voiceUsage.ts"
    shutil.copy2(TARGET, backup)

    # 🔴 先印出預告發數。跑完再對一次 ——
    #    中途 continue 掉一發在逐行輸出上只是「少一行」，很容易讀成「其中一發沒咬到」。
    print(f"\n預告：{len(MUTANTS)} 發\n")

    survived, misfired, executed = [], [], 0
    try:
        for code, desc, anchor, repl, exp in MUTANTS:
            mutated = original.replace(anchor, repl, 1)
            if mutated == original:
                misfired.append(f"{code} 突變後檔案沒有變 —— 錨點沒改到東西")
                continue
            TARGET.write_text(mutated, encoding="utf-8")
            executed += 1
            mrc, mfailed = run_tests()
            hit = {n for n in mfailed if n.startswith(exp + " ")}
            if mrc == 0:
                survived.append(f"{code} 存活（測試仍全綠）：{desc}")
                print(f"  🔴 {code} 存活  {desc}")
            elif not hit:
                survived.append(f"{code} 咬到的不含 {exp}（咬到 {sorted(mfailed)}）：{desc}")
                print(f"  🔴 {code} 咬錯人（{exp} 沒紅）  {desc}")
            else:
                print(f"  ✅ {code} → {exp} 轉紅（連帶 {len(mfailed)} 條）  {desc}")
    finally:
        TARGET.write_text(original, encoding="utf-8")

    if TARGET.read_bytes() != backup.read_bytes():
        print("❌ [設備] 還原後與備份不是逐位元組相同 —— 工作樹裡可能留著突變")
        return 2
    shutil.rmtree(backup.parent, ignore_errors=True)

    print(f"\n實得：執行 {executed} 發 / 預告 {len(MUTANTS)} 發")
    if executed != len(MUTANTS) or misfired:
        print("❌ [設備] 發數對不上：", *misfired, sep="\n  ")
        return 2
    if survived:
        print(f"❌ {len(survived)} 發沒有被咬到：", *survived, sep="\n  ")
        return 1
    print(f"✅ {len(MUTANTS)} 發全部咬到它宣告的那條測試")
    return 0


if __name__ == "__main__":
    sys.exit(main())
