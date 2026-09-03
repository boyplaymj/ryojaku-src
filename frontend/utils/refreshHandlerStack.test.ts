// utils/refreshHandlerStack.test.ts — 下拉刷新 handler 堆疊的回歸網（[A2-b-1]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
// ⚠️ 界線：驗的是堆疊規則。「hook 在 enabled=false 時不註冊」「effect 什麼時候跑」
//    是 React 的事，這裡碰不到。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshHandlerStack } from './refreshHandlerStack.ts';

const h = (name: string) => async () => { void name; };

test('A2b1-15 空堆疊 current 是 null；註冊一個就是它', () => {
    const s = createRefreshHandlerStack<() => Promise<void>>();
    assert.equal(s.current(), null);
    const k = {};
    const page = h('page');
    s.set(k, page);
    assert.equal(s.current(), page);
    assert.equal(s.size(), 1);
});

test('A2b1-16 🔴 modal 蓋在頁面上、關掉後頁面的 handler 回來（舊插槽這裡會變 null）', () => {
    const s = createRefreshHandlerStack<() => Promise<void>>();
    const kPage = {}, kModal = {};
    const page = h('page'), modal = h('modal');
    s.set(kPage, page);
    s.set(kModal, modal);
    assert.equal(s.current(), modal, 'modal 開著時是 modal 的');
    s.remove(kModal);
    assert.equal(s.current(), page, '關掉 modal 後要回到頁面的，不是 null');
});

test('A2b1-17 同一把 key 換 handler 是原地換，不會爬到 modal 上面', () => {
    const s = createRefreshHandlerStack<() => Promise<void>>();
    const kPage = {}, kModal = {};
    const page1 = h('page1'), page2 = h('page2'), modal = h('modal');
    s.set(kPage, page1);
    s.set(kModal, modal);
    s.set(kPage, page2); // 頁面因為 useCallback deps 變了而重註冊
    assert.equal(s.current(), modal, '重註冊的頁面不可搶走 modal 的位置');
    assert.equal(s.size(), 2);
    s.remove(kModal);
    assert.equal(s.current(), page2, '關掉 modal 後拿到的是新的那個 handler');
});

test('A2b1-18 移除不在堆疊裡的 key 是 no-op；移除中間層不影響最上層', () => {
    const s = createRefreshHandlerStack<() => Promise<void>>();
    const kA = {}, kB = {}, kC = {};
    const a = h('a'), b = h('b'), c = h('c');
    s.set(kA, a); s.set(kB, b); s.set(kC, c);
    s.remove({});
    assert.equal(s.size(), 3);
    s.remove(kB);
    assert.equal(s.current(), c);
    s.remove(kC);
    assert.equal(s.current(), a);
    s.remove(kA);
    assert.equal(s.current(), null);
});
