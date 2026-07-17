import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';

interface DatePickerProps {
    value: string;
    onChange: (date: string) => void;
    label?: string;
    onClose?: () => void;
    includeTime?: boolean;
}

const ScrollableColumn = ({ options, value, onChange, label }: { options: number[], value: number, onChange: (val: number) => void, label?: string }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Scroll to selected on mount
    useEffect(() => {
        if (containerRef.current) {
            const selectedEl = containerRef.current.querySelector(`[data-value="${value}"]`);
            if (selectedEl) {
                selectedEl.scrollIntoView({ block: 'center' });
            }
        }
    }, []); // Run once on mount

    return (
        <div className="flex flex-col items-center">
            {label && <div className="text-[0.5625rem] text-neutral-300 font-black uppercase tracking-[0.2em] mb-1.5">{label}</div>}
            <div
                ref={containerRef}
                className="h-28 w-14 overflow-y-auto snap-y snap-mandatory bg-neutral-50 rounded-xl border border-black/[0.04] [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                <div className="py-10 space-y-1">
                    {options.map(opt => (
                        <div
                            key={opt}
                            data-value={opt}
                            onClick={() => {
                                onChange(opt);
                                if (containerRef.current) {
                                    const el = containerRef.current.querySelector(`[data-value="${opt}"]`);
                                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                            }}
                            className={`snap-center h-8 flex items-center justify-center text-[0.8125rem] font-black tracking-tighter cursor-pointer transition-all ${value === opt
                                ? 'text-neutral-900 bg-white shadow-sm border border-black/[0.01]'
                                : 'text-neutral-300 hover:text-neutral-500'
                                }`}
                        >
                            {String(opt).padStart(2, '0')}
                        </div>
                    ))}
                </div>
            </div>
        </div >
    );
};

const DatePicker: React.FC<DatePickerProps> = ({ value, onChange, label = "SELECT DATE", onClose, includeTime = false }) => {
    // Parse initial value
    const initialDate = value ? new Date(value) : new Date();

    const [currentMonth, setCurrentMonth] = React.useState(initialDate);

    // Time state
    const [period, setPeriod] = useState<'AM' | 'PM'>(initialDate.getHours() >= 12 ? 'PM' : 'AM');
    const [hour, setHour] = useState(() => {
        let h = initialDate.getHours();
        if (h === 0) return 12;
        if (h > 12) return h - 12;
        return h;
    });
    const [minute, setMinute] = useState(initialDate.getMinutes());

    const emitChange = (newDate: Date, newPeriod: 'AM' | 'PM', newHour: number, newMinute: number) => {
        const year = newDate.getFullYear();
        const month = String(newDate.getMonth() + 1).padStart(2, '0');
        const day = String(newDate.getDate()).padStart(2, '0');

        let dateResult = `${year}-${month}-${day}`;

        if (includeTime) {
            let h = newHour;
            if (newPeriod === 'PM' && h < 12) h += 12;
            if (newPeriod === 'AM' && h === 12) h = 0;

            const hh = String(h).padStart(2, '0');
            const mm = String(newMinute).padStart(2, '0');
            dateResult = `${year}-${month}-${day}T${hh}:${mm}`;
        }

        onChange(dateResult);
    };

    const handleDateClick = (day: number) => {
        const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
        // Preserve time if exists
        if (includeTime) {
            newDate.setHours(initialDate.getHours());
            newDate.setMinutes(initialDate.getMinutes());
            emitChange(newDate, period, hour, minute);
        } else {
            const year = newDate.getFullYear();
            const month = String(newDate.getMonth() + 1).padStart(2, '0');
            const d = String(newDate.getDate()).padStart(2, '0');
            onChange(`${year}-${month}-${d}`);
        }
    };

    const nextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    };

    const prevMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    };

    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

    const isSelected = (day: number) => {
        const d = new Date(value);
        return d.getDate() === day &&
            d.getMonth() === currentMonth.getMonth() &&
            d.getFullYear() === currentMonth.getFullYear();
    };

    const isToday = (day: number) => {
        const today = new Date();
        return day === today.getDate() &&
            currentMonth.getMonth() === today.getMonth() &&
            currentMonth.getFullYear() === today.getFullYear();
    };

    const handleTimeChange = (type: 'hour' | 'minute' | 'period', val: string | number) => {
        let newHour = hour;
        let newMinute = minute;
        let newPeriod = period;

        if (type === 'hour') newHour = val as number;
        if (type === 'minute') newMinute = val as number;
        if (type === 'period') newPeriod = val as 'AM' | 'PM';

        setHour(newHour);
        setMinute(newMinute);
        setPeriod(newPeriod);

        const currentDate = value ? new Date(value) : new Date();
        emitChange(currentDate, newPeriod, newHour, newMinute);
    };

    return (
        <div className="bg-white border border-black/[0.04] rounded-2xl p-6 w-full select-none shadow-sm relative overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/20 to-transparent"></div>

            <div className="flex items-center justify-between mb-5 px-1">
                <button
                    onClick={prevMonth}
                    type="button"
                    className="p-2 bg-neutral-50 rounded-xl hover:bg-neutral-100 text-neutral-400 hover:text-neutral-900 transition-all active:scale-90 border border-black/[0.02]"
                >
                    <ChevronLeft size={16} strokeWidth={2.5} />
                </button>
                <div className="text-neutral-900 font-black tracking-tight text-[0.9375rem] uppercase">
                    {currentMonth.getFullYear()} / {String(currentMonth.getMonth() + 1).padStart(2, '0')}
                </div>
                <button
                    onClick={nextMonth}
                    type="button"
                    className="p-2 bg-neutral-50 rounded-xl hover:bg-neutral-100 text-neutral-400 hover:text-neutral-900 transition-all active:scale-90 border border-black/[0.02]"
                >
                    <ChevronRight size={16} strokeWidth={2.5} />
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
                {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                    <div key={d} className="text-center text-[0.5625rem] font-black text-neutral-200 py-1.5 uppercase tracking-widest">
                        {d}
                    </div>
                ))}

                {Array.from({ length: firstDay }).map((_, i) => (
                    <div key={`pad-${i}`} className="aspect-square"></div>
                ))}

                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const selected = isSelected(day);
                    const today = isToday(day);

                    return (
                        <button
                            key={day}
                            type="button"
                            onClick={() => handleDateClick(day)}
                            className={`relative aspect-square rounded-xl flex items-center justify-center text-[0.8125rem] font-black transition-all active:scale-90
                                ${selected
                                    ? 'bg-neutral-900 text-[#c5a059] shadow-lg scale-105 z-10'
                                    : 'text-neutral-900 hover:bg-neutral-50'
                                }
                                ${today && !selected ? 'text-[#c5a059]' : ''}
                            `}
                        >
                            {day}
                            {today && !selected && <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#c5a059]"></div>}
                        </button>
                    );
                })}
            </div>

            {includeTime && (
                <div className="mt-5 pt-5 border-t border-black/[0.04]">
                    <div className="flex items-center gap-2 mb-4 text-[#c5a059]">
                        <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                        <span className="text-[0.5625rem] font-black uppercase tracking-[0.2em]">Time Registry</span>
                    </div>

                    <div className="flex items-center justify-center gap-4">
                        <div className="flex flex-col gap-1.5">
                            <button
                                type="button"
                                onClick={() => handleTimeChange('period', 'AM')}
                                className={`px-4 py-2 rounded-xl text-[0.625rem] font-black tracking-widest transition-all ${period === 'AM' ? 'bg-neutral-900 text-[#c5a059] shadow-md' : 'bg-neutral-50 text-neutral-400 border border-black/[0.01]'}`}
                            >
                                上午
                            </button>
                            <button
                                type="button"
                                onClick={() => handleTimeChange('period', 'PM')}
                                className={`px-4 py-2 rounded-xl text-[0.625rem] font-black tracking-widest transition-all ${period === 'PM' ? 'bg-neutral-900 text-[#c5a059] shadow-md' : 'bg-neutral-50 text-neutral-400 border border-black/[0.01]'}`}
                            >
                                下午
                            </button>
                        </div>

                        <div className="h-20 w-[0.0625rem] bg-black/[0.03] mx-1"></div>

                        <ScrollableColumn
                            label="時"
                            options={Array.from({ length: 12 }, (_, i) => i + 1)}
                            value={hour}
                            onChange={(val) => handleTimeChange('hour', val)}
                        />

                        <span className="text-neutral-200 font-black text-xl pt-4 tracking-tighter">:</span>

                        <ScrollableColumn
                            label="分"
                            options={Array.from({ length: 60 }, (_, i) => i)}
                            value={minute}
                            onChange={(val) => handleTimeChange('minute', val)}
                        />
                    </div>
                </div>
            )}

            {onClose && (
                <div className="mt-6 pt-5 border-t border-black/[0.04] flex justify-center">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full py-3.5 bg-neutral-900 text-[#c5a059] rounded-xl text-[0.6875rem] font-black uppercase tracking-[0.3em] shadow-xl active:scale-95 transition-all"
                    >
                        確認選擇
                    </button>
                </div>
            )}
        </div>
    );
};

export default DatePicker;
