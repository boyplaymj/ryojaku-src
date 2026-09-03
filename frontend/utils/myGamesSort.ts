// utils/myGamesSort.ts — 「我的局」清單排序（[A2-a-1]）
//
// 🔴 為什麼抽出來：pages/MyEvents.tsx 與 components/MyGamesSection.tsx 各有一份
//    **逐字相同**的排序邏輯（diff 過，只差三行註解）。兩個來源會各自漂，而漂了之後
//    畫面上跟「已經統一」長得一樣。這裡零 React 相依，utils/myGamesSort.test.ts 釘它。
//
// 🔴 這是純抽取：行為與 2026-09-03 之前兩份元件裡的完全相同，包括
//    「日期字串壞掉 ⇒ 當成 epoch 0 ⇒ 永遠算過期、排在最底」這一條（見 eventTimeMs）。
//    要改行為先來改這裡並改測試，不要在元件裡再抄一份。
//
// 🔴 `now` 一律由呼叫端傳入，這裡不呼叫 Date.now()／new Date() ——
//    否則測試會變成「寫死日期＋真時鐘」的定時炸彈。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §4.2
//      （那裡寫的「今天 → 本週 → 更遠」是目標，本檔釘的是**現況**；改判是 [A2] 後續的事）。

export interface MyGameSortable {
    /** 局的狀態："recruiting" | "full" | "closed" | "cancelled"（types.ts 的 GroupEvent.status） */
    status?: string;
    /** 開局時間，ISO 字串（GroupEvent.date）。壞掉的值見 eventTimeMs。 */
    date?: unknown;
}

/**
 * 開局時間 → epoch 毫秒。
 * 🔴 解析失敗（`new Date('abc')` ⇒ NaN）回 **0**，不回 NaN 也不丟錯 ——
 *    這是現況行為：壞日期的局會被當成 1970 年 ⇒ 必定「過期」⇒ 排到最底。
 *    保留它是因為它決定了壞資料排哪裡；改成別的就不是純抽取了。
 */
export function eventTimeMs(dateLike: unknown): number {
    const t = new Date(dateLike as string | number | Date).getTime();
    return isNaN(t) ? 0 : t;
}

/** 開局時間 **嚴格早於** now 才算過期（同一毫秒不算）。 */
export function isEventExpired(dateLike: unknown, now: number): boolean {
    return eventTimeMs(dateLike) < now;
}

/**
 * 排序優先級，越小越上面。
 *   cancelled / closed / 已過期 → 3（最下面）
 *   full（未過期）             → 1（最上面）
 *   recruiting（未過期）       → 2（中間）
 *   其他 / 認不得 / undefined  → 3
 * ⚠️ isExpired 的檢查在 status 之前 ⇒ 過期的 full／recruiting 一律 3。
 */
export function myGameSortPriority(event: { status?: string }, isExpired: boolean): number {
    if (event.status === 'cancelled' || event.status === 'closed' || isExpired) return 3;
    if (event.status === 'full') return 1;
    if (event.status === 'recruiting') return 2;
    return 3;
}

/**
 * comparator。同優先級時：
 *   priority 3（已結束／取消／過期）→ 時間**降序**（最近結束的在上）
 *   其他                          → 時間**升序**（最快開的在上）
 */
export function compareMyGames(a: MyGameSortable, b: MyGameSortable, now: number): number {
    const timeA = eventTimeMs(a.date);
    const timeB = eventTimeMs(b.date);
    const priorityA = myGameSortPriority(a, timeA < now);
    const priorityB = myGameSortPriority(b, timeB < now);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return priorityA === 3 ? timeB - timeA : timeA - timeB;
}

/** 回傳**新陣列**，不動輸入。 */
export function sortMyGames<T extends MyGameSortable>(events: readonly T[], now: number): T[] {
    return [...events].sort((a, b) => compareMyGames(a, b, now));
}
