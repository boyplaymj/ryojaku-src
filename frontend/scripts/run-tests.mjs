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
const DEFAULT_TARGETS = ['utils/*.test.ts', 'engine/*.test.ts'];

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

const targets = process.argv.slice(2);
const useTargets = targets.length > 0 ? targets : DEFAULT_TARGETS;

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
console.log(`[run-tests] node v${fmt(runner.version)}（${runner.why}）→ ${useTargets.join(' ')}`);

const result = spawnSync(runner.exe, ['--test', ...useTargets], { stdio: 'inherit' });

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
