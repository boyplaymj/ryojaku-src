#!/usr/bin/env python3
"""[B1-j1] venueView.ts 突變測試。

🔴 歸因用**精確整數比對**，不是前綴：測試編號有 B1j-2 與 B1j-20/21/22…，
   前綴比對會把 B1j-20 的紅算成 B1j-2 的紅，而那與真的被 B1j-2 殺掉逐字相同。
"""
import io, re, shutil, subprocess, sys, os

SRC = 'utils/venueView.ts'
BAK = '/tmp/venueView.ts.pristine'

MUTANTS = [
    # (代號, 說明, old, new, 預期紅的測試編號集合)
    ('M1', '用真假值判授權（空字串被當成沒授權）',
     "if (typeof v.exactAddress === 'string') {", "if (v.exactAddress) {", {2, 3}),
    ('M2', '把 status 檢查搬到 type 之後（規則順序與後端不同）',
     "    if (v.status !== 'active') return 'withheld-review';\n    if (v.type === 'home') return 'withheld-home';",
     "    if (v.type === 'home') return 'withheld-home';\n    if (v.status !== 'active') return 'withheld-review';", {5}),
    ('M3', '認不得的 type 也可以評場地（fail-open）',
     "emoji: '❓', label: '未知場地', canRateVenue: false, known: false,",
     "emoji: '❓', label: '未知場地', canRateVenue: true, known: false,", {14}),
    ('M4', '零則評價算成 0%',
     '    if (c <= 0) return NO_RATING;\n', '', {17}),
    ('M5', '打到上限時說「就這些了」',
     "if (roundsDone >= cap) return 'cap-reached';", "if (roundsDone >= cap) return 'done';", {24}),
    ('M6', '所有 withheld 用同一句文案',
     "        case 'withheld-home':\n            return '自建場的完整地址，主揪核准你的報名後才會顯示';",
     "        case 'withheld-home':\n            return '這個場地還在審核中，暫不提供地址';", {11}),
    ('M7', 'isDojo 用真假值（字串 "true" 也會亮徽章）',
     'return v && v.isDojo === true ? ', 'return v && v.isDojo ? ', {16}),
    ('M8', '合併多頁時不去重',
     '            if (seen.has(card.venueId)) continue;\n', '', {26}),
    ('M9', '前端漏掉 event 這種 type（與後端常數不同步）',
     "    event: { emoji: '🎪', label: '活動場', canRateVenue: true, known: true },\n", '', {12, 13, 15}),
    ('M10', "用 'exactAddress' in v 判授權（undefined 會被當成有授權）",
     "if (typeof v.exactAddress === 'string') {", "if ('exactAddress' in v) {", {8}),
    ('M11', 'granted-empty 直接併進 withheld-home',
     "return v.exactAddress.trim() === '' ? 'granted-empty' : 'granted';",
     "return v.exactAddress.trim() === '' ? 'withheld-home' : 'granted';", {2, 3}),
    ('M12', '空的一頁就停（§5.3 點名的坑，改成看 done 的另一種寫法）',
     "if (typeof token !== 'string' || token === '') return 'done';",
     "if (typeof token !== 'string') return 'done';\n    if (token === '') return 'done';\n    if (roundsDone > 0 && roundsDone >= 0 && false) return 'done';", set()),
]

def run_tests():
    r = subprocess.run(['node', 'scripts/run-tests.mjs', SRC.replace('.ts', '.test.ts')],
                       capture_output=True, text=True)
    failed = set()
    for line in (r.stdout + r.stderr).splitlines():
        if line.lstrip().startswith('✖') or line.lstrip().startswith('not ok'):
            for m in re.finditer(r'B1j-(\d+)\b', line):
                failed.add(int(m.group(1)))
    return r.returncode, failed

def main():
    shutil.copy2(SRC, BAK)
    base_rc, base_failed = run_tests()
    if base_rc != 0 or base_failed:
        print(f'❌ 基線就不是綠的（rc={base_rc} failed={sorted(base_failed)}）⇒ 整份不可讀成通過')
        return 2
    print(f'基線：rc=0，0 條紅。共 {len(MUTANTS)} 發。\n')
    killed = survived = 0
    for tag, desc, old, new, expect in MUTANTS:
        src = io.open(BAK, encoding='utf-8').read()
        if src.count(old) != 1:
            print(f'{tag} ⚠️ 突變落點出現 {src.count(old)} 次（要恰好 1）⇒ 這發沒跑成，不可算通過')
            return 2
        io.open(SRC, 'w', encoding='utf-8').write(src.replace(old, new))
        rc, failed = run_tests()
        shutil.copy2(BAK, SRC)
        if not expect:
            # 刻意的等價突變（no-op）：預期**存活**，用來證明這把尺不是恆紅。
            ok = (rc == 0 and not failed)
            print(f'{tag} {"✅ 如預期存活" if ok else "❌ 等價突變竟然被殺"}（{desc}）red={sorted(failed)}')
            if not ok: return 1
            survived += 1
            continue
        if rc == 0:
            print(f'{tag} ❌ 存活（{desc}）—— 預期 {sorted(expect)} 會紅')
            survived += 1
        elif expect <= failed:
            print(f'{tag} ✅ 被 {sorted(expect)} 殺（{desc}）　實際紅：{sorted(failed)}')
            killed += 1
        else:
            print(f'{tag} ⚠️ 紅了但**不是**預期那幾條殺的（{desc}）預期 {sorted(expect)}／實際 {sorted(failed)}')
            return 1
    print(f'\n殺 {killed}／刻意存活 {survived}／共 {len(MUTANTS)}')
    return 0 if killed + survived == len(MUTANTS) else 1

if __name__ == '__main__':
    try:
        sys.exit(main())
    finally:
        if os.path.exists(BAK):
            shutil.copy2(BAK, SRC)
