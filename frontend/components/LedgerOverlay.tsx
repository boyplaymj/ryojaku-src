import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import LedgerPage from '../pages/Ledger';

interface LedgerOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

const LedgerOverlay: React.FC<LedgerOverlayProps> = ({ isOpen, onClose }) => {
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [triggerAdd, setTriggerAdd] = useState(0);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            document.body.style.overflow = 'hidden';

            // 處理瀏覽器返回按鈕 - 加入假 history state
            window.history.pushState({ modal: 'ledger' }, '');
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
                <div className="absolute top-0 right-0 w-80 h-80 bg-[#c5a059]/5 rounded-full blur-[6.25rem] -mr-40 -mt-40"></div>
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#c5a059]/5 rounded-full blur-[6.25rem] -ml-40 -mb-40"></div>
            </div>

            {/* Header - Fixed at top, System Consistent Style */}
            {/* Header - Fixed at top, System Consistent Style */}
            <div className="flex-shrink-0 bg-white border-b border-black/[0.03] pt-safe z-30 relative shadow-sm">
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
                                <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-[0.2em]">個人財務管理</span>
                            </div>
                            <div className="flex items-center gap-2 px-0.5">
                                <h2 className="text-lg font-black text-neutral-900 tracking-tight uppercase">麻將計帳本</h2>
                                <span className="text-[0.5rem] font-black text-white bg-neutral-900 px-2 py-0.5 rounded-md uppercase tracking-widest">Premium</span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => setTriggerAdd(prev => prev + 1)}
                        className="w-10 h-10 rounded-lg bg-neutral-900 flex items-center justify-center text-[#c5a059] shadow-lg hover:scale-105 transition-all active:scale-90 group"
                    >
                        <Plus size="1.5rem" strokeWidth={2.5} className="group-hover:rotate-90 transition-transform duration-500" />
                    </button>
                </div>
            </div>

            {/* Content Scrollable area */}
            <div className="flex-1 overflow-y-auto relative z-10 scrollbar-hide">
                <LedgerPage isOverlay onClose={onClose} onAddActionTrigger={triggerAdd} />
            </div>
        </div>,
        document.body
    );
};

export default LedgerOverlay;
