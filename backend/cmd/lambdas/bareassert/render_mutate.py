#!/usr/bin/env python3
# renderBaseline 兩條新測試的突變驗證。
# 🔴 歸因用**完全相等**比對，且紅名單必須含**子測試**：
#    go test 的 `--- FAIL:` 子測試那行是**縮排的**，只抓 `^--- FAIL:` 會退化成
#    「永遠只看到父測試名」⇒ 打哪一個子格子都印同一個名字，歸因等於沒做。
import io, re, subprocess, sys, tempfile, os, shutil

# 🌲 路徑由 __file__ 推導，不寫死檢出根 —— 寫死的話在 git worktree 裡會突變到
#    **主工作樹**那份，而「突變改 A、測試讀 B」的讀數是「17 發 0 殺」，
#    那與「測試通通沒牙」逐字相同。
HERE = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(HERE, "bareassert_test.go")
CWD = os.path.abspath(os.path.join(HERE, "..", "..", ".."))   # bareassert→lambdas→cmd→backend
ORIG = io.open(F, encoding="utf-8").read()

LOOP = '\tfor _, k := range keys {\n\t\tbody += k + "\\n"\n\t}\n\treturn body'
assert ORIG.count(LOOP) == 1, "錨點找不到或不唯一 —— 突變探針漂掉了"

def reds():
    """回紅掉的測試名。🔴 fail-closed：測試**沒跑起來**時 raise，不可以回空清單。

    寫這支時真的踩到了：`CWD` 少算一層 ⇒ go 找不到 package ⇒ 一行 `--- FAIL:`
    都沒有 ⇒ reds() 回 []。於是**基線判綠**（0 紅）、**每一發突變也判存活**（0 紅）
    —— 「測試全過」與「測試根本沒執行」在這個回傳值上**逐字相同**，
    而兩者的處置相反。所以這裡要求看到 PASS/ok/FAIL 至少一種真實的執行痕跡。
    """
    p = subprocess.run(["go", "test", "-count=1", "./cmd/lambdas/bareassert/", "-v"],
                       cwd=CWD, capture_output=True, text=True)
    out = p.stdout + p.stderr
    # 🔴 判準只能認**逐測試**那幾行（`--- PASS:` / `--- FAIL:`）。
    #    第一版還收 `ok\s` 與 `FAIL\s`，而 go 對 setup 失敗印的正是
    #    `FAIL\t./cmd/... [setup failed]` ⇒ **守衛被它滿足**，照樣印「基線綠」。
    #    （這不是假想：把 CWD 少算一層就會發生，我就地實測過。）
    if "[setup failed]" in out or "[build failed]" in out:
        raise RuntimeError("package 沒建起來／找不到，一條測試都沒跑，不可讀成通過：\n" + out[:800])
    if not re.search(r'^\s*--- (PASS|FAIL):', out, re.M):
        raise RuntimeError("找不到任何逐測試結果，測試沒有執行：\n" + out[:800])
    # 含縮排：子測試那行前面有空白
    return sorted(set(re.findall(r'^\s*--- FAIL: (\S+)', out, re.M)))

def restore(): io.open(F, "w", encoding="utf-8").write(ORIG)

try:
    if reds():
        print("🔴 基線就有紅 —— 突變讀數不可信:", reds()); sys.exit(2)
    print("基線 ✅ 綠（0 紅）")

    MUTANTS = [
        ("M1 改回舊的 strings.Join 寫法（＝Codex 抓到的 bug）",
         '\treturn body + strings.Join(keys, "\\n") + "\\n"',
         "TestRenderBaselineNoTrailingBlank/空集合（baseline_清到_0_的那一格）"),
        ("M2 忽略 keys、永遠只回檔頭（打那條控制組）",
         '\treturn body',
         "TestRenderBaselineNoTrailingBlank/兩筆（控制組：少了它，永遠只回檔頭也會綠）"),
    ]
    fail = 0
    for name, repl, expect in MUTANTS:
        io.open(F, "w", encoding="utf-8").write(ORIG.replace(LOOP, repl))
        got = reds()
        if expect in got:                       # 完全相等（in on list of exact names）
            print("  ✅ %s → 殺掉 %s" % (name, expect))
        else:
            print("  ❌ %s → 期望 %s 紅，實得 %s" % (name, expect, got)); fail = 1
        restore()
    print("")
    print("✅ 2 發全殺，歸因完全相等" if not fail else "🔴 有發沒殺掉")
    sys.exit(fail)
finally:
    restore()
