#!/usr/bin/env python3
"""[B1-j1/j4] venueView.ts + venueLocation.ts 突變測試。

🔴 歸因用**精確整數比對**，不是前綴：測試編號有 B1j-2 與 B1j-20/21/22…，
   前綴比對會把 B1j-20 的紅算成 B1j-2 的紅，而那與真的被 B1j-2 殺掉逐字相同。
"""
import io, re, shutil, subprocess, sys, os

FILES = {
    'view': ('utils/venueView.ts', 'utils/venueView.test.ts', '/tmp/venueView.ts.pristine', 'B1j'),
    'loc': ('utils/venueLocation.ts', 'utils/venueLocation.test.ts', '/tmp/venueLocation.ts.pristine', 'B1jL'),
}

MUTANTS = [
    # (檔, 代號, 說明, old, new, 預期紅的測試編號集合)
    ('view', 'M1', '用真假值判授權（空字串被當成沒授權）',
     "if (typeof v.exactAddress === 'string') {", "if (v.exactAddress) {", {2, 3}),
    ('view', 'M2', '把 status 檢查搬到 type 之後（規則順序與後端不同）',
     "    if (v.status !== 'active') return 'withheld-review';\n    if (v.type === 'home') return 'withheld-home';",
     "    if (v.type === 'home') return 'withheld-home';\n    if (v.status !== 'active') return 'withheld-review';", {5}),
    ('view', 'M3', '認不得的 type 也可以評場地（fail-open）',
     "emoji: '❓', label: '未知場地', canRateVenue: false, known: false,",
     "emoji: '❓', label: '未知場地', canRateVenue: true, known: false,", {14}),
    ('view', 'M4', '零則評價算成 0%',
     '    if (c <= 0) return NO_RATING;\n', '', {17}),
    ('view', 'M5', '打到上限時說「就這些了」',
     "if (roundsDone >= cap) return 'cap-reached';", "if (roundsDone >= cap) return 'done';", {24}),
    ('view', 'M6', '所有 withheld 用同一句文案',
     "        case 'withheld-home':\n            return '自建場的完整地址，主揪核准你的報名後才會顯示';",
     "        case 'withheld-home':\n            return '這個場地還在審核中，暫不提供地址';", {11}),
    ('view', 'M7', 'isDojo 用真假值（字串 "true" 也會亮徽章）',
     'return v && v.isDojo === true ? ', 'return v && v.isDojo ? ', {16}),
    ('view', 'M8', '合併多頁時不去重',
     '            if (seen.has(card.venueId)) continue;\n', '', {26}),
    ('view', 'M9', '前端漏掉 event 這種 type（與後端常數不同步）',
     "    event: { emoji: '🎪', label: '活動場', canRateVenue: true, known: true },\n", '', {12, 13, 15}),
    ('view', 'M10', "用 'exactAddress' in v 判授權（undefined 會被當成有授權）",
     "if (typeof v.exactAddress === 'string') {", "if ('exactAddress' in v) {", {8}),
    ('view', 'M11', 'granted-empty 直接併進 withheld-home',
     "return v.exactAddress.trim() === '' ? 'granted-empty' : 'granted';",
     "return v.exactAddress.trim() === '' ? 'withheld-home' : 'granted';", {2, 3}),
    ('view', 'M12', '空的一頁就停（§5.3 點名的坑，改成看 done 的另一種寫法）',
     "if (typeof token !== 'string' || token === '') return 'done';",
     "if (typeof token !== 'string') return 'done';\n    if (token === '') return 'done';\n    if (roundsDone > 0 && roundsDone >= 0 && false) return 'done';", set()),
    ('view', 'M13', '湊夠了還繼續掃（成本：無閘門的 Scan）',
     'return collected < target;', 'return true;', {29}),
    ('view', 'M14', '沒有下一頁也繼續掃（空轉打 API）',
     "if (decision !== 'fetch') return false;\n", '', {30}),
    ('view', 'M15', '自建場不必填完整地址',
     "    if (v.type === 'home' && !(v.exactAddress ?? '').trim()) {\n        return '自建場一定要填完整地址（只有你核准的玩家看得到）';\n    }\n", '', {31, 32}),
    ('view', 'M16', '玩家也能建活動場（前端限制消失）',
     "export const CREATABLE_VENUE_TYPES = ['hall', 'home'] as const;",
     "export const CREATABLE_VENUE_TYPES = ['hall', 'home', 'event'] as const;", {31}),
    ('view', 'M17', '四條驗證合成一句「資料不正確」',
     "    if (!(v.name ?? '').trim()) return '請填場地名稱';",
     "    if (!(v.name ?? '').trim()) return '請選擇場地類型';", {31}),

    # ---- utils/venueLocation.ts（自建場座標模糊化，§5.1）----
    ('loc', 'L1', '🔴 自建場座標原樣送出（模糊化整個消失）',
     '            const b = blurLocation(exact, rng);\n            return { approxLocation: { latitude: b.latitude, longitude: b.longitude }, blurred: true };',
     '            return { approxLocation: { latitude: exact.latitude, longitude: exact.longitude }, blurred: true };', {7}),
    ('loc', 'L2', '位移量固定 300m（不隨 rng 變）',
     'const distance = HOME_BLUR_MIN_M + rng() * (HOME_BLUR_MAX_M - HOME_BLUR_MIN_M);',
     'const distance = HOME_BLUR_MIN_M;', {2}),
    ('loc', 'L3', '永遠往正北（方位不隨 rng 變）',
     'const bearing = rng() * 2 * Math.PI;', 'const bearing = 0;', {3}),
    ('loc', 'L4', '位移量少一個數量級（30–50m，看起來仍像有模糊）',
     'const METERS_PER_DEG_LAT = 111_320;', 'const METERS_PER_DEG_LAT = 1_113_200;', {1, 7}),
    ('loc', 'L5', '自建場也帶 placeName（模糊化白做）',
     "            return { approxLocation: { latitude: b.latitude, longitude: b.longitude }, blurred: true };",
     "            return { approxLocation: { latitude: b.latitude, longitude: b.longitude, placeName: (placeName ?? '').trim() }, blurred: true };", {7}),
    ('loc', 'L6', '麻將館也被模糊（圖釘離店家 400 公尺）',
     "        case 'hall':\n        case 'event': {", "        case 'hall': {", {8}),
    ('loc', 'L7', '高緯度不夾 cos(lat)（NaN／無窮大）',
     'const MIN_COS_LAT = 0.01;', 'const MIN_COS_LAT = 0;', {6}),
    ('loc', 'L8', '認不得的 type 不模糊（fail-open）',
     '        default: {', "        case 'zzz-never': {", {9}),
]

