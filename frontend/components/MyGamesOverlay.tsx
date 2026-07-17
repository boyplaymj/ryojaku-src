import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Trophy } from 'lucide-react';
import MyGamesSection from './MyGamesSection';

interface MyGamesOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    initialTab: 'created' | 'joined';
}

const MyGamesOverlay: React.FC<MyGamesOverlayProps> = ({ isOpen, onClose, userId, initialTab }) => {
    const [shouldRender, setShouldRender] = useState(isOpen);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            document.body.style.overflow = 'hidden';

            // 處理瀏覽器返回按鈕 - 加入假 history state
            window.history.pushState({ modal: 'myGames' }, '');
            const handlePopState = (e: PopStateEvent) => {
                e.preventDefault();
                onClose();
            };
            window.addEventListener('popstate', handlePopState);

            return () => {
                window.removeEventListener('popstate', handlePopState);
                document.body.style.overflow = '';
            };
        }
    }, [isOpen, onClose]);

    if (!shouldRender) return null;

    return createPortal(
        <div
            className={`fixed inset-0 z-[100] flex flex-col transition-all duration-300 ease-out bg-[#f9f9f7] overflow-hidden ${isOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
            onTransitionEnd={() => {
                if (!isOpen) setShouldRender(false);
            }}
        >
            {/* Minimal Background accents */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#c5a059]/5 rounded-full blur-[5rem] -mr-32 -mt-32"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#c5a059]/5 rounded-full blur-[5rem] -ml-32 -mb-32"></div>
            </div>

            {/* Header - Fixed at top, System Consistent Style */}
            <div className="flex-shrink-0 bg-white border-b border-black/[0.03] z-20 relative shadow-sm pt-safe">
                <div className="h-16 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onClose}
                            className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 transition-all active:scale-90 shadow-sm border border-black/[0.01]"
                        >
                            <ArrowLeft size="1.25rem" strokeWidth={2.5} />
                        </button>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-0.5 ml-0.5">
                                <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                                <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-[0.2em]">個人管理中心</span>
                            </div>
                            <h2 className="text-lg font-black text-neutral-900 tracking-tight uppercase px-0.5">活動參與紀錄</h2>
                        </div>
                    </div>
                    <div className="p-3 bg-[#c5a059]/10 rounded-lg text-[#c5a059]">
                        <Trophy size="1.25rem" strokeWidth={2.5} />
                    </div>
                </div>
            </div>

            {/* Content Scrollable area */}
            <div className="flex-1 overflow-y-auto relative z-10 no-scrollbar bg-[#f9f9f7]">
                <div className="max-w-2xl mx-auto py-6 pb-SafeBottom">
                    <MyGamesSection userId={userId} initialTab={initialTab} />
                </div>
            </div>
        </div>,
        document.body
    );
};

export default MyGamesOverlay;
