// utils/myGamesSort.test.ts — 「我的局」排序的回歸網（[A2-a-1]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 🔴 2026-09-09 改判：§4.2 的「今天 → 本週 → 更遠」已落地（gameboy 拍板 1A/2A/3B）。
// A2a1-6/7/9 原本釘的是**舊的狀態優先級**，已重寫；A2a1-1/2/3 保留，
// 因為它們釘的 `myGameSortPriority` 現在是**沒有生產呼叫端**的舊行為紀錄。
// 🔴 固定的 NOW ＝ 台北 **2026-09-03（週四）20:00**；本週（週一起算）到 9/6 週日為止。
// 🔴 `now` 全部是固定數字，這裡沒有任何一行讀真時鐘。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    eventTimeMs,
    isEventExpired,
    myGameSortPriority,
    compareMyGames,
    sortMyGames,
    taipeiDayStart,
    taipeiWeekEnd,
    myGameTimeBucket,
    BUCKET_ONGOING,
    BUCKET_TODAY,
    BUCKET_THIS_WEEK,
    BUCKET_LATER,
    BUCKET_DONE,
    WEEK_STARTS_ON,
} from './myGamesSort.ts';

/** 固定的「現在」：2026-09-03T12:00:00Z */
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const DAY = 86_400_000;

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

test('A2a1-6 整串排序：進行中 → 今天 → 本週 → 更遠 → 已結束（改判後）', () => {
    const events = [
        { id: 'later',   status: 'recruiting', date: iso(+4 * DAY) },   // 下週一 → LATER
        { id: 'done',    status: 'closed',     date: iso(-1 * HOUR) },
        { id: 'week-sun',status: 'full',       date: iso(+3 * DAY) },   // 週日 → THIS_WEEK
        { id: 'today',   status: 'recruiting', date: iso(+2 * HOUR) },  // 今天 22:00
        { id: 'ongoing', status: 'recruiting', date: iso(-2 * HOUR) },  // 今天 18:00，已開始
        { id: 'week-fri',status: 'recruiting', date: iso(+1 * DAY) },   // 週五 → THIS_WEEK
        { id: 'yesterday', status: 'recruiting', date: iso(-1 * DAY) }, // 昨天 → DONE
    ];
    assert.deepEqual(sortMyGames(events, NOW).map(e => e.id), [
        'ongoing',
        'today',
        'week-fri', 'week-sun',   // 本週內升序
        'later',
        'done', 'yesterday',      // 已結束桶降序（最近的在上）
    ]);
});

test('A2a1-6b 🔴 改判的核心：時間贏過狀態 —— 今天的 recruiting 排在下週的 full 前面', () => {
    // 舊行為是 full(1) 永遠贏 recruiting(2)。這一條就是那個行為**刻意消失**的證據。
    const events = [
        { id: 'full-next-week',  status: 'full',       date: iso(+4 * DAY) },
        { id: 'recruit-today',   status: 'recruiting', date: iso(+2 * HOUR) },
    ];
    assert.deepEqual(sortMyGames(events, NOW).map(e => e.id), ['recruit-today', 'full-next-week']);
    // 反控：同一個桶裡，狀態不再有任何影響，純比時間
    const sameBucket = [
        { id: 'full-late',    status: 'full',       date: iso(+5 * HOUR) },
        { id: 'recruit-soon', status: 'recruiting', date: iso(+2 * HOUR) },
    ];
    assert.deepEqual(sortMyGames(sameBucket, NOW).map(e => e.id), ['recruit-soon', 'full-late']);
});

test('A2a1-6c 分桶本身（Q3=B：今天已開始且未收掉 → 最上面）', () => {
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: iso(-2 * HOUR) }, NOW), BUCKET_ONGOING);
    assert.equal(myGameTimeBucket({ status: 'full',       date: iso(-2 * HOUR) }, NOW), BUCKET_ONGOING);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: iso(+2 * HOUR) }, NOW), BUCKET_TODAY);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: iso(+1 * DAY) },  NOW), BUCKET_THIS_WEEK);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: iso(+4 * DAY) },  NOW), BUCKET_LATER);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: iso(-1 * DAY) },  NOW), BUCKET_DONE);
    // 收掉的局不論時間一律沉底 —— 包含「今天已開始」的
    assert.equal(myGameTimeBucket({ status: 'cancelled', date: iso(-2 * HOUR) }, NOW), BUCKET_DONE);
    assert.equal(myGameTimeBucket({ status: 'closed',    date: iso(-2 * HOUR) }, NOW), BUCKET_DONE);
    assert.equal(myGameTimeBucket({ status: 'cancelled', date: iso(+2 * HOUR) }, NOW), BUCKET_DONE);
});

