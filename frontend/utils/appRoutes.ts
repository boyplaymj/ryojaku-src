// utils/appRoutes.ts — 一級路由的路徑常數與「畫不畫殼」的判準（[A2-b-1]）
//
// 🔴 為什麼抽出來：`/` 指向哪一頁是本輪改版的核心事實（§3.1：揪咖是預設頁），
//    但它原本只活在 App.tsx 的 JSX 裡（`<Route path="/" element={<HomeRoute/>}>`），
//    沒有任何測試碰得到。把路徑抽成常數後，底欄名單（utils/bottomNavItems.ts）可以
//    直接引用 `APP_ROUTES.matchmaking`，測試才釘得住「底欄第一格＝揪咖＝/」。
//    ⚠️ 界線：這裡釘得住「哪個名字對到哪條路徑」，釘不住「那條路徑畫哪個元件」——
//    後者還是在 App.tsx 的 JSX 裡，只能目視。
//
// 🔴 `MAIN_NAV_ROUTES` 是 App.tsx Layout 的白名單：命中才畫 TopBar／BottomNav（＋pb-16）。
//    它原本是 Layout 裡的一個字面陣列，新增一條路由忘了補進去的話，那一頁會是
//    沒有殼的裸內容 —— 而且沒有任何錯誤（陷阱 2）。抽到這裡讓測試釘住
//    「每個底欄 path 都有殼」與「/feed 有殼」。
//
// ⚠️ `hasMainNavShell` 比對的是 `location.pathname`，**不含 query string**：
//    `/matchmaking?tab=find` 的 pathname 是 `/matchmaking`，`/?tab=find` 的是 `/`。
//    刻意不做正規化（尾斜線／大小寫）：HashRouter 給的 pathname 就是這個形狀，
//    寬鬆比對只會讓「哪些路徑算一級頁」變成第二份沒寫下來的規則。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §3.1。

/**
 * 一級頁的路徑。key 是「這一頁叫什麼」，value 是網址。
 * 🔴 `matchmaking` 是 `/`：使用者一開 App 第一眼就是揪咖頁（§3.1）。
 *    動態牆（原本的 `/`）搬到 `/feed`，入口降到二級（個人頁的卡片）。
 * ⚠️ `search` 保留：內容已經是揪咖頁「找場次」tab，底欄不再有它，但書籤／舊連結還進得來，
 *    而且 SearchContent 是兩邊共用的。
 */
export const APP_ROUTES = {
    matchmaking: '/',
    feed: '/feed',
    search: '/search',
    matchmakingLegacy: '/matchmaking',
    messages: '/messages',
    profile: '/profile',
    create: '/create',
    notifications: '/notifications',
    ledger: '/ledger',
} as const;

export type AppRoutePath = (typeof APP_ROUTES)[keyof typeof APP_ROUTES];

/** 精確比對（pathname 完全相等）才畫殼的路徑。 */
export const MAIN_NAV_ROUTES: readonly string[] = Object.values(APP_ROUTES);

/** 前綴比對就畫殼的路徑（帶 :id 的頁）。 */
export const MAIN_NAV_ROUTE_PREFIXES: readonly string[] = ['/rate-game/', '/reviews/', '/event/', '/ledger'];

/** 這個 pathname 要不要畫 TopBar／BottomNav 那層殼。 */
export function hasMainNavShell(pathname: string): boolean {
    return MAIN_NAV_ROUTES.includes(pathname) || MAIN_NAV_ROUTE_PREFIXES.some(p => pathname.startsWith(p));
}
