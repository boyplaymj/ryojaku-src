// utils/voiceExport.test.ts — 回灌工單的打包層（B案）
//
// 🔴 **全部走真引擎**（`buildReview` → `feedback.js`），不用 stub。
//    理由同 `voiceReview.test.ts`：拿 stub 代替的話，引擎在接線時退化
//    **不會有任何東西轉紅**。C1 是校準條，排在所有反控之前。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MIN_COUNT, buildReview, type FanTable, type ReviewPage, type ReviewRecord } from './voiceReview.ts';
import {
    EXPORT_FORMAT,
    buildExportBundle,
    bundleFilename,
    hashUserId,
    serializeBundle,
} from './voiceExport.ts';

const TABLE: FanTable = JSON.parse(
    readFileSync(fileURLToPath(new URL('../engine/mahjong-tai/fan_table.json', import.meta.url)), 'utf8'),
);

const FIXED = new Date('2026-09-14T00:00:00.000Z');

/**
 * 兩個**不同**使用者各把「爭花」講成正花一次 ⇒ 剛好踩到 minCount=2。
 * ⚠️ 這裡刻意不用 `fan_table.json` 已收錄的詞：`zhenghua` 的 asr_confusions 本來就有
 *    「爭花」⇒ 它不是新詞、不會產生建議。用一個表裡沒有的殘字才驗得到東西。
 */
const NEW_TERM = '正發';

function row(userId: string, unmatched: string, added: string[]): ReviewRecord {
    return { userId, text: unmatched, hadDiff: true, ts: 1, unmatched, added, removed: [] };
}

function pagesOf(rows: ReviewRecord[]): ReviewPage[] {
    return [{ data: rows } as ReviewPage];
}

const TWO_USERS = [row('u-alice', NEW_TERM, ['zhenghua']), row('u-bob', NEW_TERM, ['zhenghua'])];

// ── C1 校準：這份測試量的是真的那支引擎 ──────────────────────────────
test('C1 校準：真引擎在這組輸入上確實產出一則 add_confusion（少了它，下面每一條都可能是空的）', () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const auto = s.suggestions.filter((x) => x.type === 'add_confusion');
    assert.equal(auto.length, 1, `預期剛好一則，實得 ${JSON.stringify(s.suggestions)}`);
    assert.equal(auto[0].term, NEW_TERM);
    assert.equal(auto[0].fanId, 'zhenghua');
    assert.equal(auto[0].distinctUsers, 2);
});

// ── 打包 ──────────────────────────────────────────────────────────────
test('T1 出檔帶格式標記與後台那份表的版本', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    assert.equal(b._format, EXPORT_FORMAT);
    assert.equal(b.tableVersion, TABLE.meta?.version);
    assert.equal(b.minCount, MIN_COUNT);
    assert.equal(b.scannedRows, 2);
    assert.equal(b.complete, true);
});

test('T2 expected 就是後台算出來的 add_confusion（term/fanId/兩個計數）', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    assert.deepEqual(b.expected, [{ term: NEW_TERM, fanId: 'zhenghua', count: 2, distinctUsers: 2 }]);
});

test('T3 records 是 extractSuggestions 的輸入形狀，五個鍵不多不少', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    assert.equal(b.records.length, 2);
    assert.deepEqual(Object.keys(b.records[0]).sort(), ['added', 'removed', 'text', 'unmatched', 'userId']);
});

test('T4 掃到的列全帶 —— 沒有貢獻建議的那些也要在（門檻是對母體算的）', async () => {
    const noise: ReviewRecord = { userId: 'u-carol', text: '自摸', hadDiff: false, ts: 2, unmatched: '', added: [], removed: [] };
    const rows = [...TWO_USERS, noise];
    const s = buildReview(pagesOf(rows), TABLE, true);
    const b = await buildExportBundle(rows, s, MIN_COUNT, FIXED);
    assert.equal(b.records.length, 3, '沒貢獻的那列被濾掉了 —— 那會讓 repo 端重算出不同的母體');
    assert.equal(b.scannedRows, 3);
});

// ── userId 雜湊 ────────────────────────────────────────────────────────
test('T5 userId 出檔前被雜湊，原值不在出檔裡的任何角落', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    assert.equal(b.userIdHashed, true);
    const text = serializeBundle(b);
    assert.ok(!text.includes('u-alice'), '原始 userId 洩漏到出檔裡了');
    assert.ok(!text.includes('u-bob'));
});

