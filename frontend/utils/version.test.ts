// 版本單一來源的守衛測試（P0-c）。
//
// 這支要擋的不是「推導式算錯」—— 那個看一眼就知道。要擋的是**四個載體悄悄漂開**：
// package.json 說 2.0.4、gradle 說 1.0，而網頁跟商店永遠不會互相對照，
// 所以漂開之後在任何既有檢查裡都零徵兆（實測就是這樣漂了三個值出來）。
//
// 因此本檔分三層，缺一層就會留下一個「綠燈但沒保護」的洞：
//   1. 推導式本身（純函式，含邊界）
//   2. 對**真的 repo 檔案**跑 plan() —— 不是對 fixture，fixture 不會跟著 Xcode 漂
//   3. 反控：把載體改壞，必須**恰好是那一條**轉紅（紅了還要看紅的是哪一條）

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { plan, parseSemver, deriveBuildNumber, RULES, ROOT } from '../scripts/sync-version.mjs';

// ── 1. 推導式 ────────────────────────────────────────────────────────────────

test('parseSemver 只接受剛好三段的純數字版本', () => {
    assert.deepEqual(parseSemver('2.0.4'), { major: 2, minor: 0, patch: 4 });
    assert.deepEqual(parseSemver('  2.0.4  '), { major: 2, minor: 0, patch: 4 });

    // 這些在 versionGate.ts 是合法的（那支刻意寬容），但推導 build number 時
    // 少一段就沒有唯一解 ⇒ 這裡必須更嚴。兩支的寬嚴不同是設計，不是不一致。
    for (const bad of ['2.0', '2', '2.0.4.1', '2.0.4-beta', 'v2.0.4', '', 'x.y.z']) {
        assert.throws(() => parseSemver(bad), `"${bad}" 應該被拒絕`);
    }
    for (const bad of [null, undefined, 204, {}]) {
        assert.throws(() => parseSemver(bad as never), `${String(bad)} 應該被拒絕`);
    }
});

test('deriveBuildNumber：2.0.4 → 20004', () => {
    assert.equal(deriveBuildNumber({ major: 2, minor: 0, patch: 4 }), 20004);
    assert.equal(deriveBuildNumber({ major: 0, minor: 0, patch: 1 }), 1);
    assert.equal(deriveBuildNumber({ major: 1, minor: 2, patch: 3 }), 10203);
});

test('deriveBuildNumber 對版本順序是嚴格單調的', () => {
    // 商店只認「build number 有沒有變大」。推導式一旦不單調，
    // 新版會被拒收，而拒收訊息不會告訴你是推導式的錯。
    const versions = ['0.0.1', '0.0.99', '0.1.0', '1.0.0', '1.0.1', '2.0.3', '2.0.4', '2.1.0'];
    const codes = versions.map((v) => deriveBuildNumber(parseSemver(v)));
    for (let i = 1; i < codes.length; i++) {
        assert.ok(
            codes[i] > codes[i - 1],
            `${versions[i]}(${codes[i]}) 必須大於 ${versions[i - 1]}(${codes[i - 1]})`
        );
    }
});

test('deriveBuildNumber 在 minor/patch ≥100 時擲錯，不是靜靜算出撞號的值', () => {
    // 2.0.100 與 2.1.0 都會算成 20100 —— 撞號比算錯更難發現，
    // 因為兩個不同版本會得到同一個 build number，商店連拒收都不會。
    assert.equal(deriveBuildNumber({ major: 2, minor: 1, patch: 0 }), 20100);
    assert.throws(() => deriveBuildNumber({ major: 2, minor: 0, patch: 100 }), RangeError);
    assert.throws(() => deriveBuildNumber({ major: 2, minor: 100, patch: 0 }), RangeError);
});

// ── 2. 對真的 repo 檔案 ───────────────────────────────────────────────────────

test('真實 repo 的四個載體與 package.json 一致', () => {
    const result = plan(ROOT);
    const drifted = result.changes.filter((c) => !c.inSync);
    assert.deepEqual(
        drifted.map((c) => `${c.file}::${c.label}`),
        [],
        '有載體與 package.json 不一致，執行 `npm run sync-version`'
    );
});

