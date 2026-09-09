// VenueReview.tsx — 場地審核頁（B1-f3）
//
// 正典：/opt/sml/repo/tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §5.1／§5.3／§13。
//
// 🔴 **這一頁是「hall → pending」那個決定的前提，不是配套。**
//    麻將館是付費建立的，建完是 pending，非 owner 拿不到它的地址
//    ⇒ 沒有這個動作，館方付了錢而功能是壞的，
//    **而且他自己看得到地址，所以不會發現**。
//
// 🔴 **所有算術都在 utils/venueReview.ts，這裡只負責畫**（同 VoiceTaiReview 的規矩）。
//    包括排序、資料健康判斷、等待天數 —— 不要在畫面上「順手再判一次」。
//
// 視覺：繼承既有頁的玻璃擬態卡片（甲案，2026-09-02 gameboy 拍板）。

import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle, CheckCircle2, Clock, Inbox, Loader2, MapPin, RefreshCw, XCircle,
} from 'lucide-react';
import { api } from '../services/api';
import {
    hasWarning, readinessOf, sortForReview, venueStatusLabel, venueTypeLabel,
    waitingDays, type AdminVenue,
} from '../utils/venueReview.ts';

const CARD = 'bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6';

/** 資料健康的小標籤。平常一個都不該亮，所以亮起來要看得見。 */
const WarnChip: React.FC<{ text: string }> = ({ text }) => (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full
                     bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <AlertTriangle size={12} /> {text}
    </span>
);

const VenueReview: React.FC = () => {
    const [venues, setVenues] = useState<AdminVenue[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /** 正在送出的那一筆（避免重複點）。 */
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.venues.list('pending');
            setVenues(Array.isArray(res?.venues) ? res.venues : []);
        } catch (e) {
            // 🔴 錯誤時把清單清空，不是留著上一批 —— 留著的話畫面看起來正常，
            //    而審核者會對著一份可能已經被別人處理掉的清單按核准。
            setVenues([]);
            setError(e instanceof Error ? e.message : '載入失敗');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const submit = async (v: AdminVenue, action: 'approve' | 'reject') => {
        setBusyId(v.venueId);
        setNotice(null);
        try {
            await api.venues.review(v.venueId, action);
            setNotice(`${v.name}：${action === 'approve' ? '已核准上線' : '已駁回'}`);
            // 🔴 重新載入而不是就地把那一筆拿掉：後端可能因為併發回 409
            //    （別人剛審過），而就地移除會讓畫面顯示成「我成功了」。
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : '送出失敗');
        } finally {
            setBusyId(null);
        }
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const sorted = sortForReview(venues);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">場地審核</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        麻將館建立後是「待審核」，<span className="text-amber-300">在通過之前，
                        報名的玩家拿不到它的地址</span>。等最久的排在最前面。
                    </p>
                </div>
                <button onClick={() => void load()} disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl
                               bg-slate-800/70 border border-white/10 text-slate-200
                               hover:bg-slate-700/70 disabled:opacity-50">
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    重新整理
                </button>
            </div>

            {error && (
                <div className={`${CARD} border-rose-500/30 text-rose-300 flex items-center gap-2`}>
                    <XCircle size={18} /> {error}
                </div>
            )}
            {notice && (
                <div className={`${CARD} border-emerald-500/30 text-emerald-300 flex items-center gap-2`}>
                    <CheckCircle2 size={18} /> {notice}
                </div>
            )}

            {loading && venues.length === 0 && (
                <div className={`${CARD} text-slate-400 flex items-center gap-2`}>
                    <Loader2 size={18} className="animate-spin" /> 載入中…
                </div>
            )}

            {!loading && sorted.length === 0 && !error && (
                <div className={`${CARD} text-slate-400 flex items-center gap-2`}>
                    <Inbox size={18} />
                    目前沒有待審核的場地。
                    <span className="text-slate-500 text-sm">
                        （⚠️ 這也可能代表「還沒有人建立麻將館」—— 兩者在這一頁上長得一樣）
                    </span>
                </div>
            )}

            {sorted.map(v => {
                const r = readinessOf(v);
                const days = waitingDays(v, nowSec);
                return (
                    <div key={v.venueId} className={CARD}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-lg font-semibold text-white truncate">
                                        {v.name || <span className="text-amber-300">（沒有店名）</span>}
                                    </span>
                                    <span className="text-sm text-slate-300">{venueTypeLabel(v.type)}</span>
                                    <span className="text-xs text-slate-400 px-2 py-0.5 rounded-full
                                                     bg-slate-800/70 border border-white/10">
                                        {venueStatusLabel(v.status)}
                                    </span>
                                    {days !== null && (
                                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                            <Clock size={12} /> 已等 {days} 天
                                        </span>
                                    )}
                                </div>

                                <div className="mt-3 text-sm text-slate-300 flex items-start gap-2">
                                    <MapPin size={14} className="mt-0.5 shrink-0 text-slate-500" />
                                    <span>
                                        {v.exactAddress || (
                                            <span className="text-amber-300">
                                                （沒有填地址 —— 無法判斷是不是真的店）
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500 font-mono break-all">
                                    {v.venueId} · owner {v.ownerId || '（缺）'}
                                    {v.phone ? ` · ${v.phone}` : ''}
                                </div>

                                {hasWarning(r) && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {r.noAddress && <WarnChip text="沒有精確地址" />}
                                        {r.nullIsland && <WarnChip text="座標是 (0,0) —— 多半是沒填" />}
                                        {r.blankName && <WarnChip text="沒有店名" />}
                                        {r.noOwner && <WarnChip text="沒有 ownerId（不該發生）" />}
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col gap-2 shrink-0">
                                <button onClick={() => void submit(v, 'approve')} disabled={busyId === v.venueId}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl
                                               bg-emerald-600/80 hover:bg-emerald-600 text-white
                                               disabled:opacity-50">
                                    {busyId === v.venueId
                                        ? <Loader2 size={16} className="animate-spin" />
                                        : <CheckCircle2 size={16} />}
                                    核准上線
                                </button>
                                <button onClick={() => void submit(v, 'reject')} disabled={busyId === v.venueId}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl
                                               bg-slate-800/70 border border-white/10 text-rose-300
                                               hover:bg-slate-700/70 disabled:opacity-50">
                                    <XCircle size={16} /> 駁回
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default VenueReview;
