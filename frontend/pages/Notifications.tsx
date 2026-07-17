import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Loader2, Eye, User, Zap, Shield, Clock, Heart } from 'lucide-react';
import { getNotifications, markNotificationAsRead } from '../services/apiService';
import { authService } from '../services/authService';
import PostDetailModal from '../components/PostDetailModal';

interface Notification {
    notificationId: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    gameId?: string;
    gameName?: string;
    postId?: string;
    fromUserId?: string;
    fromUserName?: string;
    isRead: boolean;
    createdAt: number;
}

const Notifications: React.FC = () => {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [lastKey, setLastKey] = useState<string | null>(null);
    const [newNotifications, setNewNotifications] = useState<string[]>([]);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const lastLoadTimeRef = useRef(0);
    const isLoadingRef = useRef(false);

    const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
    const [clickPosition, setClickPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const currentUser = authService.getCurrentUser();

    // Initial load
    useEffect(() => {
        loadNotifications(true);
    }, []);

    // Poll for new notifications every 30 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            pollForNewNotifications();
        }, 30000);

        return () => clearInterval(interval);
    }, [notifications]);

    // Intersection observer for infinite scroll
    useEffect(() => {
        if (observerRef.current) observerRef.current.disconnect();

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loadingMore && !isLoadingRef.current) {
                    const now = Date.now();
                    const timeSinceLastLoad = now - lastLoadTimeRef.current;

                    if (timeSinceLastLoad >= 2000) {
                        loadMoreNotifications();
                    }
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observerRef.current.observe(loadMoreRef.current);
        }

        return () => {
            if (observerRef.current) observerRef.current.disconnect();
        };
    }, [hasMore, loadingMore]);

    const loadNotifications = async (isInitial = false) => {
        if (!currentUser) return;

        if (isInitial) setLoading(true);
        setError(null);

        try {
            const response = await getNotifications(currentUser.userId);

            if (response.success) {
                setNotifications(response.notifications || []);
                setUnreadCount(response.unreadCount || 0);
                setHasMore(response.hasMore || false);
                setLastKey(response.lastKey || null);
            } else {
                setError(response.error || '載入失敗');
            }
        } catch (err) {
            console.error('Load notifications error:', err);
            setError('無法載入通知列表');
        } finally {
            if (isInitial) setLoading(false);
        }
    };

    const loadMoreNotifications = async () => {
        if (!currentUser || !hasMore || loadingMore || isLoadingRef.current) return;

        const now = Date.now();
        const timeSinceLastLoad = now - lastLoadTimeRef.current;
        if (timeSinceLastLoad < 2000) return;

        isLoadingRef.current = true;
        lastLoadTimeRef.current = now;
        setLoadingMore(true);

        try {
            const response = await getNotifications(currentUser.userId, lastKey);

            if (response.success) {
                setNotifications(prev => [...prev, ...(response.notifications || [])]);
                setHasMore(response.hasMore || false);
                setLastKey(response.lastKey || null);
            }
        } catch (err) {
            console.error('Load more notifications error:', err);
        } finally {
            setLoadingMore(false);
            isLoadingRef.current = false;
        }
    };

    const pollForNewNotifications = async () => {
        if (!currentUser) return;

        try {
            const response = await getNotifications(currentUser.userId);

            if (response.success) {
                const newNotifs = response.notifications || [];
                const existingIds = new Set(notifications.map(n => n.notificationId));
                const actuallyNew = newNotifs.filter((n: Notification) => !existingIds.has(n.notificationId));

                if (actuallyNew.length > 0) {
                    setNewNotifications(actuallyNew.map((n: Notification) => n.notificationId));
                    setNotifications(prev => [...actuallyNew, ...prev]);

                    setTimeout(() => {
                        setNewNotifications([]);
                    }, 1000);
                }

                // Update unread count
                // We need to be careful not to overwrite the count if we have mock unread items
                // So let's count from our current state + new items
                setUnreadCount(prev => prev + actuallyNew.length);
            }
        } catch (err) {
            console.error('Poll notifications error:', err);
        }
    };

    const handleMarkAsRead = async (notificationId: string) => {
        // If it's a mock notification, just update local state
        if (notificationId.startsWith('mock-')) {
            setNotifications(prev =>
                prev.map(notif =>
                    notif.notificationId === notificationId
                        ? { ...notif, isRead: true }
                        : notif
                )
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
            return;
        }

        try {
            const response = await markNotificationAsRead({ notificationId });

            if (response.success) {
                setNotifications(prev =>
                    prev.map(notif =>
                        notif.notificationId === notificationId
                            ? { ...notif, isRead: true }
                            : notif
                    )
                );

                setUnreadCount(prev => Math.max(0, prev - 1));
            }
        } catch (err) {
            console.error('Mark as read error:', err);
        }
    };

    const handleMarkAllAsRead = async () => {
        const unreadNotifications = notifications.filter(n => !n.isRead);
        for (const notif of unreadNotifications) {
            await handleMarkAsRead(notif.notificationId);
        }
    };

    const handleViewGame = (gameId: string) => {
        navigate(`/event/${encodeURIComponent(gameId)}`);
    };

    const handleViewUser = (userId: string) => {
        navigate(`/reviews/${encodeURIComponent(userId)}`);
    };

    const handleViewPost = (postId: string, e?: React.MouseEvent) => {
        if (e) {
            setClickPosition({ x: e.clientX, y: e.clientY });
        }
        setSelectedPostId(postId);
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'registration': return <User size="1.25rem" />;
            case 'approval': return <Check size="1.25rem" />;
            case 'rejection': return <Shield size="1.25rem" />;
            case 'game_start': return <Zap size="1.25rem" />;
            case 'community_comment': return <Bell size="1.25rem" />;
            case 'community_like': return <Heart size="1.25rem" className="text-cyber-pink" />;
            default: return <Bell size="1.25rem" />;
        }
    };

    const getNotificationColor = (type: string) => {
        switch (type) {
            case 'registration': return 'text-blue-500 bg-blue-50 border-blue-100';
            case 'approval': return 'text-emerald-500 bg-emerald-50 border-emerald-100';
            case 'rejection': return 'text-red-500 bg-red-50 border-red-100';
            case 'game_start': return 'text-[#c5a059] bg-[#c5a059]/5 border-[#c5a059]/10';
            case 'community_comment': return 'text-indigo-500 bg-indigo-50 border-indigo-100';
            case 'community_like': return 'text-rose-500 bg-rose-50 border-rose-100';
            case 'system': return 'text-neutral-500 bg-neutral-50 border-neutral-100';
            default: return 'text-neutral-500 bg-neutral-50 border-neutral-100';
        }
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}天前`;
        if (hours > 0) return `${hours}小時前`;
        if (minutes > 0) return `${minutes}分鐘前`;
        return '現在';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-[0.1875rem] border-neutral-100 border-t-[#c5a059]"></div>
                    <span className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.2em] animate-pulse">正在同步記錄...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col w-full">
            {/* Status Header */}
            <div className="h-16 px-4 flex items-center justify-between bg-white/80 backdrop-blur-xl border-b border-black/[0.02]">
                <div className="flex items-center gap-2.5">
                    <div className={`h-1.5 w-1.5 rounded-full ${unreadCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-200'}`}></div>
                    <span className="text-[0.6875rem] font-black text-neutral-900 uppercase tracking-widest">
                        {unreadCount > 0 ? `${unreadCount} 則未讀動態` : '活動動態'}
                    </span>
                </div>

                {unreadCount > 0 && (
                    <button
                        onClick={handleMarkAllAsRead}
                        className="text-[0.625rem] font-black text-[#c5a059] border border-[#c5a059]/20 px-3 py-1.5 rounded-full hover:bg-[#c5a059]/5 transition-all active:scale-95 flex items-center gap-1.5"
                    >
                        <Check size="0.625rem" strokeWidth={3} />
                        全部標為已讀
                    </button>
                )}
            </div>

            {/* Notifications List */}
            {notifications.length === 0 ? (
                <div className="mx-5 my-12 p-12 bg-white rounded-lg border border-black/[0.03] shadow-sm flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 bg-neutral-50 rounded-full flex items-center justify-center mb-6 border border-black/[0.01]">
                        <Bell size="2rem" className="text-neutral-200" />
                    </div>
                    <h3 className="text-neutral-900 font-black text-sm uppercase tracking-[0.2em] mb-3">暫無通知</h3>
                    <p className="text-neutral-400 text-[0.8125rem] font-medium leading-relaxed max-w-[13.75rem]">
                        目前沒有檢測到任何活動。當有新動態時，會在此處顯示。
                    </p>
                </div>
            ) : (
                <div className="flex flex-col divide-y divide-black/[0.03]">
                    {notifications.map((notification, index) => {
                        const isNew = newNotifications.includes(notification.notificationId);
                        const colorClass = getNotificationColor(notification.type);

                        return (
                            <div
                                key={notification.notificationId}
                                onClick={() => !notification.isRead && handleMarkAsRead(notification.notificationId)}
                                className={`relative group px-5 py-5 transition-all duration-300 cursor-pointer ${notification.isRead
                                    ? 'bg-transparent'
                                    : 'bg-[#c5a059]/[0.02]'
                                    } ${isNew ? 'animate-fade-in' : ''}`}
                            >
                                <div className="flex gap-4">
                                    {/* Icon Column */}
                                    <div className="flex flex-col items-center">
                                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center border shadow-sm transition-transform group-hover:scale-105 ${colorClass}`}>
                                            {getNotificationIcon(notification.type)}
                                        </div>
                                        {!notification.isRead && (
                                            <div className="mt-2 w-1.5 h-1.5 rounded-full bg-[#c5a059]"></div>
                                        )}
                                    </div>

                                    {/* Content Column */}
                                    <div className="flex-1 min-w-0 flex flex-col pt-0.5">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className={`text-[0.625rem] font-black uppercase tracking-widest ${notification.isRead ? 'text-neutral-300' : 'text-[#c5a059]'}`}>
                                                {notification.type.replace('_', ' ')}
                                            </span>
                                            <span className="text-[0.625rem] text-neutral-300 font-black uppercase tracking-tight">
                                                {formatTime(notification.createdAt)}
                                            </span>
                                        </div>

                                        <h3 className={`text-[0.9375rem] font-black leading-tight mb-1.5 tracking-tight group-hover:text-[#c5a059] transition-colors ${notification.isRead ? 'text-neutral-600' : 'text-neutral-900'}`}>
                                            {notification.title}
                                        </h3>

                                        <p className="text-[0.8125rem] text-neutral-400 font-medium leading-relaxed mb-4 line-clamp-2">
                                            {notification.message}
                                        </p>

                                        {/* Contextual Tags */}
                                        {(notification.gameName || notification.fromUserName) && (
                                            <div className="flex flex-wrap gap-2 mb-4">
                                                {notification.gameName && (
                                                    <div className="px-2.5 py-1 rounded-lg bg-neutral-50 text-[0.625rem] font-black text-neutral-500 border border-black/[0.02] flex items-center gap-1.5">
                                                        <Zap size="0.625rem" className="text-[#c5a059]" />
                                                        <span className="uppercase tracking-wide">{notification.gameName}</span>
                                                    </div>
                                                )}
                                                {notification.fromUserName && (
                                                    <div className="px-2.5 py-1 rounded-lg bg-neutral-50 text-[0.625rem] font-black text-neutral-500 border border-black/[0.02] flex items-center gap-1.5">
                                                        <User size="0.625rem" className="text-[#c5a059]" />
                                                        <span className="uppercase tracking-wide">{notification.fromUserName}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Actions */}
                                        <div className="flex gap-2">
                                            {notification.postId && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewPost(notification.postId!, e);
                                                    }}
                                                    className="px-4 py-2 bg-neutral-900 text-white rounded-lg text-[0.6875rem] font-black uppercase tracking-widest active:scale-95 transition-all shadow-md"
                                                >
                                                    查看貼文
                                                </button>
                                            )}
                                            {notification.gameId && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewGame(notification.gameId!);
                                                    }}
                                                    className="px-4 py-2 bg-white text-neutral-900 border border-black/[0.05] rounded-lg text-[0.6875rem] font-black uppercase tracking-widest active:scale-95 transition-all shadow-sm"
                                                >
                                                    查看詳細資訊
                                                </button>
                                            )}
                                            {notification.type === 'registration' && notification.fromUserId && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewUser(notification.fromUserId!);
                                                    }}
                                                    className="px-4 py-2 bg-[#c5a059] text-white rounded-lg text-[0.6875rem] font-black uppercase tracking-widest active:scale-95 transition-all shadow-md shadow-[#c5a059]/20"
                                                >
                                                    查看用戶資料
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Load More Trigger */}
                    {hasMore && (
                        <div ref={loadMoreRef} className="py-12 flex justify-center">
                            {loadingMore ? (
                                <div className="animate-spin rounded-full h-6 w-6 border-[0.125rem] border-neutral-100 border-t-[#c5a059]"></div>
                            ) : (
                                <button
                                    onClick={loadMoreNotifications}
                                    className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.2em] hover:text-[#c5a059] transition-colors"
                                >
                                    載入更多歷史動態
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Post Detail Modal */}
            {selectedPostId && (
                <PostDetailModal
                    postId={selectedPostId}
                    user={currentUser}
                    clickPosition={clickPosition}
                    onClose={() => setSelectedPostId(null)}
                />
            )}
        </div>
    );
};

export default Notifications;