#!/usr/bin/env node
// 測試入口：先挑一個夠新的 node，再用它跑 node --test。
//
// 為什麼需要這一層：
//   package.json 的 engines 寫 >=22.18，但 engines **不會**被強制執行，
//   而 SML 主機的 /usr/bin/node 是系統 alternatives 指到 node-18（全機共用、
//   要 root 才能改、其他 SML 服務也在用）⇒ 不能為了這個專案去動它。
//   於是 `npm test` 在本機直接壞掉，而壞掉的樣子完全不提「你的 node 太舊」：
//     舊寫法（帶 --experimental-strip-types）→ node: bad option（rc=9）
//     不帶旗標                                → ERR_UNKNOWN_FILE_EXTENSION ".ts"（rc=1）
//   兩種都是「看起來像測試壞了」，不是「看起來像 node 選錯了」。
//
// 所以這支做的事很窄：**挑 node、印出挑了誰、把 rc 原封不動傳回去。**
// 它不解讀測試結果，也不吞任何 exit code。
//
// ⚠️ 刻意不再傳 --experimental-strip-types：Node 22.18 起型別剝除已是預設，
//    而我們的下限就是 22.18（實測 22.22.3 不帶旗標可以跑，13/13 綠）。
//    繼續傳一個「已經是預設」的實驗旗標，只是多一個未來會被移除的相依。
//
// 用法：
//   node scripts/run-tests.mjs                      跑 utils/*.test.ts
//   node scripts/run-tests.mjs utils/version.test.ts 只跑指定檔（給重測／除錯用）

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** 下限。與 package.json 的 engines 一致 —— 那裡是宣告，這裡是唯一真的擋得住的地方。 */
const MIN = [22, 18, 0];
// 🔴 engine 那條只收 engine/ 這一層的 *.test.ts，**不可**寫成會掃到
//    engine/mahjong-tai/*.js 的樣子：那三支引擎檔是 UMD/CJS，
//    在 "type":"module" 下會當場 `require is not defined`（DESIGN_APP.md §11.3a）。
//
// 🔴 `min` 是 fail-closed 下限，不是裝飾：glob 沒命中時 `node --test` 是
//    **`tests 0 / pass 0 / rc=0`**（實測 `run-tests.mjs 'engine/nonexistent-*.test.ts'`）——
//    「沒跑」與「全過」逐字相同，正是 §11.3a 的第一個失敗模式。
//    而真實情形更沒有徵兆：engine 測試檔被刪掉 ⇒ `36 pass / rc=0`，
//    那**正是加 engine 這條之前的輸出** ⇒ 靜靜退回原狀，沒有任何一行會變。
//    ⇒ 加測試檔時要把 min 跟著抬高，否則「有人刪掉一個檔」不會被叫出來
//      （與 tools/mahjong-tai/verify_sync.sh 的清單下限同一個道理）。
const DEFAULT_TARGETS = [
    { glob: 'utils/*.test.ts', min: 3 },
    { glob: 'engine/*.test.ts', min: 1 },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 展開一條 target。回傳命中的檔案清單；**認不得的形狀回 null**（不敢猜就不敢跑）。
 * 只支援「固定目錄 + 檔名含 *」這一種形狀 —— 我們用到的就這一種，
 * 支援得越寬，「下限驗的是不是同一批檔」就越說不準。
 */
function expandTarget(pattern) {
    if (!pattern.includes('*')) return existsSync(pattern) ? [pattern] : [];
    if (pattern.includes('**')) return null;
    const cut = pattern.lastIndexOf('/');
    const dir = cut === -1 ? '.' : pattern.slice(0, cut);
    const base = cut === -1 ? pattern : pattern.slice(cut + 1);
    if (dir.includes('*')) return null;
    const re = new RegExp(`^${base.split('*').map(escapeRe).join('[^/]*')}$`);
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return [];
    }
    return entries
        .filter((n) => re.test(n))
        .map((n) => (dir === '.' ? n : `${dir}/${n}`))
        .sort();
}

function parseVersion(text) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function gte(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] > b[i]) return true;
        if (a[i] < b[i]) return false;
    }
    return true;
}

const fmt = (v) => v.join('.');

/** 問一個 node 執行檔它是幾版；問不到（不存在／不是 node）回 null。 */
function probe(exe) {
    let r;
    try {
        r = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    } catch {
        return null;
    }
    if (!r || r.status !== 0 || !r.stdout) return null;
    return parseVersion(r.stdout);
}

/**
 * 依序找可用的 node。順序是刻意的：
 *   1. 現在正在跑這支腳本的 node —— CI 上就是它（setup-node 給的 22），
 *      命中這條就完全不會有 re-exec，CI 行為與過去逐字相同。
 *   2. PATH 上的 node-22 / node22 —— SML 主機的形態。
 *   3. nvm 已安裝的版本，由高到低。
 */
