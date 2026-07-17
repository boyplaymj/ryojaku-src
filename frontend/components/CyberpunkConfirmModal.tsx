import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, Check, Ban } from 'lucide-react';

interface CyberpunkConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    loading?: boolean;
}

const CyberpunkConfirmModal: React.FC<CyberpunkConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'danger',
    loading = false
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

    const colors = {
        danger: {
            border: 'border-orange-100',
            text: 'text-orange-600',
            bg: 'bg-orange-50/50',
            btn: 'bg-neutral-900 hover:bg-black text-white',
            shadow: 'shadow-2xl shadow-orange-900/5',
            icon: <Ban className="text-orange-500" size={24} strokeWidth={2.5} />
        },
        warning: {
            border: 'border-[#c5a059]/20',
            text: 'text-[#c5a059]',
            bg: 'bg-[#c5a059]/5',
            btn: 'bg-neutral-900 hover:bg-black text-white',
            shadow: 'shadow-2xl shadow-black/5',
            icon: <AlertTriangle className="text-[#c5a059]" size={24} strokeWidth={2.5} />
        },
        info: {
            border: 'border-emerald-100',
            text: 'text-emerald-600',
            bg: 'bg-emerald-50/50',
            btn: 'bg-neutral-900 hover:bg-black text-white',
            shadow: 'shadow-2xl shadow-emerald-900/5',
            icon: <Check className="text-emerald-500" size={24} strokeWidth={2.5} />
        }
    };

    const config = colors[type];

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center px-6 animate-fade-in">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={!loading ? onClose : undefined}
            />

            {/* Modal Content - 緊湊 Lux 設計 */}
            <div className={`relative w-full max-w-sm bg-white rounded-2xl border ${config.border} ${config.shadow} overflow-hidden animate-scale-in p-6 text-center`}>
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/40 to-transparent"></div>

                {/* Header/Icon - 縮小尺寸 */}
                <div className="flex justify-center mb-5">
                    <div className={`w-14 h-14 rounded-xl ${config.bg} flex items-center justify-center border border-black/[0.01] shadow-inner`}>
                        {React.cloneElement(config.icon as React.ReactElement, { size: 28 })}
                    </div>
                </div>

                <div className="space-y-1.5 mb-8">
                    <h3 className="text-base font-black text-neutral-900 tracking-tight uppercase leading-tight">{title}</h3>
                    <p className="text-[0.75rem] font-medium text-neutral-400 leading-normal whitespace-pre-line px-2">
                        {message.replace(/\\n/g, '\n')}
                    </p>
                </div>

                {/* Footer / Actions - 緊湊版 */}
                <div className="flex flex-col gap-2">
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className={`w-full py-3.5 ${config.btn} rounded-xl transition-all font-black text-[0.6875rem] tracking-[0.2em] uppercase flex items-center justify-center gap-2.5 shadow-lg active:scale-95 disabled:opacity-50`}
                    >
                        {loading ? (
                            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <Check size={16} strokeWidth={2.5} />
                                {confirmText}
                            </>
                        )}
                    </button>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="w-full py-2.5 text-neutral-300 hover:text-neutral-900 transition-colors font-black text-[0.625rem] tracking-[0.2em] uppercase active:scale-95 disabled:opacity-50"
                    >
                        {cancelText}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default CyberpunkConfirmModal;