test('T6 同一個人恆得同一個代號、不同人不同 —— 否則 distinctUsers 門檻會失效', async () => {
    const a1 = await hashUserId('u-alice');
    const a2 = await hashUserId('u-alice');
    const bb = await hashUserId('u-bob');
    assert.equal(a1, a2);
    assert.notEqual(a1, bb);
    assert.match(a1, /^[0-9a-f]{16}$/);
});

test('T7 雜湊後 distinctUsers 仍然是 2（正控：雜湊沒有把兩個人黏成一個）', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    const ids = new Set(b.records.map((r) => r.userId));
    assert.equal(ids.size, 2);
    assert.equal(b.expected[0].distinctUsers, 2);
});

test('T8 原本就沒帶 userId 的維持 null，不合成假的', async () => {
    const anon: ReviewRecord = { userId: '', text: NEW_TERM, hadDiff: true, ts: 3, unmatched: NEW_TERM, added: ['zhenghua'], removed: [] };
    const rows = [...TWO_USERS, anon];
    const s = buildReview(pagesOf(rows), TABLE, true);
    const b = await buildExportBundle(rows, s, MIN_COUNT, FIXED);
    assert.equal(b.records[2].userId, null);
});

// ── 分流：add_confusion 與 review_mapping 不可混 ───────────────────────
test('T9 review_mapping 落在 manualReview，不進 expected（apply.js 不會套它）', async () => {
    // 兩個使用者都把 A 改成 B ⇒ feedback.js 產出 review_mapping。
    const rows = [
        { userId: 'u-a', text: '平胡', hadDiff: true, ts: 1, unmatched: '', added: ['pinghu'], removed: ['zimo'] },
        { userId: 'u-b', text: '平胡', hadDiff: true, ts: 2, unmatched: '', added: ['pinghu'], removed: ['zimo'] },
    ] as ReviewRecord[];
    const s = buildReview(pagesOf(rows), TABLE, true);
    const kinds = new Set(s.suggestions.map((x) => x.type));
    assert.ok(kinds.has('review_mapping'), `前提不成立：這組輸入沒產出 review_mapping（${JSON.stringify(s.suggestions)}）`);
    const b = await buildExportBundle(rows, s, MIN_COUNT, FIXED);
    assert.equal(b.expected.length, 0, 'review_mapping 混進 expected 了 —— repo 端對照必然不符');
    assert.deepEqual(b.manualReview, [{ fromFanId: 'zimo', toFanId: 'pinghu', count: 2, distinctUsers: 2 }]);
});

// ── 誠實欄位 ──────────────────────────────────────────────────────────
test('T10 沒掃完時 complete=false 帶出去（expected 是下限，不是答案）', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, false);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    assert.equal(b.complete, false);
});

test('T11 versionMismatch 帶出去 —— 少了它，repo 端會把「多報」讀成「算錯」', async () => {
    const rows = TWO_USERS.map((r) => ({ ...r, rulesetVersion: '9.9.9' }));
    const s = buildReview(pagesOf(rows), TABLE, true);
    assert.equal(s.health.versionMismatch, true, '前提不成立：這組輸入沒觸發 versionMismatch');
    const b = await buildExportBundle(rows, s, MIN_COUNT, FIXED);
    assert.equal(b.versionMismatch, true);
});

test('T12 後台讀不到表版本時照抄 (未知)，不改寫成 null', async () => {
    const noMeta = { ...TABLE, meta: undefined } as FanTable;
    const s = buildReview(pagesOf(TWO_USERS), noMeta, true);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    assert.equal(b.tableVersion, '(未知)');
});

test('T13 minCount 用呼叫端傳進來的那個，不是常數', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true, 5);
    const b = await buildExportBundle(TWO_USERS, s, 5, FIXED);
    assert.equal(b.minCount, 5);
    assert.equal(b.expected.length, 0, '前提：門檻 5 時這組輸入不該有建議');
});

// ── 決定性 ────────────────────────────────────────────────────────────
test('T14 同一份資料兩次匯出逐 byte 相同（否則沒辦法比對兩份工單）', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const a = serializeBundle(await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED));
    const b = serializeBundle(await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED));
    assert.equal(a, b);
});

test('T15 檔名帶日期與表版本', async () => {
    const s = buildReview(pagesOf(TWO_USERS), TABLE, true);
    const b = await buildExportBundle(TWO_USERS, s, MIN_COUNT, FIXED);
    assert.equal(bundleFilename(b), `voice-reflow-2026-09-14-v${TABLE.meta?.version}.json`);
});
