import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Coins, Navigation, AlertCircle, Clock, Bug, Info, AlertTriangle, Map as MapIcon, ChevronRight, History, Home, Award, ChevronDown, ShieldCheck, BellRing, User as UserIcon, Gift, Flame } from 'lucide-react';
import type { CreateMahjongGamePayload, User } from '../types';

import MapPicker from '../components/MapPicker';
import ProfileIncompleteModal from '../components/ProfileIncompleteModal';
import DynamicListInput from '../components/DynamicListInput';
import CreateGroupStage2, { type ImageItem } from '../components/CreateGroupStage2';
import { isProfileComplete, getMissingProfileFields } from '../utils/profileUtils';
import { saveCreateGameDraft, loadCreateGameDraft, clearCreateGameDraft } from '../utils/draftStorage';
import { buildCreateGamePayload, validateCreateGame } from '../utils/createGroupForm';
import { authService } from '../services/authService';
import { api } from '../services/dataService';
import { createPortal } from 'react-dom';
import TemplateSelectorModal from '../components/TemplateSelectorModal';
import TermsAgreementModal from '../components/TermsAgreementModal';
import DatePicker from '../components/DatePicker';
import PushPermissionModal from '../components/PushPermissionModal';
import DailyBonusModal from '../components/DailyBonusModal';
import * as apiService from '../services/apiService';
import { notificationService } from '../services/notificationService';
import { claimPushBonus } from '../services/apiService';
import { STORAGE_KEYS } from '../constants';
import { Game } from '../types';
import { AppInput, AppSelect, AppButton } from '../components/ui/CommonUI';
import { useToast } from '../contexts/ToastContext';

interface CreateGroupProps {
    onCreate: (gameData: CreateMahjongGamePayload) => Promise<{ success: boolean; error?: string }>;
    user: User | null;
}

