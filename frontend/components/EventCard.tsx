import React from 'react';
import { GroupEvent, Category } from '../types';
import { MapPin, Users, Coins, Clock, Gamepad2, ArrowRight, ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface EventCardProps {
    event: GroupEvent;
    /** 可選的點擊事件處理，傳入後會使用假切頁模式，不傳則使用路由導航 */
    onEventClick?: (eventId: string, clickPosition: { x: number; y: number }) => void;
    /** 需要高亮的關鍵字列表 */
    highlightTerms?: string[];
}

const EventCard: React.FC<EventCardProps> = ({ event, onEventClick, highlightTerms = [] }) => {
    const navigate = useNavigate();

    // 高亮文字處理函式
    const highlightContent = (text: string, terms: string[]) => {
        if (!text) return text;
        if (!terms || terms.length === 0) return text;

        // 轉義正則表達式特殊字符
        const escapeRegExp = (string: string) => {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        // 建立正則表達式，忽略大小寫
        const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
        const parts = text.split(pattern);

        return (
            <>
                {parts.map((part, index) => {
                    const isMatch = terms.some(term =>
                        part.toLowerCase() === term.toLowerCase() ||
                        part.toLowerCase().includes(term.toLowerCase()) && term.length > 1 // 寬鬆匹配
                    );

                    // 檢查這部分是否匹配任何關鍵字 (嚴格檢查分割出來的部分是否就是關鍵字本身，因為 split 邏輯)
                    // 正則 split 包含 group capture，所以匹配項會是獨立的元素
                    const isExactMatch = terms.some(term => part.toLowerCase() === term.toLowerCase());

                    return isExactMatch ? (
                        <span key={index} className="text-yellow-400 font-bold bg-yellow-400/20 rounded px-0.5 box-decoration-clone">
                            {part}
                        </span>
                    ) : (
                        <span key={index}>{part}</span>
                    );
                })}
            </>
        );
    };

    // 處理點擊事件：優先使用 callback（假切頁模式），否則使用路由導航
    const handleClick = (e: React.MouseEvent) => {
        if (onEventClick) {
            // 傳遞點擊位置座標
            onEventClick(event.id, { x: e.clientX, y: e.clientY });
        } else {
            navigate(`/event/${event.id}`);
        }
    };


    // Category colors - Minimal Lux Refinement
    const getCategoryStyles = (cat: Category) => {
        switch (cat) {
            case Category.GAME: return {
                bg: 'bg-[#c5a059]/5',
                text: 'text-[#c5a059]',
                border: 'border-[#c5a059]/20'
            };
            case Category.FOOD: return {
                bg: 'bg-orange-50',
                text: 'text-orange-500',
                border: 'border-orange-100'
            };
            case Category.SPORTS: return {
                bg: 'bg-emerald-50',
                text: 'text-emerald-500',
                border: 'border-emerald-100'
            };
            default: return {
                bg: 'bg-neutral-50',
                text: 'text-neutral-400',
                border: 'border-neutral-100'
            };
        }
    };

    const catStyles = getCategoryStyles(event.category);
    const missingCount = event.maxMembers - event.currentMembers;

    return (
        <div
            onClick={handleClick}
            className="group relative bg-white w-full cursor-pointer transition-all hover:bg-neutral-50/50 animate-fade-in"
        >
            {/* Main Content */}
            <div className="px-4 py-4">
                {/* Header: Status & Category */}
                <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[0.5625rem] font-black uppercase tracking-widest border ${catStyles.bg} ${catStyles.text} ${catStyles.border}`}>
                            {event.category}
                        </span>
                        {event.isOwner && (
                            <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-widest">
                                我發起的
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${event.status === 'recruiting' ? 'bg-emerald-400 animate-pulse' :
                            event.status === 'full' ? 'bg-[#c5a059]' :
                                event.status === 'cancelled' ? 'bg-red-400' : 'bg-neutral-300'
                            }`}></div>
                        <span className={`text-[0.625rem] font-black uppercase tracking-wider ${event.status === 'recruiting' ? 'text-emerald-500' :
                            event.status === 'full' ? 'text-[#c5a059]' :
                                event.status === 'cancelled' ? 'text-red-500' : 'text-neutral-400'
                            }`}>
                            {event.status === 'recruiting' ? '招募中' :
                                event.status === 'full' ? '已滿員' :
                                    event.status === 'cancelled' ? '已取消' :
                                        event.status === 'closed' ? '已結束' : event.status}
                        </span>
                    </div>
                </div>

                {/* Title */}
                <h3 className="text-[1rem] font-black text-neutral-900 leading-snug tracking-tight mb-2 group-hover:text-[#c5a059] transition-colors line-clamp-2">
                    {highlightContent(event.title, highlightTerms)}
                </h3>

                {/* Key Info Row */}
                <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-neutral-500 mb-3">
                    <div className="flex items-center gap-1">
                        <Clock size="0.75rem" className="text-neutral-300" />
                        <span className="font-bold">
                            {new Date(event.date).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} {new Date(event.date).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Coins size="0.75rem" className="text-neutral-300" />
                        <span className="font-bold">{highlightContent(event.stakes, highlightTerms)}</span>
                    </div>
                    {event.distance !== undefined && event.distance !== Infinity && (
                        <div className="flex items-center gap-1 text-[#c5a059]">
                            <MapPin size="0.75rem" />
                            <span className="font-bold">
                                {event.distance < 1 ? `${Math.round(event.distance * 1000)}m` : `${event.distance.toFixed(1)}km`}
                            </span>
                        </div>
                    )}
                </div>

                {/* Location */}
                <div className="flex items-center gap-2 text-neutral-400 mb-4">
                    <MapPin size="0.75rem" className="shrink-0" />
                    <span className="text-[0.6875rem] font-medium line-clamp-1">
                        {highlightContent(event.location, highlightTerms)}
                    </span>
                </div>

                {/* Images - Compact Horizontal Scroll */}
                {event.images && event.images.length > 0 && (
                    <div className="mb-4 flex overflow-x-auto gap-2 snap-x snap-mandatory no-scrollbar -mx-1 px-1">
                        {event.images.map((img, idx) => (
                            <div key={idx} className="flex-none w-28 aspect-[4/3] rounded-lg overflow-hidden bg-neutral-100 snap-center relative border border-black/[0.03]">
                                <img src={img} alt="" className="w-full h-full object-cover" />
                                {event.images.length > 1 && (
                                    <div className="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[0.5rem] font-mono text-white/80">
                                        {idx + 1}/{event.images.length}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Footer: Host & Quota */}
                <div className="flex justify-between items-center pt-3 border-t border-black/[0.03]">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-neutral-100 border border-black/[0.03] flex items-center justify-center text-[0.625rem] font-black text-[#c5a059] overflow-hidden">
                            {event.hostPictureUrl ? (
                                <img src={event.hostPictureUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                event.hostName?.[0] || '?'
                            )}
                        </div>
                        <span className="text-[0.75rem] text-neutral-600 font-bold">
                            {highlightContent(event.hostName, highlightTerms)}
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* 人數圖片顯示：使用固定高度容器，圖片稍微溢出以放大視覺效果 */}
                        <div className="relative h-8 flex items-center">
                            <div className="flex items-center gap-[0.0625rem] transform -translate-y-0.5">
                                <img src="/userJoin/icon-watiing_lightMode_selfIcon-No1@3x.png" alt="P1" className="w-[1.25rem] object-contain" />
                                <img src={event.currentMembers >= 2 ? "/userJoin/icon-userJoined-No2@3x.png" : "/userJoin/icon-userEmpty-No2@3x.png"} alt="P2" className="w-[1.25rem] object-contain" />
                                <img src={event.currentMembers >= 3 ? "/userJoin/icon-userJoined-No3@3x.png" : "/userJoin/icon-userEmpty-No3@3x.png"} alt="P3" className="w-[1.25rem] object-contain" />
                                <img src={event.currentMembers >= 4 ? "/userJoin/icon-userJoined-No4@3x.png" : "/userJoin/icon-userEmpty-No4@3x.png"} alt="P4" className="w-[1.25rem] object-contain" />
                            </div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-neutral-900 flex items-center justify-center text-white shadow-md active:scale-95 transition-all group-hover:bg-[#c5a059]">
                            <ArrowRight size="1rem" strokeWidth={3} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EventCard;