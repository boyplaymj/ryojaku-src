/**
 * EventDetailModal - 團局詳情假切頁組件
 * 使用 Portal 渲染到 body，覆蓋在當前頁面上
 * 點擊返回時不會觸發真正的路由變化，保留前一頁狀態
 */
import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import CyberpunkConfirmModal from './CyberpunkConfirmModal';
import UserReviewsModal from './UserReviewsModal';
import { GroupEvent, Game, UserStats } from '../types';
import { X, Zap, MapPin, Users, Coins, Clock, Gamepad2, Phone, Copy, Loader2, Check, Ban, Settings, Star, ArrowLeft } from 'lucide-react';
import { api, gameToGroupEvent } from '../services/dataService';
import { authService } from '../services/authService';
import PullToRefresh from './PullToRefresh';
import { Share2, Gift } from 'lucide-react';
import PushPermissionModal from './PushPermissionModal';
import { notificationService } from '../services/notificationService';
import { claimPushBonus } from '../services/apiService';
import { useRefresh, usePullToRefresh } from '../contexts/RefreshContext';
import ProfileIncompleteModal from './ProfileIncompleteModal';
import { isProfileComplete, getMissingProfileFields } from '../utils/profileUtils';
import TermsAgreementModal from './TermsAgreementModal';
import { User } from '../types';
import ShareActionSheet from './share/ShareActionSheet';
import { STORAGE_KEYS } from '../constants';

interface EventDetailModalProps {
    eventId: string;
    events: GroupEvent[];
    clickPosition?: { x: number; y: number };
    onClose: () => void;
    onJoin: (id: string) => void;
}

