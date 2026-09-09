// utils/venueReview.test.ts — 場地審核頁（B1-f3）的算術層

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    hasWarning, readinessOf, sortForReview, venueStatusLabel, venueTypeLabel,
    waitingDays, type AdminVenue,
} from './venueReview.ts';

const base: AdminVenue = {
    venueId: 'V1', type: 'hall', name: '某某館', ownerId: 'U1',
    exactAddress: '台北市大安區某路99號', status: 'pending', createdAt: 1000,
    approxLocation: { latitude: 25.03, longitude: 121.56 },
};
const mk = (over: Partial<AdminVenue>): AdminVenue => ({ ...base, ...over });

// --- 標籤：不認得的值要看得出來 ---

test('T1 三種 type 各有標籤，未知的原樣印出並標記', () => {
    assert.match(venueTypeLabel('hall'), /麻將館/);
    assert.match(venueTypeLabel('home'), /自建場/);
    assert.match(venueTypeLabel('event'), /活動場/);
    // 🔴 承重：dojo 不是合法 type（§5.2/§5.3）。若有一天出現在資料裡，
    // 畫面必須讓人看見，而不是靜靜顯示空白 —— 後者與「這一格沒資料」逐字相同。
    assert.match(venueTypeLabel('dojo'), /未知類型/);
    assert.match(venueTypeLabel(''), /未知類型/);
});

test('T2 四種 status 各有標籤，且 rejected 與 suspended 的字不同', () => {
    assert.match(venueStatusLabel('pending'), /待審核/);
    assert.match(venueStatusLabel('active'), /已上線/);
    // 🔴 後端刻意把這兩個分開（審核不通過 vs 上線後被停權），
    // 畫面若印成同一句話，那個區別在後台就消失了。
    assert.notEqual(venueStatusLabel('rejected'), venueStatusLabel('suspended'));
    assert.match(venueStatusLabel('unknown'), /未知狀態/);
});

// --- 資料健康 ---

test('T3 乾淨的資料不亮任何警示（正控）', () => {
    const r = readinessOf(base);
    assert.equal(hasWarning(r), false, '乾淨資料不該有警示 —— 否則下面每一條都自動成立');
});

test('T4 每一條警示各自獨立成立', () => {
    assert.equal(readinessOf(mk({ exactAddress: '' })).noAddress, true);
    assert.equal(readinessOf(mk({ exactAddress: '   ' })).noAddress, true, '只有空白也算沒填');
    assert.equal(readinessOf(mk({ name: '  ' })).blankName, true);
    assert.equal(readinessOf(mk({ ownerId: '' })).noOwner, true);
    assert.equal(
        readinessOf(mk({ approxLocation: { latitude: 0, longitude: 0 } })).nullIsland, true,
        '(0,0) 是「沒填」最常見的形態，核准後圖釘會出現在幾內亞灣外海',
    );
});

test('T5 🔴「沒有座標」與「座標是 0」是兩件事', () => {
    // 用 `!lat` 寫的話，undefined 也會被算成 nullIsland ——
    // 而那兩者要給的處置不同（前者是欄位缺失，後者是填了假值）。
    assert.equal(readinessOf(mk({ approxLocation: undefined })).nullIsland, false);
    assert.equal(readinessOf(mk({ approxLocation: {} })).nullIsland, false);
    // 只有一邊是 0 也不算（真的有場地在赤道或本初子午線上）。
    assert.equal(readinessOf(mk({ approxLocation: { latitude: 0, longitude: 121 } })).nullIsland, false);
});

// --- 排序：等最久的排前面 ---

test('T6 🔴 等最久的排前面', () => {
    const got = sortForReview([
        mk({ venueId: 'B', createdAt: 3000 }),
        mk({ venueId: 'A', createdAt: 1000 }),
        mk({ venueId: 'C', createdAt: 2000 }),
    ]).map(v => v.venueId);
    assert.deepEqual(got, ['A', 'C', 'B'], '館方付了錢在等，被遺忘的那一筆必須浮到最前面');
});

test('T7 沒有 createdAt 的排最後，且同秒時順序穩定', () => {
    const got = sortForReview([
        mk({ venueId: 'X', createdAt: undefined }),
        mk({ venueId: 'A', createdAt: 1000 }),
    ]).map(v => v.venueId);
    assert.deepEqual(got, ['A', 'X']);
    // 同一秒：用 venueId 決勝，否則每次重整順序會跳。
    const stable = sortForReview([
        mk({ venueId: 'B', createdAt: 1000 }),
        mk({ venueId: 'A', createdAt: 1000 }),
    ]).map(v => v.venueId);
    assert.deepEqual(stable, ['A', 'B']);
});

test('T8 sortForReview 不改動傳進來的陣列', () => {
    const input = [mk({ venueId: 'B', createdAt: 3000 }), mk({ venueId: 'A', createdAt: 1000 })];
    const before = input.map(v => v.venueId);
    sortForReview(input);
    assert.deepEqual(input.map(v => v.venueId), before, '就地排序會讓 React 的 state 被偷改');
});

// --- 等待天數 ---

test('T9 waitingDays 由呼叫端傳時鐘，沒有 createdAt 回 null', () => {
    assert.equal(waitingDays(mk({ createdAt: 1000 }), 1000 + 86400 * 3), 3);
    assert.equal(waitingDays(mk({ createdAt: 1000 }), 1000), 0);
    // null 而不是 0：「沒有時間戳」與「今天剛送出」要分得出來。
    assert.equal(waitingDays(mk({ createdAt: undefined }), 99999), null);
    // 時鐘倒退（機器時間不對）時夾到 0，不印負數。
    assert.equal(waitingDays(mk({ createdAt: 9999 }), 1000), 0);
});
