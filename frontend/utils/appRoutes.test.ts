// utils/appRoutes.test.ts — 一級路由與「畫不畫殼」判準的回歸網（[A2-b-1]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_ROUTES, MAIN_NAV_ROUTES, hasMainNavShell } from './appRoutes.ts';
import { BOTTOM_NAV_ITEMS } from './bottomNavItems.ts';

test('A2b1-9 `/` 是揪咖、/feed 是動態牆、/matchmaking 保留', () => {
    assert.equal(APP_ROUTES.matchmaking, '/');
    assert.equal(APP_ROUTES.feed, '/feed');
    assert.equal(APP_ROUTES.matchmakingLegacy, '/matchmaking');
});

test('A2b1-10 /feed 有殼（陷阱 2：新路由忘了進白名單就是裸內容）', () => {
    assert.equal(hasMainNavShell('/feed'), true);
    assert.ok(MAIN_NAV_ROUTES.includes('/feed'));
});

test('A2b1-11 底欄每一格 path 都有殼（沒殼＝點過去底欄自己消失）', () => {
    for (const it of BOTTOM_NAV_ITEMS) assert.equal(hasMainNavShell(it.path), true, it.path);
});

test('A2b1-12 原本白名單的八條一條不少', () => {
    for (const p of ['/', '/search', '/matchmaking', '/messages', '/profile', '/create', '/notifications', '/ledger']) {
        assert.equal(hasMainNavShell(p), true, p);
    }
});

test('A2b1-13 前綴路由照舊；不相干的路徑沒殼', () => {
    // [A3-p] `/edit-group/:id` 也是前綴路由。少了它那一頁是**沒殼的裸內容**，
    //        而且不報任何錯（本檔開頭的「陷阱 2」）。
    for (const p of ['/rate-game/abc', '/reviews/u1', '/event/e1', '/ledger?x=1', '/ledger/', '/edit-group/g1']) {
        assert.equal(hasMainNavShell(p), true, p);
    }
    // 反控：`/edit-group` 少了尾斜線就不是那條前綴（它是帶 :id 的頁，裸的那個不存在）
    for (const p of ['/chat/r1', '/post/p1', '/rate-user', '/training/voice-tai', '/feed/', '/FEED', '/nope', '/edit-group']) {
        assert.equal(hasMainNavShell(p), false, p);
    }
});

test('A2b1-14 判準吃 pathname 不吃 query：?tab=find 的 pathname 是 /', () => {
    // 這條是文件化行為：呼叫端要傳 location.pathname，不是整條 URL。
    const url = new URL('https://x/#/?tab=find');
    const hashPath = url.hash.slice(1).split('?')[0];
    assert.equal(hashPath, '/');
    assert.equal(hasMainNavShell(hashPath), true);
});
