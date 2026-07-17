import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GroupEvent } from '../types';
import EventCard from './EventCard';
import EventDetailModal from './EventDetailModal';
import { api } from '../services/dataService';
import { Loader2, Settings, Star, Layers, FileText } from 'lucide-react';

interface MyGamesSectionProps {
    userId: string;
    initialTab?: 'created' | 'joined';
}

const MyGamesSection: React.FC<MyGamesSectionProps> = ({ userId, initialTab = 'created' }) => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'created' | 'joined'>(initialTab);
    const [events, setEvents] = useState<GroupEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [clickPosition, setClickPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const fetchMyGames = useCallback(async () => {
        try {
            const myGames = await api.getMyGames();
            setEvents(myGames);
        } catch (error) {
            console.error('Failed to fetch my games:', error);
        }
    }, []);

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
                if (event.status === 'cancelled' || event.status === 'closed' || isExpired) return 3;
                if (event.status === 'full') return 1;
                if (event.status === 'recruiting') return 2;
                return 3;
            };

            const priorityA = getPriority(a, isExpiredA);
            const priorityB = getPriority(b, isExpiredB);

            if (priorityA !== priorityB) return priorityA - priorityB;
            return priorityA === 3 ? timeB - timeA : timeA - timeB;
        });
    };

    const createdEvents = sortEvents(events.filter(e => e.isOwner));
    const joinedEvents = sortEvents(events.filter(e => !e.isOwner && e.joined));
    const displayEvents = activeTab === 'created' ? createdEvents : joinedEvents;

    return (
        <div className="animate-fade-in-up">
            <div className="flex items-center gap-2.5 mb-6 px-4">
                <div className="w-1.5 h-1.5 rounded-full bg-[#c5a059] shadow-[0_0_0.5rem_rgba(197,160,89,0.4)]"></div>
                <h3 className="text-[0.6875rem] font-black text-neutral-900 uppercase tracking-[0.2em]">活動紀錄總覽</h3>
                <div className="h-[0.0625rem] flex-1 bg-neutral-200/50"></div>
            </div>

            {/* Tab Switcher - Minimal Lux */}
            <div className="mx-4 relative p-1.5 bg-white rounded-lg border border-black/[0.03] mb-8 shadow-sm flex">
                <div
                    className="absolute top-1.5 bottom-1.5 w-[calc(50%-0.375rem)] bg-neutral-900 rounded-lg shadow-lg transition-all duration-500 ease-out"
                    style={{ left: activeTab === 'created' ? '0.375rem' : 'calc(50%)' }}
                ></div>
                <button
                    onClick={() => setActiveTab('created')}
                    className={`relative z-10 flex-1 py-3 text-[0.6875rem] font-black uppercase tracking-[0.15em] rounded-lg transition-colors duration-300 ${activeTab === 'created' ? 'text-white' : 'text-neutral-400'
                        }`}
                >
                    發起局 ({createdEvents.length})
                </button>
                <button
                    onClick={() => setActiveTab('joined')}
                    className={`relative z-10 flex-1 py-3 text-[0.6875rem] font-black uppercase tracking-[0.15em] rounded-lg transition-colors duration-300 ${activeTab === 'joined' ? 'text-white' : 'text-neutral-400'
                        }`}
                >
                    參與局 ({joinedEvents.length})
                </button>
            </div>

            {loading ? (
                <div className="px-4">
                    <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[2rem] border border-black/[0.03] shadow-sm">
                        <div className="w-10 h-10 rounded-full border-[0.1875rem] border-neutral-100 border-t-[#c5a059] animate-spin mb-4"></div>
                        <span className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest">載入活動數據...</span>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col">
                    {displayEvents.map((event, index) => (
                        <React.Fragment key={event.id}>
                            {index > 0 && <div className="h-2 bg-neutral-100"></div>}
                            <div className="group relative bg-white transition-all duration-300">
                                <EventCard
                                    event={event}
                                    onEventClick={(eventId, pos) => {
                                        setClickPosition(pos);
                                        setSelectedEventId(eventId);
                                    }}
                                />

                                {/* Managed Action Buttons Tray */}
                                <div className="flex items-center gap-2 px-4 pb-5 pt-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setClickPosition({ x: e.clientX, y: e.clientY });
                                            setSelectedEventId(event.id);
                                        }}
                                        className="flex-[1.8] py-3.5 bg-neutral-900 text-white rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md group/btn"
                                    >
                                        <Settings size="0.875rem" className="text-[#c5a059] group-hover/btn:rotate-90 transition-transform duration-500" />
                                        <span className="font-black text-[0.625rem] uppercase tracking-wider">管理詳情</span>
                                    </button>

                                    {event.status !== 'cancelled' && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(`/rate-game/${event.id}`);
                                            }}
                                            className="flex-1 py-3.5 bg-neutral-50 border border-black/[0.03] text-neutral-900 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95 hover:bg-white hover:border-[#c5a059]/30"
                                        >
                                            <Star size="0.875rem" className="text-[#c5a059]" />
                                            <span className="font-black text-[0.625rem] uppercase tracking-wider">評分</span>
                                        </button>
                                    )}

                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate(`/ledger?gameId=${event.id}`);
                                        }}
                                        className="flex-1 py-3.5 bg-neutral-50 border border-black/[0.03] text-[#c5a059] rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95 hover:bg-white hover:border-[#c5a059]/30"
                                    >
                                        <FileText size="0.875rem" />
                                        <span className="font-black text-[0.625rem] uppercase tracking-wider">記帳</span>
                                    </button>
                                </div>
                            </div>
                        </React.Fragment>
                    ))}

                    {displayEvents.length === 0 && (
                        <div className="text-center py-20 bg-white border-y border-black/[0.02] flex flex-col items-center justify-center">
                            <div className="p-5 bg-neutral-50 rounded-full mb-4">
                                <Layers className="text-neutral-200" size="2rem" />
                            </div>
                            <p className="text-[0.6875rem] font-black text-neutral-300 uppercase tracking-[0.2em]">尚無相關活動紀錄</p>
                        </div>
                    )}
                </div>
            )}

            {selectedEventId && (
                <EventDetailModal
                    eventId={selectedEventId}
                    events={events}
                    clickPosition={clickPosition}
                    onClose={() => setSelectedEventId(null)}
                    onJoin={async (id) => {
                        await api.joinEvent(id);
                        await fetchMyGames();
                    }}
                />
            )}
        </div>
    );
};

export default MyGamesSection;
