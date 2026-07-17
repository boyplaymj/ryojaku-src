import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Search, ChevronRight, Clock, MapPin, Calendar, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChat } from '../contexts/ChatContext';
import { api } from '../services/dataService';
import { AppInput } from '../components/ui/CommonUI';
import { usePullToRefresh } from '../contexts/RefreshContext';

interface ChatRoom {
    roomId: string;
    title: string;
    lastMessage: string;
    lastMessageTime: string;
    unreadCount: number;
    startTime: string;
    rawStartTime: string;
    address: string;
}

const CountdownTimer: React.FC<{ startTimeStr: string }> = ({ startTimeStr }) => {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        if (!startTimeStr) return;

        const calculateTimeLeft = () => {
            const start = new Date(startTimeStr);
            const end = new Date(start.getTime() + 24 * 60 * 60 * 1000); // +1 day
            const now = new Date();
            const diff = end.getTime() - now.getTime();

            if (diff <= 0) {
                setTimeLeft('已銷毀');
                return;
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            setTimeLeft(`${days}天 ${hours}時 ${minutes}分 ${seconds}秒`);
        };

        calculateTimeLeft();
        const timer = setInterval(calculateTimeLeft, 1000);

        return () => clearInterval(timer);
    }, [startTimeStr]);

    return <span>{timeLeft}</span>;
};

