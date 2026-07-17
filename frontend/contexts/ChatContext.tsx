import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/dataService';
import { chatService, ChatMessage } from '../services/chatService';
import { authService } from '../services/authService';

export interface ChatRoom {
    roomId: string;
    title: string;
    lastMessage: string;
    lastMessageTime: string;
    unreadCount: number;
    startTime: string;
    rawStartTime: string;
    address: string;
}

interface ChatContextType {
    rooms: ChatRoom[];
    totalUnreadCount: number;
    loading: boolean;
    refreshRooms: () => Promise<void>;
    markRoomAsRead: (roomId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [rooms, setRooms] = useState<ChatRoom[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalUnreadCount, setTotalUnreadCount] = useState(0);

    const fetchRooms = useCallback(async () => {
        try {
            const user = authService.getCurrentUser();
            if (!user) return;

            const response = await api.getChatRooms();
            if (response.success && response.data) {
                const mappedRooms = response.data.map((m: any) => ({
                    roomId: m.roomId,
                    title: m.title || '聊天室',
                    lastMessage: m.lastMessage || '尚無訊息',
                    lastMessageTime: m.lastMessageTimestamp
                        ? new Date(m.lastMessageTimestamp / 1000000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
                        : (m["lastMessageTime#roomId"] && m["lastMessageTime#roomId"].includes('#')
                            ? new Date(parseInt(m["lastMessageTime#roomId"].split('#')[0]) / 1000000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
                            : '--:--'),
                    unreadCount: m.unreadCount || 0,
                    startTime: m.startTime ? new Date(m.startTime).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }) : '',
                    rawStartTime: m.startTime,
                    address: m.address || '',
                }));
                setRooms(mappedRooms);

                // Calculate total unread
                const total = mappedRooms.reduce((sum: number, room: ChatRoom) => sum + (room.unreadCount || 0), 0);
                setTotalUnreadCount(total);
            }
        } catch (err) {
            console.error('Failed to fetch chat rooms', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const markRoomAsRead = useCallback(async (roomId: string) => {
        // Optimistic update
        setRooms(prev => {
            const newRooms = prev.map(r => {
                if (r.roomId === roomId) {
                    return { ...r, unreadCount: 0 };
                }
                return r;
            });
            const total = newRooms.reduce((sum, room) => sum + (room.unreadCount || 0), 0);
            setTotalUnreadCount(total);
            return newRooms;
        });

        // Call API
        await api.markAsRead(roomId);
        // We could refetch here, but optimistic update is smoother
    }, []);

    useEffect(() => {
        fetchRooms();
    }, [fetchRooms]);

    // Subscribe to WebSocket messages
    useEffect(() => {
        const handleMessage = (msg: ChatMessage) => {
            const currentUser = authService.getCurrentUser();
            setRooms(prev => {
                const roomIndex = prev.findIndex(r => r.roomId === msg.roomId);
                if (roomIndex === -1) {
                    // New room or room not in list? Should probably refetch
                    fetchRooms();
                    return prev;
                }

                const updatedRooms = [...prev];
                const room = updatedRooms[roomIndex];

                // Update room details
                const now = new Date();
                const isMe = currentUser?.userId === msg.senderId;

                let displayContent = msg.content;
                if (msg.type === 'image') {
                    displayContent = '[圖片]';
                }

                const updatedRoom = {
                    ...room,
                    lastMessage: msg.senderName ? `${msg.senderName}: ${displayContent}` : displayContent,
                    lastMessageTime: now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }),
                    unreadCount: isMe ? room.unreadCount : (room.unreadCount || 0) + 1
                };

                // Move to top
                updatedRooms.splice(roomIndex, 1);
                updatedRooms.unshift(updatedRoom);

                // Update total unread
                const total = updatedRooms.reduce((sum, r) => sum + (r.unreadCount || 0), 0);
                setTotalUnreadCount(total);

                return updatedRooms;
            });
        };

        const unsubscribe = chatService.subscribe('*', handleMessage);
        return () => {
            unsubscribe();
        };
    }, [fetchRooms]);

    return (
        <ChatContext.Provider value={{ rooms, totalUnreadCount, loading, refreshRooms: fetchRooms, markRoomAsRead }}>
            {children}
        </ChatContext.Provider>
    );
};

export const useChat = () => {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
};
