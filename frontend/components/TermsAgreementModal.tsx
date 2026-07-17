import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Check, X, AlertCircle, ArrowRight } from 'lucide-react';
import { AppButton } from './ui/CommonUI';

interface TermsAgreementModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    actionType: 'join' | 'create';
}

const TermsAgreementModal: React.FC<TermsAgreementModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    actionType
}) => {
    // 禁止背景滾動
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const actionText = actionType === 'join' ? '報名' : '發起';

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-6 animate-in fade-in duration-300">
            {/* Backdrop: Minimal Blur */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            ></div>

            {/* Modal Content: Premium Rounded Card - 緊湊版 */}
            <div className="relative w-full max-w-sm bg-white rounded-2xl border border-black/[0.05] shadow-[0_2rem_5rem_-1rem_rgba(0,0,0,0.15)] overflow-hidden animate-in zoom-in-95 duration-300">

                {/* Header Decoration */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/40 to-transparent"></div>

                {/* Main Header Content - 縮減內距 */}
                <div className="pt-8 pb-4 px-6 text-center">
                    <div className="w-14 h-14 bg-[#c5a059]/10 rounded-xl flex items-center justify-center text-[#c5a059] mx-auto mb-4 shadow-inner border border-[#c5a059]/10">
                        <ShieldCheck size={28} strokeWidth={2.5} />
                    </div>

                    <div className="flex items-center justify-center gap-2 mb-1">
                        <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                        <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-[0.4em]">Agreement</span>
                    </div>
                    <h2 className="text-lg font-black text-neutral-900 tracking-tight uppercase">服務條款確認</h2>
                </div>

                {/* Body Content - 縮減間距 */}
                <div className="px-6 pb-6 space-y-4">
                    {/* Notice Box - 緊湊版 */}
                    <div className="bg-neutral-50/80 border border-black/[0.02] rounded-xl p-4 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center text-[#c5a059] shadow-sm shrink-0 border border-black/[0.01]">
                            <AlertCircle size={16} strokeWidth={2.5} />
                        </div>
                        <p className="text-[0.75rem] text-neutral-600 font-medium leading-normal">
                            在您{actionText}團局之前，請確認您已閱讀並同意本平台的<span className="text-[#c5a059] font-black underline underline-offset-4 decoration-[#c5a059]/30">服務條款暨使用規範</span>。
                        </p>
                    </div>

                    {/* Point List - 更加緊湊 */}
                    <div className="space-y-3 px-1">
                        <div className="flex items-start gap-2.5">
                            <ArrowRight size={12} className="text-[#c5a059] shrink-0 mt-0.5" strokeWidth={3} />
                            <p className="text-[0.625rem] text-neutral-400 font-black uppercase tracking-widest leading-normal">
                                點擊「確認同意」即代表您已完全瞭解並同意遵守所有條款。
                            </p>
                        </div>
                        <div className="flex items-start gap-2.5">
                            <ArrowRight size={12} className="text-neutral-300 shrink-0 mt-0.5" strokeWidth={3} />
                            <p className="text-[0.625rem] text-neutral-400 font-black uppercase tracking-widest leading-normal">
                                點擊「拒絕」將取消本次{actionText}動作。
                            </p>
                        </div>
                    </div>
                </div>

                {/* Action Footer - 緊湊按鈕區 */}
                <div className="px-6 pb-6 flex flex-col gap-2">
                    <AppButton
                        onClick={onConfirm}
                        className="w-full h-[2.875rem]"
                        icon={Check}
                    >
                        確認同意
                    </AppButton>
                    <button
                        onClick={onClose}
                        className="w-full py-2 text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.2em] hover:text-neutral-900 transition-colors"
                    >
                        拒絕服務
                    </button>
                </div>

                {/* Security Footer Message - 縮減內距 */}
                <div className="bg-neutral-50 py-3 border-t border-black/[0.01] text-center">
                    <p className="text-[0.5rem] font-black text-neutral-200 uppercase tracking-[0.4em] pointer-events-none">
                        REI SECURITY PROTOCOL • VERIFIED
                    </p>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default TermsAgreementModal;

