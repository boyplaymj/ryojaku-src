import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
    title?: string;
    duration?: number;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType, title?: string, duration?: number) => void;
    hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const hideToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const showToast = useCallback((message: string, type: ToastType = 'info', title?: string, duration: number = 3000) => {
        const id = Math.random().toString(36).substring(2, 9);
        const newToast: Toast = { id, message, type, title, duration };

        setToasts((prev) => [...prev, newToast]);

        if (duration !== Infinity) {
            setTimeout(() => {
                hideToast(id);
            }, duration);
        }
    }, [hideToast]);

    return (
        <ToastContext.Provider value={{ showToast, hideToast }}>
            {children}
            {/* Toast Container */}
            <div className="fixed top-[max(env(safe-area-inset-top),_1.25rem)] left-0 right-0 z-[1000] flex flex-col items-center gap-2 pointer-events-none px-6">
                {toasts.map((toast) => (
                    <ToastComponent key={toast.id} toast={toast} onManualClose={() => hideToast(toast.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

// --- Sub-component for individual toast ---
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastComponent: React.FC<{ toast: Toast; onManualClose: () => void }> = ({ toast, onManualClose }) => {
    const [isExiting, setIsExiting] = useState(false);

    const handleClose = useCallback(() => {
        setIsExiting(true);
        setTimeout(onManualClose, 300);
    }, [onManualClose]);

    const icons = {
        success: <CheckCircle2 size={18} className="text-[#c5a059]" strokeWidth={2.5} />,
        error: <AlertCircle size={18} className="text-red-500" strokeWidth={2.5} />,
        warning: <AlertCircle size={18} className="text-amber-500" strokeWidth={2.5} />,
        info: <Info size={18} className="text-[#c5a059]" strokeWidth={2.5} />,
    };

    const titles = {
        success: 'SUCCESS',
        error: 'SYSTEM ERROR',
        warning: 'WARNING',
        info: 'NOTIFICATION',
    };

    return (
        <div
            className={`
                pointer-events-auto relative overflow-hidden flex items-center gap-4 bg-white 
                border-2 ${toast.type === 'error' ? 'border-red-500/20' : 'border-[#c5a059]/30'} 
                rounded-2xl p-4 shadow-[0_1.25rem_4.375rem_-0.625rem_rgba(0,0,0,0.25),0_0.625rem_1.875rem_-0.9375rem_rgba(0,0,0,0.2)] 
                max-w-md w-[calc(100vw-3rem)] md:w-full transition-all duration-300
                ${isExiting ? 'animate-toast-out' : 'animate-toast-in'}
            `}
            style={{ perspective: '62.5rem' }}
        >
            {/* Left Decorative Vibrant Bar */}
            <div className={`w-1.5 h-10 rounded-full shrink-0 ${toast.type === 'error' ? 'bg-red-500 shadow-[0_0_0.625rem_rgba(239,68,68,0.5)]' : 'bg-[#c5a059] shadow-[0_0_0.625rem_rgba(197,160,89,0.5)]'}`} />

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[0.625rem] font-black uppercase tracking-[0.25em] ${toast.type === 'error' ? 'text-red-500' : 'text-[#c5a059]'}`}>
                        {toast.title || titles[toast.type]}
                    </span>
                    <div className={`h-px flex-1 ${toast.type === 'error' ? 'bg-red-500/10' : 'bg-[#c5a059]/20'}`}></div>
                </div>
                <p className="text-[0.875rem] font-bold text-neutral-900 leading-snug">
                    {toast.message}
                </p>
            </div>

            <div className={`shrink-0 flex items-center justify-center w-10 h-10 rounded-xl ${toast.type === 'error' ? 'bg-red-50/80' : 'bg-[#c5a059]/10'} text-neutral-300`}>
                {icons[toast.type]}
            </div>

            <button
                onClick={handleClose}
                className="shrink-0 p-2 -mr-1 text-neutral-300 hover:text-neutral-500 transition-colors hover:bg-neutral-100 rounded-full"
            >
                <X size={16} strokeWidth={3} />
            </button>

            {/* Time Progress Bar */}
            {toast.duration !== Infinity && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-50">
                    <div
                        className={`h-full animate-progress-flow ${toast.type === 'error' ? 'bg-red-500/40' : 'bg-[#c5a059]/40'}`}
                        style={{ animationDuration: `${toast.duration}ms` }}
                    />
                </div>
            )}
        </div>
    );
};
