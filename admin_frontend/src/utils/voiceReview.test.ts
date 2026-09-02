// utils/voiceReview.test.ts — 審核頁聚合層（D6）
//
// 🔴 **全部用真引擎，不用 stub。** Codex 覆驗 D6-c 時指名這件事：
//    R2 只驗到「引擎可被後台正確載入」，若這裡拿 stub 代替，
//    引擎在接線時退化**不會有任何東西轉紅** —— 而 D6-c 量到的正是
//    「`vite build` rc=0 而執行產物直接 throw」那種故障。
//    ⇒ C1 是校準條，排在所有反控之前：它證明這一整份測試量的是真的那支。
//
// ⚠️ 台數表用 fs 讀，不用 `import ... with { type: 'json' }`：
//    後者在 node --test 剝型別的情境下是另一條相依，而這裡只是要一份資料。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MahjongFeedback } from '../engine/mahjong-tai/index.mjs';
import {
    MIN_COUNT,
    aggregateByFan,
    buildReview,
    extractReviewSuggestions,
    flattenPages,
    toFeedbackRecords,
    type FanTable,
    type ReviewRecord,
} from './voiceReview.ts';

const TABLE: FanTable = JSON.parse(
    readFileSync(fileURLToPath(new URL('../engine/mahjong-tai/fan_table.json', import.meta.url)), 'utf8')
);
const FAN_A = TABLE.fans[0].id;
const FAN_B = TABLE.fans[1].id;

// 🔴 殘字必須是台數表裡**沒有**的詞：`extractSuggestions` 會排除已知詞（那是它該做的），
//    而被排除的結果是 0 則建議 —— 那個 0 跟「引擎沒載到」在斷言上逐字相同。
//    刻意用不可能被收錄的字串，而不是挑一個現在剛好不在表裡的真詞
//    （後者哪天被回灌進 asr_confusions，這份測試就會無緣無故轉紅）。
const NOVEL_TERM = 'ZZ測試殘字';

const row = (o: Partial<ReviewRecord> = {}): ReviewRecord => ({
    userId: 'u1',
    text: 'x',
    hadDiff: true,
    ts: 1,
    added: [],
    removed: [],
    unmatched: '',
    ...o,
});

/** 型一（add_confusion）的最小輸入：殘字 + 剛好補上一個台種。 */
const addConfRow = (userId: string, term = NOVEL_TERM) =>
    row({ userId, text: term, unmatched: term, added: [FAN_A], removed: [] });

test('C1 【校準】用的是真引擎：extractSuggestions 是函式，且真的算得出建議', () => {
    assert.equal(typeof MahjongFeedback?.extractSuggestions, 'function');
    const out = extractReviewSuggestions([addConfRow('u1'), addConfRow('u2')], TABLE);
    assert.equal(out.length, 1, '真引擎在這組輸入上必須產出一則建議；0 則代表下面所有反控都是假綠');
    assert.equal(out[0].type, 'add_confusion');
});

test('R2 toFeedbackRecords 五個鍵齊全（少一個，飛輪只會安靜地少找到一類建議）', () => {
    const [r] = toFeedbackRecords([row({ unmatched: 'zz', added: ['a'], removed: ['b'] })]);
    assert.deepEqual(Object.keys(r).sort(), ['added', 'removed', 'text', 'unmatched', 'userId']);
});

test('R3 added/removed 不是陣列時補成 []（feedback.js 直接讀 .length，undefined 會炸）', () => {
    const [r] = toFeedbackRecords([{ userId: 'u', text: 't', hadDiff: false, ts: 1 } as ReviewRecord]);
    assert.deepEqual(r.added, []);
    assert.deepEqual(r.removed, []);
    assert.equal(r.unmatched, '');
});

test('R4 userId 是空字串時給 null（讓「沒有」在型別上顯式）', () => {
    const [r] = toFeedbackRecords([row({ userId: '' })]);
    assert.equal(r.userId, null);
});

test('R5 aggregateByFan：added 計成漏判、removed 計成誤判', () => {
    const fans = aggregateByFan([row({ added: [FAN_A], removed: [FAN_B] })], TABLE);
    const a = fans.find((f) => f.fanId === FAN_A)!;
    const b = fans.find((f) => f.fanId === FAN_B)!;
    assert.deepEqual([a.timesAdded, a.timesRemoved, a.total], [1, 0, 1]);
    assert.deepEqual([b.timesAdded, b.timesRemoved, b.total], [0, 1, 1]);
});

test('R6 aggregateByFan：total 多到少排序，同分用 fanId 升序（輸出要是決定性的）', () => {
    const fans = aggregateByFan(
        [row({ added: [FAN_B, FAN_A] }), row({ added: [FAN_B] })],
        TABLE
    );
    assert.equal(fans[0].fanId, FAN_B, 'total 大的要在前');
    const tie = aggregateByFan([row({ added: ['zzz', 'aaa'] })], TABLE).map((f) => f.fanId);
    assert.deepEqual(tie, ['aaa', 'zzz'], '同分要按 fanId 升序，否則同一份資料兩次跑出不同順序');
});

test('R7 表裡沒有的 fanId 仍要出現（known=false、name=null），不可靜靜丟掉', () => {
    const fans = aggregateByFan([row({ added: ['not_a_real_fan'] })], TABLE);
    const x = fans.find((f) => f.fanId === 'not_a_real_fan');
    assert.ok(x, '丟掉的方向是「這個台種從來沒被訂正過」——最像的解讀是「它判得很準」');
    assert.equal(x!.known, false);
    assert.equal(x!.name, null);
});

