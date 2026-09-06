import React from 'react';
import { Star, X } from 'lucide-react';
import { AppInput } from './ui/CommonUI';

// [A3-b1] 從 pages/CreateGroup.tsx 原封搬出：兩段（麻將規則／場地特色／玩家限制）都用它，
// 拆第二段成獨立元件之前得先讓它變成共用元件。interface 與 JSX 本體逐字不變。
interface DynamicListInputProps {
    label: string;
    items: string[];
    placeholder: string;
    onAdd: () => void;
    onChange: (index: number, value: string) => void;
    onRemove: (index: number) => void;
}

const DynamicListInput: React.FC<DynamicListInputProps> = ({
    label,
    items,
    placeholder,
    onAdd,
    onChange,
    onRemove
}) => (
    <div className="space-y-2">
        <div className="flex items-center justify-between">
            <label className="text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">{label}</label>
            <button
                type="button"
                onClick={onAdd}
                className="text-[0.6875rem] font-bold text-[#c5a059] hover:text-[#a68a42] transition-colors flex items-center gap-1"
            >
                <Star size="0.75rem" /> 新增一行
            </button>
        </div>
        <div className="space-y-1.5">
            {items.map((item, index) => (
                <div key={index} className="flex gap-2">
                    <div className="flex-1 relative">
                        <AppInput
                            type="text"
                            value={item}
                            onChange={(e) => onChange(index, e.target.value)}
                            placeholder={placeholder}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => onRemove(index)}
                        className="h-[3.125rem] flex items-center justify-center text-neutral-300 hover:text-red-500 transition-colors px-1"
                    >
                        <X size="1.25rem" />
                    </button>
                </div>
            ))}
        </div>
    </div>
);

export default DynamicListInput;
