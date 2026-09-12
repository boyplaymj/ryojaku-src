#!/usr/bin/env python3
"""classify() 三態的突變驗證。

🔴 第一版用巢狀 heredoc 寫突變，$ 與 { 被 shell 吃掉 ⇒ 兩發 ValueError（看得出來）、
   **一發靜靜沒改到任何東西**（M2）。後者是「no-op 突變體 ≡ 測試有洞」——
   報表上長得跟「測試沒牙」一模一樣。⇒ 每一發都要斷言「檔案真的變了」。
"""
import io, os, shutil, subprocess, sys, tempfile

# 🌲 由 __file__ 推導，不寫死檢出根（worktree 裡跑才會打到自己那棵樹）
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "security_regression_daily.sh")
ORIG = io.open(SRC, encoding="utf-8").read()

ASSERT_BLK = '''    elif [ "${nfail:-0}" -gt 0 ]; then
        kind=assert            # 斷言紅燈（真的量到了）
'''
INSTR_START = '    elif [ "${nequip:-0}" -gt 0 ]; then'
CLEANUP_LINE = '    elif [ "$rc" != 0 ]; then'


def m1(s):
    """把 instrument 整塊移到 cleanup 之後（順序倒過來）。"""
    i = s.index(INSTR_START); j = s.index(CLEANUP_LINE)
    blk = s[i:j]
    rest = s[j:]
    k = rest.index('    elif [ "$total" -lt "$best" ]; then')
    return s[:i] + rest[:k] + blk + rest[k:]


def m2(s):
    """不解析「儀器」欄 ⇒ nequip 恆空。"""
    # 🔴 用 raw string —— 跳脫層數錯過兩次了（shell heredoc 一層、Python 字面值一層）
    old = r"s/.*儀器 \([0-9]\+\).*/\1/p"
    assert old in s, "M2 錨點不在（跳脫又錯了）"
    return s.replace(old, r"s/.*NOSUCHFIELD \([0-9]\+\).*/\1/p")


def m3(s):
    """把 assert 那塊搬到 instrument 之後 ⇒ 變成 EQUIP 優先。"""
    ia = s.index(ASSERT_BLK)
    seg = s[ia:ia + len(ASSERT_BLK)]
    s2 = s[:ia] + s[ia + len(ASSERT_BLK):]
    j = s2.index(CLEANUP_LINE)
    return s2[:j] + seg + s2[j:]


MUTANTS = [("M1 instrument 排到 cleanup 之後", m1, "儀器沒跑成"),
           ("M2 不解析「儀器」欄",             m2, "儀器沒跑成"),
           ("M3 改成 EQUIP 優先於 FAIL",       m3, "斷言紅＋儀器 1")]

d = tempfile.mkdtemp(prefix="clsmut-", dir=os.environ.get("TMPDIR", "/var/tmp"))
try:
    base = subprocess.run(["bash", SRC, "--selftest"], capture_output=True, text=True)
    if "❌" in base.stdout:
        print("🔴 基線就有紅 —— 突變讀數不可信"); sys.exit(2)
    print("基線 ✅ 綠")
    fail = 0
    for name, fn, want in MUTANTS:
        path = os.path.join(d, "m.sh")
        try:
            mutated = fn(ORIG)
        except Exception as e:
            print("  ⚠️ %s 突變體做不出來（%r）—— 不算殺掉" % (name, e)); fail = 1; continue
        if mutated == ORIG:
            print("  ⚠️ %s **沒有改到任何東西**（no-op 突變體）—— 不算殺掉" % name); fail = 1; continue
        io.open(path, "w", encoding="utf-8").write(mutated)
        if subprocess.run(["bash", "-n", path], capture_output=True).returncode != 0:
            print("  ⚠️ %s 突變體語法壞了 —— 不算殺掉" % name); fail = 1; continue
        out = subprocess.run(["bash", path, "--selftest"], capture_output=True, text=True).stdout
        reds = [l for l in out.splitlines() if l.startswith("  ❌")]
        if any(want in l for l in reds):
            print("  ✅ %s → 殺掉（紅 %d 條，含「%s」）" % (name, len(reds), want))
        else:
            print("  🔴 %s → 沒殺到（紅 %d 條）" % (name, len(reds))); fail = 1
    print()
    print("✅ %d 發全殺" % len(MUTANTS) if not fail else "🔴 有發沒殺掉")
    sys.exit(fail)
finally:
    shutil.rmtree(d, ignore_errors=True)