def run_tests(key):
    _, testfile, _, prefix = FILES[key]
    r = subprocess.run(['node', 'scripts/run-tests.mjs', testfile], capture_output=True, text=True)
    failed = set()
    for line in (r.stdout + r.stderr).splitlines():
        if line.lstrip().startswith('✖') or line.lstrip().startswith('not ok'):
            # 🔴 精確整數比對，不是前綴：B1j-2 與 B1j-20 前綴相同。
            #    而且 B1j 與 B1jL 也必須分開 —— 用 startswith 的話 B1jL-7 會被算成 B1j 的。
            for m in re.finditer(prefix + r'-(\d+)\b', line):
                failed.add(int(m.group(1)))
    return r.returncode, failed

def main():
    for key, (src, _, bak, _) in FILES.items():
        shutil.copy2(src, bak)
        base_rc, base_failed = run_tests(key)
        if base_rc != 0 or base_failed:
            print(f'❌ {src} 基線就不是綠的（rc={base_rc} failed={sorted(base_failed)}）⇒ 整份不可讀成通過')
            return 2
    print(f'基線：兩個檔都 rc=0、0 條紅。共 {len(MUTANTS)} 發。\n')
    killed = survived = unexpected = 0
    for key, tag, desc, old, new, expect in MUTANTS:
        SRC, _, BAK, _ = FILES[key]
        src = io.open(BAK, encoding='utf-8').read()
        if src.count(old) != 1:
            print(f'{tag} ⚠️ 突變落點出現 {src.count(old)} 次（要恰好 1）⇒ 這發沒跑成，不可算通過')
            return 2
        io.open(SRC, 'w', encoding='utf-8').write(src.replace(old, new))
        rc, failed = run_tests(key)
        shutil.copy2(BAK, SRC)
        if not expect:
            # 刻意的等價突變（no-op）：預期**存活**，用來證明這把尺不是恆紅。
            ok = (rc == 0 and not failed)
            print(f'{tag} {"✅ 如預期存活" if ok else "❌ 等價突變竟然被殺"}（{desc}）red={sorted(failed)}')
            if not ok: return 1
            survived += 1
            continue
        if rc == 0:
            # 🔴 這裡**不可以**加進 survived —— survived 是「刻意的等價突變」那一桶。
            #    混在一起的話最後那個 killed+survived==len 會成立，於是印著 ❌ 卻 return 0
            #    （2026-09-09 真的發生過一次，L7）。
            print(f'{tag} ❌ 存活（{desc}）—— 預期 {sorted(expect)} 會紅')
            unexpected += 1
        elif expect <= failed:
            print(f'{tag} ✅ 被 {sorted(expect)} 殺（{desc}）　實際紅：{sorted(failed)}')
            killed += 1
        else:
            print(f'{tag} ⚠️ 紅了但**不是**預期那幾條殺的（{desc}）預期 {sorted(expect)}／實際 {sorted(failed)}')
            return 1
    print(f'\n殺 {killed}／刻意存活 {survived}／**非預期存活 {unexpected}**／共 {len(MUTANTS)}')
    if unexpected:
        print('❌ 有非預期存活的突變體 ⇒ 那幾發沒有任何尺咬得住，不可讀成通過')
        return 1
    return 0 if killed + survived == len(MUTANTS) else 1

if __name__ == '__main__':
    try:
        sys.exit(main())
    finally:
        for src, _, bak, _ in FILES.values():
            if os.path.exists(bak):
                shutil.copy2(bak, src)