test('每條規則都真的在檔案裡命中了東西', () => {
    // 沒有這條的話，一條規則因為檔案改版而變成 0 處匹配時，
    // 它的 inSync 會是 every([]) === true —— 空集合恆真，
    // 「沒有東西不一致」與「根本沒在檢查」在上一條測試裡逐字相同。
    const result = plan(ROOT);
    for (const c of result.changes) {
        assert.ok(c.hits > 0, `${c.file}::${c.label} 匹配到 0 處，這條規則等於沒在守`);
    }
});

// ── 3. 反控：改壞任一載體，必須恰好是那一條轉紅 ───────────────────────────────

/** 把真實 repo 的來源與四個載體複製到一個暫存目錄，供破壞性測試使用。 */
function makeSandbox(): string {
    const root = mkdtempSync(join(tmpdir(), 'ryojaku-ver-'));
    const files = new Set(['package.json', ...RULES.map((r) => r.file)]);
    for (const rel of files) {
        const dest = join(root, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(ROOT, rel), dest);
    }
    return root;
}

test('沙箱複製品本身是乾淨的（反控的基準線）', () => {
    // 先證明沙箱在「沒被破壞」時是全綠的。少了這條，下面每一格的紅
    // 都可能只是「複製壞了」，而那跟「偵測器有效」長得一模一樣。
    const result = plan(makeSandbox());
    assert.deepEqual(result.changes.filter((c) => !c.inSync), []);
});

for (const rule of RULES) {
    test(`反控：改壞 ${rule.file}::${rule.label} 必須被抓到`, () => {
        const root = makeSandbox();
        const target = join(root, rule.file);
        const original = readFileSync(target, 'utf8');

        // 注入的是**格式合法但值不對**的故障，不是亂碼。
        // 亂碼會讓規則 0 處匹配而擲錯 —— 那也是紅的，但紅的是別條路，
        // 證明不了「值不一致會被抓到」這件事。
        const current = plan(root).changes.find((c) => c.label === rule.label)!;
        const wrong = /^\d+$/.test(current.want) ? '999999' : '9.9.9';
        assert.notEqual(wrong, current.want, '注入的故障值必須真的和正確值不同');

        writeFileSync(
            target,
            original.replace(rule.pattern, (_m, pre, _cur, post) => `${pre}${wrong}${post}`)
        );

        const after = plan(root);
        const drifted = after.changes.filter((c) => !c.inSync).map((c) => c.label);

        // 不只斷言「有東西紅了」，還要斷言紅的**恰好**是被改壞的那一條。
        // 同一個檔案裡的另一條規則不該被波及。
        assert.deepEqual(
            [...new Set(drifted)],
            [rule.label],
            `預期只有 ${rule.label} 轉紅，實際轉紅的是 ${drifted.join('、')}`
        );
        // 而且被改壞的那幾處要全部被看見（pbxproj 有兩份 buildSettings，
        // 只看第一處的話漏掉第二處會靜靜通過）。
        const mutated = after.changes.find((c) => c.label === rule.label)!;
        assert.ok(mutated.found.every((v) => v === wrong), '所有匹配處都應該讀到注入的故障值');
    });
}

// ── 4. CLI 契約 ──────────────────────────────────────────────────────────────

const CLI = join(ROOT, 'scripts', 'sync-version.mjs');

function runCli(args: string[]) {
    try {
        const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
        return { code: 0, stdout };
    } catch (err) {
        const e = err as { status: number; stdout: string; stderr: string };
        return { code: e.status, stdout: e.stdout, stderr: e.stderr };
    }
}

test('--check 對乾淨的樹回 rc=0', () => {
    assert.equal(runCli(['--check']).code, 0);
});

test('--check 一個位元組都不寫', () => {
    // 「唯讀」要用檔案內容驗，不能用註解驗。
    // 曾經踩過：docstring 寫著 --check 只驗不寫，而主程式根本沒解析那個旗標。
    const before = RULES.map((r) => readFileSync(join(ROOT, r.file), 'utf8'));
    runCli(['--check']);
    const after = RULES.map((r) => readFileSync(join(ROOT, r.file), 'utf8'));
    assert.deepEqual(after, before, '--check 改動了檔案內容');
});

test('不認得的旗標回 rc=2，不會被當成「沒有旗標」而動手寫檔', () => {
    // 靜靜忽略未知旗標的話，`--dry-run` 這種打錯的參數會直接變成「真的寫下去」。
    const r = runCli(['--dry-run']);
    assert.equal(r.code, 2);
});
