// components/ledger/LedgerShareCard.tsx — 帳本頁「分享報表」的隱藏區塊（[A1-a-2]）
//
// 從 pages/Ledger.tsx 逐字搬出來的純展示元件：沒有 state、沒有副作用、不呼叫 api／html2canvas，
// 需要的東西全部從 props 進來。
//
// 🔴 ref 是這個元件的命脈：LedgerPage 的 handleShare 用 html2canvas 對這個 ref 截圖。
//    ref 接不上的話 typecheck 與 build 都不會紅，只有真的按下分享時才會發現截出來是空白。
//    所以這裡用 forwardRef，而且 ref 必須落在**內層那個報表 div**（w-[23.4375rem] 那個），
//    不是外層那個 fixed 定位的容器 —— 外層只是把它推到畫面外，截它會截到一片空。

import React from 'react';
import { TrendingUp, Trophy, User as UserIcon, Coins } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { User } from '../../types';
import { LedgerStats } from '../../utils/ledgerStats';

export interface LedgerShareCardProps {
    currentUser: User | null;
    currentMonth: Date;
    computedSummary: LedgerStats;
    avatarBase64: string | null;
}

const LedgerShareCard = React.forwardRef<HTMLDivElement, LedgerShareCardProps>(
    ({ currentUser, currentMonth, computedSummary, avatarBase64 }, shareRef) => {
        // Share View (Hidden) - Minimal Lux Premium Report
        return (
            <div className="fixed -left-[125rem] top-0 pointer-events-none">
                <div
                    ref={shareRef}
                    className="w-[23.4375rem] bg-[#f9f9f7] p-4 text-neutral-900 overflow-hidden relative font-sans flex flex-col"
                    style={{ minHeight: '35rem' }}
                >
                    {/* Texture/Grid */}
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 0.0625rem, transparent 0)', backgroundSize: '1.5rem 1.5rem' }}></div>

                    {/* Header: System Standard Branding */}
                    <div className="relative z-10 flex items-center justify-between mb-4 border-b border-black/[0.03] pb-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 overflow-hidden">
                                <img src="/icon.png" alt="App Icon" className="w-full h-full object-contain" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xl font-black tracking-tight text-neutral-900 leading-none uppercase">
                                    両雀
                                </span>
                                <span className="text-[0.5625rem] font-black text-[#c5a059] tracking-[0.3em] mt-1.5 uppercase">
                                    Imperial Ledger
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest">報表編號</p>
                            <p className="text-[0.625rem] font-black text-neutral-900">#M{new Date().getTime().toString().slice(-6)}</p>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="relative z-10 flex-1">
                        <div className="bg-white border border-black/[0.03] rounded-lg p-4 shadow-xl mb-4 text-center relative overflow-hidden">
                            {/* Accent Decoration */}
                            <div className="absolute top-0 left-0 w-full h-[0.1875rem] bg-gradient-to-r from-transparent via-[#c5a059]/40 to-transparent"></div>

                            <div className="w-16 h-16 bg-neutral-900 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-xl relative p-0.5">
                                {avatarBase64 ? (
                                    <div className="w-full h-full rounded-lg overflow-hidden">
                                        <img src={avatarBase64} alt="Avatar" className="w-full h-full object-cover" />
                                    </div>
                                ) : currentUser?.pictureUrl ? (
                                    <div className="w-full h-full rounded-lg overflow-hidden">
                                        <img src={currentUser.pictureUrl} alt="Avatar" className="w-full h-full object-cover" crossOrigin="anonymous" />
                                    </div>
                                ) : (
                                    <Trophy size="2rem" className="text-[#c5a059]" />
                                )}
                            </div>

                            <p className="text-[0.625rem] font-black text-[#c5a059] uppercase tracking-[0.4em] mb-2.5">両雀玩家狀態</p>
                            <h3 className="text-2xl font-black mb-4 tracking-tighter uppercase text-neutral-900 leading-[1.1]">
                                {currentMonth.getFullYear()} 年 {currentMonth.getMonth() + 1} 月<br />
                                戰績分析報表
                            </h3>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="bg-neutral-50 p-3.5 rounded-lg border border-black/[0.01] text-left">
                                    <p className="text-[0.5625rem] text-neutral-400 font-black uppercase tracking-widest mb-1">累計損益</p>
                                    <p className={`text-xl font-black tracking-tighter ${(computedSummary?.totalWinLoss || 0) >= 0 ? 'text-neutral-900' : 'text-orange-600'}`}>
                                        {(computedSummary?.totalWinLoss || 0) > 0 ? '+' : ''}{computedSummary?.totalWinLoss || 0}
                                        <span className="text-[0.625rem] font-black text-neutral-300 ml-1.5 tracking-widest uppercase">底台</span>
                                    </p>
                                </div>
                                <div className="bg-neutral-50 p-3.5 rounded-lg border border-black/[0.01] text-left">
                                    <p className="text-[0.5625rem] text-neutral-400 font-black uppercase tracking-widest mb-1">總計局數</p>
                                    <p className="text-xl font-black text-neutral-900 tracking-tighter">
                                        {computedSummary?.totalEntries || 0}
                                        <span className="text-[0.625rem] font-black text-neutral-300 ml-1.5 tracking-widest uppercase">場</span>
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2.5 text-left pt-5 border-t border-black/[0.03]">
                                <div className="flex justify-between items-center group">
                                    <div className="flex items-center gap-2.5">
                                        <TrendingUp size="0.875rem" className="text-[#c5a059]" />
                                        <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest">勝率統計</span>
                                    </div>
                                    <span className="text-base font-black text-neutral-900 tracking-tight">{Math.round(computedSummary?.winRate || 0)}%</span>
                                </div>
                                <div className="flex justify-between items-center group">
                                    <div className="flex items-center gap-2.5">
                                        <UserIcon size="0.875rem" className="text-[#c5a059]" />
                                        <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest">主要隊友 / 對手</span>
                                    </div>
                                    <span className="text-xs font-black text-neutral-900 truncate max-w-[8.75rem] text-right uppercase tracking-tight">{computedSummary?.mostFrequentOpponent}</span>
                                </div>

                                <div className="pt-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2.5">
                                            <Coins size="0.875rem" className="text-[#c5a059]" />
                                            <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest">底台分布</span>
                                        </div>
                                        <span className="text-[0.5rem] font-black text-neutral-300 uppercase tracking-[0.2em]">Matrix Distribution</span>
                                    </div>

                                    {/* Visual Proportion Bar */}
                                    <div className="h-2.5 w-full bg-neutral-50 rounded-full overflow-hidden flex mb-3 border border-black/[0.01]">
                                        {computedSummary?.topStakes.map((stake, idx) => (
                                            <div
                                                key={idx}
                                                style={{ width: `${stake.percentage}%` }}
                                                className={`h-full ${idx === 0 ? 'bg-neutral-900' :
                                                    idx === 1 ? 'bg-[#c5a059]' :
                                                        'bg-neutral-200'
                                                    }`}
                                            />
                                        ))}
                                    </div>

                                    {/* Labels with Legend */}
                                    <div className="space-y-2.5 px-1">
                                        {computedSummary?.topStakes.map((stake, idx) => (
                                            <div key={idx} className="flex items-center justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${idx === 0 ? 'bg-neutral-900' : idx === 1 ? 'bg-[#c5a059]' : 'bg-neutral-200'}`}></div>
                                                    <span className="text-[0.75rem] font-black text-neutral-900 tracking-tight uppercase">{stake.label}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[0.75rem] font-black text-neutral-900 tracking-tight">
                                                        {stake.percentage}%
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer with QR Code: System Standard */}
                    <div className="relative z-10 bg-white border border-black/[0.03] rounded-lg p-4 flex items-center justify-between shadow-lg">
                        <div className="flex-1 pr-4">
                            <div className="text-[0.5625rem] text-[#c5a059] font-black mb-1.5 tracking-[0.3em] uppercase">官方認證數據</div>
                            <div className="text-xs font-black text-neutral-900 mb-0.5 leading-tight uppercase tracking-tight">掃描 QR Code 查看戰績</div>
                            <div className="text-[0.5625rem] text-neutral-400 font-medium leading-tight">加入頂尖雀友社群。</div>
                        </div>
                        <div className="p-2 bg-white rounded-lg shadow-sm border border-black/[0.02] flex-shrink-0">
                            <QRCodeSVG value={`${window.location.origin}/#/ledger?userId=${currentUser?.userId}`} size={60} level="H" includeMargin={false} />
                        </div>
                    </div>
                </div>
            </div>
        );
    }
);

LedgerShareCard.displayName = 'LedgerShareCard';

export default LedgerShareCard;
