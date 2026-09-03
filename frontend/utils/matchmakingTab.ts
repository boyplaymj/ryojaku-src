// utils/matchmakingTab.ts — 揪咖頁（pages/Matchmaking.tsx）tab 的名稱與網址解析（[A2-a-2]）
//
// 🔴 為什麼抽出來：tab 記在網址 `?tab=`，而網址是任何人都能打的輸入。
//    解析寫在 JSX 裡沒有東西接得住；這裡零 React 相依，utils/matchmakingTab.test.ts 釘它。
//    [A2-b] 底部導覽要指定 tab 時也吃這一份，不要再寫第二份字串。
//
// 🔴 只有兩個 tab。正典 §4.1 是三個（我的局／找場次／地圖），**地圖刻意不在名單裡**：
//    §9 實查 MapPicker 的圖磚來自 Amazon Location Service、按取得的圖磚數計費 ——
//    每拖一次地圖就在花錢。把它放進預設頁等於把最貴的東西放到每個人一開 App 就看到的位置。
//    等 [C1]（maxBounds／maxZoom／cluster）止血後再加；加的時候是**改這裡的名單**，
//    不是在頁面裡多塞一顆按鈕。A2a2-4 釘住「現在沒有 map」。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §4.1、§9。

export const MATCHMAKING_TABS = ['mine', 'find'] as const;
export type MatchmakingTab = (typeof MATCHMAKING_TABS)[number];

/** 預設是「我的局」——§4.1 它排第一。 */
export const DEFAULT_MATCHMAKING_TAB: MatchmakingTab = 'mine';

/** 網址上的參數名：`#/matchmaking?tab=find` */
export const MATCHMAKING_TAB_PARAM = 'tab';

const LABELS: Record<MatchmakingTab, string> = {
    mine: '我的局',
    find: '找場次',
};

export function isMatchmakingTab(value: unknown): value is MatchmakingTab {
    return typeof value === 'string' && (MATCHMAKING_TABS as readonly string[]).includes(value);
}

/**
 * 把 `searchParams.get('tab')` 的結果（可能是 null／亂打的字）收斂成一個合法 tab。
 * fail-safe：認不得的一律回預設，不丟錯、不留空 —— 亂打網址最多只是回到「我的局」。
 * ⚠️ 刻意**不**做 trim／lowercase：`MINE` 不等於 `mine`。寬鬆比對只會讓
 *    「哪些字串算合法」變成沒寫下來的第二份規則。
 */
export function parseMatchmakingTab(raw: unknown): MatchmakingTab {
    return isMatchmakingTab(raw) ? raw : DEFAULT_MATCHMAKING_TAB;
}

export function matchmakingTabLabel(tab: MatchmakingTab): string {
    return LABELS[tab];
}

/**
 * 切 tab 時給 `setSearchParams` 的第二個參數。
 *
 * 🔴 `replace: true` 是 [A2-b-2] 的訂正。[A2-a-2] 原本用預設的 push，理由寫成
 *    「返回鍵才會退回上一個 tab」—— 那句在揪咖還是二級頁（`/matchmaking`）時說得通，
 *    但 [A2-b-1] 把它變成著陸頁（`/`）之後就反了：來回點兩個 tab 五次就在 history 疊十筆，
 *    使用者要按十次返回鍵才離得開 App，而且每一次都只是在原地換 tab。
 *    切 tab 是**同一頁的視圖切換**，不是換頁 ⇒ 取代目前這筆，不新增。
 * ⚠️ 這不影響「從底欄或外部連結帶著 `?tab=` 進來」——那是 navigate()／開新網址，本來就是 push。
 */
export const MATCHMAKING_TAB_NAV_OPTIONS = { replace: true } as const;

/**
 * 算出「切到 `tab`」之後網址該有的 query。
 *
 * 🔴 以現有的 query 為底再 set，不是重開一份：這一頁的網址參數不只有 `tab`
 *    （SearchContent 之後會有自己的），整包換掉會安靜地吃掉別人的參數，
 *    而畫面上跟正常切 tab 逐格相同。抽出來是為了讓這件事有測試釘得住 ——
 *    寫在 JSX 裡的時候沒有任何東西碰得到它。
 */
export function buildMatchmakingTabParams(prev: URLSearchParams, tab: MatchmakingTab): URLSearchParams {
    const next = new URLSearchParams(prev);
    next.set(MATCHMAKING_TAB_PARAM, tab);
    return next;
}
