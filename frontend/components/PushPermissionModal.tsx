import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Zap, X, Coins, MessageSquare, Trophy } from 'lucide-react';

interface PushPermissionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}

const PushPermissionModal: React.FC<PushPermissionModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const [showContent, setShowContent] = useState(false);
    const [isSubscribing, setIsSubscribing] = useState(false);

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

    const handleConfirm = async () => {
        if (isSubscribing) return;
        setIsSubscribing(true);
        try {
            await onConfirm();
        } finally {
            setIsSubscribing(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-5">
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-neutral-900/40 backdrop-blur-sm transition-opacity duration-500 ${showContent ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Modal Container */}
            <div
                className={`relative w-full max-w-sm transform transition-all duration-500 ease-out z-10 ${showContent ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-8'
                    }`}
            >
                {/* Main Content Card - 緊湊 Lux 設計 */}
                <div className="relative bg-white border border-black/[0.03] rounded-2xl overflow-hidden shadow-2xl">
                    {/* Header with Luxury Pattern - 縮小高度 */}
                    <div className="relative h-36 flex items-center justify-center overflow-hidden bg-neutral-900">
                        {/* Luxury background patterns */}
                        <div className="absolute inset-0 bg-gradient-to-br from-[#c5a059]/20 to-neutral-900 border-b border-white/5"></div>
                        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#c5a059 0.0625rem, transparent 0.0625rem)', backgroundSize: '1.25rem 1.25rem' }}></div>

                        {/* Glowing Bell Icon Container - 縮小尺寸 */}
                        <div className="relative">
                            <div className="absolute inset-0 bg-[#c5a059]/20 blur-2xl rounded-full scale-150 animate-pulse"></div>
                            <div className="relative w-20 h-20 bg-white/5 backdrop-blur-xl rounded-full border border-white/10 flex items-center justify-center shadow-2xl">
                                <BellRing size={40} className="text-[#c5a059] animate-bell-ring" strokeWidth={1.5} />
                            </div>
                        </div>

                        {/* Top Right Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/5 text-neutral-400 hover:text-white transition-colors border border-white/5"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Content Body - 縮小內距與間距 */}
                    <div className="p-6 text-center">
                        <div className="flex items-center justify-center gap-2 mb-3">
                            <div className="h-px w-5 bg-neutral-200"></div>
                            <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-[0.3em]">Smart Notifications</span>
                            <div className="h-px w-5 bg-neutral-200"></div>
                        </div>

                        <h2 className="text-xl font-black text-neutral-900 mb-3 tracking-tight uppercase">
                            啟動 <span className="text-[#c5a059]">即時推播</span>
                        </h2>

                        <p className="text-neutral-400 text-[0.6875rem] mb-6 leading-relaxed font-medium">
                            開啟權限，不再錯過精彩對局<br />
                            隨時掌握聊天與系統通知
                        </p>

                        {/* Reward Highlight - Premium Compact Style */}
                        <div className="relative group mb-6">
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-[#c5a059] to-[#a68a42] rounded-xl blur opacity-10 group-hover:opacity-20 transition-opacity"></div>
                            <div className="relative flex items-center justify-center gap-4 bg-neutral-50 border border-black/[0.02] rounded-xl py-3.5 px-6 shadow-sm">
                                <div className="w-10 h-10 bg-neutral-900 rounded-lg flex items-center justify-center shadow-lg">
                                    <Coins className="text-[#c5a059]" size={22} />
                                </div>
                                <div className="text-left">
                                    <p className="text-[0.5rem] font-black text-[#c5a059] uppercase tracking-[0.2em] leading-none mb-1">專屬回饋獎勵</p>
                                    <p className="text-xl font-black text-neutral-900 tracking-tighter leading-none">
                                        +360 <span className="text-[0.625rem] font-bold text-neutral-400 ml-0.5">POINTS</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Features List - 更加緊湊 */}
                        <div className="flex justify-center gap-8 mb-8">
                            <div className="flex flex-col items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-400 border border-black/[0.02]">
                                    <Zap size={12} />
                                </div>
                                <span className="text-[0.5rem] text-neutral-400 font-black uppercase tracking-wider">即時對局</span>
                            </div>
                            <div className="flex flex-col items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-400 border border-black/[0.02]">
                                    <MessageSquare size={12} />
                                </div>
                                <span className="text-[0.5rem] text-neutral-400 font-black uppercase tracking-wider">私訊通知</span>
                            </div>
                            <div className="flex flex-col items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-400 border border-black/[0.02]">
                                    <Trophy size={12} />
                                </div>
                                <span className="text-[0.5rem] text-neutral-400 font-black uppercase tracking-wider">系統資訊</span>
                            </div>
                        </div>

                        {/* Primary Action */}
                        <button
                            onClick={handleConfirm}
                            disabled={isSubscribing}
                            className={`group relative w-full py-4 bg-neutral-900 text-[#c5a059] rounded-xl overflow-hidden transition-all duration-300 active:scale-95 shadow-xl ${isSubscribing ? 'opacity-70 cursor-wait' : ''}`}
                        >
                            <div className="relative z-10 flex items-center justify-center gap-3">
                                {isSubscribing ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-[#c5a059]/30 border-t-[#c5a059] rounded-full animate-spin"></div>
                                        <span className="font-black uppercase tracking-[0.2em] text-[0.6875rem]">處理中...</span>
                                    </>
                                ) : (
                                    <>
                                        <Zap size={16} className="fill-[#c5a059]" />
                                        <span className="font-black uppercase tracking-[0.2em] text-[0.6875rem]">立即開啟並領取</span>
                                    </>
                                )}
                            </div>
                        </button>

                        {/* Secondary Action */}
                        <button
                            onClick={onClose}
                            className="mt-4 text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest hover:text-neutral-900 transition-colors"
                        >
                            暫時不需要
                        </button>
                    </div>

                    {/* Bottom accent decoration */}
                    <div className="h-1 w-full bg-[#c5a059]/10">
                        <div className="h-full w-1/3 bg-[#c5a059] animate-lux-scan"></div>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes bell-ring {
                    0%, 100% { transform: rotate(0); }
                    10%, 30%, 50%, 70% { transform: rotate(15deg); }
                    20%, 40%, 60%, 80% { transform: rotate(-15deg); }
                }
                .animate-bell-ring {
                    animation: bell-ring 2s ease-in-out infinite;
                    transform-origin: top center;
                }
                @keyframes lux-scan {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(300%); }
                }
                .animate-lux-scan {
                    animation: lux-scan 4s linear infinite;
                }
            `}</style>
        </div>,
        document.body
    );
};

export default PushPermissionModal;