const ChatList: React.FC = () => {
    const navigate = useNavigate();
    const { rooms, loading, refreshRooms } = useChat();
    const [searchTerm, setSearchTerm] = useState('');

    // Register with global refresh context
    usePullToRefresh(refreshRooms);

    // [LOCAL TEST] 產生 10 個測試用聊天室（僅 localhost 可見）
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const mockRooms: ChatRoom[] = isLocalhost ? [
        {
            roomId: 'mock-1',
            title: '測試房間 1 - 台北東區',
            lastMessage: '大家好，今晚打牌嗎？',
            address: '台北市大安區忠孝東路四段',
            rawStartTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '剛剛',
            unreadCount: 2,
            startTime: '今日 20:00'
        },
        {
            roomId: 'mock-2',
            title: '測試房間 2 - 信義區麻將',
            lastMessage: '三缺一，急徵腳！',
            address: '台北市信義區松高路12號',
            rawStartTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '5分鐘前',
            unreadCount: 0,
            startTime: '今日 23:00'
        },
        {
            roomId: 'mock-3',
            title: '測試房間 3 - 中山區友誼賽',
            lastMessage: '歡迎新手加入',
            address: '台北市中山區中山北路二段',
            rawStartTime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '1小時前',
            unreadCount: 0,
            startTime: '明日 14:00'
        },
        {
            roomId: 'mock-4',
            title: '測試房間 4 - 西門町聚會',
            lastMessage: '週六固定場',
            address: '台北市萬華區西寧南路',
            rawStartTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '2小時前',
            unreadCount: 5,
            startTime: '週六 13:00'
        },
        {
            roomId: 'mock-5',
            title: '測試房間 5 - 板橋高手局',
            lastMessage: '競技場模式開啟',
            address: '新北市板橋區文化路一段',
            rawStartTime: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '3小時前',
            unreadCount: 0,
            startTime: '明日 06:00'
        },
        {
            roomId: 'mock-6',
            title: '測試房間 6 - 新莊休閒場',
            lastMessage: '輕鬆小賭怡情',
            address: '新北市新莊區中正路',
            rawStartTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '昨天',
            unreadCount: 0,
            startTime: '今日 23:30'
        },
        {
            roomId: 'mock-7',
            title: '測試房間 7 - 淡水河畔',
            lastMessage: '景觀房麻將',
            address: '新北市淡水區中正路',
            rawStartTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '昨天',
            unreadCount: 0,
            startTime: '後天 10:00'
        },
        {
            roomId: 'mock-8',
            title: '測試房間 8 - 南港軟體園區',
            lastMessage: '工程師下班局',
            address: '台北市南港區經貿二路',
            rawStartTime: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '2天前',
            unreadCount: 0,
            startTime: '明日 02:00'
        },
        {
            roomId: 'mock-9',
            title: '測試房間 9 - 內湖科學園區',
            lastMessage: '週三固定',
            address: '台北市內湖區瑞光路',
            rawStartTime: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '3天前',
            unreadCount: 0,
            startTime: '下週三 19:00'
        },
        {
            roomId: 'mock-10',
            title: '測試房間 10 - 松山機場旁',
            lastMessage: '深夜場招募中',
            address: '台北市松山區敦化北路',
            rawStartTime: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
            lastMessageTime: '1週前',
            unreadCount: 0,
            startTime: '明日 04:00'
        },
    ] : [];

    // 合併真實房間與測試房間
    const allRooms = [...rooms, ...mockRooms];

    // Filter rooms
    const filteredRooms = allRooms.filter(room =>
        room.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Highlight helper
    const HighlightText = ({ text, highlight }: { text: string, highlight: string }) => {
        if (!highlight.trim()) {
            return <span>{text}</span>;
        }
        const regex = new RegExp(`(${highlight})`, 'gi');
        const parts = text.split(regex);
        return (
            <span>
                {parts.map((part, i) =>
                    regex.test(part) ? (
                        <span key={i} className="text-[#c5a059] bg-[#c5a059]/10 font-bold px-0.5 rounded">
                            {part}
                        </span>
                    ) : (
                        <span key={i}>{part}</span>
                    )
                )}
            </span>
        );
    };

    return (
        <div className="flex flex-col bg-transparent pt-3 w-full">
            {/* Search Bar */}
            <div className="px-4 py-3 bg-white border-b border-black/[0.03]">
                <AppInput
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="搜尋聊天室..."
                    icon={Search}
                />
            </div>

            {/* Chat List */}
            <div className="flex flex-col">
                {loading ? (
                    <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                        <div className="animate-spin rounded-full h-10 w-10 border-[0.1875rem] border-neutral-100 border-t-[#c5a059]"></div>
                        <span className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.3em] animate-pulse">正在安全加載...</span>
                    </div>
                ) : filteredRooms.length > 0 ? (
                    <div className="flex flex-col space-y-1">
                        {filteredRooms.map((room) => (
                            <div
                                key={room.roomId}
                                onClick={() => navigate(`/chat/${room.roomId}`)}
                                className="group relative bg-white border-b border-black/[0.04] p-4 cursor-pointer transition-all hover:bg-neutral-50/80 active:bg-neutral-100/50"
                            >
                                {/* Top Row: Avatar & Title & Time */}
                                <div className="flex items-start gap-4 mb-4">
                                    <div className="flex-shrink-0">
                                        <div className="w-14 h-14 rounded-lg bg-[#c5a059]/5 flex items-center justify-center border border-[#c5a059]/10 shadow-inner group-hover:scale-110 transition-transform duration-500">
                                            <MessageCircle size="1.625rem" className="text-[#c5a059]" strokeWidth={2.5} />
                                        </div>
                                    </div>

                                    <div className="flex-1 min-w-0 pt-0.5">
                                        <div className="flex justify-between items-start mb-1">
                                            <h3 className="text-neutral-900 font-black text-[1.0625rem] tracking-tight truncate group-hover:text-[#c5a059] transition-colors leading-tight">
                                                <HighlightText text={room.title} highlight={searchTerm} />
                                            </h3>
                                            <span className="text-[0.625rem] text-neutral-300 font-black tracking-widest uppercase ml-3 mt-1 shrink-0">
                                                {room.lastMessageTime}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <p className="text-[0.8125rem] font-medium text-neutral-400 truncate flex-1">
                                                {room.lastMessage || '開始與牌友交流吧...'}
                                            </p>
                                            {room.unreadCount > 0 && (
                                                <div className="bg-[#c5a059] text-white text-[0.5625rem] font-black h-4.5 min-w-[1.125rem] px-1.5 rounded-full flex items-center justify-center shadow-lg shadow-[#c5a059]/20">
                                                    {room.unreadCount > 99 ? '99+' : room.unreadCount}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Metadata Row: Pills - Tightened */}
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {room.address && (
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-50 border border-black/[0.01]">
                                            <MapPin size="0.625rem" className="text-[#c5a059]" strokeWidth={2.5} />
                                            <span className="text-[0.625rem] text-neutral-500 font-bold tracking-tight truncate max-w-[8.75rem]">{room.address}</span>
                                        </div>
                                    )}
                                    {room.startTime && (
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-50 border border-black/[0.01]">
                                            <Calendar size="0.625rem" className="text-[#c5a059]" strokeWidth={2.5} />
                                            <span className="text-[0.625rem] text-neutral-500 font-bold tracking-tight">{room.startTime}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Security Footer: Countdown - Refined Lux Style */}
                                {room.rawStartTime && (
                                    <div className="mt-2 overflow-hidden bg-neutral-50 rounded-lg p-3 border border-black/[0.03] group-hover:bg-neutral-100/50 transition-colors">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-[#c5a059] border border-black/[0.02]">
                                                    <Clock size="1rem" strokeWidth={2.5} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest leading-none mb-1">
                                                        自動銷毀倒數
                                                    </span>
                                                    <div className="text-neutral-900 font-mono font-black text-[0.8125rem] tracking-tight">
                                                        <CountdownTimer startTimeStr={room.rawStartTime} />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-md border border-black/[0.02] shadow-sm">
                                                <ShieldCheck size="0.625rem" className="text-emerald-500" strokeWidth={3} />
                                                <span className="text-[0.5rem] font-black text-emerald-600 uppercase tracking-tighter">加密頻道</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="my-12 p-12 bg-white border-y border-black/[0.03] flex flex-col items-center justify-center text-center">
                        <div className="w-20 h-20 bg-neutral-50 flex items-center justify-center mb-6 border border-black/[0.01]">
                            <Search size="2rem" className="text-neutral-200" />
                        </div>
                        <h3 className="text-neutral-900 font-black text-sm uppercase tracking-[0.2em] mb-3">找不到搜尋結果</h3>
                        <p className="text-neutral-400 text-[0.8125rem] font-medium leading-relaxed max-w-[13.75rem]">
                            目前的加密層中找不到您請求的頻道密鑰。
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatList;
