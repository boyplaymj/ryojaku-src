// pages/Ledger.tsx — 帳本的「獨立頁」殼（路由 /ledger）。[A1-a-4]
//
// 內容（state／handler／三種檢視／彈窗）全在 components/ledger/LedgerContent.tsx。
// 另一條到達路徑 Profile → components/LedgerOverlay.tsx 也直接用 LedgerContent，不經過這裡。
// 這裡只做兩件事：畫獨立頁的 header（返回＋新增），以及把「這是獨立頁」翻譯成 LedgerContent 的具名 props。
//
// header 透過 renderHeader 交給 LedgerContent 畫在它的容器**裡面**（-mx-5 px-5 要對齊容器、
// loading 時要跟整頁一起不畫），不是在外面包一層 —— 外面包會改到版面。

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus } from 'lucide-react';
import LedgerContent from '../components/ledger/LedgerContent';

const LedgerPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <LedgerContent
            autoOpenAddModalOnGameId
            monthBarStickyTopClass="top-[calc(4rem+env(safe-area-inset-top))]"
            renderHeader={({ openNewEntry }) => (
                <div className="pt-safe sticky top-0 z-[50] bg-[#f9f9f7]/95 backdrop-blur-md -mx-5 px-5 border-b border-black/[0.01]">
                    <div className="h-16 flex items-center justify-between">
                        <button
                            onClick={() => navigate('/profile')}
                            className="w-10 h-10 rounded-lg bg-white border border-black/[0.03] flex items-center justify-center text-neutral-900 hover:bg-neutral-50 shadow-sm transition-all active:scale-90"
                        >
                            <ChevronLeft size="1.25rem" strokeWidth={2.5} />
                        </button>
                        <div className="text-center">
                            <h1 className="text-lg font-black text-neutral-900 uppercase tracking-[0.2em] leading-none mb-1">計帳總覽</h1>
                            <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-[0.3em]">Imperial Ledger</span>
                        </div>
                        <button onClick={openNewEntry} className="w-10 h-10 rounded-lg bg-[#c5a059] flex items-center justify-center text-white shadow-lg shadow-[#c5a059]/20 hover:scale-105 transition-all active:scale-90">
                            <Plus size="1.25rem" strokeWidth={3} />
                        </button>
                    </div>
                </div>
            )}
        />
    );
};

export default LedgerPage;
