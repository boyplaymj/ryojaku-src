// pages/EditGroupExtras.tsx — 團局「補充設定」的事後編輯頁（[A3-p]）
//
// 🔴 這一頁補的是 §4.4 那句「第二段**可跳過、可事後補**」裡**沒做的那一半**。
//    `A3-m` 蓋好了後端端點 `update-game`、也讓第二段可以跳過，但跳過之後
//    **沒有任何一條路回得去**：`updateGameExtras` 全前端只有建局精靈第二段
//    一個呼叫者，而那一頁只在「剛建完局」那一刻到得了。
//    團局頁上那顆給主揪的按鈕（`EventDetail.tsx`）導向 `/edit-group/:id`，
//    而在本檔之前**那條路由不存在** ⇒ 按下去是空白頁、不報任何錯。
//
// 🔴 **範圍只有 `update-game` 白名單那四樣**：rules／features／restrictions／images。
//    時間／地點／底台／人數**改不了** —— 後端沒有那個端點，
//    而假裝能改（顯示可編輯的欄位然後靜靜丟掉）比不能改更糟。
//    團局頁那顆按鈕的文案已經跟著改成「編輯補充設定」，不再說 Modify Operation。
//
// ⚠️ 權限檢查在**兩層**：這裡比對 `hostUserId` 只是 UX（讓非主揪早點知道），
//    真正擋得住的是後端（回「只有主揪可以修改團局」）。
//    前端這一層可以被繞過，所以它不是安全邊界，只是不要讓人白填一頁。
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import CreateGroupStage2, { type Stage2ListField } from '../components/CreateGroupStage2';
import { AppButton } from '../components/ui/CommonUI';
import { useToast } from '../contexts/ToastContext';
import { useEventImages } from '../hooks/useEventImages';
import { api } from '../services/dataService';
import { buildVenueFeatures, parseVenueFeatures, validateCreateGameStage2 } from '../utils/createGroupForm';
import type { Game, User } from '../types';

type LoadState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; game: Game };

