// pages/Matchmaking.tsx — 揪咖頁殼（[A2-a-2]）
//
// 正典 PLAYER_APP_REDESIGN.md §4.1：揪咖是改版後的預設頁，三個 tab：我的局／找場次／地圖。
//
// 🔴 這裡只有**兩個** tab，「地圖」刻意沒做（不是 disabled、不是「即將推出」，是完全不出現）。
//    理由是 §9 的圖磚計費：components/MapPicker.tsx 走 @aws-amplify/geo，圖磚來自
//    Amazon Location Service、按取得的圖磚數計費 ⇒ 每拖一次地圖就在花錢。
//    把它放進預設頁＝把最貴的東西放到所有人一開 App 就看到的位置，順序反了。
//    等 [C1]（maxBounds／maxZoom／cluster）止血後再加；加法是改 utils/matchmakingTab.ts 的名單，
//    utils/matchmakingTab.test.ts A2a2-4 現在釘著「沒有 map」。
//
// 🔴 「我的局」用 components/MyGamesSection.tsx，**不是** pages/MyEvents.tsx：
//    後者是孤兒（§1 缺陷 #5，沒有任何路由或元件指向它），前者才是線上真的在跑的那份
//    （MyGamesOverlay 從個人頁點進去的就是它）。
//
// 🔴 tab 記在網址 `?tab=mine|find`（useSearchParams），不是 useState：
//    [A2-b] 底部導覽才能直接指定 tab，返回鍵也才會退回上一個 tab。解析在 utils/matchmakingTab.ts。
//
// ⚠️ 這一塊做完的狀態是「/matchmaking 存在且用網址進得去」，還**不是**預設頁——
//    `/` 路由與 BottomNav 是 [A2-b] 的事，這裡一個字沒動。

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, Search as SearchIcon } from 'lucide-react';
import MyGamesSection from '../components/MyGamesSection';
import SearchContent from '../components/SearchContent';
import { User } from '../types';
import {
    MATCHMAKING_TABS,
    MATCHMAKING_TAB_PARAM,
    MatchmakingTab,
    matchmakingTabLabel,
    parseMatchmakingTab,
} from '../utils/matchmakingTab';

interface MatchmakingProps {
    user: User;
}

/** tab 列高度（h-14＝3.5rem）。SearchContent 的子 tab 列要貼在 TopBar(4rem)＋這一列之下。 */
const TAB_BAR_STICKY_TOP = 'top-[calc(4rem+env(safe-area-inset-top))]';
const SEARCH_STICKY_TOP_UNDER_TAB_BAR = 'top-[calc(7.5rem+env(safe-area-inset-top))]';

const TAB_ICONS: Record<MatchmakingTab, React.ComponentType<{ size?: string | number; strokeWidth?: number }>> = {
    mine: CalendarCheck,
    find: SearchIcon,
};

const Matchmaking: React.FC<MatchmakingProps> = ({ user }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = parseMatchmakingTab(searchParams.get(MATCHMAKING_TAB_PARAM));

    const selectTab = (tab: MatchmakingTab) => {
        if (tab === activeTab) return;
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set(MATCHMAKING_TAB_PARAM, tab);
            return next;
        });
    };

    return (
        <div className="pb-4 flex flex-col w-full">
            {/* Tab 列 — Minimal Lux，sticky 貼在 TopBar 下方 */}
            <div className={`h-14 px-4 flex items-end bg-white/90 backdrop-blur-xl border-b border-black/[0.03] sticky ${TAB_BAR_STICKY_TOP} z-30`}>
                <div className="flex w-full max-w-lg mx-auto">
                    {MATCHMAKING_TABS.map(tab => {
                        const isActive = tab === activeTab;
                        const Icon = TAB_ICONS[tab];
                        return (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => selectTab(tab)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`relative flex-1 h-14 flex items-center justify-center gap-1.5 text-[0.6875rem] font-black uppercase tracking-widest rounded-lg transition-colors duration-300 ${isActive ? 'text-[#c5a059]' : 'text-neutral-400 hover:text-neutral-600'
                                    }`}
                            >
                                <Icon size="0.875rem" strokeWidth={isActive ? 2.5 : 2} />
                                {matchmakingTabLabel(tab)}
                                <span
                                    className={`absolute left-4 right-4 bottom-0 h-[0.125rem] rounded-full transition-all duration-300 ${isActive ? 'bg-[#c5a059] opacity-100' : 'bg-transparent opacity-0'
                                        }`}
                                ></span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeTab === 'mine' ? (
                <div className="max-w-2xl mx-auto w-full py-6">
                    <MyGamesSection userId={user.userId} />
                </div>
            ) : (
                <SearchContent stickyTopClass={SEARCH_STICKY_TOP_UNDER_TAB_BAR} />
            )}
        </div>
    );
};

export default Matchmaking;
