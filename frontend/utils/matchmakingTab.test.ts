// utils/matchmakingTab.test.ts — 揪咖頁 tab 解析的回歸網（[A2-a-2]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    MATCHMAKING_TABS,
    DEFAULT_MATCHMAKING_TAB,
    MATCHMAKING_TAB_NAV_OPTIONS,
    MATCHMAKING_TAB_PARAM,
    buildMatchmakingTabParams,
    isMatchmakingTab,
    parseMatchmakingTab,
    matchmakingTabLabel,
} from './matchmakingTab.ts';

test('A2a2-1 兩個合法值原樣回來', () => {
    assert.equal(parseMatchmakingTab('mine'), 'mine');
    assert.equal(parseMatchmakingTab('find'), 'find');
    assert.equal(isMatchmakingTab('mine'), true);
    assert.equal(isMatchmakingTab('find'), true);
});

test('A2a2-2 預設是「我的局」（§4.1 它排第一），沒帶參數就是它', () => {
    assert.equal(DEFAULT_MATCHMAKING_TAB, 'mine');
    assert.equal(parseMatchmakingTab(null), 'mine');      // searchParams.get() 沒有時回 null
    assert.equal(parseMatchmakingTab(undefined), 'mine');
    assert.equal(parseMatchmakingTab(''), 'mine');
});

test('A2a2-3 認不得的值 → 預設（fail-safe），且不做大小寫／空白寬鬆比對', () => {
    for (const bad of ['MINE', ' mine', 'mine ', 'Find', 'search', 'ledger', 'xyz', '0']) {
        assert.equal(parseMatchmakingTab(bad), 'mine', JSON.stringify(bad));
        assert.equal(isMatchmakingTab(bad), false, JSON.stringify(bad));
    }
    assert.equal(parseMatchmakingTab(1), 'mine', '非字串');
    assert.equal(parseMatchmakingTab({}), 'mine', '非字串');
});

test('A2a2-4 現在沒有「地圖」tab —— 等 [C1] 止血後才加（§9 圖磚計費）', () => {
    // 這條紅了代表有人加了 map：那要先確認 [C1] 已上，不是把這條改掉。
    assert.deepEqual([...MATCHMAKING_TABS], ['mine', 'find']);
    assert.equal(isMatchmakingTab('map'), false);
    assert.equal(parseMatchmakingTab('map'), 'mine');
});

test('A2a2-5 每個 tab 都有中文標籤，且參數名是 tab', () => {
    assert.equal(matchmakingTabLabel('mine'), '我的局');
    assert.equal(matchmakingTabLabel('find'), '找場次');
    for (const t of MATCHMAKING_TABS) assert.ok(matchmakingTabLabel(t).length > 0, t);
    assert.equal(MATCHMAKING_TAB_PARAM, 'tab');
});

// ---- [A2-b-2] 切 tab 不再堆 history ----

test('A2b2-1 切 tab 會把 tab 參數設成新的值', () => {
    const next = buildMatchmakingTabParams(new URLSearchParams(''), 'find');
    assert.equal(next.get(MATCHMAKING_TAB_PARAM), 'find');
    assert.equal(buildMatchmakingTabParams(new URLSearchParams('tab=find'), 'mine').get('tab'), 'mine');
});

test('A2b2-2 其他參數要留著 —— 整包換掉會安靜吃掉別人的 query', () => {
    // 這條是本函式存在的理由：寫成 new URLSearchParams() 重開一份的話，
    // 畫面上切 tab 完全正常，被吃掉的是別人（例如 SearchContent 之後的篩選條件）。
    const next = buildMatchmakingTabParams(new URLSearchParams('tab=mine&kw=%E5%8F%B0%E5%8C%97&sort=near'), 'find');
    assert.equal(next.get('kw'), '台北');
    assert.equal(next.get('sort'), 'near');
    assert.equal(next.get('tab'), 'find');
});

test('A2b2-3 不動到傳進來的那一份（React 的 prev 不可以被就地改）', () => {
    const prev = new URLSearchParams('tab=mine&kw=x');
    const next = buildMatchmakingTabParams(prev, 'find');
    assert.equal(prev.get('tab'), 'mine', '原本那份被改到了');
    assert.notEqual(next, prev, '回傳的必須是新物件');
});

test('A2b2-4 是覆寫不是追加（append 的話會變成 tab=mine&tab=find）', () => {
    const next = buildMatchmakingTabParams(new URLSearchParams('tab=mine'), 'find');
    assert.deepEqual(next.getAll(MATCHMAKING_TAB_PARAM), ['find']);
});

test('A2b2-5 切 tab 用 replace，不新增 history', () => {
    // ⚠️ 誠實界線：這一條釘的是**常數的值**，不是「瀏覽器真的沒有多一筆」——
    //    後者要有 DOM／瀏覽器才量得到，本專案的測試層沒有。真正的接線由 A2b2-6 顧。
    assert.equal(MATCHMAKING_TAB_NAV_OPTIONS.replace, true);
});

test('A2b2-6 頁面真的把那個選項傳給 setSearchParams（接線，不是宣稱）', () => {
    // 🔴 為什麼要掃原始碼：常數設成 replace:true 而呼叫端忘了帶第二個參數時，
    //    型別、build、上面五條測試全部照樣綠 —— 「設定好了」與「接上了」在那些尺上逐字相同。
    const src = readFileSync(new URL('../pages/Matchmaking.tsx', import.meta.url), 'utf8');
    const calls = src.split('\n').filter(line => line.includes('setSearchParams('));
    assert.ok(calls.length > 0, '揪咖頁一次都沒呼叫 setSearchParams —— 尺壞了或 tab 改用別的機制');
    for (const line of calls) {
        assert.ok(
            line.includes('MATCHMAKING_TAB_NAV_OPTIONS'),
            `這一行沒帶 replace 選項，切 tab 會多堆一筆 history：${line.trim()}`
        );
    }
});