test('R8 minCount < 2 直接拋（§4.5：1 是 single-user demo 專用）', () => {
    assert.throws(() => extractReviewSuggestions([], TABLE, 1), /minCount/);
    assert.throws(() => extractReviewSuggestions([], TABLE, 0), /minCount/);
    assert.throws(() => extractReviewSuggestions([], TABLE, 2.5), /minCount/);
    assert.equal(MIN_COUNT, 2);
});

test('R9 兩個不同使用者各一次 → 升級成一則 add_confusion', () => {
    const out = extractReviewSuggestions([addConfRow('u1'), addConfRow('u2')], TABLE);
    assert.equal(out.length, 1);
    assert.equal(out[0].term, NOVEL_TERM);
    assert.equal(out[0].fanId, FAN_A);
    assert.equal(out[0].distinctUsers, 2);
});

test('R10 【反控】同一個使用者講兩次 → 不升級（distinctUsers 防單人灌爆）', () => {
    const out = extractReviewSuggestions([addConfRow('u1'), addConfRow('u1')], TABLE);
    assert.deepEqual(out, []);
});

test('R11 完全沒帶 userId 時退回筆數（向後相容），而那是**降級**，要被數出來', () => {
    const rows = [addConfRow(''), addConfRow('')];
    assert.equal(extractReviewSuggestions(rows, TABLE).length, 1, 'feedback.js:104 的向後相容分支');
    const s = buildReview([{ data: rows }], TABLE, true);
    assert.equal(
        s.health.rowsWithoutUserId,
        2,
        '缺 userId 會把「兩個不同使用者」悄悄降級成「同一個人講兩次也算」——必須講出來'
    );
});

test('R12 add_confusion 可自動、review_mapping 一律交人工（§4.5）', () => {
    const remap = (userId: string) =>
        row({ userId, unmatched: '', added: [FAN_A], removed: [FAN_B] });
    const out = extractReviewSuggestions(
        [addConfRow('u1'), addConfRow('u2'), remap('u1'), remap('u2')],
        TABLE
    );
    const byType = Object.fromEntries(out.map((s) => [s.type, s]));
    assert.equal(byType.add_confusion.autoApplicable, true);
    assert.equal(byType.review_mapping.autoApplicable, false);
});

test('R13 建議帶得到人看得懂的台種名', () => {
    const out = extractReviewSuggestions([addConfRow('u1'), addConfRow('u2')], TABLE);
    assert.equal(out[0].fanName, TABLE.fans[0].name);
});

test('R14 【反控】台數表已收錄的詞不會被當成新詞提出來', () => {
    const known = TABLE.fans[0].name;
    const out = extractReviewSuggestions(
        [addConfRow('u1', known), addConfRow('u2', known)],
        TABLE
    );
    assert.deepEqual(out, [], `「${known}」已在表裡，提出來等於叫人把已有的詞再加一次`);
});

test('R15 versionMismatch：有帶版本且與後台這份不同才算', () => {
    const v = TABLE.meta?.version ?? '(未知)';
    const same = buildReview([{ data: [row({ rulesetVersion: v })] }], TABLE, true);
    assert.equal(same.health.versionMismatch, false);
    const diff = buildReview([{ data: [row({ rulesetVersion: '9.9.9' })] }], TABLE, true);
    assert.equal(diff.health.versionMismatch, true);
    assert.equal(diff.health.tableVersion, v);
});

test('R16 【反控】沒帶 rulesetVersion 的舊列不觸發 mismatch（否則每批舊資料都亮，亮到沒人看）', () => {
    const s = buildReview([{ data: [row({})] }], TABLE, true);
    assert.equal(s.health.versionMismatch, false);
    assert.deepEqual(s.health.dataVersions, [{ version: '(未帶)', count: 1 }]);
});

test('R17 complete 原樣傳出（false ⇒ 每個計數都是下限）', () => {
    assert.equal(buildReview([], TABLE, false).health.complete, false);
    assert.equal(buildReview([], TABLE, true).health.complete, true);
});

test('R18 unknownFanIds 列出表裡找不到的 id（版本不一致最直接的證據）', () => {
    const s = buildReview([{ data: [row({ added: ['ghost_fan'], removed: [FAN_A] })] }], TABLE, true);
    assert.deepEqual(s.health.unknownFanIds, ['ghost_fan']);
});

test('R19 flattenPages 忽略沒有 data 的頁，不當成錯誤', () => {
    assert.equal(flattenPages([{}, { data: [row({})] }, { data: undefined }]).length, 1);
});

test('R20 rowsWithBrokenDiffShape：任一欄不是陣列就算（只壞一半也要看得見）', () => {
    const bothMissing = { userId: 'u', text: 't', hadDiff: false, ts: 1 } as ReviewRecord;
    // 🔴 這一列是本條的**鑑別點**：`added` 是陣列、`removed` 缺。
    //    判準寫成「兩者都缺」的話它不會被算到 —— 而那正是 M16 那發突變，
    //    第一版 fixture 沒有這種列，於是那發存活。
    const halfMissing = { userId: 'u', text: 't', hadDiff: false, ts: 1, added: [] } as ReviewRecord;
    const s = buildReview([{ data: [bothMissing, halfMissing, row({})] }], TABLE, true);
    assert.equal(s.health.rowsWithBrokenDiffShape, 2);
    assert.equal(s.health.totalRows, 3);
});
