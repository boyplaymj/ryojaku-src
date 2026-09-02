// engine/mahjong-tai-sync.test.ts — 後台副本的漂移守衛（D6，admin_frontend 這一份）
//
// 🔴 **本檔改寫自 `frontend/engine/mahjong-tai-sync.test.ts`**（同 repo 另一個子專案）。
//    刻意複製而不是共用：兩個子專案各有自己的 tsconfig 與測試 runner，
//    而這支要驗的是**自己這一份副本**——判準相同，受測物不同。
//    ⚠️ 兩份會漂，且改了其中一份時另一份不會有任何東西轉紅。
//    可以接受的理由是它不承載邏輯：真正的判準是 SYNC.sha256，那份只有一個來源。
//
// 🔴 為什麼 admin_frontend 也要一份引擎副本：
//    正典明訂 `extractSuggestions` **只該有一個實作**（DESIGN_APP.md §4.3
//    「後台端不算建議」），而 D6 審核頁要呼叫它。後台是另一個 Vite app，
//    拿不到 App 那份 ⇒ 只能同步過去，不可以在後台重寫一份。
//
// 🔴 這支存在的理由是「沒人會手動跑正典側的守衛」：
//    正典側 `verify_sync.sh` 驗的是「副本 vs 正典」（更強），但它是**手動**的 ——
//    2026-09-02 加多目的地之前，它甚至根本不知道有第二個副本。
//    這裡驗的是「副本 vs 跟著它一起進版控的證物 SYNC.sha256」，不需要正典，
//    所以在 CI 上跑得動、而且**真的會被觸發**（npm test）。
//
// ⚠️ 已知界線（不是疏漏，是這個方案的信任邊界）：
//    副本與 SYNC.sha256 **同時**被改，這裡認不出來。擋它的是正典側 verify_sync.sh 的
//    「這份清單確實由正典內容生成」那道（`cmp` 逐位元）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = fileURLToPath(new URL('./mahjong-tai/', import.meta.url));
const LIST_NAME = 'SYNC.sha256';

/**
 * 🔴 fail-closed 下限。與正典 sync_manifest.txt 的 `# min-files: 7` 對應。
 *    沒有它的話，「清單被清空」會退化成「0 筆全部相符」——
 *    那在輸出上與「7 筆全部相符」同樣是綠的。
 */
const MIN_ENTRIES = 7;

type Entry = { hash: string; rel: string };

function parseList(): Entry[] {
    const raw = readFileSync(join(ENGINE_DIR, LIST_NAME), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    return lines.map((line, i) => {
        // 格式與 sha256sum 相容：<64hex><兩個空白><相對路徑>
        const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
        assert.ok(m, `${LIST_NAME} 第 ${i + 1} 行格式不合法：${JSON.stringify(line)}`);
        return { hash: m[1], rel: m[2] };
    });
}

/** 遞迴列出 engine 副本目錄裡的所有檔（相對路徑），用來抓「清單外多出來的檔」。 */
function walk(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
        const abs = join(dir, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
        else out.push(rel);
    }
    return out;
}

test('證物存在、格式合法，且筆數不低於下限', () => {
    const entries = parseList();
    assert.ok(
        entries.length >= MIN_ENTRIES,
        `${LIST_NAME} 只有 ${entries.length} 筆，下限 ${MIN_ENTRIES}。` +
            `空/截斷的清單會讓這支守衛變成永遠綠的擺設。`
    );
});

test('清單沒有重複路徑（重複會讓「少一個檔」被另一筆掩護過去）', () => {
    const rels = parseList().map((e) => e.rel);
    const dup = rels.filter((r, i) => rels.indexOf(r) !== i);
    assert.deepEqual(dup, [], `清單有重複路徑：${dup.join(', ')}`);
});

test('清單沒有逃出 engine 目錄的路徑（絕對路徑或 ..）', () => {
    const bad = parseList()
        .map((e) => e.rel)
        .filter((r) => r.startsWith('/') || r.split('/').includes('..'));
    assert.deepEqual(bad, [], `清單有不合法路徑：${bad.join(', ')}`);
});

test('每個副本檔案都存在，且 sha256 與證物相符', () => {
    const mismatches: string[] = [];
    for (const { hash, rel } of parseList()) {
        let actual: string;
        try {
            actual = createHash('sha256').update(readFileSync(join(ENGINE_DIR, rel))).digest('hex');
        } catch (err) {
            mismatches.push(`${rel}：讀不到（${(err as Error).message}）`);
            continue;
        }
        if (actual !== hash) mismatches.push(`${rel}：證物 ${hash} ≠ 實際 ${actual}`);
    }
    assert.deepEqual(
        mismatches,
        [],
        `副本與 SYNC.sha256 對不上 —— 有人直接改了副本，或正典改了而沒重跑 sync_to_app.sh：\n` +
            mismatches.join('\n')
    );
});

test('副本目錄裡沒有清單外多出來的檔', () => {
    // 這是舊守衛（正典側 verify_sync.sh）明載的已知缺口：它只驗清單列的檔，
    // 「副本旁邊多加一個檔」不會紅。這裡補上 —— 多出來的檔不會被同步覆蓋，
    // 會變成只存在於 App 的孤兒，而它看起來就像引擎的一部分。
    const listed = new Set(parseList().map((e) => e.rel));
    listed.add(LIST_NAME); // 證物自己不列在自己裡面
    const extra = walk(ENGINE_DIR).filter((r) => !listed.has(r));
    assert.deepEqual(extra, [], `副本目錄有清單外的檔：${extra.join(', ')}`);
});
