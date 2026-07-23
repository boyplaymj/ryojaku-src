import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Settings, User as UserIcon, Zap, Award, Clock, Smartphone, Fingerprint, Camera, Save, X, ChevronRight, ChevronDown, AlertTriangle, Edit3, Loader2, Star, Crop, FileText, Activity, Users, Layers, Gift, BellRing, CheckCircle, Info, Coins } from 'lucide-react';
import { User } from '../types';
import { updateUserProfile, getUserInfo, redeemCode, getUploadUrl, claimPushBonus } from '../services/apiService';
import { api } from '../services/dataService';
import { authService } from '../services/authService';
import { notificationService } from '../services/notificationService';
import { usePullToRefresh } from '../contexts/RefreshContext';
import TermsOfServiceModal from '../components/TermsOfServiceModal';
import ReactCrop, { Crop as CropType, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import MyGamesOverlay from '../components/MyGamesOverlay';
import LedgerOverlay from '../components/LedgerOverlay';
import UserReviewsModal from '../components/UserReviewsModal';
import AccountSecurity from '../components/AccountSecurity';
import GoogleLinkCard from '../components/GoogleLinkCard';
import { AppInput, AppSelect, AppButton } from '../components/ui/CommonUI';

interface ProfileProps {
    user: User | null;
    onLogout: () => void;
    onUserUpdate: (user: User) => void;
    inviterPoints?: string;
}

// Reusable components removed - moved to CommonUI.tsx

const Profile: React.FC<ProfileProps> = ({ user, onLogout, onUserUpdate, inviterPoints = '100' }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const returnUrl = searchParams.get('returnUrl');
    const autoEdit = searchParams.get('edit') === 'true';
    const [pushEnabled, setPushEnabled] = useState(false);
    const [pushLoading, setPushLoading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [redeemCodeInput, setRedeemCodeInput] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    // 裁剪相關狀態
    const [cropModalOpen, setCropModalOpen] = useState(false);
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [crop, setCrop] = useState<CropType>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const [croppingFile, setCroppingFile] = useState<File | null>(null);

    const { showToast } = useToast();
    const [termsModalOpen, setTermsModalOpen] = useState(false);
    // 個人團局管理 Overlay 狀態
    const [isMyGamesOpen, setIsMyGamesOpen] = useState(false);
    const [myGamesTab, setMyGamesTab] = useState<'created' | 'joined'>('created');
    // 計帳本 Overlay 狀態
    const [isLedgerOpen, setIsLedgerOpen] = useState(false);
    const [showReviewsModal, setShowReviewsModal] = useState(false);

    // Local state for editing
    const [editForm, setEditForm] = useState<Partial<User>>({});

    // 根據 autoEdit 參數自動開啟編輯模式
    useEffect(() => {
        if (autoEdit && user && !isEditing) {
            setEditForm(user);
            setIsEditing(true);
        }
    }, [autoEdit, user]);

    // 選項映射：顯示中文，發送中文值給後端
    const genderOptions = [
        { value: '男', label: '男性' },
        { value: '女', label: '女性' },
        { value: '其他', label: '其他' }
    ];

    const ageRangeOptions = [
        { value: '18-25', label: '18-25歲' },
        { value: '26-35', label: '26-35歲' },
        { value: '36-45', label: '36-45歲' },
        { value: '46-55', label: '46-55歲' },
        { value: '56+', label: '56歲以上' }
    ];

    const experienceOptions = [
        { value: '新手', label: '新手' },
        { value: '初級', label: '初級' },
        { value: '中級', label: '中級' },
        { value: '高級', label: '高級' },
        { value: '專家', label: '專家' }
    ];

    // 顯示值轉換函數
    const getDisplayValue = (value: string | undefined, options: { value: string; label: string }[]) => {
        const option = options.find(opt => opt.value === value);
        return option ? option.label : value || '未設定';
    };

    useEffect(() => {
        if (user) {
            setEditForm(user);
        }
    }, [user]);

    // 刷新用戶資料的函數
    const fetchUserProfile = useCallback(async () => {
        if (!user) return;

        try {
            // 獲取用戶識別符
            const currentUser = authService.getCurrentUser();
            const lineId = authService.getLineId();
            const userIdentifier = currentUser?.userId || lineId;

            if (!userIdentifier) {
                console.warn('No user identifier found for profile refresh');
                return;
            }

            console.log('🔄 Refreshing user profile...');
            // 使用 getUserInfo 以獲取最新實時數據
            const response = await api.getUserInfo(userIdentifier);

            if (response.success && response.data) {
                // 更新本地狀態和 localStorage
                const updatedUser = { ...user, ...response.data };
                localStorage.setItem('mahjongclub_user_session', JSON.stringify(updatedUser));
                onUserUpdate(updatedUser as User);
                console.log('✅ Profile refreshed successfully');
            }
        } catch (error) {
            console.error('Failed to refresh profile:', error);
        }
    }, [user?.userId, onUserUpdate]);

    // 註冊下拉刷新處理函數
    usePullToRefresh(fetchUserProfile);

    useEffect(() => {
        const checkPush = async () => {
            const isSupported = notificationService.isPushSupported();
            if (isSupported) {
                const isSubscribed = await notificationService.checkSubscriptionStatus();
                setPushEnabled(isSubscribed);
            }
        };
        checkPush();
    }, []);

    if (!user) return null;

    const handleSave = async () => {
        setSaving(true);
        setError('');

        try {
            // 獲取用戶識別符 - 支援 APP 用戶和 LINE Bot 用戶
            const currentUser = authService.getCurrentUser();
            const lineId = authService.getLineId();

            // 優先使用 userId (APP 用戶)，其次使用 lineId (LINE Bot 用戶)
            const userIdentifier = currentUser?.userId || lineId;

            if (!userIdentifier) {
                throw new Error('未登入或登入狀態已過期');
            }

            // 調試日誌：檢查表單數據
            const profileData = {
                displayName: editForm.displayName,
                gender: editForm.gender,
                ageRange: editForm.ageRange,
                mahjongExperience: editForm.mahjongExperience,
                lineId: editForm.lineId,
                pictureUrl: editForm.pictureUrl,
            };

            console.log('🔍 Profile update data:', profileData);
            console.log('🔍 User identifier:', userIdentifier);

            const response = await updateUserProfile(userIdentifier, profileData);

            if (!response.success) {
                throw new Error(response.error || '更新失敗');
            }

            // Update local storage and parent state
            const updatedUser = { ...user, ...editForm };
            localStorage.setItem('mahjongclub_user_session', JSON.stringify(updatedUser));

            // 通知父組件更新用戶狀態
            onUserUpdate(updatedUser as User);

            if (returnUrl) {
                showToast('個人資料已更新', 'success');
                setTimeout(() => navigate(returnUrl), 1500);
            } else {
                setIsEditing(false);
            }
        } catch (error) {
            console.error('Failed to update profile:', error);
            setError(error instanceof Error ? error.message : '更新失敗');
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Basic validation
        if (!file.type.startsWith('image/')) {
            showToast('請選擇圖片檔案', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast('圖片大小不能超過 5MB', 'error');
            return;
        }

        // 讀取檔案並開啟裁剪視窗
        setCroppingFile(file);
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            setImageSrc(reader.result?.toString() || null);
            setCropModalOpen(true);
        });
        reader.readAsDataURL(file);

        // Reset input
        if (e.target) e.target.value = '';
    };

    // 當圖片載入時，設定初始裁剪區域 (置中的 1:1 比例)
    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        const cropSize = Math.min(width, height);
        const crop = centerCrop(
            makeAspectCrop(
                {
                    unit: '%',
                    width: (cropSize / width) * 90,
                },
                1,
                width,
                height
            ),
            width,
            height
        );
        setCrop(crop);
    };

    // 將裁剪區域轉換為 Blob
    const getCroppedImg = async (
        image: HTMLImageElement,
        crop: PixelCrop
    ): Promise<Blob | null> => {
        const canvas = document.createElement('canvas');
        const scaleX = image.naturalWidth / image.width;
        const scaleY = image.naturalHeight / image.height;

        // 輸出固定大小 (400x400) 以確保一致性
        const outputSize = 400;
        canvas.width = outputSize;
        canvas.height = outputSize;

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(
            image,
            crop.x * scaleX,
            crop.y * scaleY,
            crop.width * scaleX,
            crop.height * scaleY,
            0,
            0,
            outputSize,
            outputSize
        );

        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => resolve(blob),
                'image/jpeg',
                0.92
            );
        });
    };

    // 確認裁剪並上傳
    const handleCropConfirm = async () => {
        if (!imgRef.current || !completedCrop || !croppingFile) {
            console.error('Missing required data for crop:', {
                hasImgRef: !!imgRef.current,
                hasCompletedCrop: !!completedCrop,
                hasCroppingFile: !!croppingFile
            });
            showToast('裁剪資料不完整，請重試', 'error');
            return;
        }

        // 驗證裁剪區域有效
        if (completedCrop.width <= 0 || completedCrop.height <= 0) {
            console.error('Invalid crop dimensions:', completedCrop);
            showToast('請選擇有效的裁剪區域', 'error');
            return;
        }

        setUploading(true);
        setCropModalOpen(false);

        try {
            const currentUser = authService.getCurrentUser();
            const lineId = authService.getLineId();
            const userIdentifier = currentUser?.userId || lineId;

            if (!userIdentifier) throw new Error('未登入');

            // 獲取裁剪後的圖片
            const croppedBlob = await getCroppedImg(imgRef.current, completedCrop);
            if (!croppedBlob) throw new Error('裁剪失敗');

            // 建立裁剪後的檔案
            const croppedFile = new File(
                [croppedBlob],
                croppingFile.name.replace(/\.[^/.]+$/, '.jpg'),
                { type: 'image/jpeg' }
            );

            // 1. Get Presigned URL
            const response = await getUploadUrl({
                userId: userIdentifier,
                fileName: croppedFile.name,
                contentType: croppedFile.type
            });

            if (!response.success || !response.data) {
                throw new Error(response.error || '無法取得上傳網址');
            }

            const { uploadUrl, publicUrl } = response.data;

            // 2. Upload to S3
            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: croppedFile,
                headers: {
                    'Content-Type': croppedFile.type
                }
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                console.error('S3 Upload failed:', uploadResponse.status, errorText);
                throw new Error(`上傳至 S3 失敗: ${uploadResponse.status}`);
            }

            // 等待一小段時間確保 S3 完成處理
            await new Promise(resolve => setTimeout(resolve, 500));

            // 3. Update local preview only (don't save to DB yet)
            // 加入時間戳避免瀏覽器快取
            const timestampedUrl = `${publicUrl}?t=${Date.now()}`;
            setEditForm(prev => ({ ...prev, pictureUrl: timestampedUrl }));
            console.log('📸 Avatar cropped and uploaded to S3:', timestampedUrl);

        } catch (error) {
            console.error('Avatar upload error:', error);
            showToast(`上傳失敗: ${error instanceof Error ? error.message : '未知錯誤'}`, 'error');
        } finally {
            setUploading(false);
            setImageSrc(null);
            setCroppingFile(null);
            setCompletedCrop(undefined);
        }
    };

    // 取消裁剪
    const handleCropCancel = () => {
        setCropModalOpen(false);
        setImageSrc(null);
        setCroppingFile(null);
        setCrop(undefined);
        setCompletedCrop(undefined);
    };

    const handleCancel = () => {
        setEditForm(user);
        setIsEditing(false);
        setError('');
    };

    const [claimingReward, setClaimingReward] = useState(false);

    const handleEnablePush = async () => {
        if (pushLoading) return;
        setPushLoading(true);
        try {
            const success = await notificationService.subscribe();
            if (success) {
                setPushEnabled(true);
                showToast('推播功能已成功開啟！', 'success');
            }
        } catch (error) {
            console.error('Push enable error:', error);
            showToast(`開啟失敗: ${error instanceof Error ? error.message : '未知錯誤'}`, 'error');
        } finally {
            setPushLoading(false);
        }
    };

    const handleClaimPushBonus = async () => {
        if (claimingReward || !user) return;
        setClaimingReward(true);
        try {
            const result = await claimPushBonus(user.userId);
            if (result.success) {
                showToast('推播已開啟！恭喜獲得 +360 點數獎勵', 'success');
                // 重新整理使用者資訊以取得最新 hasClaimedPushBonus 狀態與點數
                await fetchUserProfile();
            } else {
                showToast(result.error || '更新失敗', 'error');
            }
        } catch (error) {
            console.error('Claim bonus error:', error);
            showToast('獎勵領取過程發生錯誤', 'error');
        } finally {
            setClaimingReward(false);
        }
    };

    const handleRedeem = async () => {
        if (!redeemCodeInput.trim()) {
            showToast('請輸入兌換碼', 'error');
            return;
        }

        setRedeeming(true);
        try {
            const currentUser = authService.getCurrentUser();
            const lineId = authService.getLineId();
            const userIdentifier = currentUser?.userId || lineId;

            if (!userIdentifier) {
                throw new Error('未登入或登入狀態已過期');
            }

            const response = await redeemCode(userIdentifier, redeemCodeInput);

            if (response.success) {
                showToast('兌換成功！' + (response.data?.message || ''), 'success');
                setRedeemCodeInput('');
                // Refresh user profile to update points
                fetchUserProfile();
            } else {
                throw new Error(response.error || '兌換失敗');
            }
        } catch (error) {
            console.error('Redeem error:', error);
            showToast(`兌換失敗: ${error instanceof Error ? error.message : '未知錯誤'}`, 'error');
        } finally {
            setRedeeming(false);
        }
    };



    if (isEditing) {
        return (
            <div className="p-6 bg-[#f9f9f7] min-h-screen max-w-7xl mx-auto w-full animate-fade-in">
                {/* Modern Header */}
                <div className="flex items-center justify-between mb-10 mt-2">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleCancel}
                            className="w-12 h-12 rounded-lg bg-white border border-black/[0.03] flex items-center justify-center text-neutral-400 hover:text-neutral-900 transition-all active:scale-90 shadow-sm"
                        >
                            <X size="1.25rem" />
                        </button>
                        <div>
                            <h1 className="text-xl font-black text-neutral-900 tracking-tight">編輯個人檔案</h1>
                            <p className="text-[0.625rem] font-bold text-neutral-400 uppercase tracking-widest">Update your profile settings</p>
                        </div>
                    </div>
                </div>

                {/* Avatar Upload Section - Simplified Small Radius */}
                <div className="relative flex flex-col items-center">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/*"
                        className="hidden"
                    />
                    <div className="relative group cursor-pointer active:scale-95 transition-all" onClick={handleAvatarClick}>
                        <div className="w-32 h-32 rounded-lg bg-white p-1.5 shadow-xl relative z-10 overflow-hidden flex items-center justify-center border border-black/[0.05] group-hover:border-[#c5a059]/30 transition-all duration-300">
                            <div className="w-full h-full rounded-lg overflow-hidden bg-neutral-50 flex items-center justify-center shadow-inner">
                                {uploading ? (
                                    <div className="flex flex-col items-center gap-1">
                                        <Loader2 className="animate-spin text-[#c5a059]" size="1.75rem" />
                                    </div>
                                ) : editForm.pictureUrl ? (
                                    <img src={editForm.pictureUrl} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-4xl font-black text-neutral-200 uppercase">{editForm.displayName?.[0]}</span>
                                )}
                            </div>
                        </div>
                        <div className="absolute -bottom-1 -right-1 bg-neutral-900 text-white p-2.5 rounded-lg shadow-lg z-20 group-hover:bg-[#c5a059] transition-colors border-2 border-white">
                            <Camera size="1rem" strokeWidth={2.5} />
                        </div>
                    </div>
                    <p className="mt-4 text-[0.625rem] font-black text-neutral-300 uppercase tracking-widest">更換大頭貼圖片</p>
                </div>

                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-lg border border-black/[0.04] shadow-sm">
                        <div className="flex items-center gap-2 mb-6 ml-1">
                            <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                            <h3 className="text-[0.6875rem] font-black text-neutral-900 uppercase tracking-widest">基本資訊內容</h3>
                        </div>

                        <AppInput
                            label="DISPLAY NAME / 顯示暱稱"
                            value={editForm.displayName}
                            onChange={(e: any) => setEditForm({ ...editForm, displayName: e.target.value })}
                            icon={UserIcon}
                            className="mb-6"
                        />

                        <AppInput
                            label="LINE ID / 聯絡帳號"
                            value={editForm.lineId}
                            onChange={(e: any) => setEditForm({ ...editForm, lineId: e.target.value })}
                            icon={Smartphone}
                            className="mb-6"
                        />

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <AppSelect
                                label="GENDER / 性別"
                                value={editForm.gender || ''}
                                onChange={(val: string) => setEditForm({ ...editForm, gender: val })}
                                options={genderOptions}
                                icon={UserIcon}
                            />
                            <AppSelect
                                label="AGE / 年齡層區段"
                                value={editForm.ageRange || ''}
                                onChange={(val: string) => setEditForm({ ...editForm, ageRange: val })}
                                options={ageRangeOptions}
                                icon={Fingerprint}
                            />
                        </div>

                        <AppSelect
                            label="EXPERIENCE / 雀齡及對戰經驗"
                            value={editForm.mahjongExperience || ''}
                            onChange={(val: string) => setEditForm({ ...editForm, mahjongExperience: val })}
                            options={experienceOptions}
                            icon={Award}
                            className="mb-6"
                        />
                    </div>
                </div>

                {error && (
                    <div className="p-5 bg-red-50 text-red-600 rounded-lg border border-red-100 text-[0.8125rem] font-black animate-shake flex items-center gap-3">
                        <AlertTriangle size="1.125rem" />
                        {error}
                    </div>
                )}

                <div className="flex flex-col gap-3 pt-2">
                    <AppButton
                        onClick={handleSave}
                        isLoading={saving}
                        icon={Save}
                        className="w-full"
                    >
                        <span>儲存個人設定</span>
                    </AppButton>

                    <AppButton
                        variant="ghost"
                        onClick={handleCancel}
                        className="w-full"
                    >
                        捨棄本次變更
                    </AppButton>
                </div>

                {/* 圖片裁剪 Modal - Minimal Style */}
                {
                    cropModalOpen && imageSrc && (
                        <div className="fixed inset-0 bg-neutral-900/80 backdrop-blur-xl z-[100] flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
                            <div className="bg-white rounded-lg p-8 max-w-lg w-full shadow-2xl overflow-hidden relative">
                                {/* Decorative bg */}
                                <div className="absolute top-0 right-0 w-32 h-32 bg-[#c5a059]/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>

                                <div className="flex items-center justify-between mb-6 relative z-10">
                                    <h3 className="text-xl font-black text-neutral-900 flex items-center gap-3">
                                        <div className="p-2 bg-[#c5a059]/10 rounded-lg">
                                            <Crop size="1.25rem" className="text-[#c5a059]" />
                                        </div>
                                        頭像設定
                                    </h3>
                                    <button
                                        onClick={handleCropCancel}
                                        className="w-10 h-10 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 active:scale-90 transition-all"
                                    >
                                        <X size="1.25rem" />
                                    </button>
                                </div>

                                <p className="text-xs text-neutral-400 mb-6 text-center font-medium leading-relaxed">
                                    調整頭像顯示範圍。<br />建議將臉部置中以獲得最佳效果。
                                </p>

                                <div className="max-h-[50vh] overflow-hidden flex items-center justify-center bg-neutral-100 rounded-lg p-3 border border-black/[0.02]">
                                    <ReactCrop
                                        crop={crop}
                                        onChange={(c) => setCrop(c)}
                                        onComplete={(c) => setCompletedCrop(c)}
                                        aspect={1}
                                        circularCrop={true}
                                    >
                                        <img
                                            ref={imgRef}
                                            src={imageSrc}
                                            alt="Crop"
                                            onLoad={onImageLoad}
                                            className="max-h-[40vh] max-w-full"
                                        />
                                    </ReactCrop>
                                </div>

                                <div className="flex gap-4 mt-8">
                                    <button
                                        onClick={handleCropCancel}
                                        className="flex-1 py-4 bg-neutral-50 hover:bg-neutral-100 text-neutral-500 rounded-lg transition-all font-bold text-sm"
                                    >
                                        捨棄
                                    </button>
                                    <button
                                        onClick={handleCropConfirm}
                                        disabled={!completedCrop}
                                        className="flex-1 py-4 bg-neutral-900 text-white rounded-lg transition-all font-bold text-sm shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        確認套用
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div>
        )
    }

    return (
        <div className="animate-fade-in relative z-0">
            {/* Top Header - Minimal & Clean */}
            {/* Top Header - Standardized h-16 */}
            <div className="h-16 px-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white border border-black/[0.03] flex items-center justify-center text-[#c5a059] shadow-sm">
                        <UserIcon size="1.25rem" strokeWidth={2.5} />
                    </div>
                </div>
                <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg transition-all active:scale-95 shadow-lg shadow-black/5"
                >
                    <Settings size="1.125rem" className="text-[#c5a059]" />
                    <span className="text-[0.8125rem] font-black text-white tracking-widest uppercase">系統設定</span>
                </button>
            </div>

            {/* Profile Hero Section - Standard Project Theme */}
            <div className="px-4 mb-6 pt-2">
                <div className="relative bg-white rounded-lg p-5 border border-black/[0.05] flex items-center gap-5 overflow-hidden shadow-sm">
                    {/* Background decoration - Subtle */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#c5a059]/5 rounded-full blur-3xl -mr-16 -mt-16"></div>

                    {/* Left: Avatar with fixed LV.1 */}
                    <div className="relative flex-shrink-0">
                        <div className="w-20 h-20 rounded-lg bg-neutral-50 p-1 border border-black/[0.02] overflow-hidden flex items-center justify-center">
                            {user.pictureUrl ? (
                                <img src={user.pictureUrl} alt={user.displayName} className="w-full h-full object-cover rounded-lg" />
                            ) : (
                                <span className="text-2xl font-black text-neutral-200">{user.displayName[0]}</span>
                            )}
                        </div>
                        <div className="absolute -bottom-1.5 -right-1 bg-neutral-900 text-[#c5a059] text-[0.5625rem] font-black px-2 py-0.5 rounded border border-white shadow-sm tracking-tighter">
                            LV.1
                        </div>
                    </div>

                    {/* Right: User Identity */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <h2 className="text-lg font-black text-neutral-900 truncate tracking-tight">
                                {user.displayName}
                            </h2>
                            <CheckCircle size="0.875rem" strokeWidth={3} className="text-[#c5a059] flex-shrink-0" />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-neutral-400">
                                <Fingerprint size="0.6875rem" strokeWidth={2.5} className="text-neutral-300" />
                                <span className="text-[0.625rem] font-black font-mono tracking-tight uppercase">
                                    ID:{user.userId.replace('APP_', '').substring(0, 8)}
                                </span>
                            </div>

                            <div className="inline-flex items-center gap-2 bg-neutral-50 px-2.5 py-1 rounded border border-black/[0.02] w-fit">
                                <Award size="0.625rem" strokeWidth={3} className="text-[#c5a059]" />
                                <span className="text-[0.5625rem] font-black text-neutral-400 uppercase tracking-widest whitespace-nowrap">
                                    {getDisplayValue(user.mahjongExperience, experienceOptions)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="px-4 mb-4 grid grid-cols-2 gap-3">
                <div className="bg-white p-4 rounded-lg border border-black/[0.04] shadow-sm relative overflow-hidden group">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Coins size="0.625rem" className="text-[#c5a059]" />
                        <p className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest leading-none">累計積分</p>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-xl font-black text-neutral-900 leading-none">{user.points}</span>
                        <span className="text-[0.5rem] font-bold text-[#c5a059]">PT</span>
                    </div>
                    <div className="mt-3 h-1 w-full bg-neutral-50 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[#c5a059] rounded-full"
                            style={{ width: `${Math.min((user.points % 1000) / 10, 100)}%` }}
                        ></div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-lg border border-black/[0.04] shadow-sm relative overflow-hidden group">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Award size="0.625rem" className="text-[#c5a059]" />
                        <p className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest leading-none">信譽評級</p>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-xl font-black text-neutral-900 leading-none">
                            {user.stats?.totalRatings && user.stats.totalRatings > 0 ? `${Math.round(user.stats.positiveRatingRate || 0)}%` : '100%'}
                        </span>
                        <span className="text-[0.5rem] font-bold text-neutral-300">({user.stats?.totalRatings || 0})</span>
                    </div>
                    <div className="flex gap-0.5 mt-3">
                        {[1, 2, 3, 4, 5].map((s) => (
                            <div key={s} className={`h-1 flex-1 rounded-full ${s <= 4 ? 'bg-neutral-900' : 'bg-neutral-50'}`}></div>
                        ))}
                    </div>
                </div>
            </div>


            {/* Management Hub */}
            <div className="px-4 mb-3">
                <div className="flex items-center gap-2 mb-3 ml-2">
                    <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                    <h3 className="text-[0.625rem] font-black text-neutral-900 uppercase tracking-widest">個人管理中心</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={() => {
                            setMyGamesTab('created');
                            setIsMyGamesOpen(true);
                        }}
                        className="group relative bg-neutral-900 p-4 rounded-lg flex flex-col justify-between overflow-hidden active:scale-95 transition-all text-left h-24 shadow-md"
                    >
                        <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 rounded-full -mr-8 -mt-8 group-hover:bg-white/10 transition-all"></div>
                        <p className="text-[0.5rem] font-black text-white/30 uppercase tracking-widest mb-0.5 relative z-10">主揪開局</p>
                        <div className="flex items-center justify-between relative z-10">
                            <p className="text-2xl font-black text-white">{user.stats?.gamesHosted || 0}</p>
                            <ChevronRight size="0.875rem" className="text-[#c5a059]" />
                        </div>
                    </button>

                    <button
                        onClick={() => {
                            setMyGamesTab('joined');
                            setIsMyGamesOpen(true);
                        }}
                        className="group relative bg-white p-4 rounded-lg border border-black/[0.04] flex flex-col justify-between overflow-hidden active:scale-95 transition-all text-left h-24 shadow-sm"
                    >
                        <div className="absolute top-0 right-0 w-16 h-16 bg-[#c5a059]/5 rounded-full -mr-8 -mt-8 group-hover:bg-[#c5a059]/10 transition-all"></div>
                        <p className="text-[0.5rem] font-black text-neutral-300 uppercase tracking-widest mb-0.5 relative z-10">參加紀錄</p>
                        <div className="flex items-center justify-between relative z-10">
                            <p className="text-2xl font-black text-neutral-900 group-hover:text-[#c5a059] transition-colors">{user.stats?.gamesJoined || 0}</p>
                            <ChevronRight size="0.875rem" className="text-neutral-200 group-hover:text-[#c5a059]" />
                        </div>
                    </button>
                </div>
            </div>

            {/* Exclusive Features Card */}
            <div className="px-4 mb-4">
                <div
                    onClick={() => setIsLedgerOpen(true)}
                    className="group relative bg-white rounded-lg border border-black/[0.04] p-4 cursor-pointer active:scale-[0.98] overflow-hidden transition-all shadow-sm"
                >
                    <div className="flex items-center gap-4 relative z-10">
                        <div className="w-12 h-12 rounded-lg bg-neutral-900 flex items-center justify-center text-[#c5a059] shadow-lg group-hover:scale-105 transition-all duration-500">
                            <FileText size="1.25rem" strokeWidth={2.5} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                                <h3 className="text-md font-black text-neutral-900 tracking-tight">雀友帳本</h3>
                                <div className="px-1.5 py-0.5 bg-[#c5a059] rounded text-[0.375rem] font-black text-white tracking-widest uppercase">
                                    PREMIUM
                                </div>
                            </div>
                            <p className="text-[0.625rem] text-neutral-300 font-bold">紀錄勝率分佈與個人詳細戰績統計。</p>
                        </div>
                        <ChevronRight size="1rem" className="text-neutral-200 group-hover:text-[#c5a059] transition-colors" />
                    </div>
                </div>
            </div>


            {/* Utilities Stack */}
            <div className="px-4 space-y-3 pb-8">
                {/* Notification Settings Card */}
                <div className="bg-white p-5 rounded-lg border border-black/[0.04] shadow-sm">
                    <div className="flex items-center gap-4 mb-5">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center shadow-lg transition-all duration-700 ${pushEnabled ? 'bg-[#c5a059]/10 text-[#c5a059]' : 'bg-neutral-50 text-neutral-200'}`}>
                            <BellRing size="1.25rem" strokeWidth={2.5} className={pushEnabled ? 'animate-bounce' : ''} />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-md font-black text-neutral-900 tracking-tight flex items-center gap-2">
                                訊息通知中心
                                {pushEnabled && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_0.5rem_rgba(16,185,129,0.5)]"></div>}
                            </h3>
                            <p className="text-[0.5625rem] text-neutral-300 font-bold tracking-widest uppercase">Set Notification Preferences</p>
                        </div>
                    </div>

                    {!pushEnabled ? (
                        <button
                            onClick={handleEnablePush}
                            disabled={pushLoading}
                            className="w-full px-6 py-3.5 bg-neutral-900 text-white font-black text-[0.625rem] rounded-lg shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
                        >
                            {pushLoading ? <Loader2 size="1rem" className="animate-spin" /> : <><Zap size="0.875rem" fill="#c5a059" className="text-[#c5a059]" /> 開啟通知並領取 360 PT</>}
                        </button>
                    ) : (
                        <div className="flex items-center justify-between p-1.5 bg-neutral-50 rounded-lg">
                            <div className="flex items-center gap-2 px-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                <span className="text-[0.5625rem] font-black text-neutral-500 uppercase tracking-widest">通知功能已啟用</span>
                            </div>

                            {user && !user.hasClaimedPushBonus ? (
                                <button
                                    onClick={handleClaimPushBonus}
                                    disabled={claimingReward}
                                    className="px-4 py-2 bg-[#c5a059] text-white font-black text-[0.5625rem] rounded shadow-lg active:scale-95 transition-all flex items-center gap-1.5 uppercase tracking-widest"
                                >
                                    {claimingReward ? <Loader2 size="0.75rem" className="animate-spin" /> : <><Gift size="0.75rem" /> 領取獎勵</>}
                                </button>
                            ) : (
                                <div className="flex items-center gap-1.5 px-3 py-2 bg-white rounded border border-black/[0.02]">
                                    <CheckCircle size="0.75rem" className="text-[#c5a059]" />
                                    <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-wider">已領取獎勵</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* User Info Details Card */}
                <div className="bg-white p-5 rounded-lg border border-black/[0.04] shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                        <h3 className="text-[0.625rem] font-black text-neutral-900 uppercase tracking-widest">個人資料紀錄</h3>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                        {[
                            { label: '性別', value: getDisplayValue(user.gender, genderOptions) },
                            { label: '年齡層', value: getDisplayValue(user.ageRange, ageRangeOptions) },
                            { label: '聯繫 ID', value: user.lineId || '未設定', highlight: true }
                        ].map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 px-4 bg-neutral-50/50 rounded hover:bg-white transition-colors border border-black/[0.01]">
                                <span className="text-[0.625rem] font-bold text-neutral-400">{item.label}</span>
                                <span className={`text-[0.75rem] font-black ${item.highlight ? 'text-[#c5a059]' : 'text-neutral-900'}`}>{item.value}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Redeem & Invite Card */}
                <div className="bg-white p-5 rounded-lg border border-black/[0.04] shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                        <h3 className="text-[0.625rem] font-black text-neutral-900 uppercase tracking-widest">兌換與獎勵系統</h3>
                    </div>

                    <div className="space-y-4">
                        <AppInput
                            value={redeemCodeInput}
                            onChange={(e) => setRedeemCodeInput(e.target.value)}
                            placeholder="請輸入兌換碼"
                            className="bg-neutral-50"
                            rightElement={
                                <button
                                    onClick={handleRedeem}
                                    disabled={redeeming || !redeemCodeInput.trim()}
                                    className="px-4 h-8 bg-neutral-900 text-white font-black rounded text-[0.5625rem] tracking-widest uppercase shadow-md active:scale-90 transition-all disabled:opacity-30"
                                >
                                    {redeeming ? <Loader2 size="0.75rem" className="animate-spin" /> : '兌換'}
                                </button>
                            }
                        />

                        <div className="pt-4 border-t border-black/[0.02]">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest">專屬邀請碼</p>
                                <div className="px-2 py-0.5 bg-[#c5a059]/10 rounded text-[0.5rem] font-black text-[#c5a059]">
                                    +{inviterPoints} PT / 分享
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    const code = user?.userId.replace('APP_', '') || '';
                                    navigator.clipboard.writeText(code);
                                    showToast('邀請代碼已複製到剪貼簿', 'success');
                                }}
                                className="w-full p-5 bg-neutral-50 rounded border border-black/[0.01] flex items-center justify-between group active:scale-[0.98] transition-all"
                            >
                                <p className="text-xl font-black text-neutral-900 tracking-[0.3em] font-mono">{user?.userId.replace('APP_', '')}</p>
                                <div className="w-8 h-8 rounded bg-white flex items-center justify-center text-neutral-300 group-hover:text-[#c5a059] shadow-sm transition-all">
                                    <Layers size="1rem" />
                                </div>
                            </button>

                            <div className="mt-4 space-y-2">
                                <div className="flex justify-between items-center text-[0.625rem] font-black text-neutral-400 uppercase tracking-tight">
                                    <span>邀請進度</span>
                                    <span>{user?.inviteCount || 0} / {user?.inviteLimit || 10}</span>
                                </div>
                                <div className="h-1 w-full bg-neutral-50 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-neutral-900 rounded-full transition-all duration-1000"
                                        style={{ width: `${Math.min(((user?.inviteCount || 0) / (user?.inviteLimit || 10)) * 100, 100)}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* System Options Card Stack */}
                <div className="space-y-2">
                    <button
                        onClick={() => setShowReviewsModal(true)}
                        className="w-full flex items-center justify-between p-4 bg-white rounded-lg border border-black/[0.04] group active:scale-[0.98] transition-all shadow-sm"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-neutral-900 flex items-center justify-center text-[#c5a059] group-hover:rotate-3 transition-all shadow-md">
                                <Star size="1.125rem" strokeWidth={2.5} />
                            </div>
                            <div className="text-left">
                                <h4 className="text-[0.8125rem] font-black text-neutral-900 tracking-tight">信譽評價系統</h4>
                                <p className="text-[0.5rem] text-neutral-300 font-bold uppercase tracking-widest">Reputation & Feedback</p>
                            </div>
                        </div>
                        <ChevronRight size="1rem" className="text-neutral-200 group-hover:text-[#c5a059]" />
                    </button>

                    <button
                        onClick={() => setTermsModalOpen(true)}
                        className="w-full flex items-center justify-between p-4 bg-white rounded-lg border border-black/[0.04] group active:scale-[0.98] transition-all shadow-sm"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-400 group-hover:bg-[#c5a059]/10 group-hover:text-[#c5a059] transition-all shadow-md">
                                <FileText size="1.125rem" strokeWidth={2.5} />
                            </div>
                            <div className="text-left">
                                <h4 className="text-[0.8125rem] font-black text-neutral-900 tracking-tight">服務條款與隱私權規範</h4>
                                <p className="text-[0.5rem] text-neutral-300 font-bold uppercase tracking-widest">Terms & Privacy</p>
                            </div>
                        </div>
                        <ChevronRight size="1rem" className="text-neutral-200 group-hover:text-[#c5a059]" />
                    </button>

                    <div className="mt-3"><AccountSecurity /></div>
                    <div className="mt-3"><GoogleLinkCard /></div>

                    <div className="pt-2">
                        <button
                            onClick={onLogout}
                            className="w-full h-12 bg-white border border-red-100 text-red-500 font-black text-[0.6875rem] uppercase tracking-[0.2em] rounded-lg shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-3 hover:bg-red-50"
                        >
                            <AlertTriangle size="1rem" strokeWidth={2.5} />
                            登出當前帳號
                        </button>
                    </div>
                </div>
            </div>



            {/* 圖片裁剪 Modal - Main Content */}
            {
                cropModalOpen && imageSrc && (
                    <div className="fixed inset-0 bg-neutral-900/80 backdrop-blur-xl z-[100] flex flex-col items-center justify-center p-6">
                        <div className="bg-white rounded-lg p-8 max-w-lg w-full shadow-2xl overflow-hidden relative">
                            {/* Decorative bg */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-[#c5a059]/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>

                            <div className="flex items-center justify-between mb-6 relative z-10">
                                <h3 className="text-xl font-black text-neutral-900 flex items-center gap-3">
                                    <div className="p-2 bg-[#c5a059]/10 rounded-lg">
                                        <Crop size="1.25rem" className="text-[#c5a059]" />
                                    </div>
                                    頭像設定
                                </h3>
                                <button
                                    onClick={handleCropCancel}
                                    className="w-10 h-10 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 active:scale-90 transition-all"
                                >
                                    <X size="1.25rem" />
                                </button>
                            </div>

                            <div className="max-h-[50vh] overflow-hidden flex items-center justify-center bg-neutral-100 rounded-lg p-3 border border-black/[0.02]">
                                <ReactCrop
                                    crop={crop}
                                    onChange={(c) => setCrop(c)}
                                    onComplete={(c) => setCompletedCrop(c)}
                                    aspect={1}
                                    circularCrop={true}
                                >
                                    <img
                                        ref={imgRef}
                                        src={imageSrc}
                                        alt="Crop"
                                        onLoad={onImageLoad}
                                        className="max-h-[40vh] max-w-full"
                                    />
                                </ReactCrop>
                            </div>

                            <div className="flex gap-4 mt-8">
                                <button
                                    onClick={handleCropCancel}
                                    className="flex-1 py-4 bg-neutral-50 hover:bg-neutral-100 text-neutral-500 rounded-lg transition-all font-bold text-sm"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleCropConfirm}
                                    disabled={!completedCrop}
                                    className="flex-1 py-4 bg-neutral-900 text-white rounded-lg transition-all font-bold text-sm shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    更新個人頭像
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 服務條款 Modal */}
            {
                termsModalOpen && (
                    <TermsOfServiceModal onClose={() => setTermsModalOpen(false)} />
                )
            }

            {/* 個人團局管理 Overlay - 假跳轉頁面 */}
            {
                user && (
                    <MyGamesOverlay
                        isOpen={isMyGamesOpen}
                        onClose={() => setIsMyGamesOpen(false)}
                        userId={user.userId}
                        initialTab={myGamesTab}
                    />
                )
            }

            {/* 麻將計帳本 Overlay - 假跳轉頁面 */}
            {user && showReviewsModal && (
                <UserReviewsModal
                    userId={user.userId}
                    onClose={() => setShowReviewsModal(false)}
                />
            )}

            {/* 麻將計帳本 Overlay - 假跳轉頁面 */}
            <LedgerOverlay
                isOpen={isLedgerOpen}
                onClose={() => setIsLedgerOpen(false)}
            />
        </div>
    );
};

export default Profile;