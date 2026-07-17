import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Zap, Gift, Check, Coins, Flame, Star, X } from 'lucide-react';

interface DailyBonusModalProps {
    isOpen: boolean;
    onClose: () => void;
    bonusData: {
        pointsEarned: number;
        consecutiveDays: number;
        isStreakBonus: boolean;
    } | null;
}

const DailyBonusModal: React.FC<DailyBonusModalProps> = ({ isOpen, onClose, bonusData }) => {
    const [showContent, setShowContent] = useState(false);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            const timer = setTimeout(() => setShowContent(true), 100);
            return () => {
                document.body.style.overflow = '';
                clearTimeout(timer);
            };
        } else {
            setShowContent(false);
        }
    }, [isOpen]);

    if (!isOpen || !bonusData) return null;

    const days = [1, 2, 3, 4, 5, 6, 7];

    return createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
            {/* Backdrop - 高端磨砂效果 */}
            <div
                className={`absolute inset-0 bg-neutral-900/10 backdrop-blur-[0.375rem] transition-opacity duration-500 ${showContent ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Modal Container */}
            <div
                className={`relative w-full max-w-sm transform transition-all duration-500 ease-out z-10 ${showContent ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 translate-y-8'
                    }`}
            >
                {/* Main Content Card - 緊湊 Lux 設計 */}
                <div className="relative bg-white/95 backdrop-blur-2xl border border-white rounded-2xl overflow-hidden shadow-[0_1.25rem_3.125rem_rgba(0,0,0,0.1)]">
                    {/* Header Decoration */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/40 to-transparent"></div>

                    {/* Header - 縮減高度 */}
                    <div className="relative h-32 flex flex-col items-center justify-center overflow-hidden bg-neutral-50/50">
                        {/* 裝飾背景 */}
                        <div className="absolute top-0 right-0 w-24 h-24 bg-[#c5a059]/[0.05] rounded-full blur-2xl -mr-12 -mt-12"></div>
                        <div className="absolute bottom-0 left-0 w-24 h-24 bg-neutral-200/20 rounded-full blur-2xl -ml-12 -mb-12"></div>

                        {/* 圖示帶裝飾 - 縮小尺寸 */}
                        <div className="relative mb-3">
                            <div className="absolute inset-0 bg-[#c5a059]/10 blur-xl rounded-full scale-125"></div>
                            <div className="relative w-14 h-14 bg-neutral-900 rounded-xl flex items-center justify-center shadow-xl border border-white/10 group">
                                {bonusData.isStreakBonus ? (
                                    <Flame size={28} className="text-[#c5a059]" strokeWidth={1.5} />
                                ) : (
                                    <Gift size={28} className="text-[#c5a059]" strokeWidth={1.5} />
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-[0.4em]">Daily Reward</span>
                        </div>

                        {/* 右上角關閉按鈕 */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 w-7 h-7 rounded-full bg-white/50 flex items-center justify-center text-neutral-300 hover:text-neutral-900 transition-all active:scale-90"
                        >
                            <X size={14} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Content Body - 縮減內距與間距 */}
                    <div className="p-6 text-center pt-5">
                        <h2 className="text-lg font-black text-neutral-900 mb-1 tracking-tight">
                            {bonusData.isStreakBonus ? '連續簽到大禮！' : '每日簽到獎勵'}
                        </h2>
                        <p className="text-neutral-400 text-[0.6875rem] font-medium mb-5">
                            簽到成功，本次獲得獎勵：
                        </p>

                        {/* Points Display - 緊湊版 */}
                        <div className="inline-flex items-center gap-4 px-6 py-3.5 bg-neutral-50 border border-black/[0.02] rounded-xl mb-6 relative shadow-sm">
                            <div className="w-10 h-10 bg-neutral-900 rounded-lg flex items-center justify-center shadow-md">
                                <Coins size={22} className="text-[#c5a059]" />
                            </div>
                            <div className="text-left">
                                <span className="text-2xl font-black text-neutral-900 tracking-tighter block leading-none mb-0.5">
                                    +{bonusData.pointsEarned}
                                </span>
                                <span className="text-[0.5625rem] text-neutral-400 font-black uppercase tracking-widest">Points Received</span>
                            </div>

                            {bonusData.isStreakBonus && (
                                <div className="absolute -top-2 -right-2 w-7 h-7 bg-[#c5a059] rounded-full flex items-center justify-center text-white shadow-lg animate-bounce border-2 border-white">
                                    <Star size={12} fill="white" />
                                </div>
                            )}
                        </div>

                        {/* Progress Tracker - 縮減間距 */}
                        <div className="mb-6 text-left">
                            <div className="flex justify-between items-center mb-4 px-1">
                                <span className="text-[0.5625rem] text-neutral-400 font-black uppercase tracking-widest">簽到進度追蹤</span>
                                <span className="text-[0.625rem] font-black text-neutral-900 uppercase">{bonusData.consecutiveDays} / 7 DAYS</span>
                            </div>
                            <div className="flex justify-between gap-2 text-center">
                                {days.map((day) => {
                                    const isCompleted = day <= bonusData.consecutiveDays;
                                    const isTarget = day === 7;

                                    return (
                                        <div key={day} className="flex flex-col items-center gap-2 flex-1">
                                            <div
                                                className={`w-full aspect-square rounded-lg flex items-center justify-center border transition-all duration-700 ${isCompleted
                                                    ? isTarget
                                                        ? 'bg-neutral-900 border-neutral-900 text-[#c5a059] shadow-md'
                                                        : 'bg-[#c5a059]/10 border-[#c5a059]/20 text-[#c5a059]'
                                                    : 'bg-neutral-50/50 border-black/[0.03] text-neutral-200'
                                                    }`}
                                            >
                                                {isCompleted ? (
                                                    isTarget ? (
                                                        <Zap size={10} fill="currentColor" />
                                                    ) : (
                                                        <Check size={10} strokeWidth={4} />
                                                    )
                                                ) : isTarget ? (
                                                    <Star size={10} />
                                                ) : (
                                                    <span className="text-[0.5rem] font-black">{day}</span>
                                                )}
                                            </div>
                                            <div className={`h-[0.125rem] w-full rounded-full transition-all duration-1000 ${isCompleted ? 'bg-[#c5a059]' : 'bg-neutral-100'}`}></div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Primary Button */}
                        <button
                            onClick={onClose}
                            className="w-full py-5 bg-neutral-900 text-[#c5a059] font-black text-[0.8125rem] uppercase tracking-[0.3em] rounded-xl shadow-xl hover:shadow-[#c5a059]/10 active:scale-95 transition-all border border-white/5"
                        >
                            已確認領取
                        </button>

                        <p className="mt-8 text-[0.625rem] text-neutral-300 font-black uppercase tracking-[0.2em]">
                            明日持續簽到解鎖更多大獎
                        </p>
                    </div>

                    {/* Security Footer Message */}
                    <div className="bg-neutral-50 py-4 border-t border-black/[0.01] text-center">
                        <p className="text-[0.5rem] font-black text-neutral-200 uppercase tracking-[0.5em]">
                            REI ATTENDANCE PROTOCOL • VERIFIED
                        </p>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default DailyBonusModal;
