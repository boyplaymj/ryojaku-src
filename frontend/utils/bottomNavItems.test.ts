// utils/bottomNavItems.test.ts — 底部導覽名單的回歸網（[A2-b-1]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
// ⚠️ 界線：這裡釘的是**名單**（path／label／哪一格是主行動鍵／誰吃徽章）。
//    畫面層（圖示對不對、flex-1 有沒有排成五等分、亮的是不是那一格）沒有自動化證據，只能目視。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTTOM_NAV_ITEMS, validateBottomNavItems, type BottomNavItem } from './bottomNavItems.ts';
import { APP_ROUTES } from './appRoutes.ts';

// 名單是 `as const`（path 聯集給 BottomNav 的圖示表用）；測試用寬型別讀，optional 欄位才取得到。
const items: readonly BottomNavItem[] = BOTTOM_NAV_ITEMS;
const paths: string[] = items.map(it => it.path);

test('A2b1-1 五格，而且是奇數格 —— 中央主行動鍵靠的是奇數', () => {
    // 這條紅了代表有人加了第 6 格：那要連「中間是誰」一起重想，不是把 5 改成 6。
    assert.equal(BOTTOM_NAV_ITEMS.length, 5);
    assert.equal(BOTTOM_NAV_ITEMS.length % 2, 1);
});

test('A2b1-2 中央主行動鍵恰好一個，且在正中間那個 index', () => {
    const primaryIdx = items.flatMap((it, i) => (it.primary ? [i] : []));
    assert.deepEqual(primaryIdx, [Math.floor(items.length / 2)]);
    assert.equal(items[primaryIdx[0]].path, APP_ROUTES.create);
});

test('A2b1-3 path 不重複', () => {
    assert.equal(new Set(paths).size, paths.length);
});

test('A2b1-4 第一格是揪咖，而揪咖就是 `/`（§3.1：預設頁）', () => {
    // 本塊的核心事實。紅了代表有人把預設頁換回去了。
    assert.equal(APP_ROUTES.matchmaking, '/');
    assert.equal(BOTTOM_NAV_ITEMS[0].path, APP_ROUTES.matchmaking);
    assert.equal(BOTTOM_NAV_ITEMS[0].label, '揪咖');
    assert.notEqual(APP_ROUTES.feed, '/', '動態牆不再是 `/`');
});

test('A2b1-5 底欄沒有 /search（找場次已在揪咖頁裡，不留第二個入口），但路由常數仍在', () => {
    assert.equal(paths.includes(APP_ROUTES.search), false);
    assert.equal(paths.includes('/search'), false);
    assert.equal(APP_ROUTES.search, '/search', '路由保留給書籤／舊連結');
});

test('A2b1-6 吃未讀徽章的恰好是 /messages', () => {
    const badged = items.filter(it => it.unreadBadge).map(it => it.path);
    assert.deepEqual(badged, [APP_ROUTES.messages]);
});

test('A2b1-7 帳本暫佔天梯那一格（第 2 格），我的在最後', () => {
    // 天梯 §6 做好時這條會紅：那是預期的，改這裡的期望值＋名單即可。
    assert.equal(BOTTOM_NAV_ITEMS[1].path, APP_ROUTES.ledger);
    assert.equal(BOTTOM_NAV_ITEMS[4].path, APP_ROUTES.profile);
    for (const it of items) assert.ok(it.label.length > 0, it.path);
});

test('A2b1-8 validateBottomNavItems 對壞名單真的會叫（反控：現況名單是空清單）', () => {
    assert.deepEqual(validateBottomNavItems(BOTTOM_NAV_ITEMS), []);
    const p = (path: string, extra: Partial<BottomNavItem> = {}): BottomNavItem => ({ path, label: path, ...extra });
    // 偶數格
    assert.ok(validateBottomNavItems([p('/a'), p('/b', { primary: true }), p('/c'), p('/d')]).length > 0);
    // 主行動鍵不在正中間
    assert.ok(validateBottomNavItems([p('/a', { primary: true }), p('/b'), p('/c')]).length > 0);
    // 兩個主行動鍵
    assert.ok(validateBottomNavItems([p('/a', { primary: true }), p('/b', { primary: true }), p('/c')]).length > 0);
    // 沒有主行動鍵
    assert.ok(validateBottomNavItems([p('/a'), p('/b'), p('/c')]).length > 0);
    // path 重複
    assert.ok(validateBottomNavItems([p('/a'), p('/b', { primary: true }), p('/a')]).length > 0);
    // 正控：合法的三格
    assert.deepEqual(validateBottomNavItems([p('/a'), p('/b', { primary: true }), p('/c')]), []);
});
