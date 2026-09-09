// pages/VenueList.tsx — 公開場地列表（[B1-j3]）。正典 PLAYER_APP_REDESIGN.md §5。
//
// 🔴 **這一頁只有麻將館與活動場，永遠不會有自建場** —— 那不是篩選條件，是後端
//    `IsPubliclyListable` 的硬規則（§5.1：少列一間自建場的代價是使用者看不到它，
//    多列一間的代價是某個人的住處出現在地圖上，兩者不對稱）。所以「一間自建場都
//    沒有」是**正確**的，不要當成資料沒載到。
//
// 🔴 翻頁的終止條件是 `nextToken` 為空，**不是這一頁回 0 筆**（§5.3 點名的坑）：
//    DDB 的 Limit 限制的是掃描筆數不是回傳筆數 ⇒ 一整頁都被上面那條篩掉時，
//    卡片是 0 張而底下還有幾百筆。用筆數判斷的話，第一頁全是自建場就停住，
//    而畫面顯示「目前還沒有公開的場地」—— 完全合理的樣子。
//    決策在 utils/venueView.ts 的 nextPageDecision()／shouldKeepScanning()，那裡有尺。
//
// 🔴 而且「掃完了」與「我們自己停在輪數上限」**是兩句不同的話**：venue-list 背後是
//    無閘門的 Scan（§5.3：它的風險不在授權，在成本），所以一定要有上限；
//    但上限到了還說「就這些了」就是說謊。cap-reached 會給一顆「再找找」。
//
// ⚠️ 2026-09-09 實查：線上 Venues 表是 **0 筆** ⇒ 這一頁上線後的預設畫面就是空的。
//    那不是壞掉，是還沒有人建過場地（建立入口見 pages/CreateVenue.tsx）。
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, MapPin, Plus, RefreshCw } from 'lucide-react';
import { AppButton } from '../components/ui/CommonUI';
import { listVenues } from '../services/apiService';
import {
    formatRating,
    listEmptyCopy,
    mergeVenuePages,
    nextPageDecision,
    shouldKeepScanning,
    venueBadges,
    venueTypeMeta,
    type VenuePageDecision,
} from '../utils/venueView';
import type { PublicVenueCard } from '../types';

interface ScanResult {
    cards: PublicVenueCard[];
    decision: VenuePageDecision;
    token?: string;
    error?: string;
}

/**
 * 從 `startToken` 開始連續翻頁，直到湊夠卡片／掃完／打到輪數上限。
 *
 * 抽成獨立函式（而不是寫在 useEffect 裡）是為了讓「續翻」與「第一次載入」
 * 走**同一條**路徑 —— 兩條各寫一次的話，終止條件遲早只有一邊是對的。
 */
async function scanVenues(startToken: string | undefined, already: PublicVenueCard[]): Promise<ScanResult> {
    const pages: PublicVenueCard[][] = [];
    let token = startToken;
    let rounds = 0;
    let decision: VenuePageDecision = 'fetch';

    do {
        const res = await listVenues(token ? { nextToken: token } : {});
        if (!res?.success) {
            return {
                cards: mergeVenuePages([already, ...pages]),
                decision,
                token,
                error: res?.error || '載入場地列表失敗，請稍後再試',
            };
        }
        rounds += 1;
        pages.push(Array.isArray(res.venues) ? (res.venues as PublicVenueCard[]) : []);
        token = typeof res.nextToken === 'string' && res.nextToken !== '' ? res.nextToken : undefined;
        decision = nextPageDecision({ nextToken: token }, rounds);
    } while (shouldKeepScanning(mergeVenuePages([already, ...pages]).length, decision));

    return { cards: mergeVenuePages([already, ...pages]), decision, token };
}