const CreateGroup: React.FC<CreateGroupProps> = ({ onCreate, user }) => {
    const navigate = useNavigate();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const { showToast } = useToast();
    const [isMapOpen, setIsMapOpen] = useState(false);
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);

    // 個人資料檢查相關狀態
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [missingFields, setMissingFields] = useState<string[]>([]);
    const [isDailyBonusOpen, setIsDailyBonusOpen] = useState(false);
    const [dailyBonusData, setDailyBonusData] = useState<{ pointsEarned: number; consecutiveDays: number; isStreakBonus: boolean; } | null>(null);

    // 服務條款確認狀態
    const [showTermsAgreement, setShowTermsAgreement] = useState(false);

    // 推播引導狀態
    const [isPushModalOpen, setIsPushModalOpen] = useState(false);

    // 照片上傳狀態
    const [imageItems, setImageItems] = useState<ImageItem[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 用於跳過初始載入時的自動儲存
    const isInitialMount = useRef(true);
    const draftLoaded = useRef(false);

    // Get minimum datetime (current time)
    const getMinDateTime = () => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 16);
    };

    // 新增環境選項狀態
    const [smoking, setSmoking] = useState<string>('無菸');
    const [parking, setParking] = useState<string[]>([]);
    const [elevator, setElevator] = useState<string>('有電梯');
    const [mahjongTable, setMahjongTable] = useState<string>('電動桌');
    const [tableModel, setTableModel] = useState<string>('');
    const [venueType, setVenueType] = useState<string>('');
    const [skillLevel, setSkillLevel] = useState<string>('');

    const [formData, setFormData] = useState<CreateMahjongGamePayload>({
        type: 'one-time',          // 團局種類: 臨時揪團 (必選)
        gameType: '基本三將',      // 麻將規則類型 (硬編碼與機器人一致)
        placeName: '',             // 場地名稱
        location: '',              // 完整地址
        latitude: 0,               // GPS 緯度
        longitude: 0,              // GPS 經度
        needPlayers: 1,            // 缺幾人 (1-3)
        stakes: '100/20',          // 籌碼
        startTime: getMinDateTime(), // ISO 8601 格式
        rules: [''],               // 遊戲規則 (陣列)
        features: [''],            // 場地特色 (陣列)
        restrictions: ['']         // 禁止事項 (陣列)
    });

    const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>({
        latitude: 0,
        longitude: 0
    });

    // 頁面載入時，從 localStorage 讀取草稿
    useEffect(() => {
        const draft = loadCreateGameDraft();
        if (draft) {
            console.log('📋 載入草稿資料');
            setFormData(draft.formData);
            setCoordinates(draft.coordinates);
            if (draft.envOptions) {
                setSmoking(draft.envOptions.smoking);
                setParking(draft.envOptions.parking);
                setElevator(draft.envOptions.elevator);
                setMahjongTable(draft.envOptions.mahjongTable);
                setTableModel(draft.envOptions.tableModel);
                setVenueType(draft.envOptions.venueType || '');
                setSkillLevel(draft.envOptions.skillLevel || '');
            }
            draftLoaded.current = true;
        }
        // 初始載入完成後才允許自動儲存
        isInitialMount.current = false;
    }, []);

    // 表單變更時，自動儲存草稿（使用 debounce）
    useEffect(() => {
        // 跳過初始載入和剛載入草稿時的儲存
        if (isInitialMount.current) return;

        const timer = setTimeout(() => {
            saveCreateGameDraft(formData, coordinates, {
                smoking,
                parking,
                elevator,
                mahjongTable,
                tableModel,
                venueType,
                skillLevel
            });
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [formData, coordinates]);

    // Helper to handle dynamic list changes
    const handleListChange = (field: 'rules' | 'features' | 'restrictions', index: number, value: string) => {
        const newList = [...formData[field]];
        newList[index] = value;
        setFormData({ ...formData, [field]: newList });
    };

    const addListItem = (field: 'rules' | 'features' | 'restrictions') => {
        setFormData({ ...formData, [field]: [...formData[field], ''] });
    };

    const removeListItem = (field: 'rules' | 'features' | 'restrictions', index: number) => {
        if (formData[field].length <= 1) {
            const newList = [...formData[field]];
            newList[0] = '';
            setFormData({ ...formData, [field]: newList });
            return;
        }
        const newList = formData[field].filter((_, i) => i !== index);
        setFormData({ ...formData, [field]: newList });
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0 && user) {
            const newFiles = Array.from(e.target.files);

            newFiles.forEach(async (file) => {
                const id = Math.random().toString(36).substr(2, 9);
                const preview = URL.createObjectURL(file);

                // Add to state immediately
                const newItem: ImageItem = { id, file, preview, status: 'uploading' };
                setImageItems(prev => [...prev, newItem]);

                try {
                    // 1. Get Presigned URL
                    const response = await apiService.getEventUploadUrl(user.userId, file.name, file.type);

                    if (response.success && response.data) {
                        const { uploadUrl, publicUrl } = response.data;

                        // 2. Upload to S3
                        await fetch(uploadUrl, {
                            method: 'PUT',
                            body: file,
                            headers: {
                                'Content-Type': file.type,
                                'Cache-Control': 'public, max-age=31536000, immutable'
                            }
                        });

                        // 3. Update state with URL
                        setImageItems(prev => prev.map(item =>
                            item.id === id ? { ...item, url: publicUrl, status: 'done' } : item
                        ));
                    } else {
                        throw new Error('Failed to get upload URL');
                    }
                } catch (error) {
                    console.error('Image upload failed:', error);
                    setImageItems(prev => prev.map(item =>
                        item.id === id ? { ...item, status: 'error' } : item
                    ));
                }
            });
        }
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeImage = (id: string) => {
        setImageItems(prev => {
            const item = prev.find(i => i.id === id);
            if (item) URL.revokeObjectURL(item.preview);
            return prev.filter(i => i.id !== id);
        });
    };

    const handleLocationConfirm = (locationData: { address: string; lat: number; lng: number }) => {
        setFormData(prev => ({
            ...prev,
            location: locationData.address,
            latitude: locationData.lat,
            longitude: locationData.lng
        }));
        setCoordinates({
            latitude: locationData.lat,
            longitude: locationData.lng
        });
        setIsMapOpen(false);
    };

    const handleTemplateSelect = (game: Game) => {
        console.log('📋 引入模板資料:', game);

        // 保持目前的開始時間
        const currentStartTime = formData.startTime;

        const allFeatures = game.venueFeatures || [];

        // 從 features 中解析出環境選項
        const smokingOptions = ['無菸', '雀菸', '門外菸', '陽台菸', '桌上菸'];
        const parkingOptions = ['無車位', '汽車停車位', '機車停車位'];
        const elevatorOptions = ['有電梯', '無電梯', '一樓'];

        let foundSmoking = '無菸';
        let foundParking: string[] = [];
        let foundElevator = '有電梯';
        let foundMahjongTable = '電動桌';
        let foundTableModel = '';
        let foundVenueType = '';
        let foundSkillLevel = '';

        const manualFeatures = allFeatures.filter(feature => {
            if (smokingOptions.includes(feature)) {
                foundSmoking = feature;
                return false;
            }
            if (parkingOptions.includes(feature)) {
                foundParking.push(feature);
                return false;
            }
            if (elevatorOptions.includes(feature)) {
                foundElevator = feature;
                return false;
            }
            if (feature === '手動桌') {
                foundMahjongTable = '手動桌';
                return false;
            }
            if (feature.startsWith('電動桌')) {
                foundMahjongTable = '電動桌';
                if (feature.includes(':')) {
                    foundTableModel = feature.split(':')[1];
                }
                return false;
            }
            if (['自家場', '麻將館', '代揪'].includes(feature)) {
                foundVenueType = feature;
                return false;
            }
            if (['快手', '中慢手', '新手'].includes(feature)) {
                foundSkillLevel = feature;
                return false;
            }
            return true;
        });

        // 更新狀態
        setSmoking(foundSmoking);
        setParking(foundParking);
        setElevator(foundElevator);
        setMahjongTable(foundMahjongTable);
        setTableModel(foundTableModel);
        setVenueType(foundVenueType);
        setSkillLevel(foundSkillLevel);

        setFormData({
            type: game.type,
            gameType: game.gameInfo.gameType,
            placeName: game.location.placeName,
            location: game.location.address,
            latitude: game.location.latitude,
            longitude: game.location.longitude,
            needPlayers: game.playersNeeded,
            stakes: game.gameInfo.stakes,
            startTime: currentStartTime, // 不覆蓋時間
            rules: game.gameInfo.rules.length > 0 ? game.gameInfo.rules : [''],
            features: manualFeatures.length > 0 ? manualFeatures : [''],
            restrictions: game.restrictions && game.restrictions.length > 0 ? game.restrictions : ['']
        });

        setCoordinates({
            latitude: game.location.latitude,
            longitude: game.location.longitude
        });

        // 引入圖片
        if (game.images && game.images.length > 0) {
            const historicalImages: ImageItem[] = game.images.map(url => ({
                id: Math.random().toString(36).substr(2, 9),
                preview: url,
                url: url,
                status: 'done'
            }));
            setImageItems(historicalImages);
        } else {
            setImageItems([]);
        }

        setIsTemplateModalOpen(false);
        showToast('已成功引入歷史團局資料', 'success');
    };

    // 儲存草稿的回調函數（給 Modal 使用）
    const handleSaveDraft = () => {
        saveCreateGameDraft(formData, coordinates, {
            smoking,
            parking,
            elevator,
            mahjongTable,
            tableModel,
            venueType,
            skillLevel
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setShowTermsAgreement(true);
    };

    const confirmCreate = async () => {
        setShowTermsAgreement(false);
        setIsSubmitting(true);

        try {
            console.log('🚀 [CreateGame] Starting creation process');

            // 1. 即時從 API 獲取最新的個人資料
            const currentUser = user;
            if (!currentUser) {
                showToast('請先登入', 'error');
                setIsSubmitting(false);
                return;
            }

            const profileResponse = await api.getUserInfo(currentUser.userId);

            if (!profileResponse.success || !profileResponse.data) {
                console.error('❌ [CreateGame] Failed to fetch latest profile:', profileResponse.error);
                showToast('無法驗證個人資料狀態，請稍後再試', 'error');
                setIsSubmitting(false);
                return;
            }

            const latestUser = profileResponse.data;
            console.log('✅ [CreateGame] Latest profile fetched:', latestUser);

            // 2. 檢查個人資料完整性
            if (!isProfileComplete(latestUser)) {
                console.log('⚠️ [CreateGame] Profile incomplete, showing modal');
                setMissingFields(getMissingProfileFields(latestUser));
                setShowProfileModal(true);
                setIsSubmitting(false);
                return;
            }

            console.log('✨ [CreateGame] Profile complete, proceeding with validation');

            // 四道檢核（開局時間／定位／場地名稱／地址），順序與訊息在 utils/createGroupForm.ts
            const validationError = validateCreateGame({ formData, coordinates, now: Date.now() });
            if (validationError) {
                showToast(validationError, 'warning');
                setIsSubmitting(false);
                return;
            }

            // Prepare game data matching API requirements（組裝邏輯在 utils/createGroupForm.ts）
            const gameData: CreateMahjongGamePayload = buildCreateGamePayload({
                formData,
                coordinates,
                options: { smoking, parking, elevator, mahjongTable, tableModel, venueType, skillLevel },
                imageItems
            });

            const result = await onCreate(gameData);

            if (result && !result.success) {
                showToast(result.error || '創建團局失敗，請稍後再試', 'error');
            } else {
                // 創建成功，清除草稿
                clearCreateGameDraft();

                // 檢查推播狀態，若未開啟則顯示引導
                const isSupported = notificationService.isPushSupported();
                const permission = notificationService.getPermissionState();

                if (isSupported && !latestUser.hasClaimedPushBonus && permission !== 'denied') {
                    // 顯示成功訊息後再顯示推播引導
                    showToast('團局創建成功！', 'success');
                    setTimeout(() => {
                        setIsPushModalOpen(true);
                    }, 1500);
                } else {
                    showToast('團局創建成功！正在跳轉...', 'success');
                    setTimeout(() => navigate('/'), 2000);
                }
            }
        } catch (error) {
            console.error('Failed to create game:', error);
            showToast('系統發生錯誤，請稍後再試', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const fillTestData = () => {
        setFormData({
            ...formData,
            placeName: '測試場地',
            location: '台北市信義區信義路五段7號',
            rules: ['不准抽菸', '自摸三家', '門清加一台'],
            features: ['有冷氣', '有自動麻將桌', '近捷運'],
            restrictions: ['新手勿入', '需準時'],
            stakes: '300/50'
        });
        setCoordinates({
            latitude: 25.033976,
            longitude: 121.564421
        });
    };

    // 推播確認處理函數
    const handlePushConfirm = async () => {
        const currentUser = user;
        if (!currentUser) return;

        try {
            const subscribed = await notificationService.subscribe();
            if (subscribed) {
                const bonusResult = await claimPushBonus(currentUser.userId);
                if (bonusResult.success) {
                    showToast(`恭喜獲得 ${bonusResult.data?.points || 360} 點數獎勵！`, 'success');
                    // 確保本地 user 狀態更新
                    const storedUser = localStorage.getItem(STORAGE_KEYS.USER);
                    if (storedUser) {
                        const userObj = JSON.parse(storedUser);
                        userObj.hasClaimedPushBonus = true;
                        if (bonusResult.data?.newPoints) {
                            userObj.points = bonusResult.data.newPoints;
                        }
                        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userObj));
                    }
                }
            }
        } catch (error: any) {
            console.error('Push confirmation failed:', error);
            showToast(error.message || '開啟推播失敗', 'error');
        } finally {
            setIsPushModalOpen(false);
            // 跳轉到首頁
            setTimeout(() => navigate('/'), 1500);
        }
    };

    const isLocalhost = import.meta.env.DEV;



    return (
        <div className="pb-6 bg-[#f9f9f7] max-w-7xl mx-auto w-full min-h-screen">
            {/* 個人資料不完整提示 Modal */}
            <ProfileIncompleteModal
                isOpen={showProfileModal}
                onClose={() => setShowProfileModal(false)}
                missingFields={missingFields}
                onSaveDraft={handleSaveDraft}
            />
            <TemplateSelectorModal
                isOpen={isTemplateModalOpen}
                onClose={() => setIsTemplateModalOpen(false)}
                onSelect={handleTemplateSelect}
            />


            <TermsAgreementModal
                isOpen={showTermsAgreement}
                onClose={() => setShowTermsAgreement(false)}
                onConfirm={confirmCreate}
                actionType="create"
            />

            {/* 推播引導彈窗 */}
            <PushPermissionModal
                isOpen={isPushModalOpen}
                onClose={() => {
                    setIsPushModalOpen(false);
                    // 關閉彈窗後跳轉到首頁
                    setTimeout(() => navigate('/'), 500);
                }}
                onConfirm={handlePushConfirm}
            />

            <div className="px-4 py-4 space-y-5">
                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Quick Action: Template Selection */}
                    <div
                        onClick={() => setIsTemplateModalOpen(true)}
                        className="relative group cursor-pointer overflow-hidden rounded-lg bg-white border border-black/[0.03] p-4 shadow-sm transition-all hover:bg-neutral-50 active:scale-[0.98]"
                    >
                        <div className="relative z-10 flex items-center gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#c5a059]/10 text-[#c5a059]">
                                <History size="1.5rem" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-neutral-900 text-[0.9375rem]">從歷史團局引入</h3>
                                <p className="text-xs text-neutral-400 mt-0.5">省去重複輸入，一鍵帶入開團設定</p>
                            </div>
                            <div className="ml-auto">
                                <ChevronRight size="1.25rem" className="text-neutral-300 group-hover:text-[#c5a059] transition-colors" />
                            </div>
                        </div>
                    </div>

                    {/* Type Selection (Simplified) */}
                    <div className="space-y-2">
                        <label className="text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">團局種類</label>
                        <div className="flex gap-2">
                            <div className="px-4 py-2.5 rounded-lg text-[0.8125rem] font-bold bg-neutral-900 text-white shadow-md">
                                ⚡ 臨時揪團
                            </div>
                        </div>
                    </div>

                    {/* Basic Info */}
                    <div className="space-y-5">
                        <div className="space-y-2">
                            <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">開始時間</label>
                            <div
                                className="relative bg-white border border-black/[0.03] rounded-lg p-3.5 shadow-sm transition-all active:bg-neutral-50"
                                onClick={() => setShowDatePicker(true)}
                            >
                                <Clock size="1.25rem" className="absolute left-4 top-1/2 -translate-y-1/2 text-[#c5a059]" />
                                <div className="w-full bg-transparent pl-10 text-[1.0625rem] text-neutral-900 font-bold tracking-tight cursor-pointer">
                                    {(() => {
                                        const d = new Date(formData.startTime);
                                        const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
                                        let h = d.getHours();
                                        const m = d.getMinutes();
                                        const period = h >= 12 ? 'PM' : 'AM';
                                        if (h > 12) h -= 12;
                                        if (h === 0) h = 12;
                                        const timeStr = `${h}:${String(m).padStart(2, '0')} ${period}`;
                                        return `${dateStr} ${timeStr}`;
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Row 2: Players & Stakes */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">缺幾人</label>
                            <div className="flex bg-white border border-black/[0.03] rounded-lg p-1 shadow-sm h-[3.25rem]">
                                {[1, 2, 3].map((num) => (
                                    <button
                                        key={num}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, needPlayers: num })}
                                        className={`flex-1 flex items-center justify-center rounded-lg text-sm font-bold transition-all ${formData.needPlayers === num
                                            ? 'bg-neutral-900 shadow-md text-white'
                                            : 'text-neutral-400 hover:text-neutral-600'
                                            }`}
                                    >
                                        {num}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">籌碼</label>
                            <AppInput
                                required
                                value={formData.stakes}
                                onChange={(e) => setFormData({ ...formData, stakes: e.target.value })}
                                placeholder="100/20"
                                icon={Coins}
                            />
                        </div>
                    </div>

                    {/* Mahjong Rules & Dynamic List */}
                    <DynamicListInput
                        label="麻將規則"
                        items={formData.rules}
                        placeholder="例如：不打請提前告知場主"
                        onAdd={() => addListItem('rules')}
                        onChange={(index, value) => handleListChange('rules', index, value)}
                        onRemove={(index) => removeListItem('rules', index)}
                    />

                    {/* Location Section */}
                    <div className="space-y-5">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest">地點資訊</h3>
                        </div>


                        <div className="space-y-2">
                            <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">場地名稱</label>
                            <AppInput
                                required
                                value={formData.placeName}
                                onChange={(e) => setFormData({ ...formData, placeName: e.target.value })}
                                placeholder="例如：台北信義 / 自家場"
                                icon={Home}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">定位地點</label>
                            <button
                                type="button"
                                onClick={() => setIsMapOpen(true)}
                                className={`w-full flex items-center justify-between p-3.5 rounded-lg border transition-all ${formData.location
                                    ? 'bg-white border-black/[0.03] shadow-sm'
                                    : 'bg-[#c5a059]/5 border-[#c5a059]/10'
                                    }`}
                            >
                                <div className="flex items-center gap-4 overflow-hidden text-left">
                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${formData.location ? 'bg-neutral-50 text-[#c5a059]' : 'bg-[#c5a059] text-white shadow-lg shadow-[#c5a059]/20'}`}>
                                        <MapPin size="1.25rem" />
                                    </div>
                                    <div className="overflow-hidden">
                                        {formData.location ? (
                                            <>
                                                <p className="text-[0.9375rem] text-neutral-900 font-bold truncate">{formData.location}</p>
                                                <p className="text-[0.6875rem] text-neutral-400 font-medium mt-0.5">
                                                    {coordinates.latitude.toFixed(4)}, {coordinates.longitude.toFixed(4)}
                                                </p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-[0.9375rem] text-[#c5a059] font-bold">點擊開啟地圖</p>
                                                <p className="text-[0.6875rem] text-[#c5a059]/60 font-medium mt-0.5">選擇團局具體座標位置</p>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <ChevronRight size="1.25rem" className="text-neutral-300 shrink-0 ml-2" />
                            </button>
                        </div>
                    </div>

                    <MapPicker
                        isOpen={isMapOpen}
                        onClose={() => setIsMapOpen(false)}
                        onConfirm={handleLocationConfirm}
                        initialLat={coordinates.latitude || undefined}
                        initialLng={coordinates.longitude || undefined}
                    />

                    {/* 第二段：環境設施／照片／場地特色／玩家限制（[A3-b1] 抽到 components/CreateGroupStage2.tsx） */}
                    <CreateGroupStage2
                        venueType={venueType} setVenueType={setVenueType}
                        skillLevel={skillLevel} setSkillLevel={setSkillLevel}
                        smoking={smoking} setSmoking={setSmoking}
                        parking={parking} setParking={setParking}
                        elevator={elevator} setElevator={setElevator}
                        mahjongTable={mahjongTable} setMahjongTable={setMahjongTable}
                        tableModel={tableModel} setTableModel={setTableModel}
                        imageItems={imageItems}
                        fileInputRef={fileInputRef}
                        handleImageSelect={handleImageSelect}
                        removeImage={removeImage}
                        features={formData.features}
                        restrictions={formData.restrictions}
                        addListItem={addListItem}
                        handleListChange={handleListChange}
                        removeListItem={removeListItem}
                    />

                    {/* Submit Button */}
                    <div className="pt-6 pb-10 space-y-3">
                        <AppButton
                            type="submit"
                            isLoading={isSubmitting}
                            disabled={coordinates.latitude === 0 && coordinates.longitude === 0}
                            className="w-full"
                        >
                            🎲 確認發起團局
                        </AppButton>

                        {isLocalhost && (
                            <div className="space-y-3">
                                <button
                                    type="button"
                                    onClick={fillTestData}
                                    className="w-full bg-neutral-100 text-neutral-400 font-bold py-3 rounded-lg border border-black/[0.03] hover:bg-neutral-200 hover:text-neutral-600 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
                                >
                                    <Bug size="0.875rem" />
                                    [DEBUG] 填入測試資料
                                </button>


                                <div className="grid grid-cols-1 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setMissingFields(['真實姓名', '電話號碼', '常用場地']);
                                            setShowProfileModal(true);
                                        }}
                                        className="py-3 bg-white/5 text-neutral-300 text-[0.625rem] font-black rounded-lg border border-white/10 hover:bg-white/10 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                                    >
                                        <UserIcon size="0.75rem" /> 測試：個人資料不完整彈窗
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowTermsAgreement(true)}
                                        className="py-3 bg-white/5 text-neutral-300 text-[0.625rem] font-black rounded-lg border border-white/10 hover:bg-white/10 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                                    >
                                        <ShieldCheck size="0.75rem" /> 測試：服務條款確認彈窗
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsPushModalOpen(true)}
                                        className="py-3 bg-white/5 text-neutral-300 text-[0.625rem] font-black rounded-lg border border-white/10 hover:bg-white/10 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                                    >
                                        <BellRing size="0.75rem" /> 測試：推播授權引導彈窗
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDailyBonusData({ pointsEarned: 150, consecutiveDays: 3, isStreakBonus: false });
                                            setIsDailyBonusOpen(true);
                                        }}
                                        className="py-3 bg-white/5 text-neutral-300 text-[0.625rem] font-black rounded-lg border border-white/10 hover:bg-white/10 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                                    >
                                        <Gift size="0.75rem" /> 測試：每日簽到彈窗 (一般)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDailyBonusData({ pointsEarned: 500, consecutiveDays: 7, isStreakBonus: true });
                                            setIsDailyBonusOpen(true);
                                        }}
                                        className="py-3 bg-white/5 text-neutral-300 text-[0.625rem] font-black rounded-lg border border-white/10 hover:bg-white/10 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                                    >
                                        <Flame size="0.75rem" /> 測試：每日簽到彈窗 (連續大獎)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsTemplateModalOpen(true)}
                                        className="py-3 bg-white/5 text-neutral-300 text-[0.625rem] font-black rounded-lg border border-white/10 hover:bg-white/10 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                                    >
                                        <History size="0.75rem" /> 測試：歷史模板選擇器
                                    </button>
                                </div>

                                {/* 新設計通知測試 */}
                                <div className="mt-6 pt-4 border-t border-white/5">
                                    <p className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-[0.3em] mb-3 text-center">Lux Toast System Test</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => showToast('成功引入歷史設定', 'success')}
                                            className="py-2.5 bg-[#c5a059]/10 text-[#c5a059] text-[0.625rem] font-black rounded-lg border border-[#c5a059]/20 hover:bg-[#c5a059]/20 transition-all uppercase tracking-widest"
                                        >
                                            Success Toast
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => showToast('開局時間不能早於目前', 'warning')}
                                            className="py-2.5 bg-amber-500/10 text-amber-500 text-[0.625rem] font-black rounded-lg border border-amber-500/20 hover:bg-amber-500/20 transition-all uppercase tracking-widest"
                                        >
                                            Warning Toast
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => showToast('伺服器連線超時', 'error')}
                                            className="py-2.5 bg-red-500/10 text-red-500 text-[0.625rem] font-black rounded-lg border border-red-500/20 hover:bg-red-500/20 transition-all uppercase tracking-widest"
                                        >
                                            Error Toast
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => showToast('已有 2 位玩家報名', 'info')}
                                            className="py-2.5 bg-neutral-100 text-neutral-400 text-[0.625rem] font-black rounded-lg border border-black/5 hover:bg-neutral-200 transition-all uppercase tracking-widest"
                                        >
                                            Info Toast
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </form>
            </div>

            {/* DatePicker Modal */}
            {showDatePicker && createPortal(
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-5 bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setShowDatePicker(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-full max-w-sm">
                        <DatePicker
                            value={formData.startTime}
                            onChange={(date) => {
                                setFormData({ ...formData, startTime: date });
                            }}
                            onClose={() => setShowDatePicker(false)}
                            includeTime={true}
                        />
                    </div>
                </div>,
                document.body
            )}

            <DailyBonusModal
                isOpen={isDailyBonusOpen}
                onClose={() => setIsDailyBonusOpen(false)}
                bonusData={dailyBonusData}
            />
        </div>
    );
};

export default CreateGroup;