const EventDetailModal: React.FC<EventDetailModalProps> = ({ eventId, events, clickPosition, onClose, onJoin }) => {
    const { onRefresh } = useRefresh();
    const navigate = useNavigate();
    const [event, setEvent] = useState<GroupEvent | undefined>(undefined);
    const [gameDetail, setGameDetail] = useState<Game | null>(null);
    const [registrations, setRegistrations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
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

    // 查看評論假切頁狀態
    const [selectedReviewUserId, setSelectedReviewUserId] = useState<string | null>(null);
    const [reviewClickPosition, setReviewClickPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    // 個人資料檢查相關狀態
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [missingFields, setMissingFields] = useState<string[]>([]);

    // 服務條款確認狀態
    const [showTermsAgreement, setShowTermsAgreement] = useState(false);

    // 分享選單狀態
    const [showShareSheet, setShowShareSheet] = useState(false);

    // 推播引導狀態
    const [isPushModalOpen, setIsPushModalOpen] = useState(false);

    // 照片放大檢視
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const currentUser = authService.getCurrentUser();

    // 禁止背景滾動
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    const fetchUsersRatings = useCallback(async (userIds: string[]) => {
        const ratingsMap: Record<string, { positiveRate: number, count: number }> = {};

        await Promise.all(userIds.map(async (userId) => {
            if (ratingsMap[userId]) return;

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
    }, []);

    const fetchGameDetail = useCallback(async () => {
        if (!eventId) return;

        setLoading(true);
        try {
            const detail = await api.getGameDetail(eventId);
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
            const found = events.find(e => e.id === eventId);
            setEvent(found);
        } finally {
            setLoading(false);
        }
    }, [eventId, events, currentUser?.userId, fetchUsersRatings]);

    // Register refresh handler
    usePullToRefresh(fetchGameDetail);

    useEffect(() => {
        fetchGameDetail();
    }, [fetchGameDetail]);

    const handleJoin = async () => {
        if (!eventId || !event) return;
        setShowTermsAgreement(true);
    };

    const handlePushConfirm = async () => {
        const currentUser = authService.getCurrentUser();
        if (!currentUser) return;

        try {
            const subscribed = await notificationService.subscribe();
            if (subscribed) {
                const bonusResult = await claimPushBonus(currentUser.userId);
                if (bonusResult.success) {
                    showToast(`恭喜獲得 ${bonusResult.data?.points || 360} 點數獎勵！`, 'success', '領取成功');
                    // 確保本地 user 狀態更新
                    const storedUser = localStorage.getItem(STORAGE_KEYS.USER);
                    if (storedUser) {
                        const user = JSON.parse(storedUser);
                        user.hasClaimedPushBonus = true;
                        if (bonusResult.data?.newPoints) {
                            user.points = bonusResult.data.newPoints;
                        }
                        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
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
            console.log('🚀 [JoinGameModal] Starting join process');

            // 1. 即時從 API 獲取最新的個人資料
            const currentUser = authService.getCurrentUser();
            if (!currentUser) {
                showToast('請先登入', 'error');
                setJoining(false);
                return;
            }

            const profileResponse = await api.getUserInfo(currentUser.userId);

            if (!profileResponse.success || !profileResponse.data) {
                console.error('❌ [JoinGameModal] Failed to fetch latest profile:', profileResponse.error);
                showToast('無法驗證個人資料狀態，請稍後再試', 'error');
                setJoining(false);
                return;
            }

            const latestUser = profileResponse.data as User;
            console.log('✅ [JoinGameModal] Latest profile fetched:', latestUser);

            // 2. 檢查個人資料完整性
            if (!isProfileComplete(latestUser)) {
                console.log('⚠️ [JoinGameModal] Profile incomplete, showing modal');
                setMissingFields(getMissingProfileFields(latestUser));
                setShowProfileModal(true);
                setJoining(false);
                return;
            }

            console.log('✨ [JoinGameModal] Profile complete, proceeding to register');

            // 3. 執行報名
            await onJoin(eventId);

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
            const detail = await api.getGameDetail(eventId);
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
        if (!eventId) return;
        setProcessingReg(regId);
        try {
            await api.acceptRegistration(eventId, regId);
            showToast('已接受報名', 'success', '成功');
            // Refresh
            const detail = await api.getGameDetail(eventId);
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
        if (!eventId) return;
        setProcessingReg(regId);
        try {
            await api.rejectRegistration(eventId, regId);
            showToast('已拒絕報名', 'success', '成功');
            // Refresh
            const detail = await api.getGameDetail(eventId);
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
        if (!eventId) return;
        setCancelling(true);
        try {
            await api.cancelEvent(eventId);
            showToast('團局已取消', 'success', '成功');
            setTimeout(() => {
                onClose();
                navigate('/');
            }, 1500);
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
        if (!eventId || !currentUser) return;
        const userReg = registrations.find(r => r.userId === currentUser.userId && r.status === 'pending');
        if (!userReg) return;

        setCancellingReg(true);
        try {
            await api.cancelRegistration(eventId, userReg.registrationId);
            showToast('已取消報名', 'success', '成功');
            // Refresh game detail
            const detail = await api.getGameDetail(eventId);
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

    // 處理瀏覽器返回按鈕
    useEffect(() => {
        const handlePopState = (e: PopStateEvent) => {
            e.preventDefault();
            onClose();
        };

        // 加入一個假的 history state
        window.history.pushState({ modal: 'eventDetail' }, '');
        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [onClose]);

    // 渲染內容
    const renderContent = () => {
        if (loading && !event) {
            return (
                <div className="flex flex-col items-center justify-center h-full gap-4 bg-white">
                    <Loader2 className="animate-spin text-[#c5a059]" size="2.25rem" />
                    <p className="text-neutral-400 text-sm font-bold">載入中...</p>
                </div>
            );
        }

        if (joining || !!processingReg) {
            return (
                <div className="flex flex-col items-center justify-center h-full gap-4 bg-white">
                    <Loader2 className="animate-spin text-[#c5a059]" size="2.25rem" />
                    <p className="text-neutral-400 text-sm font-bold">
                        {joining ? '正在報名...' :
                            processingReg ? '正在處理報名...' :
                                '處理中...'}
                    </p>
                </div>
            );
        }

        if (!event) {
            return (
                <div className="flex flex-col items-center justify-center h-full gap-4 bg-white">
                    <p className="text-neutral-400 text-sm">找不到此團局</p>
                    <button onClick={onClose} className="text-[#c5a059] font-bold text-sm">返回</button>
                </div>
            );
        }

        return (
            <div className="bg-[#f9f9f7] pb-4 relative animate-fade-in">
                {/* Content - Stack Layout */}
                <div className="flex flex-col">
                    {/* Title Section */}
                    <div className="bg-white border-b border-black/[0.03] p-5">
                        <h3 className="text-[1.25rem] font-black text-neutral-900 leading-snug tracking-tight mb-3">{event.title}</h3>
                        <div className="flex items-start gap-2">
                            <MapPin size="1rem" className="text-[#c5a059] mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-neutral-900 font-bold text-sm">{event.location}</p>
                                <p className="text-neutral-400 text-[0.6875rem] mt-0.5 leading-relaxed">{event.address}</p>
                            </div>
                        </div>
                    </div>

                    {/* Module: Image Carousel */}
                    {event.images && event.images.length > 0 && (
                        <div className="bg-white border-b border-black/[0.03] py-4">
                            <div className="flex items-center justify-between px-4 mb-3">
                                <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest">照片展示</span>
                                <span className="text-[0.5625rem] font-bold text-neutral-300">{event.images.length} 張</span>
                            </div>
                            <div className="flex overflow-x-auto gap-3 px-4 pb-1 snap-x snap-mandatory no-scrollbar">
                                {event.images.map((img, i) => (
                                    <div
                                        key={i}
                                        onClick={() => setSelectedImage(img)}
                                        className="flex-none w-56 aspect-[4/3] rounded-2xl overflow-hidden border border-black/[0.03] shadow-sm snap-center relative group cursor-pointer"
                                    >
                                        <img src={img} alt="" className="w-full h-full object-cover" />
                                        {event.images.length > 1 && (
                                            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/50 rounded text-[0.5625rem] font-mono text-white/80">
                                                {i + 1}/{event.images?.length}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Status Bar */}
                    <div className="grid grid-cols-2 gap-px bg-black/[0.03]">
                        <div className="bg-white p-4 pb-2 flex flex-col items-center justify-center min-h-[7.5rem]">
                            <span className="text-[0.5625rem] text-neutral-400 uppercase mb-2 font-black tracking-widest">目前人數</span>
                            <div className="flex-1 flex items-center justify-center w-full">
                                <div className="flex items-center gap-[0.0625rem]">
                                    <img src="/userJoin/icon-watiing_lightMode_selfIcon-No1@3x.png" alt="P1" className="w-[2.5rem] object-contain" />
                                    <img src={event.currentMembers >= 2 ? "/userJoin/icon-userJoined-No2@3x.png" : "/userJoin/icon-userEmpty-No2@3x.png"} alt="P2" className="w-[2.5rem] object-contain" />
                                    <img src={event.currentMembers >= 3 ? "/userJoin/icon-userJoined-No3@3x.png" : "/userJoin/icon-userEmpty-No3@3x.png"} alt="P3" className="w-[2.5rem] object-contain" />
                                    <img src={event.currentMembers >= 4 ? "/userJoin/icon-userJoined-No4@3x.png" : "/userJoin/icon-userEmpty-No4@3x.png"} alt="P4" className="w-[2.5rem] object-contain" />
                                </div>
                            </div>
                        </div>
                        <div className="bg-white p-4 flex flex-col items-center justify-center">
                            <span className="text-[0.5625rem] text-neutral-400 uppercase mb-1 font-black tracking-widest">狀態</span>
                            <div className={`flex items-center gap-1.5 font-black text-lg ${event.status === 'recruiting' ? 'text-emerald-500' :
                                event.status === 'full' ? 'text-[#c5a059]' :
                                    event.status === 'cancelled' ? 'text-red-400' : 'text-neutral-400'
                                }`}>
                                {event.status === 'recruiting' ? <Zap size="1rem" fill="currentColor" /> :
                                    event.status === 'full' ? <Users size="1rem" /> :
                                        event.status === 'cancelled' ? <Ban size="1rem" /> : <Clock size="1rem" />}
                                <span>
                                    {event.status === 'recruiting' ? '招募中' :
                                        event.status === 'full' ? '已滿員' :
                                            event.status === 'cancelled' ? '已取消' :
                                                event.status === 'closed' ? '已結束' : event.status}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Info List */}
                    <div className="bg-white border-b border-black/[0.03]">
                        {/* Stakes */}
                        <div className="flex items-center justify-between p-4 border-b border-black/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-[#c5a059]/10 flex items-center justify-center">
                                    <Coins size="1rem" className="text-[#c5a059]" />
                                </div>
                                <span className="text-sm text-neutral-600 font-bold">籌碼底台</span>
                            </div>
                            <span className="text-neutral-900 font-black text-base">{event.stakes}</span>
                        </div>

                        {/* Time */}
                        <div className="flex items-center justify-between p-4 border-b border-black/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-neutral-50 flex items-center justify-center">
                                    <Clock size="1rem" className="text-neutral-400" />
                                </div>
                                <span className="text-sm text-neutral-600 font-bold">開打時間</span>
                            </div>
                            <span className="text-neutral-900 font-black text-sm">
                                {new Date(event.date).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                            </span>
                        </div>

                        {/* Detailed Rules */}
                        {gameDetail?.gameInfo.rules && gameDetail.gameInfo.rules.length > 0 && (
                            <div className="p-4 border-b border-black/[0.02]">
                                <div className="flex items-center gap-2 mb-3">
                                    <Gamepad2 size="0.875rem" className="text-[#c5a059]" />
                                    <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">麻將規則</span>
                                </div>
                                <ul className="space-y-1.5">
                                    {gameDetail.gameInfo.rules.map((rule, i) => (
                                        <li key={i} className="text-[0.75rem] text-neutral-600 flex items-start gap-2">
                                            <span className="text-[#c5a059] mt-0.5">•</span>
                                            {rule}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Features */}
                        {gameDetail?.venueFeatures && gameDetail.venueFeatures.length > 0 && (
                            <div className="p-4 border-b border-black/[0.02]">
                                <div className="flex items-center gap-2 mb-3">
                                    <Star size="0.875rem" className="text-[#c5a059]" />
                                    <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">場地特色</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {gameDetail.venueFeatures.map((feature, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-[#c5a059]/10 rounded-lg text-[0.625rem] text-[#c5a059] font-bold">
                                            {feature}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Restrictions */}
                        {gameDetail?.restrictions && gameDetail.restrictions.length > 0 && (
                            <div className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Ban size="0.875rem" className="text-red-400" />
                                    <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">玩家限制</span>
                                </div>
                                <ul className="space-y-1.5">
                                    {gameDetail.restrictions.map((restriction, i) => (
                                        <li key={i} className="text-[0.75rem] text-neutral-600 flex items-start gap-2">
                                            <span className="text-red-400 mt-0.5">•</span>
                                            {restriction}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* Host Info Block */}
                    <div className="bg-white border-b border-black/[0.03] p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <Users size="0.875rem" className="text-[#c5a059]" />
                            <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">主揪資訊</span>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="w-14 h-14 rounded-lg bg-neutral-100 flex items-center justify-center border border-black/[0.03] overflow-hidden flex-shrink-0 shadow-sm">
                                {gameDetail?.hostPictureUrl ? (
                                    <img src={gameDetail.hostPictureUrl} alt={gameDetail.hostDisplayName} className="w-full h-full object-cover" />
                                ) : gameDetail?.hostDisplayName ? (
                                    <div className="text-[#c5a059] font-black text-xl">{gameDetail.hostDisplayName[0]}</div>
                                ) : (
                                    <Users size="1.25rem" className="text-neutral-300" />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <p className="text-neutral-900 font-black text-base truncate">{gameDetail?.hostDisplayName}</p>
                                    {hostGender && (
                                        <span className={`text-[0.5625rem] px-1.5 py-0.5 rounded ${hostGender === 'male' || hostGender === '男' ? 'text-blue-500 bg-blue-50' :
                                            hostGender === 'female' || hostGender === '女' ? 'text-pink-500 bg-pink-50' :
                                                'text-neutral-400 bg-neutral-50'
                                            }`}>
                                            {hostGender === 'male' ? '男' : hostGender === 'female' ? '女' : hostGender}
                                        </span>
                                    )}
                                    {hostAgeRange && (
                                        <span className="text-[0.5625rem] text-neutral-400 bg-neutral-50 px-1.5 py-0.5 rounded">
                                            {hostAgeRange}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex flex-col">
                                            <span className="text-[0.5625rem] text-neutral-400">好評率</span>
                                            <div className="flex items-center gap-1">
                                                <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                                <span className="text-[#c5a059] text-xs font-black">
                                                    {hostStats ? Math.round(hostStats.positiveRatingRate) : (userRatings[gameDetail?.hostUserId || '']?.positiveRate || 100)}%
                                                </span>
                                            </div>
                                        </div>
                                        <div className="w-px h-6 bg-neutral-100"></div>
                                        <div className="flex flex-col">
                                            <span className="text-[0.5625rem] text-neutral-400">評論數</span>
                                            <span className="text-neutral-900 text-xs font-black">
                                                {hostStats ? hostStats.totalRatings : (userRatings[gameDetail?.hostUserId || '']?.count || 0)}
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={(e) => {
                                            setReviewClickPosition({ x: e.clientX, y: e.clientY });
                                            setSelectedReviewUserId(gameDetail?.hostUserId || null);
                                        }}
                                        className="text-[0.625rem] text-[#c5a059] border border-[#c5a059]/30 px-3 py-1.5 rounded-lg hover:bg-[#c5a059]/10 transition-colors font-bold"
                                    >
                                        查看評論
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Contact Block */}
                    <div className="bg-white border-b border-black/[0.03] p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <Phone size="0.875rem" className="text-[#c5a059]" />
                            <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">聯絡資訊</span>
                        </div>
                        <div className="flex items-center justify-between bg-neutral-50 p-3 rounded-lg border border-black/[0.02]">
                            <span className="text-neutral-400 text-sm">{event.contactMethod}:</span>
                            <div className="flex items-center gap-3">
                                {(event.isOwner || event.joined) ? (
                                    (event.lineId || (event.isOwner && currentUser?.lineId)) ? (
                                        <>
                                            <span className="text-neutral-900 font-black text-base">{event.lineId || currentUser?.lineId}</span>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(event.lineId || currentUser?.lineId || '');
                                                    showToast('已複製 LINE ID', 'success', '成功');
                                                }}
                                                className="p-2 hover:bg-[#c5a059]/10 rounded-lg text-[#c5a059] transition-colors"
                                            >
                                                <Copy size="0.875rem" />
                                            </button>
                                        </>
                                    ) : (
                                        <span className="text-neutral-400 text-sm italic">未設定 LINE ID</span>
                                    )
                                ) : (
                                    <div className="flex items-center gap-1.5 text-neutral-400">
                                        <Clock size="0.75rem" />
                                        <span className="text-xs italic">報名成功後可查看</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>


                    {/* Participants Section */}
                    <div className="bg-white border-b border-black/[0.03] p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <Users size="0.875rem" className="text-[#c5a059]" />
                            <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">
                                已加入成員 ({((gameDetail?.joinedPlayers.filter(p => p.userId !== gameDetail.hostUserId).length || 0) + 1)})
                            </span>
                        </div>

                        <div className="space-y-2">
                            {/* Host Card */}
                            <div className="bg-neutral-50 p-3 rounded-lg border border-black/[0.02] relative">
                                <div className="absolute top-2 right-2 px-2 py-0.5 bg-[#c5a059]/10 text-[#c5a059] text-[0.5625rem] font-black rounded uppercase">
                                    主揪
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-black/[0.03] overflow-hidden shadow-sm">
                                        {gameDetail?.hostPictureUrl ? (
                                            <img src={gameDetail.hostPictureUrl} alt={gameDetail.hostDisplayName} className="w-full h-full object-cover" />
                                        ) : gameDetail?.hostDisplayName ? (
                                            <div className="text-[#c5a059] font-black text-base">{gameDetail.hostDisplayName[0]}</div>
                                        ) : (
                                            <Users size="1.125rem" className="text-neutral-300" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-neutral-900 font-bold text-sm truncate">{gameDetail?.hostDisplayName}</p>
                                            {(event.isOwner || event.joined) && (event.lineId || (event.isOwner && currentUser?.lineId)) && (
                                                <div className="flex items-center gap-1 bg-[#c5a059]/10 px-2 py-0.5 rounded">
                                                    <span className="text-[0.5625rem] text-[#c5a059] font-bold">LINE: {event.lineId || currentUser?.lineId}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigator.clipboard.writeText(event.lineId || currentUser?.lineId || '');
                                                            showToast('已複製主揪 LINE ID', 'success', '成功');
                                                        }}
                                                        className="text-[#c5a059] hover:text-[#a68a42] transition-colors"
                                                    >
                                                        <Copy size="0.625rem" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                            <span className="text-[#c5a059] text-[0.625rem] font-bold">
                                                {userRatings[gameDetail?.hostUserId || '']?.positiveRate || 100}% 好評
                                            </span>
                                            <span className="text-neutral-400 text-[0.625rem] ml-1">
                                                ({userRatings[gameDetail?.hostUserId || '']?.count || 0} 評價)
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
                                    <div key={player.userId} className="bg-neutral-50 p-3 rounded-lg border border-black/[0.02]">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-black/[0.03] overflow-hidden shadow-sm">
                                                {player.pictureUrl ? (
                                                    <img src={player.pictureUrl} alt={player.displayName} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="text-neutral-400 font-black text-base">{player.displayName[0]}</div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-neutral-900 font-bold text-sm truncate">{player.displayName}</p>
                                                    {(event.isOwner || event.joined) && player.lineId && (
                                                        <div className="flex items-center gap-1 bg-neutral-100 px-2 py-0.5 rounded">
                                                            <span className="text-[0.5625rem] text-neutral-500 font-bold">LINE: {player.lineId}</span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(player.lineId || '');
                                                                    showToast('已複製玩家 LINE ID', 'success', '成功');
                                                                }}
                                                                className="text-neutral-400 hover:text-neutral-600 transition-colors"
                                                            >
                                                                <Copy size="0.625rem" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                                    <span className="text-[#c5a059] text-[0.625rem] font-bold">
                                                        {userRatings[player.userId]?.positiveRate || 100}% 好評
                                                    </span>
                                                    <span className="text-neutral-400 text-[0.625rem] ml-1">
                                                        ({userRatings[player.userId]?.count || 0} 評價)
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            }
                        </div>
                    </div>

                    {/* Host Management Section */}
                    {event.isOwner && registrations.filter(r => r.status === 'pending').length > 0 && (
                        <div className="bg-white border-b border-black/[0.03] p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></div>
                                <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">
                                    待審核報名 ({registrations.filter(r => r.status === 'pending').length})
                                </span>
                            </div>
                            <div className="space-y-3">
                                {registrations.filter(r => r.status === 'pending').map((reg) => (
                                    <div key={reg.registrationId} className="bg-neutral-50 p-4 rounded-lg border border-red-100">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center border overflow-hidden shadow-sm ${reg.pictureUrl
                                                    ? 'bg-white border-black/[0.03]'
                                                    : reg.gender === '男'
                                                        ? 'bg-blue-50 border-blue-100'
                                                        : reg.gender === '女'
                                                            ? 'bg-pink-50 border-pink-100'
                                                            : 'bg-neutral-100 border-black/[0.03]'
                                                    }`}>
                                                    {reg.pictureUrl ? (
                                                        <img src={reg.pictureUrl} alt={reg.displayName} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Users
                                                            size="1.125rem"
                                                            className={
                                                                reg.gender === '男'
                                                                    ? 'text-blue-400'
                                                                    : reg.gender === '女'
                                                                        ? 'text-pink-400'
                                                                        : 'text-neutral-400'
                                                            }
                                                        />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-neutral-900 font-bold text-sm">{reg.displayName}</p>
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        <Star size="0.625rem" className="text-[#c5a059] fill-[#c5a059]" />
                                                        <span className="text-[#c5a059] text-[0.625rem] font-bold">
                                                            {userRatings[reg.userId]?.positiveRate || 100}% 好評
                                                        </span>
                                                        <span className="text-neutral-400 text-[0.625rem] ml-1">
                                                            ({userRatings[reg.userId]?.count || 0} 評價)
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    setReviewClickPosition({ x: e.clientX, y: e.clientY });
                                                    setSelectedReviewUserId(reg.userId);
                                                }}
                                                className="text-[0.625rem] text-[#c5a059] border border-[#c5a059]/30 px-2 py-1 rounded-lg hover:bg-[#c5a059]/10 transition-colors font-bold"
                                            >
                                                查看評論
                                            </button>
                                        </div>
                                        {reg.message && (
                                            <div className="bg-white p-3 rounded-lg mb-3 text-xs text-neutral-600 border border-black/[0.02] italic">
                                                "{reg.message}"
                                            </div>
                                        )}
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleAcceptRegistration(reg.registrationId)}
                                                disabled={!!processingReg}
                                                className="flex-1 bg-emerald-50 text-emerald-600 py-2.5 rounded-lg text-xs font-bold hover:bg-emerald-100 border border-emerald-100 transition-all flex items-center justify-center gap-1.5"
                                            >
                                                {processingReg === reg.registrationId ? <Loader2 className="animate-spin" size="0.875rem" /> : <Check size="0.875rem" />}
                                                接受
                                            </button>
                                            <button
                                                onClick={() => handleRejectRegistration(reg.registrationId)}
                                                disabled={!!processingReg}
                                                className="flex-1 bg-red-50 text-red-500 py-2.5 rounded-lg text-xs font-bold hover:bg-red-100 border border-red-100 transition-all flex items-center justify-center gap-1.5"
                                            >
                                                {processingReg === reg.registrationId ? <Loader2 className="animate-spin" size="0.875rem" /> : <Ban size="0.875rem" />}
                                                拒絕
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="bg-white p-5">
                        {(() => {
                            const userRegs = registrations.filter(r => r.userId === currentUser?.userId);
                            const isPending = userRegs.some(r => r.status === 'pending');
                            const isRejected = userRegs.some(r => r.status === 'rejected');

                            if (event.isOwner) {
                                return (
                                    <>
                                        <div className="w-full bg-[#c5a059]/10 border border-[#c5a059]/30 text-[#c5a059] font-black py-3 rounded-lg text-center flex items-center justify-center gap-2 mb-3">
                                            <span className="text-[0.6875rem] uppercase tracking-widest">您是主辦人</span>
                                        </div>
                                        {event.status !== 'cancelled' && (
                                            <button
                                                onClick={() => setShowCancelDialog(true)}
                                                className="w-full bg-red-50 hover:bg-red-100 text-red-500 border border-red-100 font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2"
                                            >
                                                <Ban size="1.125rem" />
                                                <span className="text-sm font-black">取消團局</span>
                                            </button>
                                        )}
                                    </>
                                );
                            }

                            if (event.joined) {
                                return (
                                    <div className="w-full bg-emerald-50 border border-emerald-100 text-emerald-600 font-black py-4 rounded-lg text-center flex items-center justify-center gap-2">
                                        <Check size="1.25rem" />
                                        <span className="text-sm uppercase tracking-wider">已加入團局</span>
                                    </div>
                                );
                            }

                            if (isPending) {
                                return (
                                    <div className="space-y-3">
                                        <div className="w-full bg-[#c5a059]/10 border border-[#c5a059]/30 text-[#c5a059] font-black py-4 rounded-lg text-center flex items-center justify-center gap-2">
                                            <Clock size="1.125rem" />
                                            <span className="text-sm uppercase tracking-wider">報名審核中</span>
                                        </div>
                                        <button
                                            onClick={() => setShowCancelRegDialog(true)}
                                            className="w-full bg-red-50 hover:bg-red-100 text-red-500 border border-red-100 font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
                                        >
                                            <Ban size="1rem" />
                                            <span className="text-sm font-black">取消報名</span>
                                        </button>
                                    </div>
                                );
                            }

                            if (isRejected) {
                                return (
                                    <div className="w-full bg-red-50 border border-red-100 text-red-500 font-black py-4 rounded-lg text-center flex items-center justify-center gap-2">
                                        <Ban size="1.25rem" />
                                        <span className="text-sm uppercase tracking-wider">報名已被拒絕</span>
                                    </div>
                                );
                            }

                            return (
                                <button
                                    onClick={handleJoin}
                                    disabled={joining || event.currentMembers >= event.maxMembers}
                                    className="w-full bg-neutral-900 text-white font-black py-4 rounded-lg shadow-lg hover:bg-[#c5a059] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                                >
                                    {joining ? (
                                        <>
                                            <Loader2 className="animate-spin" size="1.25rem" />
                                            <span className="text-sm uppercase tracking-wider">處理中...</span>
                                        </>
                                    ) : event.currentMembers >= event.maxMembers ? (
                                        <span className="text-sm uppercase tracking-wider">已額滿</span>
                                    ) : (
                                        <>
                                            <Zap size="1.25rem" className="group-hover:fill-white transition-colors" />
                                            <span className="text-sm uppercase tracking-wider">報名參加</span>
                                        </>
                                    )}
                                </button>
                            );
                        })()}

                        {/* Rate Game Button - Show for participants after game */}
                        {(event.isOwner || event.joined) && gameDetail?.status === 'completed' && (
                            <button
                                onClick={() => navigate(`/rate-game/${eventId}`)}
                                className="w-full mt-3 bg-gradient-to-r from-[#c5a059] to-[#a68a42] text-white font-black py-4 rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                            >
                                <Star size="1.125rem" />
                                <span className="text-sm uppercase tracking-wider">評分團局</span>
                            </button>
                        )}
                    </div>

                    {/* Cancel Confirmation Dialog */}
                    <CyberpunkConfirmModal
                        isOpen={showCancelDialog}
                        onClose={() => setShowCancelDialog(false)}
                        onConfirm={handleCancelGame}
                        title="確認取消團局"
                        message="取消後將通知所有已報名的玩家，此操作無法復原。確定要執行嗎？"
                        confirmText="確認取消"
                        type="danger"
                        loading={cancelling}
                    />

                    {/* Cancel Registration Confirmation Dialog */}
                    <CyberpunkConfirmModal
                        isOpen={showCancelRegDialog}
                        onClose={() => setShowCancelRegDialog(false)}
                        onConfirm={handleCancelRegistration}
                        title="確認取消報名"
                        message="確定要取消您的報名嗎？取消後您可以隨時重新報名。"
                        confirmText="確認取消"
                        type="danger"
                        loading={cancellingReg}
                    />
                </div>
            </div>
        );
    };

    // 計算點擊位置的百分比座標
    const originX = clickPosition ? `${(clickPosition.x / window.innerWidth) * 100}%` : '50%';
    const originY = clickPosition ? `${(clickPosition.y / window.innerHeight) * 100}%` : '50%';

    // 使用 Portal 渲染到 body
    return createPortal(
        <div
            className="fixed inset-0 z-[100] bg-[#f9f9f7] flex flex-col animate-expand-from-point"
            style={{
                '--origin-x': originX,
                '--origin-y': originY,
            } as React.CSSProperties}
        >

            {/* Header - Fixed at top - Standardized */}
            <div className="flex-shrink-0 bg-white border-b border-black/[0.03] z-20 relative pt-safe">
                <div className="h-16 px-4 flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors border border-black/[0.03]"
                    >
                        <ArrowLeft size="1.25rem" />
                    </button>
                    <div className="flex-1">
                        <div className="flex items-center gap-2 text-neutral-400 text-[0.625rem] font-black uppercase tracking-widest mb-0.5">
                            <span>活動詳情</span>
                            <div className="h-[0.0625rem] flex-1 bg-black/[0.03]"></div>
                        </div>
                        <div className="flex items-center gap-2">
                            {event && (
                                <p className="text-[0.5625rem] font-black text-[#c5a059] bg-[#c5a059]/10 px-2 py-0.5 rounded uppercase tracking-wider">#{event.id.slice(-6).toUpperCase()}</p>
                            )}
                        </div>
                    </div>
                    {/* Share Button */}
                    <button
                        onClick={() => setShowShareSheet(true)}
                        className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-[#c5a059] hover:bg-neutral-100 transition-colors border border-black/[0.03]"
                    >
                        <Share2 size="1.25rem" />
                    </button>
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto relative z-10 pb-safe bg-[#f9f9f7]">
                <PullToRefresh onRefresh={onRefresh}>
                    {renderContent()}
                </PullToRefresh>
            </div>

            {/* 查看評論假切頁 */}
            {selectedReviewUserId && (
                <UserReviewsModal
                    userId={selectedReviewUserId}
                    clickPosition={reviewClickPosition}
                    onClose={() => setSelectedReviewUserId(null)}
                />
            )}

            {/* 個人資料不完整提示 Modal */}
            <ProfileIncompleteModal
                isOpen={showProfileModal}
                onClose={() => setShowProfileModal(false)}
                missingFields={missingFields}
            />

            <TermsAgreementModal
                isOpen={showTermsAgreement}
                onClose={() => setShowTermsAgreement(false)}
                onConfirm={confirmJoin}
                actionType="join"
            />

            {/* 推播引導 Modal */}
            <PushPermissionModal
                isOpen={isPushModalOpen}
                onClose={() => setIsPushModalOpen(false)}
                onConfirm={handlePushConfirm}
            />

            {/* 分享選單 */}
            {event && (
                <ShareActionSheet
                    isOpen={showShareSheet}
                    onClose={() => setShowShareSheet(false)}
                    type="event"
                    data={event}
                    gameDetail={gameDetail}
                />
            )}

            {/* Full Screen Image Viewer Modal */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedImage(null)}
                >
                    <img
                        src={selectedImage}
                        alt="Full view"
                        className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <div className="absolute bottom-10 left-0 right-0 text-center">
                        <span className="text-white/50 text-[0.625rem] font-bold uppercase tracking-widest">點擊背景關閉</span>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
};

export default EventDetailModal;
