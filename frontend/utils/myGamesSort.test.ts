// utils/myGamesSort.test.ts — 「我的局」排序的回歸網（[A2-a-1]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這些測試釘的是「從 MyEvents.tsx / MyGamesSection.tsx 搬出來時的行為」，
// 不是「應該有的行為」（§4.2 的「今天 → 本週 → 更遠」是之後的事）。
// 🔴 `now` 全部是固定數字，這裡沒有任何一行讀真時鐘。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    eventTimeMs,
    isEventExpired,
    myGameSortPriority,
    compareMyGames,
    sortMyGames,
} from './myGamesSort.ts';

/** 固定的「現在」：2026-09-03T12:00:00Z */
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

test('A2a1-1 四種 status 未過期時的優先級：full=1、recruiting=2、closed=3、cancelled=3', () => {
    assert.equal(myGameSortPriority({ status: 'full' }, false), 1);
    assert.equal(myGameSortPriority({ status: 'recruiting' }, false), 2);
    assert.equal(myGameSortPriority({ status: 'closed' }, false), 3);
    assert.equal(myGameSortPriority({ status: 'cancelled' }, false), 3);
});

test('A2a1-2 isExpired=true 會把 full／recruiting 都壓到 3（過期先於狀態）', () => {
    for (const status of ['full', 'recruiting', 'closed', 'cancelled']) {
        assert.equal(myGameSortPriority({ status }, true), 3, status);
    }
});

test('A2a1-3 認不得的 status／undefined → 3', () => {
    assert.equal(myGameSortPriority({ status: 'in_progress' }, false), 3);
    assert.equal(myGameSortPriority({ status: '' }, false), 3);
    assert.equal(myGameSortPriority({}, false), 3);
    assert.equal(myGameSortPriority({ status: 'FULL' }, false), 3, '大小寫不同不算 full');
});

test('A2a1-4 isEventExpired：早於 now 才過期，同一毫秒不算', () => {
    assert.equal(isEventExpired(iso(-1), NOW), true);
    assert.equal(isEventExpired(iso(0), NOW), false);
    assert.equal(isEventExpired(iso(+1), NOW), false);
    assert.equal(isEventExpired(NOW - 1, NOW), true, '數字型 epoch 也吃');
});

test('A2a1-5 日期壞掉（new Date("abc") ⇒ NaN）→ 當 epoch 0 ⇒ 永遠過期 —— 釘住現況', () => {
    assert.equal(eventTimeMs('abc'), 0);
    assert.equal(eventTimeMs(undefined), 0);
    assert.equal(eventTimeMs(''), 0);
    assert.equal(isEventExpired('abc', NOW), true);
    assert.equal(isEventExpired('abc', 1), true, 'now 只要 > 0 就算過期');
    // 反面：合法字串不會被當 0
    assert.equal(eventTimeMs(iso(0)), NOW);
});

test('A2a1-6 整串排序：full 未過期 → recruiting 未過期 → 其餘；組內升／降序', () => {
    const events = [
        { id: 'r+5h', status: 'recruiting', date: iso(+5 * HOUR) },
        { id: 'x-2h', status: 'full', date: iso(-2 * HOUR) },        // 過期的 full → 3
        { id: 'f+3h', status: 'full', date: iso(+3 * HOUR) },
        { id: 'c+1h', status: 'cancelled', date: iso(+1 * HOUR) },   // 未過期但取消 → 3
        { id: 'r+1h', status: 'recruiting', date: iso(+1 * HOUR) },
        { id: 'k-1d', status: 'closed', date: iso(-24 * HOUR) },
        { id: 'f+8h', status: 'full', date: iso(+8 * HOUR) },
        { id: 'r-1h', status: 'recruiting', date: iso(-1 * HOUR) },  // 過期的 recruiting → 3
    ];
    const got = sortMyGames(events, NOW).map(e => e.id);
    assert.deepEqual(got, [
        'f+3h', 'f+8h',             // priority 1，升序
        'r+1h', 'r+5h',             // priority 2，升序
        'c+1h', 'r-1h', 'x-2h', 'k-1d', // priority 3，時間降序（最近的在上）
    ]);
});

test('A2a1-7 壞日期的局排在整串最底（比最舊的已結束局還下面）', () => {
    const events = [
        { id: 'bad', status: 'recruiting', date: 'not-a-date' },
        { id: 'old', status: 'closed', date: iso(-365 * 24 * HOUR) },
        { id: 'live', status: 'recruiting', date: iso(+1 * HOUR) },
    ];
    assert.deepEqual(sortMyGames(events, NOW).map(e => e.id), ['live', 'old', 'bad']);
});

test('A2a1-8 不動輸入陣列，回傳新陣列', () => {
    const events = [
        { id: 'b', status: 'recruiting', date: iso(+2 * HOUR) },
        { id: 'a', status: 'recruiting', date: iso(+1 * HOUR) },
    ];
    const snapshot = events.map(e => e.id);
    const out = sortMyGames(events, NOW);
    assert.notEqual(out, events);
    assert.deepEqual(events.map(e => e.id), snapshot);
    assert.deepEqual(out.map(e => e.id), ['a', 'b']);
});

test('A2a1-9 now 是參數：同一批輸入，把 now 往後撥就換排法（沒有內建時鐘）', () => {
    const events = [
        { id: 'p', status: 'recruiting', date: iso(+1 * HOUR) },
        { id: 'q', status: 'full', date: iso(+2 * HOUR) },
    ];
    // now 在兩場之前：full 在上
    assert.deepEqual(sortMyGames(events, NOW).map(e => e.id), ['q', 'p']);
    // now 撥到 p 之後、q 之前：p 過期掉到 3，q 仍是 1
    assert.deepEqual(sortMyGames(events, NOW + 1.5 * HOUR).map(e => e.id), ['q', 'p']);
    // now 撥到兩場之後：全都 3，降序 ⇒ q（較晚）在上
    assert.deepEqual(sortMyGames(events, NOW + 3 * HOUR).map(e => e.id), ['q', 'p']);
    // 反向：換成 recruiting 在後，才看得出 now 真的有作用
    const flipped = [
        { id: 'p', status: 'full', date: iso(+1 * HOUR) },
        { id: 'q', status: 'recruiting', date: iso(+2 * HOUR) },
    ];
    assert.deepEqual(sortMyGames(flipped, NOW).map(e => e.id), ['p', 'q']);
    assert.deepEqual(sortMyGames(flipped, NOW + 1.5 * HOUR).map(e => e.id), ['q', 'p']);
    assert.equal(compareMyGames(flipped[0], flipped[1], NOW) < 0, true);
    assert.equal(compareMyGames(flipped[0], flipped[1], NOW + 1.5 * HOUR) > 0, true);
});
