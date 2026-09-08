import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigation, AlertCircle, Bug, Info, AlertTriangle, Map as MapIcon, ChevronRight, History, Award, ChevronDown, ShieldCheck, BellRing, User as UserIcon, Gift, Flame } from 'lucide-react';
import type { CreateMahjongGamePayload, User } from '../types';

import MapPicker from '../components/MapPicker';
import ProfileIncompleteModal from '../components/ProfileIncompleteModal';
import CreateGroupStage1 from '../components/CreateGroupStage1';
import CreateGroupStage2 from '../components/CreateGroupStage2';
import { isProfileComplete, getMissingProfileFields } from '../utils/profileUtils';
import { saveCreateGameDraft, loadCreateGameDraft, clearCreateGameDraft } from '../utils/draftStorage';
import { useEventImages } from '../hooks/useEventImages';
import { buildCreateGamePayload, refreshStaleStartTime, toDateTimeLocalString, toStage1Payload, validateCreateGame, validateCreateGameStage1, validateCreateGameStage2 } from '../utils/createGroupForm';
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
import { AppSelect, AppButton } from '../components/ui/CommonUI';
import { useToast } from '../contexts/ToastContext';

interface CreateGroupProps {
    // [A3-m] `data` 不可省：第一段送出就建局之後，第二段要拿 `data.gameID` 去打 update-game。
    onCreate: (gameData: CreateMahjongGamePayload) => Promise<{ success: boolean; error?: string; data?: any }>;
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
    // [A3-m] 第一段送出成功後拿到的 gameId。它同時是「局已經成立」這件事的旗標：
    // 非空 ⇒ 團局已公開招募、120 點已扣，第二段只能補資料，不能再建一次。
    const [createdGameId, setCreatedGameId] = useState<string>('');
    // [A3-c2] 兩步驟精靈：只控制哪一段掛在畫面上。
    // 刻意不存進草稿：重新進頁面一律從第 1 步開始（草稿可能只填了一半）。
    const [step, setStep] = useState<1 | 2>(1);

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
    // [A3-p] 照片的上傳邏輯搬到 `useEventImages`，因為編輯頁要用**同一份**
    //        （複製一份的話日後只會有一邊被修，而差別只有使用者才遇得到）。
    const { imageItems, resetToUrls, fileInputRef, handleImageSelect, removeImage } = useEventImages(user?.userId);

    // 用於跳過初始載入時的自動儲存
    const isInitialMount = useRef(true);
    const draftLoaded = useRef(false);

    // Get minimum datetime (current time)
    // 🔴 算法本身搬到 utils/createGroupForm.ts 的 `toDateTimeLocalString`（[A3-i]）：
    //    自動推進那支要產出**完全一樣**的字串，各留一份副本必定會漂。
    const getMinDateTime = () => toDateTimeLocalString(Date.now());

    // 使用者有沒有自己動過開局時間欄位。
    // 🔴 這個旗標是 [A3-i] 的全部重點：少了它，「預設值餿掉」與「使用者**故意**填一個
    //    過去的時間」在程式眼裡逐字相同 —— 後者必須繼續被 validateCreateGame 擋下來。
    //    唯一會把它設成 true 的地方是下面那個 DatePicker 的 onChange。
    const [startTimeTouched, setStartTimeTouched] = useState(false);

