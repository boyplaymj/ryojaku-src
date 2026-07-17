import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, GroupEvent } from '../types';
import { Dices, Search, Trophy, Activity, Target, Zap, Users, Edit3, Image as ImageIcon } from 'lucide-react';
import PostFeed from '../components/PostFeed';
import AppShareWidget from '../components/AppShareWidget';
import PostEditor from '../components/PostEditor';
import PostDetailModal from '../components/PostDetailModal';
import UserReviewsModal from '../components/UserReviewsModal';
import PushPermissionModal from '../components/PushPermissionModal';
import { useToast } from '../contexts/ToastContext';
import { usePullToRefresh } from '../contexts/RefreshContext';
import { api } from '../services/dataService';
import { notificationService } from '../services/notificationService';
import { claimPushBonus } from '../services/apiService';

interface HomeProps {
    events: GroupEvent[];
    user: User | null;
    onUserUpdate?: (user: User) => void;
}

const STORAGE_KEYS = {
    PUSH_PROMPT_COOLDOWN: 'mahjongclub_push_prompt_cooldown'
};

const Home: React.FC<HomeProps> = ({ user, onUserUpdate }) => {
    const navigate = useNavigate();
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [feedRefreshTrigger, setFeedRefreshTrigger] = useState(0);
    const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
    const [viewingUserProfileId, setViewingUserProfileId] = useState<string | null>(null);
    const [clickPosition, setClickPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [userProfileClickPos, setUserProfileClickPos] = useState<{ x: number; y: number } | undefined>(undefined);
    const [isPushModalOpen, setIsPushModalOpen] = useState(false);
    const { showToast } = useToast();

    const handleUserClick = (userId: string) => {
        setViewingUserProfileId(userId);
        // Can optionally track click position if needed, but simple center or slide-up is fine
        setUserProfileClickPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    };

    useEffect(() => {
        const checkPushPermission = async () => {
            if (!user) return;

            // 1. 檢查是否支援推播
            if (!notificationService.isPushSupported()) return;

            // 2. 檢查是否已領取過獎勵 (代表該帳號已成功開啟過)
            if (user.hasClaimedPushBonus) return;

            // 3. 檢查權限是否被禁止
            const permission = notificationService.getPermissionState();
            if (permission === 'denied') return;

            // 3. 檢查冷卻機制
            const cooldownStr = localStorage.getItem(STORAGE_KEYS.PUSH_PROMPT_COOLDOWN);
            if (cooldownStr) {
                const cooldownDate = new Date(parseInt(cooldownStr));
                const now = new Date();
                if (now < cooldownDate) {
                    console.log('[Push] Cooldown active until:', cooldownDate.toLocaleString());
                    return;
                }
            }

            // 4. 只有在 Standalone 模式或特定情況下引導 (依計畫開發)
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

            // 延遲一點點時間彈出，體驗較好
            setTimeout(() => {
                setIsPushModalOpen(true);
            }, 2000);
        };

        checkPushPermission();
    }, [user]);

    const handlePushModalClose = () => {
        setIsPushModalOpen(false);
        // 設定冷卻時間：7天
        const cooldown = Date.now() + 7 * 24 * 60 * 60 * 1000;
        localStorage.setItem(STORAGE_KEYS.PUSH_PROMPT_COOLDOWN, cooldown.toString());
    };

    const handlePushConfirm = async () => {
        if (!user) return;

        try {
            // 執行訂閱
            const success = await notificationService.subscribe();
            if (success) {
                // 訂閱成功後，呼叫領取獎勵 API
                const result = await claimPushBonus(user.userId);
                if (result.success) {
                    showToast('推播已開啟！恭喜獲得 +360 點數獎勵', 'success');
                    // 刷新用戶資訊以更新點數顯示
                    handleRefresh();
                } else {
                    showToast('權限已開放，但獎勵領取失敗（可能已領取）', 'info');
                }
            }
        } catch (error) {
            console.error('[Push] Automation failed:', error);
        } finally {
            setIsPushModalOpen(false);
        }
    };

    const handleRefresh = async () => {
        console.log('Home: handleRefresh called');
        // 刷新貼文
        setFeedRefreshTrigger(prev => prev + 1);

        // 刷新使用者資訊 (包含點數、等級等)
        if (user?.userId && onUserUpdate) {
            try {
                const profileResponse = await api.getUserInfo(user.userId);
                if (profileResponse.success && profileResponse.data) {
                    onUserUpdate(profileResponse.data);
                    console.log('Home: User profile refreshed');
                }
            } catch (e) {
                console.error('Home: Failed to refresh user info', e);
            }
        }
    };

    usePullToRefresh(handleRefresh);

    if (!user) return null;

    // Calculate level based on points
    const level = Math.floor(user.points / 1000) + 1;
    const expProgress = ((user.points % 1000) / 1000) * 100;

    const handlePostCreated = () => {
        setFeedRefreshTrigger(prev => prev + 1);
    };

    return (
        <div className="flex flex-col gap-1 w-full pt-1">
            {/* 1. App Share Widget - Full Width */}
            <div className="mb-3">
                <AppShareWidget />
            </div>

            {/* 2. Post Composer Trigger - Full Width & Flat */}
            <div className="pb-3 border-b border-black/[0.03]">
                <div
                    onClick={() => setIsEditorOpen(true)}
                    className="bg-white p-4 flex items-center gap-4 cursor-pointer active:scale-[0.98] transition-all"
                >
                    <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {user.pictureUrl ? (
                            <img src={user.pictureUrl} alt="Me" className="w-full h-full object-cover" />
                        ) : (
                            <span className="text-neutral-400 font-medium">{user.displayName[0]}</span>
                        )}
                    </div>
                    <div className="flex-1 text-neutral-400 text-sm font-normal">
                        分享你的想法...
                    </div>
                    <div className="text-[#c5a059] p-1">
                        <ImageIcon size="1.125rem" strokeWidth={2} />
                    </div>
                </div>
            </div>



            {/* 4. Community Feed */}
            <div className="mt-2 text-left">
                <PostFeed
                    refreshTrigger={feedRefreshTrigger}
                    onPostClick={(postId, pos) => {
                        setClickPosition(pos);
                        setSelectedPostId(postId);
                    }}
                    userId={user?.userId || ''}
                    onUserClick={handleUserClick}
                />
            </div>

            {/* Post Editor Overlay */}
            <PostEditor
                isOpen={isEditorOpen}
                onClose={() => setIsEditorOpen(false)}
                onPostCreated={handlePostCreated}
                user={user}
            />

            {/* Post Detail Modal (Fake Page Jump) */}
            {selectedPostId && (
                <PostDetailModal
                    postId={selectedPostId}
                    user={user}
                    clickPosition={clickPosition}
                    onClose={() => setSelectedPostId(null)}
                    onUserClick={handleUserClick}
                />
            )}

            {/* User Profile Modal */}
            {viewingUserProfileId && (
                <UserReviewsModal
                    userId={viewingUserProfileId}
                    clickPosition={userProfileClickPos}
                    onClose={() => setViewingUserProfileId(null)}
                />
            )}

            {/* Push Permission Guiding Modal */}
            <PushPermissionModal
                isOpen={isPushModalOpen}
                onClose={handlePushModalClose}
                onConfirm={handlePushConfirm}
            />

        </div>
    );
};

export default Home;