test('A2a1-6d 台北日界與週界（Q1=A 固定 +8、Q2=A 週一起算）', () => {
    // NOW 是台北 9/3(四) 20:00 ⇒ 今天從 9/3 00:00 台北 ＝ 9/2 16:00Z 起算
    assert.equal(new Date(taipeiDayStart(NOW)).toISOString(), '2026-09-02T16:00:00.000Z');
    // 本週到 9/6(日) 結束 ⇒ 開區間右端是 9/7(一) 00:00 台北 ＝ 9/6 16:00Z
    assert.equal(new Date(taipeiWeekEnd(NOW)).toISOString(), '2026-09-06T16:00:00.000Z');
    assert.equal(WEEK_STARTS_ON, 1, '週一起算 —— 這是選項 2A「到本週日」的字面');

    // 邊界：右端是開的
    const end = taipeiWeekEnd(NOW);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: new Date(end - 1).toISOString() }, NOW), BUCKET_THIS_WEEK);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: new Date(end).toISOString() }, NOW), BUCKET_LATER);

    // 邊界：今天的最後一毫秒仍是今天
    const tomorrow = taipeiDayStart(NOW) + DAY;
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: new Date(tomorrow - 1).toISOString() }, NOW), BUCKET_TODAY);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: new Date(tomorrow).toISOString() }, NOW), BUCKET_THIS_WEEK);

    // 邊界：剛好等於 now ⇒ 算「已開始」
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: iso(0) }, NOW), BUCKET_ONGOING);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: iso(1) }, NOW), BUCKET_TODAY);

    // 反控：日界不是 UTC 午夜 —— 台北 00:30 那一刻，UTC 還是前一天
    const taipeiEarly = Date.UTC(2026, 8, 3, 16, 30); // 9/4 00:30 台北
    assert.equal(new Date(taipeiDayStart(taipeiEarly)).toISOString(), '2026-09-03T16:00:00.000Z');
});

test('A2a1-6e ONGOING 桶內是**降序**：最近開始的在最上面（突變 M4 補的尺）', () => {
    // 🔴 這條是突變測試逼出來的：改判當下「ONGOING 降序」只寫在註解裡，
    //    而 A2a1-6 的整串排序裡**只有一場**進行中的局 ⇒ 桶內排序結構上求值不到，
    //    把它改成升序四條測試全綠。有主張就要有尺。
    const events = [
        { id: 'started-5h', status: 'recruiting', date: iso(-5 * HOUR) },
        { id: 'started-1h', status: 'recruiting', date: iso(-1 * HOUR) },
        { id: 'started-3h', status: 'full',       date: iso(-3 * HOUR) },
    ];
    assert.deepEqual(sortMyGames(events, NOW).map(e => e.id),
        ['started-1h', 'started-3h', 'started-5h'],
        '最近開始的最可能是「人現在就在那張桌子上」的那一局');
    // 反控：DONE 桶也是降序，但 TODAY／THIS_WEEK 是升序 —— 三者不可以同向
    const upcoming = [
        { id: 'later',  status: 'recruiting', date: iso(+5 * HOUR) },
        { id: 'sooner', status: 'recruiting', date: iso(+1 * HOUR) },
    ];
    assert.deepEqual(sortMyGames(upcoming, NOW).map(e => e.id), ['sooner', 'later'], '未開始的是升序');
});

test('A2a1-7 壞日期的局排在整串最底（epoch 0 ⇒ 遠在今天之前 ⇒ DONE 桶最舊的一端）', () => {
    const events = [
        { id: 'bad', status: 'recruiting', date: 'not-a-date' },
        { id: 'old', status: 'closed', date: iso(-365 * DAY) },
        { id: 'live', status: 'recruiting', date: iso(+1 * HOUR) },
    ];
    assert.deepEqual(sortMyGames(events, NOW).map(e => e.id), ['live', 'old', 'bad']);
    assert.equal(myGameTimeBucket({ status: 'recruiting', date: 'not-a-date' }, NOW), BUCKET_DONE);
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

test('A2a1-9 now 是參數：把 now 往後撥就換桶（沒有內建時鐘）', () => {
    const ev = { id: 'p', status: 'recruiting', date: iso(+2 * HOUR) };
    assert.equal(myGameTimeBucket(ev, NOW), BUCKET_TODAY, 'now 在它之前 ⇒ 今天未開始');
    assert.equal(myGameTimeBucket(ev, NOW + 3 * HOUR), BUCKET_ONGOING, 'now 撥過它 ⇒ 進行中');
    assert.equal(myGameTimeBucket(ev, NOW + 2 * DAY), BUCKET_DONE, 'now 撥到隔天之後 ⇒ 沉底');
    // 整串排序也要跟著換
    const events = [ev, { id: 'q', status: 'recruiting', date: iso(+5 * HOUR) }];
    assert.deepEqual(sortMyGames(events, NOW).map(e => e.id), ['p', 'q'], '都在今天，升序');
    assert.deepEqual(sortMyGames(events, NOW + 3 * HOUR).map(e => e.id), ['p', 'q'], 'p 進行中在最上');
    assert.equal(compareMyGames(ev, events[1], NOW) < 0, true);
});
