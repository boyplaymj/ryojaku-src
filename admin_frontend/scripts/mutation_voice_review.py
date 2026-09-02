#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D6 審核頁聚合層（src/utils/voiceReview.ts）的突變測試 —— 可重跑的鑑別力證據。

為什麼要有這支：`node --test` 全綠只證明「目前沒壞」，不證明「壞了會被抓到」。
本檔每一條規則都是**錯了不會報錯**的那一種（一個數字從 5 變成 3，版面上長得一樣），
所以「測試綠」這件事本身沒有告訴我任何東西 —— 要問的是「把規則改壞，哪一條會紅」。

跑法：
    python3 scripts/mutation_voice_review.py            # 全套
    python3 scripts/mutation_voice_review.py --anchors  # 只驗錨點還在（秒級，不掛看板）

退出碼：
    0  每一發都咬到它宣告的測試
    1  有突變存活，或咬到的不含宣告的那條  ← 這是本檔要抓的
    2  設備問題（錨點漂掉／基準線不綠／發數對不上／還原失敗）
       🔴 rc=2 是「量不到」，不可以讀成通過。

⚠️ 本檔改寫自 scripts/mutation_voice_usage.py（同目錄）。兩份會漂 ——
   可以接受的理由是 harness 不承載正確性:真正的判準是下面 MUTANTS 那張表,
   而它本來就必須逐專案手寫。改了其中一份時另一份不會轉紅。

🔴 這支的受測物**直接 import 真引擎**(../engine/mahjong-tai/index.mjs)。
   所以基準線不綠有第二種可能:不是我的程式壞了,是引擎副本壞了。
   分辨法是先跑 `node-22 scripts/run-tests.mjs src/engine/mahjong-tai-sync.test.ts`。

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
TARGET = ROOT / "src/utils/voiceReview.ts"
TESTS = ROOT / "src/utils/voiceReview.test.ts"
NODE = "node-22"
BOARD_GATE = "/opt/sml/repo/tools/bgtask/require-board.sh"

# (代號, 說明, 錨點, 換成什麼, 必須咬到的測試名片段)
MUTANTS = [
    ("M1", "表裡沒有的 fanId 也標成 known",
     "known: names.has(fanId),",
     "known: true,",
     "R7"),
    ("M2", "表裡沒有的 fanId 直接不計(靜靜丟掉)",
     "if (Array.isArray(r.added)) for (const id of r.added) bump(id, 'timesAdded');",
     "if (Array.isArray(r.added)) for (const id of r.added) { if (names.has(id)) bump(id, 'timesAdded'); }",
     "R7"),
    ("M3", "同分時不再用 fanId 排序(輸出不再決定性)",
     "(a, b) => b.total - a.total || a.fanId.localeCompare(b.fanId)",
     "(a, b) => b.total - a.total",
     "R6"),
    ("M4", "added 記成誤判而不是漏判(方向反了)",
     "bump(id, 'timesAdded');",
     "bump(id, 'timesRemoved');",
     "R5"),
    ("M5", "minCount 門檻放寬到 1",
     "if (!Number.isInteger(minCount) || minCount < MIN_COUNT) {",
     "if (!Number.isInteger(minCount) || minCount < 1) {",
     "R8"),
    ("M6", "MIN_COUNT 改成 1(§4.5 明令不可)",
     "export const MIN_COUNT = 2;",
     "export const MIN_COUNT = 1;",
     "R8"),
    ("M7", "不檢查整數(2.5 這種會混進去)",
     "if (!Number.isInteger(minCount) || minCount < MIN_COUNT) {",
     "if (minCount < MIN_COUNT) {",
     "R8"),
    ("M8", "unmatched 一律送空字串(型一建議整類消失)",
     "unmatched: r.unmatched ?? '',",
     "unmatched: '',",
     "R9"),
    ("M9", "added 不是陣列時原樣送出(feedback.js 讀 .length 會炸)",
     "added: Array.isArray(r.added) ? r.added : [],",
     "added: r.added as string[],",
     "R3"),
    ("M10", "userId 空字串不轉 null",
     "userId: r.userId ? r.userId : null,",
     "userId: r.userId ?? null,",
     "R4"),
    ("M11", "review_mapping 也標成可自動套用(§4.5 明令交人工)",
     "autoApplicable: s.type === 'add_confusion',",
     "autoApplicable: true,",
     "R12"),
    ("M12", "沒帶版本的舊列也算 mismatch(亮到沒人看)",
     "(d) => d.version !== '(未帶)' && d.version !== tableVersion",
     "(d) => d.version !== tableVersion",
     "R16"),
    ("M13", "versionMismatch 永遠 false",
     "      versionMismatch: dataVersions.some(\n        (d) => d.version !== '(未帶)' && d.version !== tableVersion\n      ),",
     "      versionMismatch: false,",
     "R15"),
    ("M14", "unknownFanIds 永遠空(版本不一致的證據被抹掉)",
     "unknownFanIds: fans.filter((f) => !f.known).map((f) => f.fanId),",
     "unknownFanIds: [],",
     "R18"),
    ("M15", "缺 userId 的列不計(門檻降級這件事被藏起來)",
     "if (!r.userId) rowsWithoutUserId += 1;",
     "if (false) rowsWithoutUserId += 1;",
     "R11"),
    ("M16", "形狀壞掉改成「兩欄都缺才算」(只壞一半的批次靜靜通過)",
     "if (!Array.isArray(r.added) || !Array.isArray(r.removed)) rowsWithBrokenDiffShape += 1;",
     "if (!Array.isArray(r.added) && !Array.isArray(r.removed)) rowsWithBrokenDiffShape += 1;",
     "R20"),
    ("M17", "complete 永遠回 true(沒掃完也宣稱掃完)",
     "      totalRows: rows.length,\n      complete,",
     "      totalRows: rows.length,\n      complete: true,",
     "R17"),
    ("M18", "flattenPages 不檢查 data 是不是陣列",
     "if (Array.isArray(p?.data)) out.push(...p.data);",
     "out.push(...(p.data as ReviewRecord[]));",
     "R19"),
    ("M19", "建議不帶台種名",
     "const nameOf = (id?: string) => (id == null ? undefined : names.get(id) ?? null);",
     "const nameOf = (_id?: string) => undefined;",
     "R13"),
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