const EditGroupExtras: React.FC<{ user: User | null }> = ({ user }) => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
    const [isSaving, setIsSaving] = useState(false);

    // 七個環境選項 ＋ 三個清單。初始值一律是「空」，載入成功後才由草稿以外的
    // 唯一真實來源（DB 那一列）覆蓋 —— 🔴 **不可以給預設值**：
    // 那正是 `A3-j` 修掉的缺陷（用預設值替主揪宣告場地條件）。
    const [venueType, setVenueType] = useState('');
    const [skillLevel, setSkillLevel] = useState('');
    const [smoking, setSmoking] = useState('');
    const [parking, setParking] = useState<string[]>([]);
    const [elevator, setElevator] = useState('');
    const [mahjongTable, setMahjongTable] = useState('');
    const [tableModel, setTableModel] = useState('');
    const [lists, setLists] = useState<Record<Stage2ListField, string[]>>({
        rules: [''], features: [''], restrictions: [''],
    });

    const { imageItems, resetToUrls, fileInputRef, handleImageSelect, removeImage } =
        useEventImages(user?.userId);

    useEffect(() => {
        let alive = true;
        (async () => {
            if (!id) { setLoad({ kind: 'error', message: '網址上沒有團局 ID' }); return; }
            const detail = await api.getGameDetail(id);
            if (!alive) return;
            if (!detail) { setLoad({ kind: 'error', message: '找不到這個團局，或是載入失敗' }); return; }
            const game = detail.game;
            if (user && game.hostUserId !== user.userId) {
                setLoad({ kind: 'error', message: '只有主揪可以修改團局' });
                return;
            }
            if (game.status === 'cancelled') {
                // 後端也會擋（回「此團局已取消」）。這裡先擋是為了不要讓人白填一整頁。
                setLoad({ kind: 'error', message: '此團局已取消，不能再修改' });
                return;
            }

            // 🔴 把既有宣告還原回 UI —— `update-game` 是**整欄覆寫**，
            //    少了這一步，主揪按一次儲存就會把原本的宣告與照片整批洗掉。
            const parsed = parseVenueFeatures(game.venueFeatures);
            setSmoking(parsed.smoking);
            setParking(parsed.parking);
            setElevator(parsed.elevator);
            setMahjongTable(parsed.mahjongTable);
            setTableModel(parsed.tableModel);
            setVenueType(parsed.venueType);
            setSkillLevel(parsed.skillLevel);
            // 清單空的時候放一個空字串，DynamicListInput 才有一格可以打字
            const orEmptyRow = (xs?: string[]) => (xs && xs.length > 0 ? [...xs] : ['']);
            setLists({
                rules: orEmptyRow(game.gameInfo?.rules),
                features: orEmptyRow(parsed.manualFeatures),
                restrictions: orEmptyRow(game.restrictions),
            });
            resetToUrls(game.images || []);
            setLoad({ kind: 'ready', game });
        })();
        return () => { alive = false; };
    }, [id, user?.userId, resetToUrls]);

    const addListItem = (field: Stage2ListField) =>
        setLists(prev => ({ ...prev, [field]: [...prev[field], ''] }));
    const handleListChange = (field: Stage2ListField, index: number, value: string) =>
        setLists(prev => {
            const next = [...prev[field]];
            next[index] = value;
            return { ...prev, [field]: next };
        });
    const removeListItem = (field: Stage2ListField, index: number) =>
        setLists(prev => {
            // 與建局頁同一個約定：只剩一格時不刪除，改成清空那一格。
            if (prev[field].length <= 1) return { ...prev, [field]: [''] };
            return { ...prev, [field]: prev[field].filter((_, i) => i !== index) };
        });

    const options = useMemo(
        () => ({ smoking, parking, elevator, mahjongTable, tableModel, venueType, skillLevel }),
        [smoking, parking, elevator, mahjongTable, tableModel, venueType, skillLevel],
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (load.kind !== 'ready') return;
        // 三個 `(必填)` 在這裡是真的必填：按下儲存＝做出宣告（與建局頁第二段同一條規則）。
        // ⚠️ 舊的團局可能一項都沒宣告過（跳過了，或是 A3-j 之前建的）⇒ 打開這一頁會是空的，
        //    要他先選一次才存得了。這是刻意的：不可以拿預設值替他宣告。
        const err = validateCreateGameStage2({ options: { smoking, elevator, mahjongTable } });
        if (err) { showToast(err, 'warning'); return; }

        setIsSaving(true);
        try {
            const result = await api.updateGameExtras({
                gameId: load.game.gameId,
                rules: lists.rules.filter(r => r.trim() !== ''),
                // 🔴 用 buildVenueFeatures，不要在這裡重寫一次合併 ——
                //    順序與 `電動桌:型號` 的組法只有一份，在 utils 那邊。
                features: buildVenueFeatures(options, lists.features),
                restrictions: lists.restrictions.filter(r => r.trim() !== ''),
                // 只送已經上傳成功的；上傳中／失敗的留在畫面上但不進 payload。
                images: imageItems.filter(i => i.status === 'done' && i.url).map(i => i.url as string),
            });
            if (result && !result.success) {
                // 後端那幾句話是不同的行動指示，原樣顯示（與 A3-m 第二段同一個理由）。
                showToast(result.error || '儲存補充設定失敗，請稍後再試', 'error');
                return;
            }
            showToast('補充設定已更新！', 'success');
            setTimeout(() => navigate(`/event/${load.game.gameId}`), 900);
        } catch (error) {
            console.error('Failed to update game extras:', error);
            showToast('系統發生錯誤，請稍後再試', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const Header = (
        <div className="flex items-center gap-3 px-4 pt-4">
            <button
                type="button"
                onClick={() => navigate(id ? `/event/${id}` : '/')}
                className="p-2 -ml-2 text-neutral-400 hover:text-neutral-900 transition-colors"
                aria-label="返回團局頁"
            >
                <ArrowLeft size="1.25rem" />
            </button>
            <h1 className="text-base font-black text-neutral-900">編輯補充設定</h1>
        </div>
    );

    if (load.kind === 'loading') {
        return (
            <div>
                {Header}
                <div className="flex items-center justify-center gap-2 py-20 text-neutral-400 text-sm">
                    <Loader2 size="1rem" className="animate-spin" /> 載入團局資料…
                </div>
            </div>
        );
    }

    if (load.kind === 'error') {
        return (
            <div>
                {Header}
                <div className="px-4 py-16 text-center space-y-4">
                    <p className="text-sm font-bold text-neutral-600">{load.message}</p>
                    <AppButton type="button" variant="secondary" onClick={() => navigate(id ? `/event/${id}` : '/')}>
                        回團局頁
                    </AppButton>
                </div>
            </div>
        );
    }

    return (
        <div>
            {Header}
            <div className="px-4 py-4 space-y-5">
                <div className="rounded-lg border border-[#c5a059]/30 bg-[#c5a059]/[0.07] p-4 space-y-1">
                    <p className="text-sm font-black text-[#8a6d3b]">這裡只能改補充設定</p>
                    <p className="text-xs text-neutral-600 leading-relaxed">
                        時間／地點／底台／人數<span className="font-bold">改不了</span> ——
                        那些在團局成立時就寫定了。要改請取消這個團局再開一個
                        （<span className="font-bold">尚無人報名時取消可全額退回 120 點</span>）。
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
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
                        rules={lists.rules}
                        features={lists.features}
                        restrictions={lists.restrictions}
                        addListItem={addListItem}
                        handleListChange={handleListChange}
                        removeListItem={removeListItem}
                    />

                    <div className="pt-6 pb-10 space-y-3">
                        <AppButton type="submit" isLoading={isSaving} className="w-full">
                            儲存補充設定
                        </AppButton>
                        <AppButton
                            type="button"
                            variant="secondary"
                            onClick={() => navigate(`/event/${load.game.gameId}`)}
                            className="w-full"
                        >
                            取消，不儲存
                        </AppButton>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditGroupExtras;
