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

test('A2b1-17 🔴 React 真正的重註冊序列是 remove→set，會爬到 modal 上面', () => {
    // 🔴 這條 2026-09-03 改寫過，原因記在這裡當例子。
    //    原版寫成 set(kPage,page1) → set(kModal,modal) → **set(kPage,page2)**，
    //    據此宣稱「重註冊的頁面不可搶走 modal 的位置」。那句話對 stack.set() 成立，
    //    對 hook **不成立**：React 在 effect deps 變動時是先跑 cleanup 再跑 effect
    //    ⇒ 真正的序列是 remove(kPage) → set(kPage, page2) ⇒ 推到最上面。
    //    原版模擬的那個轉移，元件端**永遠不會執行** ⇒ 那條測試對真實缺陷零鑑別力。
    //    （我先發現、Codex 覆驗評 Medium，兩邊獨立。）
    // ⇒ 這裡改成釘住**真的會發生的事**，而不是我希望發生的事。
    const s = createRefreshHandlerStack<() => Promise<void>>();
    const kPage = {}, kModal = {};
    const page1 = h('page1'), page2 = h('page2'), modal = h('modal');
    s.set(kPage, page1);
    s.set(kModal, modal);
    // React 的 cleanup → effect：
    s.remove(kPage);
    s.set(kPage, page2);
    assert.equal(s.current(), page2, '這就是為什麼 hook 的 deps 不可以放 handler');
    assert.equal(s.size(), 2);
});

test('A2b1-19 🔴 usePullToRefresh 的 effect deps 不可以含 handler', async () => {
    // 這是「沒有 React 測試設備」之下唯一擋得住 A2b1-17 那個缺陷的東西：掃原始碼。
    // ⚠️ 它的盲區很明確：**認的是一種寫法，不是一份語意**。有人把 hook 重構成
    //    別的形狀（換行、改用 useMemo、把 deps 抽成變數）它就掃不到 ——
    //    所以下面第一條是正控：撈不到 deps 陣列時要**當場紅**，
    //    不可以讓「撈不到」跟「撈到而且乾淨」長成同一個結果。
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
        fileURLToPath(new URL('../contexts/RefreshContext.tsx', import.meta.url)),
        'utf8',
    );

    const m = /registerRefreshHandler\(key,[\s\S]*?\}, \[([^\]]*)\]\);/.exec(src);
    assert.ok(m, '🔴 正控：在 RefreshContext.tsx 裡找不到 usePullToRefresh 的 effect deps 陣列 —— 這把尺壞了，不是程式碼乾淨');

    const deps = m[1].split(',').map(d => d.trim()).filter(Boolean);
    assert.ok(deps.length > 0, '🔴 正控：deps 陣列撈到了但是空的，形狀跟預期不同');
    assert.ok(
        !deps.includes('handler'),
        `deps 裡出現了 handler（${deps.join(', ')}）—— 那會讓頁面每次重渲染都爬到自己開的 modal 上面，見 A2b1-17`,
    );
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