    // 新增環境選項狀態
    // 🔴 [A3-j] 這三項的初始值原本是 '無菸'／'有電梯'／'電動桌'，而它們的標籤寫著 `(必填)`。
    //    後果不是「檢核沒作用」而已：`buildCreateGamePayload` 只濾空字串 ⇒ 那三個非空的
    //    預設值**必定**被送進 `features`，使用者一次都沒碰過也會publish 成
    //    「無菸、有電梯、電動桌」。那是有人會據以出門的資訊。
    //    ⚠️ 改成 '' 只是修法的一半，另一半是 `validateCreateGameStage2`（見 handleSubmit）——
    //      只改這裡的話，沒選就變成靜靜不送，而畫面上的 `(必填)` 依然是謊話。
    const [smoking, setSmoking] = useState<string>('');
    const [parking, setParking] = useState<string[]>([]);
    const [elevator, setElevator] = useState<string>('');
    const [mahjongTable, setMahjongTable] = useState<string>('');
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
            // 🔴 草稿有效期 24 小時，裡面的 startTime **必然**已經過去（[A3-i]）。
            //    沒碰過就換成「現在」；使用者自己選的（touched）照原樣還原、繼續被擋。
            //    舊草稿沒有這個欄位 ⇒ undefined 當 false。
            const touched = draft.startTimeTouched ?? false;
            const fresh = refreshStaleStartTime({ startTime: draft.formData.startTime, touched, now: Date.now() });
            setStartTimeTouched(touched);
            setFormData(fresh ? { ...draft.formData, startTime: fresh } : draft.formData);
            setCoordinates(draft.coordinates);
            if (draft.envOptions) {
                // 🔴 [A3-j] 舊草稿（沒有 envOptionsDeclared）的三個必填欄分不出
                //    「使用者選的」與「A3-j 之前的預設值」⇒ 丟掉，要他重選一次。
                //    其餘欄位（車位／型號／場館種類／程度）本來就預設為空，
                //    非空必定是他填的，照原樣還原。
                const declared = draft.envOptionsDeclared ?? false;
                setSmoking(declared ? draft.envOptions.smoking : '');
                setElevator(declared ? draft.envOptions.elevator : '');
                setMahjongTable(declared ? draft.envOptions.mahjongTable : '');
                setParking(draft.envOptions.parking);
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
            }, startTimeTouched);
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

        // 引入圖片（[A3-p] 改用 hook 的 resetToUrls —— 它做的就是這件事：
        //          把已上傳過的 url 鋪成 status:'done' 的項目；空陣列即清空）
        resetToUrls(game.images || []);

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
        }, startTimeTouched);
    };

    /**
     * 送出前把**使用者沒碰過**的過期開局時間換成「現在」（[A3-i]）。
     * 回傳這一次要用的 formData —— `setFormData` 是非同步的，同一個 render 裡
     * 讀回來還是舊值，所以驗證與組 payload 都必須用這個回傳值，不能用 state。
     */
    const withFreshStartTime = (): CreateMahjongGamePayload => {
        const fresh = refreshStaleStartTime({ startTime: formData.startTime, touched: startTimeTouched, now: Date.now() });
        if (!fresh) return formData;
        const next = { ...formData, startTime: fresh };
        setFormData(next);
        return next;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (step === 1) {
            // Stage1 卸載後原生 required 不再跑，這裡補上同一組檢核（含 stakes）
            const stage1Error = validateCreateGameStage1({ formData: withFreshStartTime(), coordinates, now: Date.now() });
            if (stage1Error) {
                showToast(stage1Error, 'warning');
                return;
            }
            // 🔴 [A3-m] 第一段送出就**成立可招募**（§4.4），所以條款與扣點的閘門移到這裡。
            //    在此之前這裡只是 `setStep(2)`，錢的閘門在第二段。
            //    移動的是「錢的時機」不只是「彈窗的位置」—— 使用者按下確認的那一刻
            //    就會被扣 120 點，就算他之後把第二段整個跳過。
            setShowTermsAgreement(true);
            return;
        }
        // [A3-j] 三個標著 `(必填)` 的環境選項真的必填（見 validateCreateGameStage2 的註解）。
        // ⚠️ `setShowTermsAgreement(true)` 在本檔有**第二個**呼叫點（isLocalhost 的測試面板），
        //    那條刻意不擋 —— 它是 debug 捷徑、只在 `import.meta.env.DEV` 下渲染。
        //    但 e2e 也跑在 DEV ⇒ **不要用那顆測試按鈕寫驗收**，會繞過本閘門而看起來全綠。
        // ⚠️ [A3-m] A3-j 那三個「(必填)」的語意變了：第二段整段**可以跳過**，
        //    所以它們只在「使用者真的按了儲存」時必填，不是全域必填。
        //    跳過的那條路不經過這裡（見 skipStage2）—— 這是刻意的，不是漏掉。
        const stage2Error = validateCreateGameStage2({ options: { smoking, elevator, mahjongTable } });
        if (stage2Error) {
            showToast(stage2Error, 'warning');
            return;
        }
        await submitStage2();
    };

    /**
     * [A3-m] 第二段＝補充設定，打 `update-game`（局在第一段就已經建好了）。
     *
     * 🔴 這裡**不可以**再呼叫一次 `onCreate` —— 那會建出第二個團局並再扣一次 120 點，
     *    而使用者看到的只是「送出成功」。
     */
    const submitStage2 = async () => {
        if (!createdGameId) {
            showToast('找不到剛建立的團局，請回列表確認', 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            const payload = buildCreateGamePayload({
                formData,
                coordinates,
                options: { smoking, parking, elevator, mahjongTable, tableModel, venueType, skillLevel },
                imageItems
            });
            const result = await api.updateGameExtras({
                gameId: createdGameId,
                // 只送第二段擁有的欄位。[A3-m/M5] `rules` 已由第一段搬進第二段，
                // 所以它現在也在這裡 —— 建局時送的是空的，這一送才是它真正的寫入點。
                rules: payload.rules,
                features: payload.features,
                restrictions: payload.restrictions,
                images: payload.images ?? []
            });
            if (result && !result.success) {
                showToast(result.error || '儲存補充設定失敗，請稍後再試', 'error');
                return;
            }
            showToast('補充設定已儲存！', 'success');
            setTimeout(() => navigate('/'), 1200);
        } catch (error) {
            console.error('Failed to update game:', error);
            showToast('系統發生錯誤，請稍後再試', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    /**
     * [A3-m] 跳過第二段。§4.4：「可跳過、可事後補」。
     * ⚠️ 團局**已經公開招募中**，跳過不會取消它、也不會退點 —— 那是取消團局那條路。
     */
    const skipStage2 = () => {
        showToast('已跳過補充設定，之後可以再補', 'success');
        navigate('/');
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
            const freshFormData = withFreshStartTime();
            const validationError = validateCreateGame({ formData: freshFormData, coordinates, now: Date.now() });
            if (validationError) {
                showToast(validationError, 'warning');
                setIsSubmitting(false);
                return;
            }

            // Prepare game data matching API requirements（組裝邏輯在 utils/createGroupForm.ts）
            // 🔴 這裡一定要用 freshFormData，不是 state 裡的 formData ——
            //    否則會變成「驗證放行了，送出去的還是那個過期的時間」。
            const gameData: CreateMahjongGamePayload = buildCreateGamePayload({
                formData: freshFormData,
                coordinates,
                options: { smoking, parking, elevator, mahjongTable, tableModel, venueType, skillLevel },
                imageItems
            });

            // 🔴 [A3-m] 第一段只送第一段問過的東西。`buildCreateGamePayload` 會把
            //    `...formData` 整包帶出去，而 rules／features／restrictions 已經歸第二段 ——
            //    草稿還原那條路上它們可能是非空的（見 toStage1Payload 的註解）。
            const result = await onCreate(toStage1Payload(gameData));

            if (result && !result.success) {
                showToast(result.error || '創建團局失敗，請稍後再試', 'error');
            } else {
                // 創建成功，清除草稿
                clearCreateGameDraft();

                // 🔴 [A3-m] 這裡**不再跳轉**。局已經公開招募了，接下來是「可跳過」的第二段。
                //    gameId 是第二段唯一的著陸點：拿不到它的話 update-game 沒有對象，
                //    而使用者會在一個看起來正常、實際上存不了檔的頁面上填東西。
                const newGameId = result?.data?.gameID || result?.data?.gameId || '';
                if (!newGameId) {
                    // 局建起來了（錢也扣了），只是我們不知道它的 id ⇒ 不可以假裝沒事。
                    console.error('❌ [CreateGame] 建立成功但回應裡沒有 gameID:', result);
                    showToast('團局已建立，但無法載入補充設定，請到列表中編輯', 'warning');
                    setTimeout(() => navigate('/'), 2000);
                    return;
                }
                setCreatedGameId(newGameId);
                setStep(2);
                window.scrollTo({ top: 0, behavior: 'auto' });

                // 檢查推播狀態，若未開啟則顯示引導
                const isSupported = notificationService.isPushSupported();
                const permission = notificationService.getPermissionState();

                if (isSupported && !latestUser.hasClaimedPushBonus && permission !== 'denied') {
                    showToast('團局已公開招募！', 'success');
                    setTimeout(() => {
                        setIsPushModalOpen(true);
                    }, 1500);
                } else {
                    showToast('團局已公開招募！可以繼續補充設定，或直接跳過', 'success');
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
                    // [A3-m] 不再跳首頁：局建好之後使用者停在第二段（補充設定），
                    // 跳走的話那一段就永遠沒機會填，而它是這次改動的重點。
                    setIsPushModalOpen(false);
                }}
                onConfirm={handlePushConfirm}
            />

            <div className="px-4 py-4 space-y-5">
                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* 步驟指示（[A3-c2] 兩步驟精靈；class 全部沿用兩個 Stage 元件既有的標籤語彙） */}
                    <div className="flex items-center gap-2 text-[0.6875rem] font-bold text-neutral-400 uppercase tracking-widest ml-1">
                        <span className={step === 1 ? 'text-[#c5a059]' : undefined}>1</span>
                        <span>─</span>
                        <span className={step === 2 ? 'text-[#c5a059]' : undefined}>2</span>
                        <span className="ml-auto">步驟 {step} / 2</span>
                    </div>

                    {/* Quick Action: Template Selection（只在第 1 步：它會覆蓋整張表單） */}
                    {step === 1 && (
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
                    )}

                    {/* 第一段：團局種類／開始時間／缺幾人與籌碼／地點資訊（[A3-b2] 抽到 components/CreateGroupStage1.tsx）
                        [A3-m/M5] 麻將規則已搬到第二段 —— §4.4 的第一段只問四件事。 */}
                    {step === 1 && (
                    <CreateGroupStage1
                        startTime={formData.startTime}
                        openDatePicker={() => setShowDatePicker(true)}
                        needPlayers={formData.needPlayers}
                        setNeedPlayers={(num) => setFormData({ ...formData, needPlayers: num })}
                        stakes={formData.stakes}
                        setStakes={(value) => setFormData({ ...formData, stakes: value })}
                        placeName={formData.placeName}
                        setPlaceName={(value) => setFormData({ ...formData, placeName: value })}
                        location={formData.location}
                        coordinates={coordinates}
                        openMap={() => setIsMapOpen(true)}
                    />
                    )}

                    <MapPicker
                        isOpen={isMapOpen}
                        onClose={() => setIsMapOpen(false)}
                        onConfirm={handleLocationConfirm}
                        initialLat={coordinates.latitude || undefined}
                        initialLng={coordinates.longitude || undefined}
                    />

                    {/* [A3-m] 局已經公開了 —— 這一條橫幅是使用者唯一會看到的告知。
                        少了它，第二段看起來像「還沒送出」，而實際上錢已經扣了、別人已經看得到這個局。 */}
                    {step === 2 && createdGameId && (
                        <div className="rounded-lg border border-[#c5a059]/30 bg-[#c5a059]/[0.07] p-4 space-y-2">
                            <p className="text-sm font-black text-[#8a6d3b]">✅ 團局已公開招募中</p>
                            <p className="text-xs text-neutral-600 leading-relaxed">
                                已扣除 120 點。以下都是<span className="font-bold">補充設定，可以跳過</span>，之後也能再補。
                                <br />
                                <span className="font-bold">尚無人報名時取消可全額退回 120 點</span>；
                                直接離開這一頁**不會**取消團局，也不會退點。
                            </p>
                            <button
                                type="button"
                                onClick={() => navigate(`/event/${createdGameId}`)}
                                className="text-xs font-bold text-[#8a6d3b] underline underline-offset-2"
                            >
                                前往團局頁（可在那裡取消）
                            </button>
                        </div>
                    )}

                    {/* 第二段：環境設施／照片／場地特色／玩家限制（[A3-b1] 抽到 components/CreateGroupStage2.tsx） */}
                    {step === 2 && (
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
                        rules={formData.rules}
                        features={formData.features}
                        restrictions={formData.restrictions}
                        addListItem={addListItem}
                        handleListChange={handleListChange}
                        removeListItem={removeListItem}
                    />
                    )}

                    {/* Submit Button */}
                    <div className="pt-6 pb-10 space-y-3">
                        {step === 1 ? (
                            <AppButton
                                type="submit"
                                disabled={coordinates.latitude === 0 && coordinates.longitude === 0}
                                className="w-full"
                            >
                                下一步
                            </AppButton>
                        ) : (
                            <>
                                <AppButton
                                    type="submit"
                                    isLoading={isSubmitting}
                                    className="w-full"
                                >
                                    儲存補充設定
                                </AppButton>
                                {/* 🔴 [A3-m] 「上一步」在這裡被拿掉是刻意的：局已經建好了，
                                    第一段那四件事（時間／地點／底台／人數）已經寫進資料庫，
                                    退回去改也不會生效 —— 留著它會變成一個看起來能改、
                                    其實什麼都沒改的按鈕。要改那些請走團局頁。 */}
                                <AppButton
                                    type="button"
                                    variant="secondary"
                                    onClick={skipStage2}
                                    className="w-full"
                                >
                                    跳過，之後再補
                                </AppButton>
                            </>
                        )}

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
                                setStartTimeTouched(true);   // [A3-i] 使用者自己選的，之後一律不自動改
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