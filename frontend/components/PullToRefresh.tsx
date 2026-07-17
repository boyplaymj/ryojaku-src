import React, { useState, useRef } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';

interface PullToRefreshProps {
    onRefresh: () => Promise<void>;
    children: React.ReactNode;
}

const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children }) => {
    const [startY, setStartY] = useState(0);
    const [currentY, setCurrentY] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pullProgress, setPullProgress] = useState(0);
    const THRESHOLD = 80;
    const MAX_PULL = 150;

    const handleTouchStart = (e: React.TouchEvent) => {
        const target = e.currentTarget as HTMLElement;
        // 只有在滾動到最頂端時才啟動下拉刷新
        if (target.scrollTop <= 5 && !isRefreshing) {
            setStartY(e.touches[0].clientY);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (startY === 0 || isRefreshing) return;
        const y = e.touches[0].clientY;
        const diff = y - startY;

        if (diff > 0) {
            // 計算阻力感
            const newY = Math.min(diff * 0.4, MAX_PULL);
            setCurrentY(newY);
            setPullProgress(Math.min(newY / THRESHOLD, 1));
        }
    };

    const handleTouchEnd = async () => {
        if (startY === 0 || isRefreshing) return;

        if (currentY > THRESHOLD) {
            setIsRefreshing(true);
            setCurrentY(THRESHOLD);
            try {
                // 觸覺回饋（如果支援）
                if (navigator.vibrate) navigator.vibrate(10);
                await onRefresh();
            } finally {
                setIsRefreshing(false);
                setCurrentY(0);
                setPullProgress(0);
            }
        } else {
            setCurrentY(0);
            setPullProgress(0);
        }
        setStartY(0);
    };

    return (
        <div
            className="relative"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Lux Style Refresh Indicator */}
            <div
                className="absolute top-0 left-0 w-full flex justify-center pointer-events-none z-0 overflow-hidden"
                style={{
                    height: `${currentY}px`,
                    opacity: Math.max(pullProgress, isRefreshing ? 1 : 0),
                    transition: isRefreshing ? 'height 0.2s ease-out' : 'height 0s'
                }}
            >
                <div className="flex flex-col items-center justify-center h-full">
                    {/* The Loader Tile */}
                    <div className={`relative w-11 h-11 flex items-center justify-center rounded-xl bg-white border border-black/[0.03] shadow-[0_0.5rem_1.875rem_rgba(0,0,0,0.06)] transition-all duration-300 ${isRefreshing ? 'scale-110' : ''}`}
                        style={{ transform: !isRefreshing ? `rotate(${currentY * 2}deg)` : 'none' }}>

                        {/* Inner Ring */}
                        <div className={`absolute inset-1 rounded-lg border border-[#c5a059]/10 ${isRefreshing ? 'animate-pulse' : ''}`}></div>

                        {isRefreshing ? (
                            <Loader2 className="text-[#c5a059] animate-spin" size="1.25rem" strokeWidth={2.5} />
                        ) : (
                            <RefreshCw className={`text-[#c5a059] transition-all duration-500 ${pullProgress >= 1 ? 'rotate-180 scale-110 opacity-100' : 'opacity-40 scale-90'}`} size="1.125rem" strokeWidth={2.5} />
                        )}

                        {/* Sparkle Decoration */}
                        {pullProgress >= 1 && !isRefreshing && (
                            <div className="absolute -top-1 -right-1 animate-bounce">
                                <Sparkles size="0.625rem" className="text-[#c5a059]" />
                            </div>
                        )}
                    </div>

                    {/* Status Text - Lux Typography */}
                    <div className="mt-3 flex flex-col items-center gap-1">
                        <span className="text-[0.625rem] font-black text-neutral-900 tracking-[0.2em] transition-all duration-300 uppercase">
                            {isRefreshing ? '正在同步數據' : pullProgress >= 1 ? '釋放即可刷新' : '下拉刷新紀錄'}
                        </span>
                        {/* Decorative Line */}
                        <div className={`h-[0.0938rem] bg-[#c5a059]/40 transition-all duration-500 rounded-full ${isRefreshing ? 'w-8 animate-pulse' : pullProgress >= 1 ? 'w-12' : 'w-4'}`}></div>
                    </div>
                </div>
            </div>

            {/* Content Wrapper */}
            <div
                style={{
                    transform: `translateY(${currentY}px)`,
                    transition: isRefreshing ? 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)' : 'transform 0.15s ease-out',
                    willChange: 'transform'
                }}
                className="relative z-10"
            >
                {children}
            </div>
        </div>
    );
};

export default PullToRefresh;
