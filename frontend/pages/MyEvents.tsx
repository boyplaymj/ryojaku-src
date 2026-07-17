import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GroupEvent } from '../types';
import EventCard from '../components/EventCard';
import EventDetailModal from '../components/EventDetailModal';
import { api } from '../services/dataService';
import { Loader2, Settings, Star } from 'lucide-react';
import { usePullToRefresh } from '../contexts/RefreshContext';

interface MyEventsProps {
    events: GroupEvent[];
}

const MyEvents: React.FC<MyEventsProps> = ({ events: initialEvents }) => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'created' | 'joined'>('created');
    const [events, setEvents] = useState<GroupEvent[]>(initialEvents);
    const [loading, setLoading] = useState(false);

    // 假切頁 Modal 狀態
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [clickPosition, setClickPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });


    const fetchMyGames = useCallback(async () => {
        console.log('MyEvents: fetchMyGames called');
        try {
            const myGames = await api.getMyGames();
            console.log('MyEvents: My games fetched', myGames.length);
            setEvents(myGames);
        } catch (error) {
            console.error('Failed to fetch my games:', error);
        }
    }, []);

    // Register refresh handler
    usePullToRefresh(fetchMyGames);

    // Initial fetch
    useEffect(() => {
        const loadInitial = async () => {
            setLoading(true);
            await fetchMyGames();
            setLoading(false);
        };
        loadInitial();
    }, [fetchMyGames]);

    const sortEvents = (events: GroupEvent[]) => {
        const now = new Date();
        return [...events].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
            const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();
            const isExpiredA = timeA < now.getTime();
            const isExpiredB = timeB < now.getTime();

            const getPriority = (event: GroupEvent, isExpired: boolean) => {
                // 已取消、已關閉或已過期的團局放在最下面 (Priority 3)
                if (event.status === 'cancelled' || event.status === 'closed' || isExpired) return 3;
                // 已滿員但未過期的放在最上面 (Priority 1)
                if (event.status === 'full') return 1;
                // 招募中的放在中間 (Priority 2)
                if (event.status === 'recruiting') return 2;
                return 3;
            };

            const priorityA = getPriority(a, isExpiredA);
            const priorityB = getPriority(b, isExpiredB);

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            // 同優先級時，根據日期排序
            if (priorityA === 3) {
                // 已結束/取消的，顯示最近的在上面 (降序)
                return timeB - timeA;
            } else {
                // 進行中的，顯示即將到來的在上面 (升序)
                return timeA - timeB;
            }
        });
    };

    const createdEvents = sortEvents(events.filter(e => e.isOwner));
    const joinedEvents = sortEvents(events.filter(e => !e.isOwner && e.joined));
    const displayEvents = activeTab === 'created' ? createdEvents : joinedEvents;

    return (
        <div className="pb-4 bg-transparent p-4 pt-6 max-w-7xl mx-auto w-full">
            {/* Custom Tab Segment - Cyberpunk Style */}
            <div className="relative p-1 bg-slate-900/80 backdrop-blur-xl rounded-lg border border-white/10 mb-6 shadow-lg overflow-hidden">
                {/* Animated Background for Active Tab */}
                <div
                    className={`absolute top-1 bottom-1 w-[calc(50%-0.25rem)] bg-cyber-cyan rounded-lg shadow-[0_0_0.9375rem_rgba(6,182,212,0.4)] transition-all duration-300 ease-out ${activeTab === 'created' ? 'left-1' : 'left-[calc(50%+0.125rem)]'
                        }`}
                ></div>

                <div className="relative z-10 flex">
                    <button
                        onClick={() => setActiveTab('created')}
                        className={`flex-1 py-3 text-sm font-bold rounded-lg transition-colors duration-300 ${activeTab === 'created' ? 'text-black' : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        我發起的 ({createdEvents.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('joined')}
                        className={`flex-1 py-3 text-sm font-bold rounded-lg transition-colors duration-300 ${activeTab === 'joined' ? 'text-black' : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        我參與的 ({joinedEvents.length})
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="animate-spin text-cyber-cyan" size="2.5rem" />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {displayEvents.map(event => (
                        <div key={event.id} className="group relative bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden transition-all duration-300 hover:border-cyber-cyan/30 hover:shadow-[0_0_1.25rem_rgba(6,182,212,0.1)]">
                            {/* Event Content */}
                            <div className="p-1">
                                <EventCard
                                    event={event}
                                    onEventClick={(eventId, pos) => {
                                        setClickPosition(pos);
                                        setSelectedEventId(eventId);
                                    }}
                                />
                            </div>

                            {/* Cyberpunk Action Bar */}
                            <div className="flex items-center gap-3 p-3 pt-0">
                                {/* Manage Button - Only for created events */}
                                {event.isOwner && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setClickPosition({ x: e.clientX, y: e.clientY });
                                            setSelectedEventId(event.id);
                                        }}
                                        className="flex-1 py-3 bg-cyber-cyan/10 hover:bg-cyber-cyan text-cyber-cyan hover:text-black border border-cyber-cyan/50 rounded-lg flex items-center justify-center gap-2 transition-all duration-300 shadow-[0_0_0.625rem_rgba(6,182,212,0.1)] hover:shadow-[0_0_1.25rem_rgba(6,182,212,0.4)] group/btn"
                                    >
                                        <Settings size="1.125rem" className="group-hover/btn:rotate-90 transition-transform duration-500" />
                                        <span className="font-bold tracking-wider text-sm">查看詳情</span>
                                    </button>
                                )}

                                {/* Rate Button - For non-cancelled events */}
                                {event.status !== 'cancelled' && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate(`/rate-game/${event.id}`);
                                        }}
                                        className={`flex-1 py-3 rounded-lg flex items-center justify-center gap-2 transition-all duration-300 border group/btn ${event.isOwner
                                            ? 'bg-cyber-yellow/10 hover:bg-cyber-yellow text-cyber-yellow hover:text-black border-cyber-yellow/50 shadow-[0_0_0.625rem_rgba(250,204,21,0.1)] hover:shadow-[0_0_1.25rem_rgba(250,204,21,0.4)]'
                                            : 'bg-cyber-cyan/10 hover:bg-cyber-cyan text-cyber-cyan hover:text-black border-cyber-cyan/50 shadow-[0_0_0.625rem_rgba(6,182,212,0.1)] hover:shadow-[0_0_1.25rem_rgba(6,182,212,0.4)]'
                                            }`}
                                    >
                                        <Star size="1.125rem" className="group-hover/btn:scale-110 transition-transform" />
                                        <span className="font-bold tracking-wider text-sm">評分玩家</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    {displayEvents.length === 0 && (
                        <div className="text-center py-20 text-slate-500 bg-slate-900/50 rounded-lg border border-dashed border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
                            <div className="absolute inset-0 bg-cyber-cyan/5 animate-pulse"></div>
                            <p className="text-sm font-mono relative z-10">NO DATA FOUND</p>
                        </div>
                    )}
                </div>
            )}

            {/* 假切頁 Modal - 團局詳情 */}
            {selectedEventId && (
                <EventDetailModal
                    eventId={selectedEventId}
                    events={events}
                    clickPosition={clickPosition}
                    onClose={() => setSelectedEventId(null)}
                    onJoin={async (id) => {
                        // 執行報名
                        await api.joinEvent(id);
                        // 報名成功後刷新列表
                        await fetchMyGames();
                    }}
                />
            )}
        </div>
    );
};

export default MyEvents;