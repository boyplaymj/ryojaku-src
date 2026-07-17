import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, LucideIcon } from 'lucide-react';

// --- AppInput ---
interface AppInputProps extends React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> {
    label?: string;
    icon?: LucideIcon;
    error?: string;
    isTextArea?: boolean;
    rightElement?: React.ReactNode;
    rows?: number;
}

export const AppInput: React.FC<AppInputProps> = ({
    label,
    icon: Icon,
    error,
    isTextArea = false,
    rightElement,
    className = "",
    ...props
}) => {
    const inputClasses = `
        w-full bg-neutral-50/50 border border-black/[0.03] rounded-lg px-4 text-neutral-900 text-[0.875rem] font-bold 
        focus:bg-white focus:border-[#c5a059]/40 focus:ring-2 focus:ring-[#c5a059]/5 outline-none transition-all duration-200 
        placeholder:text-neutral-200
        ${Icon ? 'pl-11' : ''}
        ${error ? 'border-red-200 bg-red-50/30' : ''}
        ${isTextArea ? 'py-3 min-h-[5.625rem] resize-none' : 'h-[2.75rem]'}
    `;

    return (
        <div className={`group flex flex-col gap-1.5 ${className}`}>
            {label && (
                <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-[0.2em] ml-1 transition-colors group-focus-within:text-[#c5a059]">
                    {label}
                </label>
            )}
            <div className="relative">
                {Icon && (
                    <div className={`absolute left-4 ${isTextArea ? 'top-5' : 'top-1/2 -translate-y-1/2'} text-neutral-300 group-focus-within:text-[#c5a059] transition-all duration-200`}>
                        <Icon size="1.0625rem" strokeWidth={2.5} />
                    </div>
                )}
                {isTextArea ? (
                    <textarea
                        {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
                        className={inputClasses}
                    />
                ) : (
                    <input
                        {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
                        className={`${inputClasses} ${rightElement ? 'pr-20' : ''}`}
                    />
                )}
                {rightElement && (
                    <div className="absolute right-1 top-1 bottom-1 flex items-center">
                        {rightElement}
                    </div>
                )}
            </div>
            {error && <span className="text-[0.625rem] font-bold text-red-500 ml-2 animate-in fade-in slide-in-from-top-1">{error}</span>}
        </div>
    );
};

// --- AppSelect ---
interface AppSelectOption {
    label: string;
    value: string;
}

interface AppSelectProps {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    options: AppSelectOption[];
    icon?: LucideIcon;
    placeholder?: string;
    className?: string;
}

export const AppSelect: React.FC<AppSelectProps> = ({
    label,
    value,
    onChange,
    options,
    icon: Icon,
    placeholder = "請選擇...",
    className = ""
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(opt => opt.value === value);

    return (
        <div className={`group flex flex-col gap-1.5 relative ${className}`} ref={containerRef}>
            {label && (
                <label className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-[0.2em] ml-1 transition-colors group-focus-within:text-[#c5a059]">
                    {label}
                </label>
            )}
            <div className="relative">
                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className={`
                        w-full h-[2.75rem] bg-neutral-50/50 border border-black/[0.03] rounded-lg px-4 text-[0.875rem] font-bold 
                        cursor-pointer transition-all duration-200 flex items-center
                        ${Icon ? 'pl-11' : ''}
                        ${isOpen ? 'bg-white border-[#c5a059]/40 ring-2 ring-[#c5a059]/5' : 'hover:border-black/[0.1]'}
                    `}
                >
                    {Icon && (
                        <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-all duration-200 ${isOpen ? 'text-[#c5a059]' : 'text-neutral-300'}`}>
                            <Icon size="1.0625rem" strokeWidth={2.5} />
                        </div>
                    )}
                    <span className={value ? 'text-neutral-900' : 'text-neutral-200'}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-300 transition-transform duration-200" style={{ transform: isOpen ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)' }}>
                        <ChevronDown size="0.875rem" strokeWidth={3} />
                    </div>
                </div>

                {isOpen && (
                    <div className="absolute top-[calc(100%+0.375rem)] left-0 right-0 bg-white border border-black/[0.06] rounded-lg shadow-xl z-[100] py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                        {options.map((opt) => (
                            <div
                                key={opt.value}
                                onClick={() => {
                                    onChange(opt.value);
                                    setIsOpen(false);
                                }}
                                className={`
                                    px-5 py-3 text-[0.8125rem] font-bold transition-colors cursor-pointer flex items-center justify-between
                                    ${value === opt.value ? 'bg-[#c5a059]/10 text-[#c5a059]' : 'text-neutral-600 hover:bg-neutral-50'}
                                `}
                            >
                                {opt.label}
                                {value === opt.value && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#c5a059]"></div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- AppButton ---
interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    isLoading?: boolean;
    icon?: LucideIcon;
}

export const AppButton: React.FC<AppButtonProps> = ({
    children,
    variant = 'primary',
    isLoading = false,
    icon: Icon,
    className = "",
    ...props
}) => {
    const baseStyles = "h-[3rem] rounded-lg font-black text-[0.75rem] uppercase tracking-[0.25em] transition-all duration-200 flex items-center justify-center gap-2.5 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 px-6 shadow-sm";

    const variants = {
        primary: "bg-neutral-900 text-[#c5a059] shadow-xl hover:shadow-[#c5a059]/10 border border-white/5",
        secondary: "bg-white text-neutral-900 border border-black/[0.06] shadow-sm hover:border-black/[0.12]",
        ghost: "bg-transparent text-neutral-400 hover:text-neutral-900",
        danger: "bg-red-50 text-red-500 hover:bg-red-500 hover:text-white border border-red-100"
    };

    return (
        <button
            {...props}
            disabled={isLoading || props.disabled}
            className={`${baseStyles} ${variants[variant]} ${className}`}
        >
            {isLoading ? (
                <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full"></div>
            ) : (
                <>
                    {children}
                    {Icon && <Icon size="1.125rem" strokeWidth={2.5} />}
                </>
            )}
        </button>
    );
};
