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
