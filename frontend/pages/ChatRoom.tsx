import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Info, Send, Gamepad2, User as UserIcon, X, MapPin, Clock, Coins, Image as ImageIcon, Camera, Loader2 } from 'lucide-react';
import { chatService, ChatMessage } from '../services/chatService';
import { authService } from '../services/authService';
import { AppButton, AppInput } from '../components/ui/CommonUI';
import { api } from '../services/dataService';
import { getRoomInfo, getGameDetail, getChatUploadUrl } from '../services/apiService';
import { useChat } from '../contexts/ChatContext';

interface Message {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    type: string;
    timestamp: string;
    fullTimestamp: number;
}

interface RoomInfo {
    title: string;
    memberCount: number;
    onlineCount: number;
}

const ChatRoom: React.FC = () => {
    const { roomId } = useParams<{ roomId: string }>();
    const navigate = useNavigate();
    const { markRoomAsRead } = useChat();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [roomInfo, setRoomInfo] = useState<RoomInfo>({ title: '聊天室', memberCount: 0, onlineCount: 0 });
    const [userAvatars, setUserAvatars] = useState<Record<string, string>>({});
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fetchedUserIds = useRef<Set<string>>(new Set());

    // 團局資訊 Popup 狀態
    const [showInfoPopup, setShowInfoPopup] = useState(false);
    const [eventInfo, setEventInfo] = useState<{
        startTime: string;
        location: string;
        placeName: string;
        stakes: string;
    } | null>(null);
    const [loadingInfo, setLoadingInfo] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Connect to WebSocket on mount
    useEffect(() => {
        const user = authService.getCurrentUser();
        if (user?.userId) {
            chatService.connect(user.userId);
        }
    }, []);

    // Helper: Parse timestamp from ID (UnixNano)
    const parseTimestamp = (timestampId: string): number => {
        if (!timestampId) return Date.now();
        const timestampPart = timestampId.split('#')[0];
        // If 19 digits (UnixNano), take first 13 for milliseconds
        if (timestampPart.length >= 16) {
            return parseInt(timestampPart.substring(0, 13));
        }
        return parseInt(timestampPart) || Date.now();
    };

    // Helper: Format time for display
    const formatMessageTime = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const isThisYear = date.getFullYear() === now.getFullYear();

        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        if (isToday) {
            return timeStr;
        } else if (isThisYear) {
            return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${timeStr}`;
        } else {
            return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${timeStr}`;
        }
    };

    // Fetch user info for avatar
    const fetchUserAvatar = async (userId: string) => {
        if (fetchedUserIds.current.has(userId)) return;
        fetchedUserIds.current.add(userId);

        try {
            const response = await api.getUserInfo(userId);
            if (response.success && response.data) {
                setUserAvatars(prev => ({
                    ...prev,
                    [userId]: response.data.pictureUrl || ''
                }));
            }
        } catch (err) {
            console.error(`Failed to fetch info for user ${userId}`, err);
        }
    };

    // Load history and subscribe
    useEffect(() => {
        if (!roomId) return;

        // Mark as read immediately when entering
        markRoomAsRead(roomId);

        const fetchHistory = async () => {
            try {
                const response = await api.getChatHistory(roomId);
                if (response.success && response.data) {
                    const historyMessages = response.data.map((msg: any) => {
                        const timestampId = msg["timestamp#messageId"] || msg.timestampId || '';
                        const timestampNum = parseTimestamp(timestampId);

                        // Check if we need to fetch avatar
                        if (msg.senderId) {
                            fetchUserAvatar(msg.senderId);
                        }

                        return {
                            id: timestampId,
                            senderId: msg.senderId,
                            senderName: msg.senderName || '匿名',
                            content: msg.content,
                            type: msg.type || 'text',
                            timestamp: formatMessageTime(timestampNum),
                            fullTimestamp: timestampNum
                        };
                    });
                    // Sort by timestamp
                    historyMessages.sort((a: Message, b: Message) => a.fullTimestamp - b.fullTimestamp);
                    setMessages(historyMessages);
                }
            } catch (err) {
                console.error('Failed to fetch chat history', err);
            }
        };

        // 從 getChatRooms 獲取房間資訊 (標題等) 以及 getRoomInfo (人數)
        const fetchRoomInfo = async () => {
            try {
                const roomsResponse = await api.getChatRooms();
                let title = '聊天室';
                if (roomsResponse.success && roomsResponse.data) {
                    const room = roomsResponse.data.find((r: any) => r.roomId === roomId);
                    if (room) {
                        title = room.title || '聊天室';
                    }
                }

                const infoResponse = await getRoomInfo(roomId);
                let memberCount = 0;
                let onlineCount = 0;

                if (infoResponse.success && infoResponse.data) {
                    memberCount = infoResponse.data.totalMembers || 0;
                    onlineCount = infoResponse.data.onlineMembers || 0;
                }

                setRoomInfo({ title, memberCount, onlineCount });
            } catch (err) {
                console.error('Failed to fetch room info', err);
            }
        };

        fetchHistory();
        fetchRoomInfo();

        const unsubscribe = chatService.subscribe(roomId, (msg: ChatMessage) => {
            markRoomAsRead(roomId);
            setMessages(prev => {
                if (prev.some(m => m.id === msg.timestampId)) return prev;
                const filtered = prev.filter(m =>
                    !(m.id.startsWith('temp-') && m.content === msg.content && m.senderId === msg.senderId)
                );
                if (msg.senderId) fetchUserAvatar(msg.senderId);
                const timestampNum = parseTimestamp(msg.timestampId);
                return [...filtered, {
                    id: msg.timestampId,
                    senderId: msg.senderId,
                    senderName: msg.senderName,
                    content: msg.content,
                    type: msg.type,
                    timestamp: formatMessageTime(timestampNum),
                    fullTimestamp: timestampNum
                }];
            });
        });

        return () => unsubscribe();
    }, [roomId, markRoomAsRead]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = () => {
        if (!inputValue.trim() || !roomId) return;
        const currentUser = authService.getCurrentUser();
        const tempId = `temp-${Date.now()}`;
        const now = Date.now();

        const newMessage: Message = {
            id: tempId,
            senderId: currentUser?.userId || 'me',
            senderName: currentUser?.displayName || '我',
            content: inputValue,
            type: 'text',
            timestamp: formatMessageTime(now),
            fullTimestamp: now
        };

        setMessages(prev => [...prev, newMessage]);
        chatService.sendMessage(roomId, inputValue);
        setInputValue('');
    };

    const handleOpenInfoPopup = async () => {
        if (!roomId) return;
        setShowInfoPopup(true);
        setLoadingInfo(true);
        try {
            const response = await getGameDetail(roomId);
            if (response.success && response.data?.game) {
                const game = response.data.game;
                setEventInfo({
                    startTime: game.gameInfo?.startTime || game.gameInfo?.timeText || '',
                    location: game.location?.address || '未設定',
                    placeName: game.location?.placeName || '',
                    stakes: game.gameInfo?.stakes || '未設定'
                });
            } else {
                setEventInfo({ startTime: '', location: '無法取得', placeName: '', stakes: '無法取得' });
            }
        } catch (error) {
            console.error('Failed to fetch event info:', error);
            setEventInfo({ startTime: '', location: '載入失敗', placeName: '', stakes: '載入失敗' });
        } finally {
            setLoadingInfo(false);
        }
    };

    const handleImageUpload = () => fileInputRef.current?.click();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !roomId) return;
        if (!file.type.startsWith('image/')) { alert('請選擇圖片檔案'); return; }
        if (file.size > 10 * 1024 * 1024) { alert('圖片大小不能超過 10MB'); return; }

        const currentUser = authService.getCurrentUser();
        if (!currentUser?.userId) return;

        setUploading(true);
        try {
            const uploadRes = await getChatUploadUrl(currentUser.userId, roomId, file.name, file.type);
            if (!uploadRes.success || !uploadRes.data) throw new Error(uploadRes.error || '無法取得上傳網址');
            const { uploadUrl, publicUrl } = uploadRes.data;

            const s3Res = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=31536000, immutable' }
            });
            if (!s3Res.ok) throw new Error('圖片上傳失敗');

            chatService.sendMessage(roomId, publicUrl, 'image');
            const now = Date.now();
            setMessages(prev => [...prev, {
                id: `temp-${now}`,
                senderId: currentUser.userId,
                senderName: currentUser.displayName || '我',
                content: publicUrl,
                type: 'image',
                timestamp: formatMessageTime(now),
                fullTimestamp: now
            } as Message]);
        } catch (error) {
            console.error('Image upload failed:', error);
            alert('圖片發送失敗，請稍後再試');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            scrollToBottom();
        }
    };

    const currentUser = authService.getCurrentUser();

    return (
        <div className="flex flex-col h-screen bg-[#f9f9f7] relative overflow-hidden font-inter">
            {/* Top Bar - Premium Glass */}
            {/* Top Bar - Premium Glass */}
            <div className="fixed top-0 left-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-black/[0.02] pt-safe">
                <div className="h-16 px-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-900 border border-black/[0.01] shadow-sm active:scale-90 transition-all">
                            <ChevronLeft size="1.25rem" strokeWidth={3} />
                        </button>
                        <div className="flex flex-col">
                            <h2 className="text-neutral-900 font-black tracking-tight truncate text-[1rem] uppercase leading-none">{roomInfo.title}</h2>
                            <div className="flex items-center gap-1.5 mt-1.5">
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                                <span className="text-[0.5625rem] text-neutral-400 font-black uppercase tracking-[0.2em]">{roomInfo.onlineCount} 在線 • {roomInfo.memberCount} 總計</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handleOpenInfoPopup}
                        className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-[#c5a059] border border-black/[0.01] shadow-sm active:scale-90 transition-all hover:bg-white"
                    >
                        <Info size="1.125rem" strokeWidth={3} />
                    </button>
                </div>
            </div>

            {/* Message Area */}
            <div
                className="flex-1 overflow-y-auto px-5 space-y-6"
                style={{
                    paddingTop: 'calc(6rem + env(safe-area-inset-top, 0))',
                    paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0))'
                }}
            >
                {messages.map((msg, index) => {
                    const isMe = msg.senderId === currentUser?.userId;
                    const isSystem = msg.type === 'system';
                    const avatarUrl = userAvatars[msg.senderId];
                    const showName = index === 0 || messages[index - 1].senderId !== msg.senderId;

                    if (isSystem) {
                        return (
                            <div key={msg.id} className="flex justify-center my-6">
                                <span className="bg-white border border-black/[0.03] text-neutral-400 text-[0.5625rem] font-black uppercase tracking-[0.3em] px-5 py-2 rounded-full shadow-sm">
                                    {msg.content}
                                </span>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={msg.id}
                            className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 ${!showName ? '-mt-4' : ''}`}
                        >
                            {!isMe && showName && (
                                <div className="flex-shrink-0 w-9 h-9">
                                    <div className="w-full h-full rounded-lg bg-white border border-black/[0.05] overflow-hidden shadow-sm">
                                        {avatarUrl ? (
                                            <img src={avatarUrl} alt={msg.senderName} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-neutral-50 text-neutral-300">
                                                <UserIcon size="0.875rem" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {!isMe && !showName && <div className="w-9" />}

                            <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[80%]`}>
                                {!isMe && showName && (
                                    <span className="text-[0.625rem] text-neutral-400 font-black uppercase tracking-widest ml-1 mb-1.5">{msg.senderName}</span>
                                )}

                                <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                    <div
                                        className={`relative px-4 py-3 text-[0.875rem] leading-relaxed shadow-sm transition-all ${msg.type === 'image'
                                            ? 'p-0 overflow-hidden rounded-lg border border-black/[0.03] bg-white'
                                            : (isMe
                                                ? 'bg-neutral-900 text-white font-medium rounded-lg rounded-tr-none'
                                                : 'bg-white text-neutral-800 font-medium rounded-lg rounded-tl-none border border-black/[0.03]')
                                            }`}
                                    >
                                        {msg.type === 'image' ? (
                                            <img
                                                src={msg.content}
                                                alt="Chat Image"
                                                className="max-w-[13.75rem] max-h-[18.75rem] object-cover rounded-lg cursor-pointer active:scale-95 transition-transform"
                                                onClick={() => setPreviewImage(msg.content)}
                                                onLoad={scrollToBottom}
                                            />
                                        ) : (
                                            <span className="tracking-tight break-words">{msg.content}</span>
                                        )}
                                    </div>
                                    <span className="text-[0.5rem] text-neutral-300 font-black uppercase tracking-tighter mb-1 select-none">
                                        {msg.timestamp.split(' ')[msg.timestamp.split(' ').length - 1]}
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Bottom Input Area - Unified Height */}
            <div className="fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-xl border-t border-black/[0.02] z-50 p-4 pb-safe">
                <div className="max-w-4xl mx-auto flex items-center gap-3">
                    <button
                        onClick={handleImageUpload}
                        disabled={uploading}
                        className={`w-[3.125rem] h-[3.125rem] rounded-lg flex items-center justify-center transition-all shadow-sm ${uploading ? 'bg-neutral-50 text-neutral-200' : 'bg-neutral-50 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 active:scale-90 border border-black/[0.01]'}`}
                    >
                        {uploading ? <Loader2 size="1.25rem" className="animate-spin" /> : <ImageIcon size="1.25rem" strokeWidth={2.5} />}
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />

                    <div className="flex-1 relative">
                        <AppInput
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder="在這裡輸入訊息..."
                        />
                        <button
                            onClick={handleSendMessage}
                            disabled={!inputValue.trim()}
                            className={`absolute right-1 top-1 bottom-1 w-10 rounded-lg flex items-center justify-center transition-all ${inputValue.trim()
                                ? 'bg-neutral-900 text-[#c5a059] shadow-md active:scale-95'
                                : 'text-neutral-200 pointer-events-none'
                                }`}
                        >
                            <Send size="1rem" strokeWidth={3} className={inputValue.trim() ? 'ml-0.5' : ''} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Image Preview Overlay */}
            {previewImage && (
                <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300" onClick={() => setPreviewImage(null)}>
                    <div className="relative animate-in zoom-in-95 duration-300">
                        <img src={previewImage} alt="Fullscreen" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
                        <button className="absolute -top-12 right-0 w-10 h-10 bg-white/10 rounded-full text-white flex items-center justify-center backdrop-blur-md active:scale-90 transition-all border border-white/10" onClick={() => setPreviewImage(null)}>
                            <X size="1.25rem" />
                        </button>
                    </div>
                </div>
            )}

            {/* Game Info Popup - Hard Edge & Compact */}
            {showInfoPopup && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center px-6 animate-in fade-in duration-300 overflow-hidden" onClick={() => setShowInfoPopup(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />
                    <div className="relative bg-white shadow-[0_2rem_5rem_rgba(0,0,0,0.3)] w-full max-w-sm animate-in zoom-in-95 duration-300 overflow-hidden border border-black/[0.1]" onClick={(e) => e.stopPropagation()}>

                        <div className="pt-8 pb-3 px-6 text-center">
                            <h3 className="text-lg font-black text-neutral-900 tracking-tight uppercase leading-none mb-1.5">團局詳情分析</h3>
                            <p className="text-[0.5625rem] text-[#c5a059] font-black uppercase tracking-[0.4em]">Club Mission Intel</p>
                        </div>

                        <div className="px-6 pb-8">
                            {loadingInfo ? (
                                <div className="flex flex-col items-center justify-center py-10 gap-4">
                                    <Loader2 className="w-8 h-8 text-[#c5a059] animate-spin" strokeWidth={2.5} />
                                    <span className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-[0.3em]">正在解密數據...</span>
                                </div>
                            ) : eventInfo ? (
                                <div className="space-y-px bg-black/[0.04]">
                                    <div className="flex items-center gap-4 p-4 bg-white hover:bg-neutral-50 transition-colors">
                                        <div className="w-9 h-9 bg-neutral-900 flex items-center justify-center shrink-0">
                                            <Clock size="1rem" className="text-[#c5a059]" strokeWidth={2.5} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[0.5rem] text-neutral-300 font-black uppercase tracking-widest mb-0.5">預定時間</p>
                                            <p className="text-neutral-900 font-black tracking-tight text-[0.8125rem] truncate">
                                                {(() => {
                                                    if (!eventInfo.startTime) return '未定時';
                                                    const date = new Date(eventInfo.startTime);
                                                    if (isNaN(date.getTime())) return eventInfo.startTime;
                                                    return date.toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                                })()}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 p-4 bg-white hover:bg-neutral-50 transition-colors">
                                        <div className="w-9 h-9 bg-neutral-900 flex items-center justify-center shrink-0">
                                            <MapPin size="1rem" className="text-[#c5a059]" strokeWidth={2.5} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[0.5rem] text-neutral-300 font-black uppercase tracking-widest mb-0.5">集合位置</p>
                                            <p className="text-neutral-900 font-black tracking-tight text-[0.8125rem] truncate">{eventInfo.placeName || '指定地點'}</p>
                                            <p className="text-neutral-400 text-[0.625rem] font-medium truncate mt-0.5">{eventInfo.location}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 p-4 bg-white hover:bg-neutral-50 transition-colors">
                                        <div className="w-9 h-9 bg-neutral-900 flex items-center justify-center shrink-0">
                                            <Coins size="1rem" className="text-[#c5a059]" strokeWidth={2.5} />
                                        </div>
                                        <div>
                                            <p className="text-[0.5rem] text-neutral-300 font-black uppercase tracking-widest mb-0.5">底台設定</p>
                                            <p className="text-[#c5a059] font-black text-[1.125rem] tracking-tighter uppercase leading-none">{eventInfo.stakes}</p>
                                        </div>
                                    </div>

                                    <div className="pt-6 bg-white">
                                        <AppButton onClick={() => setShowInfoPopup(false)} className="w-full rounded-none h-[2.8125rem] text-[0.75rem]">
                                            返回頻道
                                        </AppButton>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8 bg-neutral-50 border border-dashed border-neutral-200">
                                    <p className="text-neutral-300 font-black text-[0.5625rem] uppercase tracking-widest">目前無詳情數據</p>
                                </div>
                            )}
                        </div>

                        {/* Security Label */}
                        <div className="bg-neutral-900 py-2.5 text-center">
                            <p className="text-[0.4375rem] font-black text-[#c5a059]/60 uppercase tracking-[0.6em]">REI ENCRYPTED DATA</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatRoom;
