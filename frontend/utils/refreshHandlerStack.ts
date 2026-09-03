// utils/refreshHandlerStack.ts — 下拉刷新 handler 的堆疊（[A2-b-1]）
//
// 🔴 為什麼不是「單一插槽」：contexts/RefreshContext.tsx 原本只有一個 `handlerRef`。
//    頁面（Profile／Home／SearchContent／揪咖的 MyGamesSection）註冊一個，頁面上再開一個
//    modal（EventDetailModal／PostDetailModal／UserReviewsModal）它會**蓋掉**頁面那個；
//    modal 關掉時 `unregister` 看到「現在的就是我」就把插槽設成 null ——
//    **而頁面的 effect 不會重跑**（deps 沒變）⇒ 關掉 modal 之後那一頁的下拉刷新就死了，
//    直到離開再進來。這不是理論：揪咖頁「我的局」點一張卡開 EventDetailModal、關掉、下拉，
//    就是這條路；而揪咖頁是 [A2-b-1] 起的著陸頁。
//
// 🔴 堆疊用「key」定位、不用 handler 身分：hook 每個實例一把 key（useRef），handler 因為
//    useCallback deps 變了而換身分時，是**原地換**不是「移除＋推到最上面」——
//    否則底下那一頁只要重渲染就會爬到 modal 上面去搶插槽。
//
// 零 React 相依，utils/refreshHandlerStack.test.ts 釘它。
// ⚠️ 界線：這裡驗得到「堆疊的規則」，驗不到「hook 有沒有在對的時機呼叫它」——
//    後者是 React effect 的事，這個 repo 沒有 React 測試設備。

export interface RefreshHandlerStack<H> {
    /** 有這把 key 就原地換 handler（位置不變），沒有就推到最上面。 */
    set(key: object, handler: H): void;
    /** 拿掉這把 key 的那一層；不在堆疊裡就什麼都不做。 */
    remove(key: object): void;
    /** 最上面那一層的 handler；空堆疊回 null。 */
    current(): H | null;
    size(): number;
}

export function createRefreshHandlerStack<H>(): RefreshHandlerStack<H> {
    const entries: { key: object; handler: H }[] = [];
    return {
        set(key, handler) {
            const idx = entries.findIndex(e => e.key === key);
            if (idx >= 0) entries[idx] = { key, handler };
            else entries.push({ key, handler });
        },
        remove(key) {
            const idx = entries.findIndex(e => e.key === key);
            if (idx >= 0) entries.splice(idx, 1);
        },
        current() {
            return entries.length ? entries[entries.length - 1].handler : null;
        },
        size() {
            return entries.length;
        },
    };
}
