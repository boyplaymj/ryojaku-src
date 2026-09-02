#!/usr/bin/env node
// ⚠️ **本檔改寫自 `frontend/scripts/run-tests.mjs`**（同 repo 另一個子專案）。
//    刻意用複製而不是共用：那支的 DEFAULT_TARGETS 寫死自己的路徑，抽成共用模組
//    要動到別條 session 正在改的檔。兩份會漂 —— 可以接受的理由是它**不承載正確性**，
//    它只挑 node 與擋「測試靜靜歸零」；真正的判準在各自的 DEFAULT_TARGETS 裡。
//    改了其中一份時，另一份不會有任何東西轉紅。
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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/** 下限。與 package.json 的 engines 一致 —— 那裡是宣告，這裡是唯一真的擋得住的地方。 */
const MIN = [22, 18, 0];
// 🔴 `min` 是 fail-closed 下限，不是裝飾：glob 沒命中時 `node --test` 是
//    **`tests 0 / pass 0 / rc=0`** ——「沒跑」與「全過」在輸出上逐字相同。
//    admin_frontend 在 D6 之前**一條測試都沒有**，所以「零測試」正是這個專案的自然狀態
//    ⇒ 靜靜退回零的路特別短，這道下限就是擋那條路的。
//
// 🔴 兩道下限方向不同，缺一不可：
//    `min`      數**檔案**（glob 沒命中／檔被刪）
//    `minTests` 數**條數**（檔還在、裡面的 test() 被清光 —— 一樣是 rc=0）
//
// ⚠️ minTests 訂在目前的實際條數：這批測試由 tools/mahjong-tai 這條線維護，
//    條數我說了算（與 frontend 的 `utils` 那組刻意放寬的理由相反 —— 那組別條 session 會動）。
const DEFAULT_TARGETS = [
    { glob: 'src/utils/*.test.ts', min: 1, minTests: 20 },
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
const useTargets =
    explicit.length > 0 ? explicit.map((glob) => ({ glob, min: 1, minTests: 0 })) : DEFAULT_TARGETS;

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
console.log(`[run-tests] node v${fmt(runner.version)}（${runner.why}）`);

/**
 * 跑一組檔案，順便把「跑了幾條」量回來。
 * stdout 仍給人看（spec），另開一份 TAP 寫到暫存檔當尺。
 * ⚠️ 暫存目錄用 mkdtemp：/tmp 是所有 session 共用的，固定檔名會互相蓋。
 */
function runGroup(files) {
    const dir = mkdtempSync(join(tmpdir(), 'run-tests-'));
    const tap = join(dir, 'result.tap');
    const r = spawnSync(
        runner.exe,
        [
            '--test',
            '--test-reporter=spec',
            '--test-reporter-destination=stdout',
            '--test-reporter=tap',
            `--test-reporter-destination=${tap}`,
            ...files,
        ],
        { stdio: 'inherit' }
    );
    let ran = null;
    try {
        const m = /^# tests (\d+)$/m.exec(readFileSync(tap, 'utf8'));
        if (m) ran = Number(m[1]);
    } catch {
        /* 讀不到就是 null —— 下面 fail-closed，量不到不等於量到全過 */
    }
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* 清不掉不影響判定，不要因此改變 rc */
    }
    return { r, ran };
}

/** 把 spawn 本身的異常收斂成 rc，別讓它偽裝成 0。 */
function bailOnSpawnTrouble({ error, status, signal }) {
    if (error) {
        console.error(`❌ 無法執行 ${runner.exe}：${error.message}`);
        process.exit(1);
    }
    // 被訊號砍掉時 status 是 null —— 那種情況回 0 等於謊報成功。
    if (status === null) {
        console.error(`❌ 測試行程被訊號中止（${signal}）`);
        process.exit(1);
    }
}

// 手動指定：一次跑完就好，不套條數下限（除錯路徑，條數本來就少）。
if (explicit.length > 0) {
    const { r } = runGroup(matched);
    bailOnSpawnTrouble(r);
    process.exit(r.status);
}

// 🔴 **逐組跑、逐組驗條數**，不是跑一次驗總數。
//    總數下限有個洞：`utils` 長大可以把 `engine` 歸零蓋過去
//    （實測 2026-09-02：utils 一度 36 條、別條 session 改動後變 44，
//     總數下限 40 在 engine 掛零時照樣綠）。
//    ⇒ 閘門的計量單位要跟擔心的風險同一個維度：誰的下限就數誰。
let worst = 0;
for (const t of useTargets) {
    const files = expandTarget(t.glob);
    const { r, ran } = runGroup(files);
    bailOnSpawnTrouble(r);
    if (r.status !== 0) {
        // 測試自己紅了就回它的 rc —— 那個訊息比「條數不足」具體得多。
        worst = worst || r.status;
        continue;
    }
    if (ran === null) {
        console.error(`❌ [設備] ${t.glob} 讀不到測試計數 —— 量不到不等於量到全過，不敢回 0。`);
        process.exit(2);
    }
    if (ran < t.minTests) {
        console.error(
            `\n❌ [設備] ${t.glob} 只跑了 ${ran} 條，下限是 ${t.minTests}。\n` +
            `   檔案還在、裡面的 test() 被清空時，node --test 一樣是 rc=0 ——\n` +
            `   這道下限就是為了讓那種退化紅起來。\n` +
            `   若這是刻意的（真的移除了測試），請同時調低該組的 minTests。`
        );
        process.exit(2);
    }
    console.log(`[run-tests] ${t.glob} 條數 ✓ ${ran} ≥ ${t.minTests}`);
}

process.exit(worst);
