// utils/bottomNavItems.ts — 底部導覽五格的名單（[A2-b-1]）
//
// 🔴 零 React 相依：圖示元件**不放這裡**（那會把 lucide-react 拖進 node:test），
//    圖示對照留在 components/BottomNav.tsx 的 `NAV_ICONS`（跟 pages/Matchmaking.tsx
//    的 TAB_ICONS 同一個手法）。utils/bottomNavItems.test.ts 釘這一份。
//
// 正典 §3.1 的目標是「揪咖／天梯／＋開局／私訊／我的」。現況是
//   「揪咖／帳本／＋開局／訊息／我的」，兩格跟正典不同，理由：
//
// 🔴 為什麼帳本暫時佔著天梯那一格（天梯 §6 還沒做）：
//   ① `/ledger` 已經存在，而且是 §8 的一期前置，不是湊數；
//   ② 不放一個點下去是空的假格子（「即將推出」比沒有更糟）；
//   ③ 保持五格，「＋開局」才留得在正中央 —— 中央主行動鍵靠的是**奇數格數**，
//      `validateBottomNavItems` 釘著這件事。
//   §3.1 的註腳本來就寫過「若第 4 格給了帳本，則頂欄再加 💬 訊息」——那句講的是第 4 格，
//   這裡放的是第 2 格；借的是「帳本可以進底欄」這個前提，不是那個位置。
//
// 🔴 第 4 格「訊息」現在裝的是**局內群聊**（§3.3 實查），私訊匣是 [A4] 的事；
//    位置、圖示、未讀徽章一律不動。
//
// 🔴 「找團」`/search` 從底欄消失：它的內容已經是揪咖頁的「找場次」tab，
//    底欄不該有第二個入口。路由本身保留（書籤／舊連結），見 utils/appRoutes.ts。
//
// 🔴 天梯／私訊做好時，**要改的是這份名單**（換 path＋label＋在 BottomNav.tsx 補圖示），
//    不是回 BottomNav.tsx 改 CSS —— 那裡已經不再寫死 w-1/5，格數由這裡決定。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §3.1。

import { APP_ROUTES } from './appRoutes.ts';

export interface BottomNavItem {
    /** 點下去 navigate 到哪；也是「亮不亮」的比對鍵（pathname 精確相等）。 */
    readonly path: string;
    readonly label: string;
    /** 中央主行動鍵（黑底方塊那顆）。整份名單恰好一個，且在正中間。 */
    readonly primary?: boolean;
    /** 要不要掛聊天未讀徽章（ChatContext.totalUnreadCount）。 */
    readonly unreadBadge?: boolean;
}

export const BOTTOM_NAV_ITEMS = [
    { path: APP_ROUTES.matchmaking, label: '揪咖' },
    { path: APP_ROUTES.ledger, label: '帳本' },
    { path: APP_ROUTES.create, label: '開局', primary: true },
    { path: APP_ROUTES.messages, label: '訊息', unreadBadge: true },
    { path: APP_ROUTES.profile, label: '我的' },
] as const satisfies readonly BottomNavItem[];

/** 名單裡出現過的 path 的聯集型別 —— BottomNav.tsx 的圖示表用它，少一個圖示 typecheck 就紅。 */
export type BottomNavPath = (typeof BOTTOM_NAV_ITEMS)[number]['path'];

/**
 * 名單必須滿足的形狀。回傳問題清單，空陣列＝合法。
 * 抽成函式是為了讓測試能拿**壞掉的**名單來驗它真的會叫（不然只驗現況等於同義反覆）。
 */
export function validateBottomNavItems(items: readonly BottomNavItem[]): string[] {
    const problems: string[] = [];
    if (items.length % 2 === 0) problems.push(`格數必須是奇數（中央主行動鍵才有「正中間」），現在是 ${items.length}`);
    const primaryIdx = items.flatMap((it, i) => (it.primary ? [i] : []));
    if (primaryIdx.length !== 1) problems.push(`中央主行動鍵必須恰好一個，現在有 ${primaryIdx.length} 個`);
    else if (primaryIdx[0] !== Math.floor(items.length / 2)) problems.push(`中央主行動鍵要在 index ${Math.floor(items.length / 2)}，現在在 ${primaryIdx[0]}`);
    const seen = new Set<string>();
    for (const it of items) {
        if (seen.has(it.path)) problems.push(`path 重複：${it.path}`);
        seen.add(it.path);
    }
    return problems;
}

// 🔴 載入時就驗：名單長錯形狀要在開發者第一次跑起來就炸，不要等到有人在畫面上看到
//    主行動鍵歪掉。這一行在 dev／build／test 三處都會跑到。
{
    const problems = validateBottomNavItems(BOTTOM_NAV_ITEMS);
    if (problems.length) throw new Error(`BOTTOM_NAV_ITEMS 形狀不合法：${problems.join('；')}`);
}