const VenueRow: React.FC<{ card: PublicVenueCard; onOpen: () => void }> = ({ card, onOpen }) => {
    const meta = venueTypeMeta(card.type);
    const rating = formatRating(card);
    return (
        <button
            type="button"
            onClick={onOpen}
            className="w-full text-left bg-white rounded-lg border border-black/[0.04] p-4 shadow-sm active:scale-[0.99] transition-transform"
        >
            <div className="flex items-center gap-2 flex-wrap mb-1">
                <span aria-hidden>{meta.emoji}</span>
                <span className="text-sm font-black text-neutral-900">{card.name || '未命名場地'}</span>
                {venueBadges(card).map(b => (
                    <span key={b} className="rounded-full bg-[#c5a059]/15 px-2 py-0.5 text-[10px] font-bold text-[#8a6d3b]">{b}</span>
                ))}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="font-bold">{meta.label}</span>
                <span>·</span>
                {/* §7：沒人評過時是「尚無評價」，不是 0%。 */}
                <span>{rating.text}</span>
            </div>
            {card.approxLocation?.placeName && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-neutral-400">
                    <MapPin size="0.75rem" />{card.approxLocation.placeName}
                </p>
            )}
        </button>
    );
};

const VenueListPage: React.FC = () => {
    const navigate = useNavigate();
    const [cards, setCards] = useState<PublicVenueCard[]>([]);
    const [decision, setDecision] = useState<VenuePageDecision>('done');
    const [token, setToken] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | undefined>(undefined);

    const load = useCallback(async (from: string | undefined, existing: PublicVenueCard[], alive: () => boolean) => {
        setIsLoading(true);
        setError(undefined);
        try {
            const r = await scanVenues(from, existing);
            if (!alive()) return;
            setCards(r.cards);
            setDecision(r.decision);
            setToken(r.token);
            setError(r.error);
        } catch (e) {
            console.error('[venue] list failed:', e);
            if (alive()) setError('系統發生錯誤，請稍後再試');
        } finally {
            if (alive()) setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        let live = true;
        void load(undefined, [], () => live);
        return () => { live = false; };
    }, [load]);

    const canLoadMore = decision === 'fetch' || decision === 'cap-reached';

    return (
        <div>
            <div className="flex items-center gap-3 px-4 pt-4">
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="p-2 -ml-2 text-neutral-400 hover:text-neutral-900 transition-colors"
                    aria-label="返回"
                >
                    <ArrowLeft size="1.25rem" />
                </button>
                <h1 className="text-base font-black text-neutral-900">場地</h1>
                <button
                    type="button"
                    onClick={() => navigate('/create-venue')}
                    className="ml-auto flex items-center gap-1 text-xs font-black text-[#c5a059]"
                >
                    <Plus size="0.875rem" />登錄場地
                </button>
            </div>

            <div className="px-4 py-4 space-y-3 pb-12">
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                    這裡只有麻將館與活動場。自建場（家場）不會出現在公開列表 ——
                    它的位置只在有場次時、對報名核准的人顯示。
                </p>

                {cards.map(c => (
                    <VenueRow key={c.venueId} card={c} onOpen={() => navigate(`/venue/${encodeURIComponent(c.venueId)}`)} />
                ))}

                {isLoading && (
                    <div className="flex items-center justify-center gap-2 py-10 text-neutral-400 text-sm">
                        <Loader2 size="1rem" className="animate-spin" /> 載入場地…
                    </div>
                )}

                {/* 錯誤與空狀態刻意分開：「打不到 API」與「沒有場地」是不同的行動指示。 */}
                {!isLoading && error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                        <p className="text-xs text-red-700">{error}</p>
                        <AppButton type="button" variant="secondary" onClick={() => void load(undefined, [], () => true)}>
                            重新載入
                        </AppButton>
                    </div>
                )}

                {!isLoading && !error && cards.length === 0 && (
                    <div className="py-14 text-center space-y-3">
                        <p className="text-sm text-neutral-400">{listEmptyCopy(cards.length, decision)}</p>
                        <AppButton type="button" variant="secondary" onClick={() => navigate('/create-venue')}>
                            登錄第一個場地
                        </AppButton>
                    </div>
                )}

                {!isLoading && !error && canLoadMore && (
                    <button
                        type="button"
                        onClick={() => void load(token, cards, () => true)}
                        className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-black text-neutral-500"
                    >
                        <RefreshCw size="0.875rem" />
                        {decision === 'cap-reached' ? '找了一輪還有更多，再找找' : '載入更多'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default VenueListPage;
