import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type MessageType = 'success' | 'error' | 'warning' | 'info';

interface CyberpunkErrorModalProps {
    isOpen: boolean;
    onClose: () => void;
    message: string;
    type?: MessageType;
    autoClose?: boolean;
    duration?: number;
}

const CyberpunkErrorModal: React.FC<CyberpunkErrorModalProps> = ({
    isOpen,
    onClose,
    message,
    type = 'error',
    autoClose = true,
    duration = 3000
}) => {
    const [progress, setProgress] = useState(100);
    const [showContent, setShowContent] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShowContent(true);
            if (autoClose) {
                setProgress(100);
                const startTime = Date.now();
                const timer = setInterval(() => {
                    const elapsed = Date.now() - startTime;
                    const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
                    setProgress(remaining);

                    if (elapsed >= duration) {
                        clearInterval(timer);
                        handleClose();
                    }
                }, 10);

                return () => clearInterval(timer);
            }
        } else {
            setShowContent(false);
        }
    }, [isOpen, autoClose, duration]);

    const handleClose = () => {
        setShowContent(false);
        setTimeout(onClose, 300);
    };

    if (!isOpen) return null;

    const config = {
        success: {
            icon: CheckCircle,
            color: 'text-emerald-500',
            bg: 'bg-emerald-50',
            border: 'border-emerald-100',
            progressBg: 'bg-emerald-500',
            label: '執行成功'
        },
        error: {
            icon: AlertCircle,
            color: 'text-rose-500',
            bg: 'bg-rose-50',
            border: 'border-rose-100',
            progressBg: 'bg-rose-500',
            label: '發生錯誤'
        },
        warning: {
            icon: AlertTriangle,
            color: 'text-[#c5a059]',
            bg: 'bg-[#c5a059]/5',
            border: 'border-[#c5a059]/20',
            progressBg: 'bg-[#c5a059]',
            label: '注意提示'
        },
        info: {
            icon: Info,
            color: 'text-blue-500',
            bg: 'bg-blue-50',
            border: 'border-blue-100',
            progressBg: 'bg-blue-500',
            label: '系統資訊'
        }
    };

    const current = config[type];
    const Icon = current.icon;

    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
            {/* Backdrop with High-end Blur */}
            <div
                className={`absolute inset-0 bg-neutral-900/10 backdrop-blur-[0.375rem] transition-opacity duration-300 ${showContent ? 'opacity-100' : 'opacity-0'}`}
                onClick={handleClose}
            ></div>

            {/* Modal Content - 緊湊 Lux 資訊流設計 */}
            <div className={`
                    relative w-full max-w-sm bg-white/95 backdrop-blur-2xl rounded-2xl shadow-[0_1.25rem_3.125rem_rgba(0,0,0,0.1)] 
                    border border-white overflow-hidden transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1)
                    ${showContent ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 translate-y-8'}
                `}>
                <div className="p-4 px-5">
                    <div className="flex items-start gap-4">
                        {/* Status Icon - 更加緊湊 */}
                        <div className={`w-10 h-10 shrink-0 rounded-xl ${current.bg} ${current.color} flex items-center justify-center shadow-inner border border-black/[0.02] mt-0.5`}>
                            <Icon size={20} strokeWidth={2.5} />
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <span className={`text-[0.5625rem] font-black uppercase tracking-[0.2em] ${current.color}`}>
                                    {current.label}
                                </span>
                                <button
                                    onClick={handleClose}
                                    className="w-6 h-6 -mr-1 -mt-1 rounded-full flex items-center justify-center text-neutral-300 hover:text-neutral-900 transition-all active:scale-90"
                                >
                                    <X size={14} strokeWidth={2.5} />
                                </button>
                            </div>
                            <p className="text-[0.8125rem] font-black text-neutral-900 leading-tight mt-0.5 pr-2">
                                {message}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Refined Progress Line */}
                {autoClose && (
                    <div className="h-[0.0938rem] w-full bg-neutral-50 relative overflow-hidden">
                        <div
                            className={`h-full ${current.progressBg} transition-all duration-100 ease-linear rounded-full opacity-60`}
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default CyberpunkErrorModal;
