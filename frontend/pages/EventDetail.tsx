import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../contexts/ToastContext';
import CyberpunkConfirmModal from '../components/CyberpunkConfirmModal';
import { useParams, useNavigate } from 'react-router-dom';
import { GroupEvent, Game, UserStats, User } from '../types';
import { X, Zap, MapPin, Users, Coins, Clock, Gamepad2, Phone, Copy, Loader2, Check, Ban, Settings, Star, ArrowLeft, Gift } from 'lucide-react';
import { api, gameToGroupEvent } from '../services/dataService';
import { authService } from '../services/authService';
import ProfileIncompleteModal from '../components/ProfileIncompleteModal';
import TermsAgreementModal from '../components/TermsAgreementModal';
import { isProfileComplete, getMissingProfileFields } from '../utils/profileUtils';
import PullToRefresh from '../components/PullToRefresh';
import { useRefresh, usePullToRefresh } from '../contexts/RefreshContext';
import PushPermissionModal from '../components/PushPermissionModal';
import { notificationService } from '../services/notificationService';
import { claimPushBonus } from '../services/apiService';
import { STORAGE_KEYS } from '../constants';

interface EventDetailProps {
    events: GroupEvent[];
    onJoin: (id: string) => void;
    user: User | null;
}

const EventDetail: React.FC<EventDetailProps> = ({ events, onJoin, user }) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState<GroupEvent | undefined>(undefined);
    const [gameDetail, setGameDetail] = useState<Game | null>(null);
    const [registrations, setRegistrations] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [joining, setJoining] = useState(false);

    const [processingReg, setProcessingReg] = useState<string | null>(null);
    const [userRatings, setUserRatings] = useState<Record<string, { positiveRate: number, count: number }>>({});
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [showCancelRegDialog, setShowCancelRegDialog] = useState(false);
    const [cancellingReg, setCancellingReg] = useState(false);

    // Host Info State
    const [hostStats, setHostStats] = useState<UserStats | null>(null);
    const [hostGender, setHostGender] = useState<string>('');
    const [hostAgeRange, setHostAgeRange] = useState<string>('');

    const { showToast } = useToast();

    // 個人資料檢查相關狀態
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [missingFields, setMissingFields] = useState<string[]>([]);

    // 服務條款確認狀態
    const [showTermsAgreement, setShowTermsAgreement] = useState(false);

    // 推播引導狀態
    const [isPushModalOpen, setIsPushModalOpen] = useState(false);

    // 照片放大檢視
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const currentUser = user;

    const fetchGameDetail = useCallback(async () => {
        if (!id) return;

        setLoading(true);
        try {
            const detail = await api.getGameDetail(id);
            if (detail) {
                setGameDetail(detail.game);
                setRegistrations(detail.registrations);

                // Set Host Info
                if (detail.hostStats) setHostStats(detail.hostStats);
                if (detail.hostGender) setHostGender(detail.hostGender);
                if (detail.hostAgeRange) setHostAgeRange(detail.hostAgeRange);

                // Convert to GroupEvent for display
                const groupEvent = gameToGroupEvent(detail.game, currentUser?.userId);
                setEvent(groupEvent);

                // Fetch ratings for all players and applicants
                const usersToFetch = [
                    detail.game.hostUserId,
                    ...detail.game.joinedPlayers.map(p => p.userId),
                    ...detail.registrations.map(r => r.userId)
                ];
                // Remove duplicates
                const uniqueUsers = Array.from(new Set(usersToFetch));
                fetchUsersRatings(uniqueUsers);
            }
        } catch (error) {
            console.error('Failed to fetch game detail:', error);
            // Fallback to events list
            const found = events.find(e => e.id === id);
            setEvent(found);
        } finally {
            setLoading(false);
        }
    }, [id, events, currentUser?.userId]);

    // Register refresh handler
    usePullToRefresh(fetchGameDetail);

    useEffect(() => {
        fetchGameDetail();
    }, [fetchGameDetail]);

    const fetchUsersRatings = async (userIds: string[]) => {
        const ratingsMap: Record<string, { positiveRate: number, count: number }> = { ...userRatings };

        await Promise.all(userIds.map(async (userId) => {
            if (ratingsMap[userId]) return; // Skip if already fetched

            try {
                const response = await api.getRatings(userId);
                if (response.success && response.data?.ratings) {
                    const ratings = response.data.ratings;
                    const positiveCount = ratings.filter((r: any) => r.isPositive).length;
                    const totalCount = ratings.length;
                    ratingsMap[userId] = {
                        positiveRate: totalCount > 0 ? Math.round((positiveCount / totalCount) * 100) : 100,
                        count: totalCount
                    };
                } else {
                    ratingsMap[userId] = { positiveRate: 100, count: 0 };
                }
            } catch (error) {
                console.error(`Failed to fetch ratings for ${userId}:`, error);
                ratingsMap[userId] = { positiveRate: 100, count: 0 };
            }
        }));

        setUserRatings(ratingsMap);
    };

    const handleJoin = async () => {
        if (!id || !event) return;
        setShowTermsAgreement(true);
    };

    const handlePushConfirm = async () => {
        if (!user) return;

        try {
            const subscribed = await notificationService.subscribe();
            if (subscribed) {
                const bonusResult = await claimPushBonus(user.userId);
                if (bonusResult.success) {
                    showToast(`恭喜獲得 ${bonusResult.data?.points || 360} 點數獎勵！`, 'success', '領取成功');
                    // 確保本地 user 狀態更新
                    const storedUser = localStorage.getItem(STORAGE_KEYS.USER);
                    if (storedUser) {
                        const u = JSON.parse(storedUser);
                        u.hasClaimedPushBonus = true;
                        if (bonusResult.data?.newPoints) {
                            u.points = bonusResult.data.newPoints;
                        }
                        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(u));
                    }
                }
            }
        } catch (error: any) {
            console.error('Push confirmation failed:', error);
            showToast(error.message || '開啟推播失敗', 'error');
        } finally {
            setIsPushModalOpen(false);
        }
    };

    const confirmJoin = async () => {
        setShowTermsAgreement(false);
        setJoining(true);
        try {
            console.log('🚀 [JoinGame] Starting join process');

            // 1. 即時從 API 獲取最新的個人資料
            const currentUser = user;
            if (!currentUser) {
                showToast('請先登入', 'error');
                setJoining(false);
                return;
            }

            const profileResponse = await api.getUserInfo(currentUser.userId);

            if (!profileResponse.success || !profileResponse.data) {
                console.error('❌ [JoinGame] Failed to fetch latest profile:', profileResponse.error);
                showToast('無法驗證個人資料狀態，請稍後再試', 'error');
                setJoining(false);
                return;
            }

            const latestUser = profileResponse.data as User;
            console.log('✅ [JoinGame] Latest profile fetched:', latestUser);

            // 2. 檢查個人資料完整性
            if (!isProfileComplete(latestUser)) {
                console.log('⚠️ [JoinGame] Profile incomplete, showing modal');
                setMissingFields(getMissingProfileFields(latestUser));
                setShowProfileModal(true);
                setJoining(false);
                return;
            }

            console.log('✨ [JoinGame] Profile complete, proceeding to register');

            // 3. 執行報名 (使用傳入的 onJoin 以確保全域狀態刷新)
            await onJoin(id || '');

            // 4. 報名成功後的推播引導檢查
            const isSupported = notificationService.isPushSupported();
            const permission = notificationService.getPermissionState();

            if (isSupported && !latestUser.hasClaimedPushBonus && permission !== 'denied') {
                // 延遲一點點顯示，讓報名成功的 message 先被看到或是有個過度
                setTimeout(() => {
                    setIsPushModalOpen(true);
                }, 800);
            } else {
                showToast('報名成功！請等待主揪審核', 'success', '成功');
            }

            // 5. 刷新頁面資料
            const detail = await api.getGameDetail(id || '');
            if (detail) {
                setGameDetail(detail.game);
                setRegistrations(detail.registrations);
                setEvent(gameToGroupEvent(detail.game, currentUser.userId));
            }
        } catch (error: any) {
            console.error('Failed to join game:', error);
            const errorMessage = error.message || '報名失敗，請稍後再試';
            showToast(errorMessage, 'error');
        } finally {
            setJoining(false);
        }
    };

    const handleAcceptRegistration = async (regId: string) => {
        if (!id) return;
        setProcessingReg(regId);
        try {
            await api.acceptRegistration(id, regId);
            showToast('已接受報名', 'success', '成功');
            // Refresh
            const detail = await api.getGameDetail(id);
            if (detail) {
                setGameDetail(detail.game);
                setRegistrations(detail.registrations);
                setEvent(gameToGroupEvent(detail.game, currentUser?.userId));
            }
        } catch (error: any) {
            console.error('Failed to accept:', error);
            const errorMessage = error.message || '操作失敗';
            showToast(errorMessage, 'error');
        } finally {
            setProcessingReg(null);
        }
    };

    const handleRejectRegistration = async (regId: string) => {
        if (!id) return;
        setProcessingReg(regId);
        try {
            await api.rejectRegistration(id, regId);
            showToast('已拒絕報名', 'success', '成功');
            // Refresh
            const detail = await api.getGameDetail(id);
            if (detail) {
                setGameDetail(detail.game);
                setRegistrations(detail.registrations);
                setEvent(gameToGroupEvent(detail.game, currentUser?.userId));
            }
        } catch (error: any) {
            console.error('Failed to reject:', error);
            const errorMessage = error.message || '操作失敗';
            showToast(errorMessage, 'error');
        } finally {
            setProcessingReg(null);
        }
    };

    const handleCancelGame = async () => {
        if (!id) return;
        setCancelling(true);
        try {
            await api.cancelEvent(id);
            showToast('團局已取消', 'success', '成功');
            setTimeout(() => navigate('/'), 1500);
        } catch (error: any) {
            console.error('Failed to cancel game:', error);
            const errorMessage = error.message || '取消失敗';
            showToast(errorMessage, 'error');
        } finally {
            setCancelling(false);
            setShowCancelDialog(false);
        }
    };

    const handleCancelRegistration = async () => {
        if (!id || !currentUser) return;
        const userReg = registrations.find(r => r.userId === currentUser.userId && r.status === 'pending');
        if (!userReg) return;

        setCancellingReg(true);
        try {
            await api.cancelRegistration(id, userReg.registrationId);
            showToast('已取消報名', 'success', '成功');
            // Refresh game detail
            const detail = await api.getGameDetail(id);
            if (detail) {
                setGameDetail(detail.game);
                setRegistrations(detail.registrations);
                setEvent(gameToGroupEvent(detail.game, currentUser?.userId));
            }
        } catch (error: any) {
            console.error('Failed to cancel registration:', error);
            const errorMessage = error.message || '取消失敗';
            showToast(errorMessage, 'error');
        } finally {
            setCancellingReg(false);
            setShowCancelRegDialog(false);
        }
    };

    if ((loading && !event) || joining || !!processingReg) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                    <Loader2 className="animate-spin text-cyber-cyan" size="2.5rem" />
                    <p className="text-cyber-cyan font-mono text-sm animate-pulse">連線同步中...</p>
                </div>
            </div>
        );
    }

    if (!event) return null;

    const { onRefresh } = useRefresh();

    return (
        <PullToRefresh onRefresh={onRefresh}>
            <div className="bg-[#f9f9f7] min-h-screen pb-32 relative animate-fade-in pt-safe">
                <div className="p-5 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-8">


                    {/* Header - Integrated with TopBar context */}
                    {/* Header - Standardized EventDetail Style (4rem height) */}
                    <div className="h-16 flex items-center mb-2 lg:col-span-3">
                        <div className="flex items-center gap-4 w-full">
                            <button
                                onClick={() => navigate(-1)}
                                className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-neutral-400 hover:text-neutral-900 shadow-sm border border-black/[0.03] transition-all active:scale-90"
                            >
                                <ArrowLeft size="1.25rem" />
                            </button>
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-1">
                                    <span className="text-[0.625rem] font-black text-[#c5a059] uppercase tracking-[0.2em]">EVENT INTELLIGENCE</span>
                                    <div className="h-[0.0625rem] flex-1 bg-black/[0.03]"></div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <p className="text-[0.6875rem] font-black text-neutral-400 bg-neutral-100 px-3 py-1 rounded-full border border-black/[0.02]">#{event.id.slice(-6).toUpperCase()}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Title Card */}
                    <div className="relative overflow-hidden bg-white border border-black/[0.03] rounded-lg p-8 shadow-[0_0.9375rem_3.125rem_rgba(0,0,0,0.02)] lg:col-span-2 group">
                        {/* Decorative Elements */}
                        <div className="absolute top-0 right-0 w-40 h-40 bg-[#c5a059]/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none transition-transform group-hover:scale-110"></div>

                        <h3 className="text-neutral-900 font-black text-3xl mb-6 leading-tight relative z-10">{event.title}</h3>

                        <div className="flex items-start gap-4 relative z-10">
                            <div className="mt-1 w-10 h-10 rounded-lg bg-[#c5a059]/10 flex items-center justify-center flex-shrink-0">
                                <MapPin size="1.125rem" className="text-cyber-cyan" />
                            </div>
                            <div>
                                <p className="text-neutral-900 font-black text-lg">{event.location}</p>
                                <p className="text-neutral-400 font-medium text-[0.875rem] mt-1.5 leading-relaxed">{event.address}</p>
                            </div>
                        </div>
                    </div>

                    {/* Module: Image Carousel */}
                    {event.images && event.images.length > 0 && (
                        <div className="lg:col-span-2 space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-1.5 h-4 bg-[#c5a059] rounded-full"></div>
                                    <span className="text-[0.6875rem] font-black text-neutral-900 tracking-widest uppercase">Visual Registry</span>
                                </div>
                                <span className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-widest">{event.images.length} ARCHIVES</span>
                            </div>

                            {/* Horizontal Scroll with Snap */}
                            <div className="flex overflow-x-auto gap-5 pb-4 snap-x snap-mandatory no-scrollbar scroll-smooth">
                                {event.images.map((img, i) => (
                                    <div
                                        key={i}
                                        onClick={() => setSelectedImage(img)}
                                        className="flex-none w-[85vw] sm:w-[31.25rem] aspect-[4/3] rounded-lg overflow-hidden border border-black/[0.03] shadow-xl snap-center relative group cursor-pointer"
                                    >
                                        <img src={img} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="absolute top-6 right-6 px-4 py-2 bg-white/90 backdrop-blur-md rounded-lg text-[0.625rem] font-black text-neutral-900 border border-black/[0.03] shadow-sm">
                                            {i + 1} / {event.images?.length}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Status Bar */}
                    <div className="flex gap-4 lg:col-span-2">
                        <div className="flex-1 bg-white border border-black/[0.03] rounded-lg p-5 flex flex-col items-center shadow-sm min-h-[10rem]">
                            <span className="text-[0.625rem] text-neutral-400 font-black uppercase mb-3 tracking-[0.2em]">目前人數</span>
                            <div className="flex-1 flex items-center justify-center w-full">
                                <div className="flex items-center gap-[0.0625rem]">
                                    <img src="/userJoin/icon-watiing_lightMode_selfIcon-No1@3x.png" alt="P1" className="w-[2.8rem] object-contain" />
                                    <img src={event.currentMembers >= 2 ? "/userJoin/icon-userJoined-No2@3x.png" : "/userJoin/icon-userEmpty-No2@3x.png"} alt="P2" className="w-[2.8rem] object-contain" />
                                    <img src={event.currentMembers >= 3 ? "/userJoin/icon-userJoined-No3@3x.png" : "/userJoin/icon-userEmpty-No3@3x.png"} alt="P3" className="w-[2.8rem] object-contain" />
                                    <img src={event.currentMembers >= 4 ? "/userJoin/icon-userJoined-No4@3x.png" : "/userJoin/icon-userEmpty-No4@3x.png"} alt="P4" className="w-[2.8rem] object-contain" />
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 bg-white border border-black/[0.03] rounded-lg p-6 flex flex-col items-center justify-center shadow-sm">
                            <span className="text-[0.625rem] text-neutral-300 font-black uppercase mb-2 tracking-[0.2em]">STATUS</span>
                            <div className={`flex items-center gap-3 font-black text-xl ${event.status === 'recruiting' ? 'text-green-500' :
                                event.status === 'full' ? 'text-[#c5a059]' :
                                    event.status === 'cancelled' ? 'text-red-500' : 'text-neutral-400'
                                }`}>
                                {event.status === 'recruiting' ? <Zap size="1.25rem" fill="currentColor" className="animate-pulse" /> :
                                    event.status === 'full' ? <Users size="1.25rem" /> :
                                        event.status === 'cancelled' ? <Ban size="1.25rem" /> : <Clock size="1.25rem" />}
                                <span className="uppercase tracking-tight text-lg">
                                    {event.status === 'recruiting' ? 'RECRUITING' :
                                        event.status === 'full' ? 'ESTABLISHED' :
                                            event.status === 'cancelled' ? 'CANCELLED' :
                                                event.status === 'closed' ? 'ARCHIVED' : event.status}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Info List (Minimal Lux Style) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:col-span-2">
                        {/* Stakes */}
                        <div className="flex items-center justify-between p-6 bg-white border border-black/[0.02] rounded-lg hover:shadow-xl transition-all duration-500 group">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-lg bg-neutral-900 flex items-center justify-center text-white shadow-lg shadow-neutral-900/10 active:scale-95 transition-transform">
                                    <Coins size="1.375rem" />
                                </div>
                                <span className="text-[0.9375rem] text-neutral-400 font-bold uppercase tracking-widest">Entry Stakes</span>
                            </div>
                            <span className="text-neutral-900 font-black text-2xl tracking-tight">{event.stakes}</span>
                        </div>

                        {/* Time */}
                        <div className="flex items-center justify-between p-6 bg-white border border-black/[0.02] rounded-lg hover:shadow-xl transition-all duration-500 group">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-lg bg-[#c5a059] flex items-center justify-center text-white shadow-lg shadow-[#c5a059]/20">
                                    <Clock size="1.375rem" />
                                </div>
                                <span className="text-[0.9375rem] text-neutral-400 font-bold uppercase tracking-widest">Kickoff Time</span>
                            </div>
                            <span className="text-neutral-900 font-black text-[0.9375rem] bg-neutral-50 px-4 py-2 rounded-lg">
                                {new Date(event.date).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                            </span>
                        </div>

                        {/* Detailed Rules */}
                        {gameDetail?.gameInfo.rules && gameDetail.gameInfo.rules.length > 0 && (
                            <div className="md:col-span-2 p-7 bg-white border border-black/[0.03] rounded-lg shadow-sm">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400">
                                        <Gamepad2 size="1.25rem" />
                                    </div>
                                    <span className="text-[0.6875rem] font-black uppercase tracking-[0.2em] text-neutral-500">Mahjong Protocol</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {gameDetail.gameInfo.rules.map((rule, i) => (
                                        <div key={i} className="text-[0.875rem] text-neutral-600 font-bold flex items-center gap-3 p-4 bg-neutral-50/50 rounded-lg border border-black/[0.01]">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#c5a059]/40"></div>
                                            {rule}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Features & Restrictions Grid */}
                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Features */}
                            {gameDetail?.venueFeatures && gameDetail.venueFeatures.length > 0 && (
                                <div className="p-7 bg-white border border-black/[0.03] rounded-lg shadow-sm">
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="w-10 h-10 rounded-lg bg-[#c5a059]/10 flex items-center justify-center text-[#c5a059]">
                                            <Star size="1.25rem" />
                                        </div>
                                        <span className="text-[0.6875rem] font-black uppercase tracking-[0.2em] text-neutral-500">Premium Amenities</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {gameDetail.venueFeatures.map((feature, i) => (
                                            <span key={i} className="px-4 py-2 bg-[#c5a059]/5 border border-[#c5a059]/10 rounded-lg text-[0.6875rem] text-[#c5a059] font-black uppercase tracking-wider">
                                                {feature}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Restrictions */}
                            {gameDetail?.restrictions && gameDetail.restrictions.length > 0 && (
                                <div className="p-7 bg-white border border-black/[0.03] rounded-lg shadow-sm">
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-red-400">
                                            <Ban size="1.25rem" />
                                        </div>
                                        <span className="text-[0.6875rem] font-black uppercase tracking-[0.2em] text-neutral-500">Restricted Terms</span>
                                    </div>
                                    <div className="space-y-3">
                                        {gameDetail.restrictions.map((restriction, i) => (
                                            <div key={i} className="text-[0.8125rem] text-neutral-500 font-medium flex items-center gap-3 p-3.5 bg-red-50/30 rounded-lg border border-red-100/50">
                                                <div className="w-1.5 h-1.5 rounded-full bg-red-400/30"></div>
                                                {restriction}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sidebar Column */}
                    <div className="space-y-8 lg:col-span-1">
                        {/* Host Info Block */}
                        <div className="bg-neutral-900 p-8 rounded-lg relative overflow-hidden shadow-2xl group">
                            {/* Champagne accent */}
                            <div className="absolute top-0 right-0 w-48 h-48 bg-[#c5a059]/10 rounded-full blur-3xl -mr-24 -mt-24 pointer-events-none"></div>

                            <div className="flex items-center gap-3 text-[#c5a059] text-[0.625rem] font-black uppercase tracking-[0.2em] mb-8 relative z-10">
                                <Users size="1.25rem" />
                                <span>Executive Host</span>
                            </div>

                            <div className="flex flex-col items-center text-center relative z-10">
                                <div className="w-24 h-24 rounded-full bg-neutral-800 p-1 mb-5 border border-white/5 shadow-2xl group-hover:scale-105 transition-transform duration-500 overflow-hidden">
                                    {gameDetail?.hostPictureUrl ? (
                                        <img src={gameDetail.hostPictureUrl} alt={gameDetail.hostDisplayName} className="w-full h-full object-cover rounded-full" />
                                    ) : gameDetail?.hostDisplayName ? (
                                        <div className="w-full h-full rounded-full flex items-center justify-center bg-[#c5a059] text-white font-black text-3xl">{gameDetail.hostDisplayName[0]}</div>
                                    ) : (
                                        <Users size="2.5rem" className="text-neutral-700" />
                                    )}
                                </div>

                                <div className="flex items-center gap-3 mb-6">
                                    <p className="text-white font-black text-2xl tracking-tight">{gameDetail?.hostDisplayName}</p>
                                    <div className="flex items-center gap-2">
                                        {hostGender && (
                                            <span className={`text-[0.5625rem] font-black px-2.5 py-1 rounded-lg border uppercase tracking-widest ${hostGender === 'male' || hostGender === '男' ? 'text-blue-400 border-blue-400/30 bg-blue-400/10' :
                                                hostGender === 'female' || hostGender === '女' ? 'text-pink-400 border-pink-400/30 bg-pink-400/10' :
                                                    'text-neutral-500 border-neutral-800 bg-neutral-800'
                                                }`}>
                                                {hostGender === 'male' ? 'M' : hostGender === 'female' ? 'F' : hostGender}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 w-full mb-8">
                                    <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                                        <span className="text-[0.625rem] font-black text-neutral-500 uppercase tracking-widest block mb-1">Reputation</span>
                                        <div className="flex items-center justify-center gap-2">
                                            <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                            <span className="text-white text-xl font-black">
                                                {hostStats ? Math.round(hostStats.positiveRatingRate) : (userRatings[gameDetail?.hostUserId || '']?.positiveRate || 100)}%
                                            </span>
                                        </div>
                                    </div>
                                    <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                                        <span className="text-[0.625rem] font-black text-neutral-500 uppercase tracking-widest block mb-1">Vouches</span>
                                        <span className="text-white text-xl font-black block">
                                            {hostStats ? hostStats.totalRatings : (userRatings[gameDetail?.hostUserId || '']?.count || 0)}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    onClick={() => navigate(`/reviews/${gameDetail?.hostUserId}`)}
                                    className="w-full py-4.5 bg-[#c5a059] text-white rounded-lg font-black text-xs uppercase tracking-widest hover:bg-[#b08d4a] transition-all shadow-xl shadow-[#c5a059]/10 active:scale-[0.98]"
                                >
                                    Intelligence Dossier
                                </button>
                            </div>
                        </div>

                        {/* Contact Block */}
                        <div className="bg-white border border-black/[0.03] p-8 rounded-lg relative overflow-hidden shadow-sm group">
                            <div className="flex items-center gap-3 text-[#c5a059] text-[0.625rem] font-black uppercase tracking-[0.2em] mb-6">
                                <Phone size="0.875rem" />
                                <span>Encrypted Contact</span>
                            </div>
                            <div className="bg-neutral-50/50 p-5 rounded-lg border border-black/[0.01] backdrop-blur-sm">
                                <div className="flex items-center justify-between">
                                    <span className="text-neutral-400 text-[0.625rem] font-black uppercase tracking-widest">{event.contactMethod}</span>
                                    <div className="flex items-center gap-3">
                                        {(event.isOwner || event.joined) ? (
                                            (event.lineId || (event.isOwner && currentUser?.lineId)) ? (
                                                <>
                                                    <span className="text-neutral-900 font-black text-xl tracking-tight">{event.lineId || currentUser?.lineId}</span>
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(event.lineId || currentUser?.lineId || '');
                                                            showToast('Registry ID Copied', 'success', 'System');
                                                        }}
                                                        className="w-10 h-10 bg-white shadow-sm rounded-lg flex items-center justify-center text-[#c5a059] hover:bg-[#c5a059] hover:text-white transition-all border border-black/[0.03]"
                                                    >
                                                        <Copy size="1rem" />
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="text-neutral-300 text-xs font-bold uppercase">Unregistered</span>
                                            )
                                        ) : (
                                            <div className="flex items-center gap-2 text-neutral-300">
                                                <Clock size="0.875rem" />
                                                <span className="text-[0.6875rem] font-bold uppercase tracking-wider">Locked until approved</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Participants Section */}
                    <div className="space-y-4 lg:col-span-1">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-1.5 h-4 bg-[#c5a059] rounded-full"></div>
                            <h4 className="text-neutral-900 font-black text-xs uppercase tracking-widest">
                                Established Registry ({((gameDetail?.joinedPlayers.filter(p => p.userId !== gameDetail.hostUserId).length || 0) + 1)})
                            </h4>
                        </div>

                        <div className="space-y-3">
                            {/* Host Card */}
                            <div className="bg-white border border-black/[0.03] p-5 rounded-lg relative overflow-hidden shadow-sm hover:border-[#c5a059]/30 transition-all">
                                <div className="absolute top-0 right-0 px-3 py-1 bg-[#c5a059] text-white text-[0.5625rem] font-black tracking-widest uppercase rounded-bl-xl">
                                    HOST
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-lg bg-neutral-50 flex items-center justify-center border border-black/[0.03] overflow-hidden shadow-sm">
                                        {gameDetail?.hostPictureUrl ? (
                                            <img src={gameDetail.hostPictureUrl} alt={gameDetail.hostDisplayName} className="w-full h-full object-cover" />
                                        ) : gameDetail?.hostDisplayName ? (
                                            <div className="text-[#c5a059] font-black text-xl">{gameDetail.hostDisplayName[0]}</div>
                                        ) : (
                                            <ArrowLeft size="1.5rem" className="text-white" />
                                        )}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <p className="text-neutral-900 font-black text-[0.9375rem]">{gameDetail?.hostDisplayName}</p>
                                            {(event.isOwner || event.joined) && (event.lineId || (event.isOwner && currentUser?.lineId)) && (
                                                <div className="flex items-center gap-2 bg-[#c5a059]/10 px-2 py-0.5 rounded-lg border border-[#c5a059]/20">
                                                    <span className="text-[0.5625rem] text-[#c5a059] font-black tracking-tighter">LINE: {event.lineId || currentUser?.lineId}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigator.clipboard.writeText(event.lineId || currentUser?.lineId || '');
                                                            showToast('Host ID Copied', 'success', 'System');
                                                        }}
                                                        className="text-[#c5a059] hover:text-[#b08d4a] transition-colors"
                                                    >
                                                        <Copy size="0.625rem" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                            <span className="text-neutral-400 text-[0.625rem] font-bold">
                                                {userRatings[gameDetail?.hostUserId || '']?.positiveRate || 100}% SCORE
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Joined Players */}
                            {gameDetail?.joinedPlayers
                                .filter(player => {
                                    if (player.userId === gameDetail.hostUserId) return false;
                                    if (player.lineId && event.lineId && player.lineId === event.lineId) return false;
                                    if (event.isOwner && player.lineId && currentUser?.lineId && player.lineId === currentUser.lineId) return false;
                                    return true;
                                })
                                .map((player) => (
                                    <div key={player.userId} className="bg-white border border-black/[0.03] p-5 rounded-lg hover:bg-neutral-50/50 transition-all shadow-sm">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-lg bg-neutral-50 flex items-center justify-center border border-black/[0.03] overflow-hidden">
                                                {player.pictureUrl ? (
                                                    <img src={player.pictureUrl} alt={player.displayName} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="text-[#c5a059] font-black text-xl">{player.displayName[0]}</div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-3 mb-1">
                                                    <p className="text-neutral-900 font-black text-[0.9375rem]">{player.displayName}</p>
                                                    {(event.isOwner || event.joined) && player.lineId && (
                                                        <div className="flex items-center gap-2 bg-neutral-100 px-2 py-0.5 rounded-lg border border-black/[0.02]">
                                                            <span className="text-[0.5625rem] text-neutral-400 font-black tracking-tighter">LINE: {player.lineId}</span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(player.lineId || '');
                                                                    showToast('Player ID Copied', 'success', 'System');
                                                                }}
                                                                className="text-neutral-400 hover:text-neutral-900 transition-colors"
                                                            >
                                                                <Copy size="0.625rem" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                                    <span className="text-neutral-400 text-[0.625rem] font-bold">
                                                        {userRatings[player.userId]?.positiveRate || 100}% SCORE
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </div>

                    {/* Host Management Section */}
                    {event.isOwner && registrations.filter(r => r.status === 'pending').length > 0 && (
                        <div className="space-y-4 lg:col-span-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-1.5 h-4 bg-neutral-900 rounded-full animate-pulse"></div>
                                <h4 className="text-neutral-900 font-black text-xs uppercase tracking-widest">
                                    Pending Applications ({registrations.filter(r => r.status === 'pending').length})
                                </h4>
                            </div>

                            <div className="space-y-3">
                                {registrations.filter(r => r.status === 'pending').map((reg) => (
                                    <div key={reg.registrationId} className="bg-white border border-black/[0.05] p-5 rounded-lg shadow-xl shadow-neutral-900/5 hover:border-neutral-900/10 transition-all">
                                        <div className="flex items-center justify-between mb-5">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-12 h-12 rounded-lg flex items-center justify-center border border-black/[0.03] overflow-hidden transition-colors ${reg.pictureUrl
                                                    ? 'bg-neutral-50'
                                                    : reg.gender === '男'
                                                        ? 'bg-blue-50'
                                                        : reg.gender === '女'
                                                            ? 'bg-pink-50'
                                                            : 'bg-neutral-100'
                                                    }`}>
                                                    {reg.pictureUrl ? (
                                                        <img src={reg.pictureUrl} alt={reg.displayName} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Users size="1.5rem"
                                                            className={
                                                                reg.gender === '男'
                                                                    ? 'text-blue-400'
                                                                    : reg.gender === '女'
                                                                        ? 'text-pink-400'
                                                                        : 'text-neutral-300'
                                                            }
                                                        />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-neutral-900 font-black text-[0.9375rem]">{reg.displayName}</p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <div className="flex items-center gap-1">
                                                            <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                                            <span className="text-neutral-400 text-[0.625rem] font-black">
                                                                {userRatings[reg.userId]?.positiveRate || 100}%
                                                            </span>
                                                        </div>
                                                        <span className="text-neutral-200 text-[0.625rem]">•</span>
                                                        <span className="text-neutral-400 text-[0.625rem] font-bold uppercase tracking-widest">
                                                            {reg.ageRange} {reg.gender}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {reg.message && (
                                            <div className="bg-neutral-50 p-4 rounded-lg mb-5 text-[0.8125rem] text-neutral-500 font-medium border border-black/[0.01] italic">
                                                "{reg.message}"
                                            </div>
                                        )}

                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => handleRejectRegistration(reg.registrationId)}
                                                disabled={!!processingReg}
                                                className="flex-1 py-3 bg-neutral-50 hover:bg-red-50 text-neutral-400 hover:text-red-500 rounded-lg font-black text-[0.625rem] uppercase tracking-widest transition-all"
                                            >
                                                Decline
                                            </button>
                                            <button
                                                onClick={() => handleAcceptRegistration(reg.registrationId)}
                                                disabled={!!processingReg}
                                                className="flex-1 py-3 bg-neutral-900 text-white rounded-lg font-black text-[0.625rem] uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                                            >
                                                {processingReg === reg.registrationId ? <Loader2 className="animate-spin" size="0.875rem" /> : 'Accept'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}


                    {/* Action Buttons */}
                    <div className="lg:col-span-3 mt-8">
                        {(() => {
                            const userRegs = registrations.filter(r => r.userId === currentUser?.userId);
                            const isPending = userRegs.some(r => r.status === 'pending');
                            const isRejected = userRegs.some(r => r.status === 'rejected');

                            if (event.isOwner) {
                                return (
                                    <div className="space-y-4">
                                        <div className="w-full bg-neutral-900/5 border border-black/[0.03] text-neutral-400 font-black py-4 rounded-lg text-center flex items-center justify-center gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#c5a059]"></div>
                                            <span className="text-xs uppercase tracking-[0.2em]">Operational Authority Confirmed</span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <button
                                                onClick={() => navigate(`/edit-group/${id}`)}
                                                className="w-full py-5 bg-neutral-900 text-white font-black rounded-lg shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-xs"
                                            >
                                                <Settings size="1.125rem" />
                                                Modify Operation
                                            </button>
                                            {event.status !== 'cancelled' && (
                                                <button
                                                    onClick={() => setShowCancelDialog(true)}
                                                    className="w-full py-5 bg-white border border-red-100 text-red-500 font-black rounded-lg hover:bg-red-50 transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-xs"
                                                >
                                                    <Ban size="1.125rem" />
                                                    Terminate Event
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            }

                            if (event.joined) {
                                return (
                                    <div className="w-full py-6 bg-[#c5a059] text-white font-black rounded-lg shadow-2xl shadow-[#c5a059]/20 flex items-center justify-center gap-4 uppercase tracking-[0.2em] animate-fade-in">
                                        <Check size="1.625rem" strokeWidth={3} />
                                        Deployment Confirmed
                                    </div>
                                );
                            }

                            if (isPending) {
                                return (
                                    <div className="space-y-4">
                                        <div className="w-full py-6 bg-neutral-50 text-neutral-400 font-black rounded-lg border border-black/[0.03] flex items-center justify-center gap-4 uppercase tracking-[0.15em] text-sm italic">
                                            <Loader2 size="1.5rem" className="animate-spin" />
                                            Awaiting Multi-Factor Verification
                                        </div>
                                        <button
                                            onClick={() => setShowCancelRegDialog(true)}
                                            className="w-full py-4 text-red-400 font-black hover:bg-red-50 rounded-lg transition-colors text-[0.625rem] uppercase tracking-widest"
                                        >
                                            Withdraw Application
                                        </button>
                                    </div>
                                );
                            }

                            if (isRejected) {
                                return (
                                    <div className="w-full py-6 bg-red-50 text-red-400 font-black rounded-lg border border-red-100 flex items-center justify-center gap-4 uppercase tracking-[0.2em] text-sm">
                                        <Ban size="1.5rem" />
                                        Application Denied
                                    </div>
                                );
                            }

                            return (
                                <button
                                    onClick={handleJoin}
                                    disabled={joining || event.currentMembers >= event.maxMembers}
                                    className="w-full py-6 bg-neutral-900 text-white font-black rounded-lg shadow-2xl shadow-neutral-900/20 hover:scale-[1.01] hover:bg-black active:scale-[0.98] transition-all flex items-center justify-center gap-5 group disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {joining ? (
                                        <>
                                            <Loader2 className="animate-spin" size="1.625rem" />
                                            <span className="text-lg uppercase tracking-[0.2em]">Processing...</span>
                                        </>
                                    ) : event.currentMembers >= event.maxMembers ? (
                                        <span className="text-lg uppercase tracking-[0.2em]">Quota Fully Allocated</span>
                                    ) : (
                                        <>
                                            <span className="text-lg uppercase tracking-[0.2em] ml-5">Initialize Recruitment</span>
                                            <Zap size="1.625rem" fill="currentColor" className="group-hover:animate-bounce" />
                                        </>
                                    )}
                                </button>
                            );
                        })()}

                        {/* Rate Game Button - Show for participants after game */}
                        {(event.isOwner || event.joined) && gameDetail?.status === 'completed' && (
                            <button
                                onClick={() => navigate(`/rate-game/${id}`)}
                                className="w-full mt-4 py-5 bg-gradient-to-r from-[#c5a059] to-[#b08d4a] text-white font-black rounded-lg shadow-xl shadow-[#c5a059]/20 hover:scale-[1.01] transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-xs"
                            >
                                <Star size="1.25rem" fill="white" />
                                Submit Post-Operation Review
                            </button>
                        )}
                    </div>

                    {/* Confirm Modals */}
                    <CyberpunkConfirmModal
                        isOpen={showCancelDialog}
                        onClose={() => setShowCancelDialog(false)}
                        onConfirm={handleCancelGame}
                        title="Terminate Event"
                        message="Are you sure you want to shut down this operation? All participants will be notified and points refunded."
                        confirmText="Shutdown"
                        cancelText="Resume"
                        loading={cancelling}
                    />

                    <CyberpunkConfirmModal
                        isOpen={showCancelRegDialog}
                        onClose={() => setShowCancelRegDialog(false)}
                        onConfirm={handleCancelRegistration}
                        title="Withdraw Application"
                        message="Are you sure you want to withdraw your application for this unit? This cannot be undone."
                        confirmText="Withdraw"
                        cancelText="Stay"
                        loading={cancellingReg}
                    />

                    {/* Profile Modal */}
                    <ProfileIncompleteModal
                        isOpen={showProfileModal}
                        onClose={() => setShowProfileModal(false)}
                        missingFields={missingFields}
                        onSaveDraft={() => {
                            // Logic to save draft if needed
                        }}
                    />

                    {/* Terms Modal */}
                    <TermsAgreementModal
                        isOpen={showTermsAgreement}
                        onClose={() => setShowTermsAgreement(false)}
                        onConfirm={confirmJoin}
                        actionType="join"
                    />

                    {/* Push Modal */}
                    <PushPermissionModal
                        isOpen={isPushModalOpen}
                        onClose={() => {
                            setIsPushModalOpen(false);
                            showToast('報名成功！請等待主揪審核', 'success', '成功');
                        }}
                        onConfirm={handlePushConfirm}
                    />

                    {/* Image Lightbox */}
                    {selectedImage && (
                        <div
                            className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6"
                            onClick={() => setSelectedImage(null)}
                        >
                            <div className="relative max-w-4xl w-full">
                                <img src={selectedImage} alt="Large" className="w-full h-auto rounded-lg shadow-2xl" />
                                <button
                                    className="absolute -top-12 right-0 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                                    onClick={() => setSelectedImage(null)}
                                >
                                    <X size="1.5rem" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </PullToRefresh>
    );
};

export default EventDetail;