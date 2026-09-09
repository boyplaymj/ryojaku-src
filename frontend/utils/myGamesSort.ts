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
// 🔴 2026-09-09 改判：§4.2 的「今天 → 本週 → 更遠」已落地（gameboy 拍板 1A / 2A / 3B）。
//    本檔不再是「釘現況」—— 舊的三桶（full → recruiting → 其他）是**依狀態**排，
//    新的是**依時間遠近**排 ⇒ 「滿員排在招募中前面」這個行為**刻意消失了**。
//    今天的招募中會贏過下週的滿員，因為卡片是拿來看「接下來要幹嘛」的。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §4.2。

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

// ─────────────────────────────────────────────────────────────────────────────
// [A2 排序改判] 時間分桶。gameboy 2026-09-09 拍板：Q1=A、Q2=A、Q3=B。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 Q1=A：時區**固定台北**，不跟裝置走。
 *
 * 用固定位移而不是 `Intl.DateTimeFormat`，因為 **台灣自 1980 年起固定 UTC+8、沒有
 * 日光節約時間** ⇒ 固定位移在這個時區是**精確**的，不是近似。
 * 好處是邊界可測、不依賴執行環境的 ICU 時區資料。
 * ⚠️ **這是本檔唯一靠「外部事實」成立的假設**，寫在這裡是為了讓它可以被質疑：
 *    如果台灣哪天恢復日光節約時間，這一行就要換成 Intl。
 */
export const TAIPEI_UTC_OFFSET_MS = 8 * 3_600_000;

/**
 * 🔴 Q2=A：**日曆週**，而「本週」到**本週日**為止 ⇒ 一週從**星期一**開始。
 *
 * 「星期一開始」是選項 A 字面（「今天之後到本週日」）的直接後果，不是我另外挑的。
 * 要改成星期日開始，只要把這個常數改成 0 —— 刻意做成一個常數就是為了這件事。
 * （0=星期日、1=星期一，與 `Date.prototype.getUTCDay()` 同一套編號。）
 *
 * ⚠️ **已知代價（gameboy 選 A 時已被告知並接受）**：第二桶的大小隨星期幾變動 ——
 *    星期日打開時它幾乎是空的，東西全部落到「更遠」。
 *    換來的是「本週」這兩個字在文案上是**誠實**的（選 B 滾動 7 天的話標籤就得改）。
 */
export const WEEK_STARTS_ON = 1;

/** 某個時刻所屬「台北日」的起點（該日 00:00 台北）對應的 epoch 毫秒。 */
export function taipeiDayStart(ms: number): number {
    const shifted = ms + TAIPEI_UTC_OFFSET_MS;
    return Math.floor(shifted / 86_400_000) * 86_400_000 - TAIPEI_UTC_OFFSET_MS;
}

/**
 * 某個時刻所屬台北週的**結束**（下一個 `WEEK_STARTS_ON` 的 00:00 台北）。
 * 回傳的是**開區間右端**：`t < weekEnd` 才算「這一週內」。
 */
export function taipeiWeekEnd(ms: number): number {
    const dayStart = taipeiDayStart(ms);
    // getUTCDay 對「已位移成台北牆鐘」的值取星期幾。
    const dow = new Date(dayStart + TAIPEI_UTC_OFFSET_MS).getUTCDay();
    const daysIntoWeek = (dow - WEEK_STARTS_ON + 7) % 7;
    return dayStart + (7 - daysIntoWeek) * 86_400_000;
}

/** 分桶結果。數字即排序優先級，越小越上面。 */
export const BUCKET_ONGOING = 0;   // 今天已開始、還沒被標成結束／取消
export const BUCKET_TODAY = 1;     // 今天，還沒開始
export const BUCKET_THIS_WEEK = 2; // 今天之後、本週日之前
export const BUCKET_LATER = 3;     // 更遠
export const BUCKET_DONE = 4;      // 已取消／已結束／過去的日子／壞日期

/** 被視為「這局已經收掉了」的狀態。 */
const TERMINAL_STATUSES = new Set(['cancelled', 'closed']);

/**
 * 🔴 Q3=B：時間分桶 ＋「今天已開始但還沒結束」提到最上面。
 *
 * 🔴 **那個「已開始」是弱啟發式**（日期是今天且已過、狀態不是 cancelled／closed），
 *    跟 §15.3 第⑥項判定「進行中」用的是**同一個**猜法 —— 而那一項的結論是「不能做」。
 *    這裡可以做，理由是**代價不對稱**：
 *      排序猜錯 ⇒ 一張卡在錯的位置，**看得見、往下滑就找到**；
 *      閘門猜錯 ⇒ 按鈕該在沒在，**沒有任何徵兆**。
 *    ⚠️ 所以這個啟發式**不可以**被複製去做閘門。哪天系統真的有「開打／結束」狀態了，
 *      這裡也該改過去。
 */
export function myGameTimeBucket(event: MyGameSortable, now: number): number {
    if (TERMINAL_STATUSES.has(String(event.status))) return BUCKET_DONE;

    const t = eventTimeMs(event.date);
    const todayStart = taipeiDayStart(now);
    const tomorrowStart = todayStart + 86_400_000;

    if (t < todayStart) return BUCKET_DONE;          // 昨天以前（含壞日期的 epoch 0）
    if (t < tomorrowStart) {
        // 今天：已經過了開局時間 ⇒ 可能正在打
        return t <= now ? BUCKET_ONGOING : BUCKET_TODAY;
    }
    return t < taipeiWeekEnd(now) ? BUCKET_THIS_WEEK : BUCKET_LATER;
}

/**
 * @deprecated 改判前的**狀態**優先級。`compareMyGames` 已改用 `myGameTimeBucket`，
 * 這支**沒有生產呼叫端**了；留著是因為它是「舊行為長什麼樣」的唯一紀錄，
 * 而 §15.3 那段訂正會引用它。要刪的話連同 A2a1-1/2/3 一起刪。
 *
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
    const bucketA = myGameTimeBucket(a, now);
    const bucketB = myGameTimeBucket(b, now);
    if (bucketA !== bucketB) return bucketA - bucketB;
    const timeA = eventTimeMs(a.date);
    const timeB = eventTimeMs(b.date);
    // 🔴 兩個桶是**降序**，其餘升序：
    //    BUCKET_ONGOING —— 最近開始的最可能是「現在人在那張桌子上」的那一局。
    //    BUCKET_DONE    —— 最近結束的最可能還要回去記帳／評價（沿用改判前的行為）。
    const descending = bucketA === BUCKET_ONGOING || bucketA === BUCKET_DONE;
    return descending ? timeB - timeA : timeA - timeB;
}

/** 回傳**新陣列**，不動輸入。 */
export function sortMyGames<T extends MyGameSortable>(events: readonly T[], now: number): T[] {
    return [...events].sort((a, b) => compareMyGames(a, b, now));
}
