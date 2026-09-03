// utils/matchmakingTab.test.ts — 揪咖頁 tab 解析的回歸網（[A2-a-2]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MATCHMAKING_TABS,
    DEFAULT_MATCHMAKING_TAB,
    MATCHMAKING_TAB_PARAM,
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
