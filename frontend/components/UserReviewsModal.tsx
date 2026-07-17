/**
 * UserReviewsModal - 用戶評論假切頁組件
 * 使用 Portal 渲染到 body，覆蓋在當前頁面上
 * 點擊返回時不會觸發真正的路由變化
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../contexts/ToastContext';
import {
    ArrowLeft, ThumbsUp, ThumbsDown, Star, TrendingUp, CheckCircle, Fingerprint, Award,
    Heart, MessageSquare, Layout, Clock, Calendar, ShieldCheck, Zap
} from 'lucide-react';
import { getUserInfo, getUserComments, getUserCommunityPosts } from '../services/apiService';
import PullToRefresh from './PullToRefresh';
import { useRefresh, usePullToRefresh } from '../contexts/RefreshContext';
import { Post, User } from '../types';

interface Comment {
    commentId: string;
    ratingId: string;
    gameId: string;
    fromUserId: string;
    fromDisplayName?: string;
    toUserId: string;
    isPositive: boolean;
    comment: string;
    createdAt: number;
}

interface UserReviewsModalProps {
    userId: string;
    clickPosition?: { x: number; y: number };
    onClose: () => void;
}

type TabType = 'posts' | 'comments';

const UserReviewsModal: React.FC<UserReviewsModalProps> = ({ userId, clickPosition, onClose }) => {

    const [user, setUser] = useState<User | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('posts');
    const [loading, setLoading] = useState(true);

    // Posts State
    const [posts, setPosts] = useState<Post[]>([]);
    const [postsLastKey, setPostsLastKey] = useState<any>(null);
    const [postsHasMore, setPostsHasMore] = useState(false);
    const [loadingMorePosts, setLoadingMorePosts] = useState(false);

    // Comments State
    const [comments, setComments] = useState<Comment[]>([]);
    const [commentsLastKey, setCommentsLastKey] = useState<any>(null);
    const [commentsHasMore, setCommentsHasMore] = useState(false);
    const [loadingMoreComments, setLoadingMoreComments] = useState(false);

    const { onRefresh } = useRefresh();
    const { showToast } = useToast();
    const contentRef = useRef<HTMLDivElement>(null);

    // 禁止背景滾動
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    // 載入用戶數據
    const loadUserData = useCallback(async () => {
        if (!userId) return;

        try {
            setLoading(true);

            // 1. 獲取核心用戶資料
            const userResponse = await getUserInfo(userId);
            if (userResponse.success && userResponse.data) {
                setUser(userResponse.data);
            }

            // 2. 獲取用戶評論 (Initial)
            const commentsResponse = await getUserComments(userId, 10);
            if (commentsResponse.success && Array.isArray(commentsResponse.data)) {
                setComments(commentsResponse.data);
                setCommentsLastKey(commentsResponse.lastKey);
                setCommentsHasMore(!!commentsResponse.lastKey);
            }

            // 3. 獲取核心貼文 (Initial)
            try {
                const postsResponse = await getUserCommunityPosts(userId, 10);
                if (postsResponse.success && Array.isArray(postsResponse.data)) {
                    setPosts(postsResponse.data);
                    setPostsLastKey(postsResponse.lastKey);
                    setPostsHasMore(!!postsResponse.lastKey);
                }
            } catch (e) {
                console.warn('User community posts fetch failed:', e);
            }

        } catch (error) {
            console.error('Load user data error:', error);
            showToast('載入失敗,請稍後再試', 'error');
        } finally {
            setLoading(false);
        }
    }, [userId, showToast]);

    useEffect(() => {
        loadUserData();
    }, [loadUserData]);

    // 分頁載入貼文
    const loadMorePosts = async () => {
        if (!userId || !postsHasMore || loadingMorePosts) return;
        try {
            setLoadingMorePosts(true);
            const response = await getUserCommunityPosts(userId, 10, postsLastKey);
            if (response.success && Array.isArray(response.data)) {
                setPosts(prev => [...prev, ...response.data]);
                setPostsLastKey(response.lastKey);
                setPostsHasMore(!!response.lastKey);
            }
        } catch (error) {
            console.error('Load more posts error:', error);
        } finally {
            setLoadingMorePosts(false);
        }
    };

    // 分頁載入評論
    const loadMoreComments = async () => {
        if (!userId || !commentsHasMore || loadingMoreComments) return;
        try {
            setLoadingMoreComments(true);
            const response = await getUserComments(userId, 10, commentsLastKey);
            if (response.success && Array.isArray(response.data)) {
                setComments(prev => [...prev, ...response.data]);
                setCommentsLastKey(response.lastKey);
                setCommentsHasMore(!!response.lastKey);
            }
        } catch (error) {
            console.error('Load more comments error:', error);
        } finally {
            setLoadingMoreComments(false);
        }
    };

    const [showCompactHeader, setShowCompactHeader] = useState(false);

    // 監聽模態框內垂直捲動
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;

        setShowCompactHeader(scrollTop > 260);

        if (scrollTop + clientHeight >= scrollHeight - 300) {
            if (activeTab === 'posts' && postsHasMore && !loadingMorePosts) {
                loadMorePosts();
            } else if (activeTab === 'comments' && commentsHasMore && !loadingMoreComments) {
                loadMoreComments();
            }
        }
    };

    // Register refresh handler
    usePullToRefresh(loadUserData);

    // 處理瀏覽器返回按鈕
    useEffect(() => {
        const handlePopState = (e: PopStateEvent) => {
            e.preventDefault();
            onClose();
        };

        window.history.pushState({ modal: 'userReviews' }, '');
        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [onClose]);

    // 統計數據計算
    const stats = useMemo(() => {
        const totalComments = user?.stats?.totalRatings || 0;
        const positiveCount = user?.stats?.positiveRatings || 0;
        const positiveRate = user?.stats?.positiveRatingRate || (totalComments > 0 ? (positiveCount / totalComments) * 100 : 100);

        // 獲讚數與貼文數從後端 API 取得，若無則降級使用目前已加載的數據
        const loadedPostCount = posts.length;
        const loadedLikes = posts.reduce((sum, post) => sum + (post.likeCount || 0), 0);

        // 如果後端有數據且大於0，則使用後端數據，否則使用已加載數據 (避免後端為0但實際有貼文的情況)
        const apiTotalLikes = user?.stats?.totalLikesReceived || 0;
        const apiTotalPosts = user?.stats?.totalPosts || 0;

        const totalLikes = apiTotalLikes > 0 ? apiTotalLikes : loadedLikes;
        const postCount = apiTotalPosts > 0 ? apiTotalPosts : loadedPostCount;

        const gamesHosted = user?.stats?.gamesHosted || user?.gamesHosted || 0;
        const preferredTime = gamesHosted > 5 ? "平日晚間 19:30" : (gamesHosted > 0 ? "不定期開團" : "尚無開團紀錄");

        return {
            positiveCount,
            totalComments,
            negativeCount: Math.max(0, totalComments - positiveCount),
            positiveRate: Math.round(positiveRate),
            totalLikes,
            postCount,
            gamesHosted,
            preferredTime
        };
    }, [user, posts]);

    const originX = clickPosition ? `${(clickPosition.x / window.innerWidth) * 100}%` : '50%';
    const originY = clickPosition ? `${(clickPosition.y / window.innerHeight) * 100}%` : '50%';

    return createPortal(
        <div
            className="fixed inset-0 z-[101] bg-[#f9f9f7] flex flex-col animate-expand-from-point overflow-hidden"
            style={{
                '--origin-x': originX,
                '--origin-y': originY,
            } as React.CSSProperties}
        >
            {/* Unified Sticky Header Section */}
            <div className="pt-safe sticky top-0 z-[50] bg-[#f9f9f7]/95 backdrop-blur-md shadow-sm border-b border-black/[0.05]">
                {/* 1. Navigation Header - Always Visible */}
                <div className="px-4 border-b border-black/[0.03]">
                    <div className="h-14 flex items-center gap-4">
                        <button
                            onClick={onClose}
                            className="w-9 h-9 rounded-lg bg-white flex items-center justify-center text-neutral-400 hover:text-neutral-900 shadow-sm border border-black/[0.03] transition-all active:scale-90"
                        >
                            <ArrowLeft size="1.125rem" strokeWidth={2.5} />
                        </button>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-0.5 ml-0.5">
                                <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                                <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-[0.2em]">PLAYER DOSSIER</span>
                            </div>
                            <h2 className="text-base font-black text-neutral-900 tracking-tight uppercase px-0.5">玩家檔案</h2>
                        </div>
                        <div className="w-9 h-9 rounded-lg bg-[#c5a059]/10 flex items-center justify-center text-[#c5a059]">
                            <ShieldCheck size="1.125rem" strokeWidth={2.5} />
                        </div>
                    </div>
                </div>

                {/* 2. Compact Profile Overlay - Absolute Positioned to prevent layout jump */}
                <div
                    className={`absolute top-full left-0 right-0 bg-[#f9f9f7]/95 backdrop-blur-md shadow-sm border-b border-black/[0.05] overflow-hidden transition-all duration-300 ease-out origin-top z-[-1]`}
                    style={{
                        transform: showCompactHeader ? 'translateY(0)' : 'translateY(-100%)',
                        opacity: showCompactHeader ? 1 : 0,
                        pointerEvents: showCompactHeader ? 'auto' : 'none',
                    }}
                >
                    <div className="px-4 py-3">
                        <div className="bg-white rounded-[0.5rem] p-3 border border-black/[0.04] shadow-sm">
                            {/* Top Row: User Info */}
                            <div className="flex items-center gap-3 mb-3">
                                <div className="relative">
                                    <div className="w-12 h-12 rounded-[0.375rem] bg-neutral-50 p-0.5 border border-black/[0.02] overflow-hidden">
                                        {user ? (
                                            user.pictureUrl ? (
                                                <img src={user.pictureUrl} alt={user.displayName} className="w-full h-full object-cover rounded-[0.25rem]" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-neutral-100 text-neutral-300 font-black">
                                                    {user.displayName.charAt(0)}
                                                </div>
                                            )
                                        ) : (
                                            <div className="w-full h-full bg-neutral-100 animate-pulse" />
                                        )}
                                    </div>
                                    <div className="absolute -bottom-1 -right-1 bg-neutral-900 text-[#c5a059] text-[0.5rem] font-black px-1.5 py-0.5 rounded border border-white leading-none">
                                        LV.1
                                    </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                    {user ? (
                                        <>
                                            <div className="flex items-center justify-between mb-1">
                                                <h2 className="text-sm font-black text-neutral-900 truncate tracking-tight">{user.displayName}</h2>
                                                {user.isVerified && <CheckCircle size="0.75rem" strokeWidth={3} className="text-[#c5a059]" />}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 bg-neutral-50 px-1.5 py-0.5 rounded border border-black/[0.02]">
                                                    <Award size="0.5625rem" className="text-[#c5a059]" />
                                                    <span className="text-[0.5625rem] font-bold text-neutral-500">{user.mahjongExperience || '新手'}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Fingerprint size="0.5625rem" className="text-neutral-300" />
                                                    <span className="text-[0.5625rem] font-mono text-neutral-400">ID:{user.userId.replace('APP_', '').substring(0, 6)}</span>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="h-4 w-24 bg-neutral-100 rounded animate-pulse" />
                                            <div className="h-3 w-32 bg-neutral-100 rounded animate-pulse" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Bottom Row: Stats Grid */}
                            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-dashed border-neutral-100">
                                {[
                                    { label: '開團', value: stats.gamesHosted, color: 'text-[#c5a059]' },
                                    { label: '貼文', value: stats.postCount, color: 'text-neutral-900' },
                                    { label: '獲讚', value: stats.totalLikes, color: 'text-pink-500' },
                                    { label: '好評', value: `${stats.positiveRate}%`, color: 'text-neutral-400' }
                                ].map((item, i) => (
                                    <div key={i} className="flex flex-col items-center">
                                        <span className={`text-[0.8125rem] font-black ${item.color} leading-none mb-0.5`}>{item.value}</span>
                                        <span className="text-[0.5rem] text-neutral-300 font-bold uppercase scale-90">{item.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Compact Tabs Switcher */}
                    <div className="px-4 pb-2">
                        <div className="bg-white p-1 rounded-lg border border-black/[0.04] shadow-sm flex gap-1">
                            <button
                                onClick={() => setActiveTab('posts')}
                                className={`flex-1 py-2 rounded-md text-[0.625rem] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${activeTab === 'posts'
                                    ? 'bg-neutral-900 text-white shadow-md'
                                    : 'text-neutral-400 hover:bg-neutral-50'
                                    }`}
                            >
                                <Layout size="0.75rem" />
                                貼文牆
                            </button>
                            <button
                                onClick={() => setActiveTab('comments')}
                                className={`flex-1 py-2 rounded-md text-[0.625rem] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${activeTab === 'comments'
                                    ? 'bg-neutral-900 text-white shadow-md'
                                    : 'text-neutral-400 hover:bg-neutral-50'
                                    }`}
                            >
                                <MessageSquare size="0.75rem" />
                                評論
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div
                className="flex-1 overflow-y-auto relative z-10 scrollbar-hide pt-2"
                onScroll={handleScroll}
                ref={contentRef}
            >
                <PullToRefresh onRefresh={onRefresh}>
                    {loading && !user ? (
                        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                            <div className="animate-spin rounded-full h-10 w-10 border-[0.1875rem] border-neutral-100 border-t-[#c5a059]"></div>
                            <p className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.3em] animate-pulse">正在同步玩家數據...</p>
                        </div>
                    ) : !user ? (
                        <div className="flex flex-col items-center justify-center py-20 px-10 text-center">
                            <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mb-6">
                                <Star size="1.5rem" className="text-neutral-200" />
                            </div>
                            <p className="text-neutral-400 font-black text-[0.8125rem] uppercase tracking-widest mb-6">找不到有效用戶資訊</p>
                            <button onClick={onClose} className="px-8 py-3 bg-neutral-900 text-white rounded-lg text-[0.6875rem] font-black uppercase tracking-widest">返回上一頁</button>
                        </div>
                    ) : (
                        <div className="pb-20 max-w-2xl mx-auto w-full">
                            {/* Original BIG Profile Hero Section */}
                            <div className="px-4 mb-6 pt-2">
                                <div className="relative bg-white rounded-[0.5rem] p-5 border border-black/[0.05] flex items-center gap-5 overflow-hidden shadow-sm">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#c5a059]/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                                    <div className="relative flex-shrink-0">
                                        <div className="w-20 h-20 rounded-[0.5rem] bg-neutral-50 p-1 border border-black/[0.02] overflow-hidden flex items-center justify-center shadow-inner pt-0">
                                            {user.pictureUrl ? (
                                                <img src={user.pictureUrl} alt={user.displayName} className="w-full h-full object-cover rounded-[0.375rem]" />
                                            ) : (
                                                <span className="text-3xl font-black text-neutral-200">{user.displayName.charAt(0)}</span>
                                            )}
                                        </div>
                                        <div className="absolute -bottom-1.5 -right-1 bg-neutral-900 text-[#c5a059] text-[0.5625rem] font-black px-2 py-0.5 rounded border border-white shadow-sm tracking-tighter">
                                            LV.1
                                        </div>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            <h2 className="text-xl font-black text-neutral-900 truncate tracking-tight">{user.displayName}</h2>
                                            {user.isVerified && <CheckCircle size="0.875rem" strokeWidth={3} className="text-[#c5a059] flex-shrink-0" />}
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <div className="flex items-center gap-1.5 text-neutral-400">
                                                <Fingerprint size="0.6875rem" strokeWidth={2.5} className="text-neutral-300" />
                                                <span className="text-[0.625rem] font-black font-mono tracking-tight uppercase opacity-60">
                                                    ID:{user.userId.replace('APP_', '').substring(0, 8)}
                                                </span>
                                            </div>
                                            <div className="inline-flex items-center gap-2 bg-neutral-50 px-2.5 py-1 rounded border border-black/[0.02] w-fit">
                                                <Award size="0.625rem" strokeWidth={3} className="text-[#c5a059]" />
                                                <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest whitespace-nowrap">
                                                    {user.mahjongExperience || '新手玩家'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Original Detailed Stats Row */}
                            <div className="px-4 mb-4 grid grid-cols-4 gap-2">
                                {[
                                    { icon: Zap, label: '開團', value: stats.gamesHosted, color: 'text-[#c5a059]' },
                                    { icon: Layout, label: '貼文', value: stats.postCount, color: 'text-neutral-900' },
                                    { icon: Heart, label: '獲讚', value: stats.totalLikes, color: 'text-pink-500' },
                                    { icon: MessageSquare, label: '評論', value: stats.totalComments, color: 'text-neutral-400' }
                                ].map((item, idx) => (
                                    <div key={idx} className="bg-white rounded-[0.5rem] p-3 border border-black/[0.04] shadow-sm flex flex-col items-center justify-center">
                                        <div className="mb-1.5">
                                            <item.icon size="0.875rem" className={item.color} />
                                        </div>
                                        <span className="text-lg font-black text-neutral-900 leading-none mb-1 tracking-tighter">{item.value}</span>
                                        <span className="text-[0.5rem] font-black text-neutral-300 uppercase tracking-widest">{item.label}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Original Info & Insights Grid */}
                            <div className="px-4 mb-6 grid grid-cols-2 gap-3">
                                <div className="bg-white p-4 rounded-[0.5rem] border border-black/[0.04] shadow-sm">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <div className="w-1 h-3 bg-neutral-900 rounded-full"></div>
                                        <p className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest leading-none">基本資訊</p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-neutral-400">性別</span>
                                            <span className="font-bold text-neutral-900">{user.gender || '未公開'}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-neutral-400">年齡</span>
                                            <span className="font-bold text-neutral-900">{user.ageRange || '未公開'}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white p-4 rounded-[0.5rem] border border-black/[0.04] shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-2 opacity-[0.03]">
                                        <Clock size="2.5rem" />
                                    </div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                                        <p className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-widest leading-none">開團偏好</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs font-black text-neutral-900 truncate">{stats.preferredTime}</p>
                                        <div className="flex items-center gap-1 text-[0.5625rem] text-neutral-400">
                                            <Calendar size="0.625rem" />
                                            <span>活躍玩家</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Placeholder Tabs Switcher - Visible only when NOT compact */}
                            <div className={`px-4 mb-4 transition-opacity duration-300 ${showCompactHeader ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                                <div className="bg-white p-1 rounded-lg border border-black/[0.04] shadow-sm flex gap-1">
                                    <button
                                        onClick={() => setActiveTab('posts')}
                                        className={`flex-1 py-3 rounded-md text-[0.6875rem] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${activeTab === 'posts'
                                            ? 'bg-neutral-900 text-white shadow-md'
                                            : 'text-neutral-400 hover:bg-neutral-50'
                                            }`}
                                    >
                                        <Layout size="0.875rem" />
                                        貼文牆 ({stats.postCount})
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('comments')}
                                        className={`flex-1 py-3 rounded-md text-[0.6875rem] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${activeTab === 'comments'
                                            ? 'bg-neutral-900 text-white shadow-md'
                                            : 'text-neutral-400 hover:bg-neutral-50'
                                            }`}
                                    >
                                        <MessageSquare size="0.875rem" />
                                        評論紀錄 ({stats.totalComments})
                                    </button>
                                </div>
                            </div>

                            {activeTab === 'posts' && (
                                <div className="space-y-4">
                                    {posts.length === 0 ? (
                                        <div className="bg-white border border-black/[0.03] rounded-[0.5rem] py-16 px-6 text-center shadow-sm">
                                            <div className="inline-flex p-4 bg-neutral-50 rounded-full mb-4">
                                                <Layout size="1.5rem" className="text-neutral-100" />
                                            </div>
                                            <p className="text-neutral-300 font-black text-[0.75rem] uppercase tracking-widest">目前尚無公開貼文</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="grid grid-cols-1 gap-4">
                                                {posts.map((post) => (
                                                    <div key={post.postId} className="bg-white border border-black/[0.04] rounded-[0.5rem] p-5 shadow-sm">
                                                        <div className="flex items-center justify-between mb-4">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                                                                <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">
                                                                    {new Date(post.createdAt).toLocaleDateString('zh-TW')}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-pink-500">
                                                                <Heart size="0.875rem" fill={post.isLikedByMe ? "#ec4899" : "none"} />
                                                                <span className="text-[0.6875rem] font-bold">{post.likeCount}</span>
                                                            </div>
                                                        </div>
                                                        <p className="text-[0.875rem] text-neutral-600 leading-relaxed mb-4 whitespace-pre-wrap">{post.content}</p>
                                                        {post.images && post.images.length > 0 && (
                                                            <div className="rounded-lg overflow-hidden border border-black/[0.02]">
                                                                <img src={post.images[0]} alt="" className="w-full aspect-video object-cover" />
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            {(postsHasMore || loadingMorePosts) && (
                                                <div className="py-8 flex justify-center">
                                                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-neutral-100 border-t-[#c5a059]"></div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                            {activeTab === 'comments' && (
                                <div className="space-y-3">
                                    <div className="bg-white border border-black/[0.04] rounded-[0.5rem] p-5 shadow-sm mb-4">
                                        <div className="flex justify-between items-center mb-4">
                                            <span className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-widest">獲評滿意度 / 社群推薦指數</span>
                                            <span className="text-[1.125rem] font-black text-neutral-900 leading-none">{stats.positiveRate}%</span>
                                        </div>

                                        <div className="relative h-2 bg-neutral-50 rounded-full overflow-hidden mb-5">
                                            <div
                                                className="absolute inset-y-0 left-0 bg-[#c5a059] transition-all duration-1000"
                                                style={{ width: `${stats.positiveRate}%` }}
                                            ></div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-px bg-black/[0.02] rounded-lg overflow-hidden border border-black/[0.02]">
                                            <div className="bg-white p-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                                    <ThumbsUp size="0.75rem" className="text-[#c5a059]" strokeWidth={3} />
                                                    <span className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-widest">好評內容</span>
                                                </div>
                                                <div className="text-xl font-black text-neutral-900">{stats.positiveCount}</div>
                                            </div>
                                            <div className="bg-white p-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                                    <ThumbsDown size="0.75rem" className="text-neutral-200" strokeWidth={3} />
                                                    <span className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-widest">待進步/差評</span>
                                                </div>
                                                <div className="text-xl font-black text-neutral-200">{stats.negativeCount}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {comments.length === 0 ? (
                                        <div className="bg-white border border-black/[0.03] rounded-[0.5rem] py-16 px-6 text-center shadow-sm">
                                            <div className="p-4 bg-neutral-50 rounded-full mb-4">
                                                <Star size="1.5rem" className="text-neutral-100" />
                                            </div>
                                            <p className="text-neutral-300 font-black text-[0.75rem] uppercase tracking-widest">目前尚未收到評論</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="space-y-3">
                                                {comments.map((comment) => (
                                                    <div
                                                        key={comment.commentId || comment.ratingId}
                                                        className="bg-white border border-black/[0.04] rounded-[0.5rem] p-5 shadow-sm"
                                                    >
                                                        <div className="flex items-center justify-between mb-4">
                                                            <div className="flex items-center gap-2.5">
                                                                {comment.isPositive ? (
                                                                    <div className="flex items-center gap-1.5 text-[#c5a059] bg-[#c5a059]/5 px-2.5 py-1 rounded-[0.25rem] text-[0.625rem] font-black uppercase tracking-widest border border-[#c5a059]/10">
                                                                        <ThumbsUp size="0.6875rem" strokeWidth={3} />
                                                                        <span>優秀</span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-1.5 text-neutral-300 bg-neutral-50 px-2.5 py-1 rounded-[0.25rem] text-[0.625rem] font-black uppercase tracking-widest border border-black/[0.01]">
                                                                        <ThumbsDown size="0.6875rem" strokeWidth={3} />
                                                                        <span>一般</span>
                                                                    </div>
                                                                )}
                                                                <span className="text-[0.6875rem] font-black text-neutral-900 uppercase tracking-tight">{comment.fromDisplayName || '社群玩家'}</span>
                                                            </div>
                                                            <span className="text-[0.625rem] font-black text-neutral-200 uppercase tracking-tighter">
                                                                {new Date(comment.createdAt * 1000).toLocaleDateString('zh-TW')}
                                                            </span>
                                                        </div>
                                                        <div className="pl-3 border-l-2 border-[#c5a059]/10 py-0.5">
                                                            <p className="text-neutral-600 text-[0.875rem] leading-relaxed font-medium">{comment.comment}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            {(commentsHasMore || loadingMoreComments) && (
                                                <div className="py-8 flex justify-center">
                                                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-neutral-100 border-t-[#c5a059]"></div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                    )}
                </PullToRefresh>
            </div >
        </div >,
        document.body
    );
};

export default UserReviewsModal;