function findRunner() {
    const current = parseVersion(process.versions.node);
    if (current && gte(current, MIN)) {
        return { exe: process.execPath, version: current, why: '目前的 node 就夠新' };
    }

    for (const name of ['node-22', 'node22']) {
        const v = probe(name);
        if (v && gte(v, MIN)) return { exe: name, version: v, why: `PATH 上的 ${name}` };
    }

    const nvmRoot = join(homedir(), '.nvm', 'versions', 'node');
    if (existsSync(nvmRoot)) {
        const candidates = readdirSync(nvmRoot)
            .map((dir) => ({ dir, v: parseVersion(dir) }))
            .filter((c) => c.v && gte(c.v, MIN))
            .sort((a, b) => (gte(a.v, b.v) ? -1 : 1));
        for (const c of candidates) {
            const exe = join(nvmRoot, c.dir, 'bin', 'node');
            if (existsSync(exe)) return { exe, version: c.v, why: `nvm 的 ${c.dir}` };
        }
    }

    return null;
}

const explicit = process.argv.slice(2);
// 手動指定時下限一律 1：指定了卻一個檔都沒命中，那也該大聲，不該安靜跑 0 條。
const useTargets = explicit.length > 0 ? explicit.map((glob) => ({ glob, min: 1 })) : DEFAULT_TARGETS;

// 🔴 先驗下限，再決定要不要跑。rc=2 是「設備問題」不是「測試失敗」——
//    量不到不等於量到全過（同 verify_sync.sh 的 rc 約定）。
const matched = [];
let shortfall = false;
for (const t of useTargets) {
    const files = expandTarget(t.glob);
    if (files === null) {
        console.error(`❌ [設備] 認不得的 target 形狀：${t.glob} —— 驗不了下限，不敢往下跑`);
        shortfall = true;
        continue;
    }
    console.log(`[run-tests] ${t.glob} → ${files.length} 檔（下限 ${t.min}）${files.length ? '：' + files.join(' ') : ''}`);
    if (files.length < t.min) {
        console.error(`❌ [設備] ${t.glob} 只命中 ${files.length} 個檔，下限是 ${t.min}。`);
        shortfall = true;
    }
    matched.push(...files);
}
if (shortfall) {
    console.error(
        `\n   測試檔被刪掉／搬走／glob 漂掉時，node --test 會回 tests 0 / rc=0 ——\n` +
        `   「沒跑」與「全過」在輸出上逐字相同，所以這裡擋在跑之前。\n` +
        `   若這是刻意的（例如真的移除了一組測試），請同時調低 DEFAULT_TARGETS 的 min。`
    );
    process.exit(2);
}

const runner = findRunner();
if (!runner) {
    // 找不到就直接失敗，不要用手上這個太舊的 node 硬跑。
    // 硬跑的話會得到 ERR_UNKNOWN_FILE_EXTENSION —— 那個訊息會把人帶去查
    // 「.ts 要怎麼跑」，而真正的原因是 node 版本，方向完全是反的。
    console.error(
        `❌ 找不到 Node >= ${fmt(MIN)}（目前的是 v${process.versions.node}）。\n` +
        `   測試檔是 .ts，要靠 Node 22.18+ 內建的型別剝除才跑得起來。\n` +
        `   試試其中一個：\n` +
        `     - 安裝／使用 node-22（SML 主機上就有 /usr/bin/node-22）\n` +
        `     - nvm install 22 && nvm use 22\n` +
        `   ⚠️ 不要去改 /usr/bin/node 的 alternatives —— 那是全機共用的，\n` +
        `      其他 SML 服務也吃它。`
    );
    process.exit(1);
}

// 永遠印出「用了哪一個 node」。少了這一行，re-exec 就變成隱形的：
// 測試在哪個 runtime 上綠的變成不可知，而那正是這支腳本存在的理由。
// 🔴 交給 node 的是**上面驗過下限的那份展開結果**，不是原始 glob ——
//    否則「我數的那批」與「node 跑的那批」會是兩個來源，可以各自漂而下限失去意義。
console.log(`[run-tests] node v${fmt(runner.version)}（${runner.why}）→ ${matched.length} 檔：${matched.join(' ')}`);

const result = spawnSync(runner.exe, ['--test', ...matched], { stdio: 'inherit' });

if (result.error) {
    console.error(`❌ 無法執行 ${runner.exe}：${result.error.message}`);
    process.exit(1);
}
// 被訊號砍掉時 status 是 null —— 那種情況回 0 等於謊報成功。
if (result.status === null) {
    console.error(`❌ 測試行程被訊號中止（${result.signal}）`);
    process.exit(1);
}
process.exit(result.status);
