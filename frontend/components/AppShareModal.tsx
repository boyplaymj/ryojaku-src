import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import AppShareWidget from './AppShareWidget';

interface AppShareModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AppShareModal: React.FC<AppShareModalProps> = ({ isOpen, onClose }) => {
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

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
            {/* Backdrop - 高端磨砂效果 */}
            <div
                className={`absolute inset-0 bg-neutral-900/10 backdrop-blur-[0.375rem] transition-opacity duration-500 ${showContent ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Modal Container */}
            <div
                className={`relative w-full max-w-[21.25rem] transform transition-all duration-500 ease-out z-10 ${showContent ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 translate-y-8'
                    }`}
            >
                {/* Main Content Card - 緊湊 Lux 設計 */}
                <div className="relative bg-white/95 backdrop-blur-2xl border border-white rounded-2xl overflow-hidden shadow-[0_1.25rem_3.125rem_rgba(0,0,0,0.1)]">
                    {/* Header Decoration */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/40 to-transparent"></div>

                    {/* Header - 縮減高度 */}
                    <div className="relative p-6 pb-4 flex items-center justify-between border-b border-black/[0.01]">
                        <div className="flex flex-col">
                            <span className="text-[0.5625rem] text-[#c5a059] font-black uppercase tracking-[0.4em] mb-0.5">QUICK SHARE</span>
                            <h2 className="text-lg font-black text-neutral-900 tracking-tight leading-none">分享両雀</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 bg-neutral-50 rounded-lg flex items-center justify-center text-neutral-300 hover:text-neutral-900 transition-all active:scale-90"
                        >
                            <X size="1rem" strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Share Widget Content */}
                    <div className="p-0">
                        <AppShareWidget />
                    </div>

                    {/* Footer Hint */}
                    <div className="bg-neutral-50 py-3 text-center border-t border-black/[0.01]">
                        <p className="text-[0.5625rem] text-neutral-300 font-black uppercase tracking-[0.3em]">
                            點擊複製連結
                        </p>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default AppShareModal;
