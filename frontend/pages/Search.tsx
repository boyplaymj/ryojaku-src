import React, { useState, useEffect, useCallback } from 'react';
import { Search as SearchIcon, Dices, Filter, Map, MapPin, Coins } from 'lucide-react';
import { api } from '../services/dataService';
import { GroupEvent } from '../types';
import EventCard from '../components/EventCard';
import EventDetailModal from '../components/EventDetailModal';
import { usePullToRefresh } from '../contexts/RefreshContext';
import { AppInput } from '../components/ui/CommonUI';


const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
};

const deg2rad = (deg: number) => {
    return deg * (Math.PI / 180)
};

const SearchPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'all' | 'nearby'>('all');
    const [keyword, setKeyword] = useState('');
    const [events, setEvents] = useState<GroupEvent[]>(() => {
        try {
            const saved = sessionStorage.getItem('search_events_cache');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });
    const [filteredEvents, setFilteredEvents] = useState<GroupEvent[]>(() => {
        try {
            const saved = sessionStorage.getItem('search_events_cache');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });
    const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);

    // 假切頁 Modal 狀態
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [clickPosition, setClickPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [selectedStake, setSelectedStake] = useState<string | null>(null);

    // 取得所有唯一的底台選項
    const uniqueStakes = React.useMemo(() => {
        const stakes = new Set(events.map(e => e.stakes).filter(Boolean));
        return Array.from(stakes).sort((a: string, b: string) => {
            // 嘗試解析底台數字 (例如 "100/20" -> 100)
            const getBase = (s: string) => {
                const match = s.match(/^(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            };
            return getBase(a) - getBase(b);
        });
    }, [events]);

    // 計算需要高亮的關鍵字列表
    const highlightTerms = React.useMemo(() => {
        const terms: string[] = [];
        if (keyword.trim()) {
            terms.push(keyword.trim());
        }
        if (selectedStake) {
            terms.push(selectedStake);
        }
        // 移除重複並過濾空字串
        return Array.from(new Set(terms)).filter(Boolean);
    }, [keyword, selectedStake]);



    // Fetch events function (can be called on mount and on refresh)
    const fetchEvents = useCallback(async () => {
        // Only show loading if we don't have data
        const hasCachedData = sessionStorage.getItem('search_events_cache');
        if (!hasCachedData) {
            setLoading(true);
        }

        try {
            // Fetch all games without location filter initially
            const data = await api.getEvents();
            setEvents(data);
            sessionStorage.setItem('search_events_cache', JSON.stringify(data));
        } catch (error) {
            console.error("Failed to fetch events", error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Register pull-to-refresh handler
    usePullToRefresh(fetchEvents);

    const searchNearby = useCallback(async (latitude: number, longitude: number) => {
        try {
            // Fetch games with location parameters
            const data = await api.getEvents({
                latitude,
                longitude,
                radius: 50 // 50km radius
            });

            // Calculate distance for each event
            const eventsWithDistance = data.map(event => {
                if (event.latitude && event.longitude) {
                    return {
                        ...event,
                        distance: calculateDistance(latitude, longitude, event.latitude, event.longitude)
                    };
                }
                return { ...event, distance: Infinity };
            });

            // Sort by distance
            const sortedEvents = eventsWithDistance.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

            setEvents(sortedEvents);
        } catch (error) {
            console.error("Failed to fetch nearby events", error);
            setLocationError("無法取得附近的團局");
        } finally {
            setLoading(false);
        }
    }, []);

    const handleLocationSearch = useCallback(async () => {
        setLoading(true);
        setLocationError(null);

        if (!navigator.geolocation) {
            setLocationError("您的瀏覽器不支援地理位置功能");
            setLoading(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setUserLocation({ lat: latitude, lng: longitude });

                // Call the window-attached function to ensure it runs with correct closure context
                // even if intercepted by external scripts
                if ((window as any).searchNearby) {
                    (window as any).searchNearby(latitude, longitude);
                } else {
                    searchNearby(latitude, longitude);
                }
            },
            (error) => {
                console.error("Error getting location", error);
                setLocationError("無法取得您的位置，請確認已開啟定位權限");
                setLoading(false);
                // 不需要手動 setFilteredEvents，統一的篩選 Effect 會處理
            }
        );
    }, [searchNearby]);

    // Expose functions to window for external location spoofing tools/scripts
    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as any).setUserLocation = setUserLocation;
            (window as any).searchNearby = searchNearby;
        }

        // Restore scroll position
        const savedScroll = sessionStorage.getItem('search_scroll_pos');
        if (savedScroll && !loading && events.length > 0) {
            setTimeout(() => {
                window.scrollTo(0, parseInt(savedScroll));
            }, 0);
        }

        return () => {
            sessionStorage.setItem('search_scroll_pos', window.scrollY.toString());
            if (typeof window !== 'undefined') {
                delete (window as any).setUserLocation;
                delete (window as any).searchNearby;
            }
        };
    }, [loading, events.length, searchNearby]);

    // Tab 切換時重新抓取資料
    useEffect(() => {
        // 初始掛載時，如果已經有快取資料，就不重複抓取 (fetchEvents 內部已有判斷)
        if (activeTab === 'all') {
            fetchEvents();
        } else if (activeTab === 'nearby') {
            handleLocationSearch();
        }
    }, [activeTab, fetchEvents, handleLocationSearch]);

    // 統一的篩選邏輯
    useEffect(() => {
        let result = [...events];

        // 1. 關鍵字篩選 (擴充：地址、名稱、底台、主揪名稱)
        if (keyword.trim()) {
            const lowerKeyword = keyword.toLowerCase();
            result = result.filter(event =>
                (event.title || '').toLowerCase().includes(lowerKeyword) ||
                (event.location || '').toLowerCase().includes(lowerKeyword) ||
                (event.address || '').toLowerCase().includes(lowerKeyword) ||
                (event.hostName || '').toLowerCase().includes(lowerKeyword) ||
                (event.stakes || '').toLowerCase().includes(lowerKeyword) ||
                (event.rules || '').toLowerCase().includes(lowerKeyword)
            );
        }

        // 2. 底台篩選
        if (selectedStake) {
            result = result.filter(event => event.stakes === selectedStake);
        }

        setFilteredEvents(result);
    }, [events, keyword, selectedStake]);


    return (
        <div className="pb-4 flex flex-col w-full">
            {/* Tab Switcher - Compact Segment Control */}
            <div className="h-16 px-4 flex items-center bg-white border-b border-black/[0.03] sticky top-[calc(4rem+env(safe-area-inset-top))] z-20">
                <div className="flex bg-neutral-100 p-0.5 rounded-lg w-full">
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`flex-1 py-2.5 rounded-md text-[0.6875rem] font-black uppercase tracking-[0.1em] transition-all ${activeTab === 'all'
                            ? 'bg-white text-neutral-900 shadow-sm'
                            : 'text-neutral-400 hover:text-neutral-600'
                            }`}
                    >
                        探索所有
                    </button>
                    <button
                        onClick={() => setActiveTab('nearby')}
                        className={`flex-1 py-2.5 rounded-md text-[0.6875rem] font-black uppercase tracking-[0.1em] transition-all flex items-center justify-center gap-1.5 ${activeTab === 'nearby'
                            ? 'bg-white text-neutral-900 shadow-sm'
                            : 'text-neutral-400 hover:text-neutral-600'
                            }`}
                    >
                        <Map size="0.75rem" />
                        附近場次
                    </button>
                </div>
            </div>

            {/* Search & Filter Bar */}
            <div className="px-4 py-3 bg-white border-b border-black/[0.03]">
                <AppInput
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜尋場次、地區、主揪..."
                    icon={SearchIcon}
                    className="mb-3"
                />

                {/* Stake Filter Pills */}
                {uniqueStakes.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                        <button
                            onClick={() => setSelectedStake(null)}
                            className={`flex-none px-3 py-1.5 rounded-lg text-[0.625rem] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${selectedStake === null
                                ? 'bg-neutral-900 text-white shadow-md'
                                : 'bg-neutral-50 text-neutral-400 hover:bg-neutral-100'
                                }`}
                        >
                            <Filter size="0.625rem" />
                            全部
                        </button>
                        {uniqueStakes.map(stake => (
                            <button
                                key={stake}
                                onClick={() => setSelectedStake(stake === selectedStake ? null : stake)}
                                className={`flex-none px-3 py-1.5 rounded-lg text-[0.625rem] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 whitespace-nowrap ${selectedStake === stake
                                    ? 'bg-[#c5a059] text-white shadow-md'
                                    : 'bg-neutral-50 text-neutral-400 hover:bg-neutral-100'
                                    }`}
                            >
                                <Coins size="0.625rem" />
                                {stake}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Location Error Message */}
            {locationError && activeTab === 'nearby' && (
                <div className="mx-4 mt-3 p-3 bg-red-50 rounded-lg flex items-center gap-2 text-red-500 text-[0.6875rem] font-medium animate-fade-in">
                    <MapPin size="0.75rem" />
                    {locationError}
                </div>
            )}

            {/* Results Count */}
            {!loading && filteredEvents.length > 0 && (
                <div className="px-4 py-2 flex items-center justify-between">
                    <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">
                        找到 {filteredEvents.length} 場團局
                    </span>
                    {(keyword || selectedStake) && (
                        <button
                            onClick={() => { setKeyword(''); setSelectedStake(null); }}
                            className="text-[0.625rem] font-bold text-[#c5a059] hover:underline"
                        >
                            清除篩選
                        </button>
                    )}
                </div>
            )}

            {/* Results Area */}
            {loading ? (
                <div className="flex-1 flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-[0.1875rem] border-neutral-100 border-t-[#c5a059]"></div>
                </div>
            ) : filteredEvents.length > 0 ? (
                <div className="flex flex-col">
                    {filteredEvents.map((event, index) => (
                        <React.Fragment key={event.id}>
                            {index > 0 && <div className="h-2 bg-neutral-100"></div>}
                            <EventCard
                                event={event}
                                highlightTerms={highlightTerms}
                                onEventClick={(eventId, pos) => {
                                    setClickPosition(pos);
                                    setSelectedEventId(eventId);
                                }}
                            />
                        </React.Fragment>
                    ))}
                </div>
            ) : (
                <div className="mx-4 mt-6 p-10 bg-white rounded-lg border border-black/[0.03] shadow-sm flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mb-5 border border-black/[0.01]">
                        <Dices size="1.75rem" className="text-neutral-200" />
                    </div>
                    <h3 className="text-neutral-900 font-black text-sm uppercase tracking-[0.15em] mb-2">查無場次</h3>
                    <p className="text-neutral-400 text-[0.75rem] font-medium leading-relaxed max-w-[12.5rem]">
                        目前的篩選條件下找不到任何場次。
                    </p>
                    <button
                        onClick={() => {
                            setKeyword('');
                            setSelectedStake(null);
                        }}
                        className="mt-6 px-5 py-2.5 bg-neutral-900 text-white rounded-lg text-[0.625rem] font-black uppercase tracking-widest hover:bg-black transition-all shadow-md active:scale-95"
                    >
                        清除篩選條件
                    </button>
                </div>
            )}

            {/* Modal remains unchanged in logic but its content is refactored in EventDetail */}
            {selectedEventId && (
                <EventDetailModal
                    eventId={selectedEventId}
                    events={events}
                    clickPosition={clickPosition}
                    onClose={() => setSelectedEventId(null)}
                    onJoin={async (id) => {
                        await api.joinEvent(id);
                        await fetchEvents();
                    }}
                />
            )}
        </div>
    );
};

export default SearchPage;