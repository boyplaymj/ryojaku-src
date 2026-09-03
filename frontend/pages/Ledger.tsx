import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2, TrendingUp, TrendingDown, Calendar, ChevronLeft, ChevronRight, Plus, X, Search, Filter, Share2, Download, PieChart, List, CreditCard, Clock, MessageSquare, ChevronDown, Users, Info, ArrowLeft, ArrowRight, Wallet, Save, Loader2, Sparkles, Smile, Meh, Frown, Layers, History, Mic } from 'lucide-react';
import { api } from '../services/dataService';
import { authService } from '../services/authService';
import html2canvas from 'html2canvas';
import DatePicker from '../components/DatePicker';
import CyberpunkConfirmModal from '../components/CyberpunkConfirmModal';
import LedgerShareCard from '../components/ledger/LedgerShareCard';
import LedgerEntryFormModal from '../components/ledger/LedgerEntryFormModal';

import { AppSelect } from '../components/ui/CommonUI';
import { Game } from '../types';

import { Opponent, LedgerEntry, filterEntriesByMonth, computeLedgerStats } from '../utils/ledgerStats';

// --- Types ---
// Opponent / LedgerEntry 已搬到 utils/ledgerStats.ts（[A1-a-1]）。
// LedgerSummary 留在這裡：它是後端回來的那份，跟 computeLedgerStats 算的 LedgerStats 欄位不同，不要合併。

interface LedgerSummary {
    totalEntries: number;
    totalRounds: number;
    totalWinLoss: number;
    averageWin: number;
    winRate: number;
    moodStats: Record<string, number>;
}

// --- Components ---

const MoodIcon = ({ mood, size = 20 }: { mood: string, size?: number | string }) => {
    switch (mood) {
        case 'happy': return <Smile size={size} className="text-[#c5a059]" />;
        case 'neutral': return <Meh size={size} className="text-neutral-300" />;
        case 'sad': return <Frown size={size} className="text-neutral-400" />;
        default: return <span>{mood}</span>;
    }
};

const LedgerEntryCard = ({
    entry,
    onEdit,
    onDelete
}: {
    entry: LedgerEntry,
    onEdit: () => void,
    onDelete: () => void
}) => {
    const isWin = entry.winLoss >= 0;

    return (
        <div className="group relative bg-white border border-black/[0.04] rounded-lg p-5 hover:shadow-xl transition-all duration-300 shadow-sm active:scale-[0.99]" onClick={onEdit}>
            <div className="flex items-center gap-5">
                {/* Mood Icon - Circle Style */}
                <div
                    className={`flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center transition-all ${isWin ? 'bg-neutral-900 shadow-lg' : 'bg-neutral-50 border border-black/[0.03]'}`}
                >
                    <div className={isWin ? 'scale-110' : ''}>
                        <MoodIcon mood={entry.mood} size="1.75rem" />
                    </div>
                </div>

                {/* Main Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-neutral-900 font-black text-base tracking-tight">{entry.stakes}</span>
                        <div className="flex items-center gap-1.5 bg-neutral-50 px-2 py-0.5 rounded-lg">
                            <span className="text-[0.625rem] text-neutral-400 font-black uppercase tracking-widest">{entry.rounds} 局</span>
                        </div>
                    </div>
                    {entry.opponents.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 overflow-hidden">
                            {entry.opponents.slice(0, 3).map((opp, i) => (
                                <span key={i} className="text-[0.5625rem] text-neutral-400 font-bold uppercase tracking-widest truncate max-w-[5rem]">
                                    @{opp.name || '---'}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[0.625rem] text-neutral-300 font-bold uppercase tracking-widest italic">個人自主練習</p>
                    )}
                </div>

                {/* Amount */}
                <div className="flex flex-col items-end justify-center min-w-[5rem]">
                    <p className={`text-2xl font-black leading-none tracking-tighter ${isWin ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {entry.winLoss > 0 ? '+' : ''}{entry.winLoss}
                    </p>
                    <p className={`text-[0.5625rem] font-black uppercase tracking-widest mt-2 ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>{isWin ? '盈利' : '虧損'}</p>
                </div>
            </div>

            {entry.note && (
                <div className="mt-4 pl-[4.5rem] flex items-start gap-3 border-t border-black/[0.02] pt-4">
                    <MessageSquare size="0.75rem" className="text-[#c5a059] mt-0.5" />
                    <p className="text-[0.75rem] text-neutral-400 font-medium leading-relaxed italic line-clamp-1">{entry.note}</p>
                </div>
            )}

            {/* Hover Actions */}
            <div className="absolute top-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-2 rounded-lg bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all shadow-sm"
                >
                    <Trash2 size="0.75rem" strokeWidth={3} />
                </button>
            </div>
        </div>
    );
};


// Reusable components moved to CommonUI.tsx

interface LedgerProps {
    isOverlay?: boolean;
    onClose?: () => void;
    onAddActionTrigger?: number;
}

const LedgerPage: React.FC<LedgerProps> = ({ isOverlay, onClose, onAddActionTrigger }) => {
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const gameId = searchParams.get('gameId');
    const currentUser = authService.getCurrentUser();

    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [summary, setSummary] = useState<LedgerSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [isSelectingGame, setIsSelectingGame] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form State
    const [formData, setFormData] = useState<Partial<LedgerEntry>>({
        date: new Date().toISOString().split('T')[0],
        stakes: localStorage.getItem('mahjong_last_stakes') || '30/10',
        rounds: 3,
        winLoss: undefined,
        actualAmount: undefined,
        opponents: [{ name: '' }, { name: '' }, { name: '' }],
        mood: 'neutral',
        note: ''
    });

    const [viewMode, setViewMode] = useState<'calendar' | 'list' | 'chart'>('calendar');
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [resultType, setResultType] = useState<'win' | 'loss'>('win');
    const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [deleteParams, setDeleteParams] = useState<{ id: string, time: number } | null>(null);
    const shareRef = useRef<HTMLDivElement>(null);



    useEffect(() => {
        if (currentUser?.pictureUrl) {
            const convertToBase64 = () => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    try {
                        const canvas = document.createElement("canvas");
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext("2d");
                        if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            setAvatarBase64(canvas.toDataURL("image/jpeg"));
                        }
                    } catch (e) {
                        console.error('Error drawing image to canvas:', e);
                    }
                };
                img.onerror = (error) => {
                    console.error('Error loading avatar image for base64 conversion:', error);
                };
                // Force a fresh request with a cache-busting timestamp
                const urlWithTimestamp = currentUser.pictureUrl!.includes('?')
                    ? `${currentUser.pictureUrl}&cb=${Date.now()}`
                    : `${currentUser.pictureUrl}?cb=${Date.now()}`;
                img.src = urlWithTimestamp;
            };
            convertToBase64();
        }
    }, [currentUser?.pictureUrl]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const ledgerRes = await api.getLedger();
            if (ledgerRes.success) setEntries(ledgerRes.data || []);
            // Summary will be computed locally in frontend to support month switching
        } catch (error) {
            console.error('Failed to fetch ledger data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const filteredEntries = filterEntriesByMonth(entries, currentMonth);

    const computedSummary = React.useMemo(() => computeLedgerStats(filteredEntries), [filteredEntries]);

    useEffect(() => {
        if (onAddActionTrigger && onAddActionTrigger > 0) {
            setShowAddModal(true);
        }
    }, [onAddActionTrigger]);

    useEffect(() => {
        fetchData();

        // If gameId is provided, pre-fill data
        // FIX: Only auto-open if NOT in overlay mode to prevent accidental opening from Profile page
        if (gameId) {
            const fetchGameDetail = async () => {
                const res = await api.getGameDetail(gameId);
                if (res && res.game) {
                    const game = res.game;
                    setFormData(prev => ({
                        ...prev,
                        gameId: gameId,
                        stakes: game.gameInfo.stakes,
                        date: game.gameInfo.startTime ? game.gameInfo.startTime.split('T')[0] : prev.date,
                        opponents: game.joinedPlayers
                            .filter(p => p.userId !== game.hostUserId) // Filter out the host themselves
                            .map(p => ({ name: p.displayName, userId: p.userId }))
                            .concat([{ name: '' }, { name: '' }, { name: '' }] as any[]) // Pad with empty slots
                            .slice(0, 3) // Keep only 3
                    }));

                    // Only auto-open if standalone ledger page or specifically requested
                    if (!isOverlay) {
                        setShowAddModal(true);
                    }
                }
            };
            fetchGameDetail();
        }
    }, [fetchData, gameId, isOverlay]);

    const handleGameSelect = (game: Game) => {
        setFormData(prev => ({
            ...prev,
            gameId: game.gameId,
            stakes: game.gameInfo.stakes,
            date: game.gameInfo.startTime ? game.gameInfo.startTime.split('T')[0] : prev.date,
            opponents: game.joinedPlayers
                .filter(p => p.userId !== (authService.getCurrentUser()?.userId))
                .map(p => ({ name: p.displayName, userId: p.userId }))
                .concat([{ name: '' }, { name: '' }, { name: '' }] as any[])
                .slice(0, 3)
        }));
        setIsSelectingGame(false);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Clean up opponents
            const filteredOpponents = (formData.opponents || []).filter(o => o.name.trim() !== '');

            // Foolproof logic: Force winLoss and actualAmount to match resultType
            const finalWinLoss = resultType === 'loss'
                ? -Math.abs(formData.winLoss || 0)
                : Math.abs(formData.winLoss || 0);

            const finalActualAmount = resultType === 'loss'
                ? -Math.abs(formData.actualAmount || 0)
                : Math.abs(formData.actualAmount || 0);

            let response;
            if (isEditing && formData.ledgerId) {
                response = await api.updateLedger({
                    ...formData,
                    winLoss: finalWinLoss,
                    actualAmount: finalActualAmount,
                    opponents: filteredOpponents
                } as any);
            } else {
                response = await api.createLedger({
                    ...formData,
                    winLoss: finalWinLoss,
                    actualAmount: finalActualAmount,
                    opponents: filteredOpponents
                } as any);
            }

            if (response.success) {
                if (formData.stakes) {
                    localStorage.setItem('mahjong_last_stakes', formData.stakes);
                }
                setShowAddModal(false);
                setIsEditing(false);
                fetchData();
                // Clear form for next time
                setFormData({
                    date: new Date().toISOString().split('T')[0],
                    stakes: localStorage.getItem('mahjong_last_stakes') || '30/10',
                    rounds: 3,
                    winLoss: undefined,
                    actualAmount: undefined,
                    opponents: [{ name: '' }, { name: '' }, { name: '' }],
                    mood: 'neutral',
                    note: ''
                });
            } else {
                showToast('儲存失敗: ' + response.error);
            }
        } catch (error) {
            console.error('Failed to save ledger entry:', error);
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = (entryId?: string, createdAt?: number) => {
        const idToDelete = entryId || formData.ledgerId;
        const timeToDelete = createdAt || formData.createdAt;

        if (!idToDelete || !timeToDelete) return;

        setDeleteParams({ id: idToDelete, time: timeToDelete });
    };

    const handleDelete = async () => {
        if (!deleteParams) return;

        setSaving(true);
        try {
            const response = await api.deleteLedger(deleteParams.id, deleteParams.time);
            if (response.success) {
                setShowAddModal(false);
                setIsEditing(false);
                setDeleteParams(null);
                fetchData();
            } else {
                showToast('刪除失敗: ' + response.error);
            }
        } catch (error) {
            console.error('Failed to delete ledger entry:', error);
        } finally {
            setSaving(false);
        }
    };




    const handleShare = async () => {
        if (!shareRef.current) return;
        try {
            const canvas = await html2canvas(shareRef.current, {
                useCORS: true,
                scale: 2, // Better quality
                backgroundColor: '#020617',
                logging: true
            });
            const image = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = image;
            link.download = `mahjong-record-${new Date().getTime()}.png`;
            link.click();
        } catch (error) {
            console.error('Failed to generate share image:', error);
            showToast('產生分享圖片失敗，請重試');
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen w-full flex-col items-center justify-center bg-[#f9f9f7] gap-4">
                <div className="animate-spin rounded-full h-10 w-10 border-[0.1875rem] border-neutral-100 border-t-[#c5a059]"></div>
                <span className="text-[0.625rem] font-black text-neutral-300 uppercase tracking-[0.3em] animate-pulse">正在初始化記帳本...</span>
            </div>
        );
    }

    return (
        <div className={`px-5 max-w-7xl mx-auto w-full animate-fade-in bg-[#f9f9f7] min-h-screen ${isOverlay ? 'pt-8' : ''}`}>
            {/* Top Header - Minimal Lux */}
            {/* Top Header - Minimal Lux */}
            {!isOverlay && (
                <div className="pt-safe sticky top-0 z-[50] bg-[#f9f9f7]/95 backdrop-blur-md -mx-5 px-5 border-b border-black/[0.01]">
                    <div className="h-16 flex items-center justify-between">
                        <button
                            onClick={() => {
                                if (isOverlay && onClose) {
                                    onClose();
                                } else {
                                    navigate('/profile');
                                }
                            }}
                            className="w-10 h-10 rounded-lg bg-white border border-black/[0.03] flex items-center justify-center text-neutral-900 hover:bg-neutral-50 shadow-sm transition-all active:scale-90"
                        >
                            <ChevronLeft size="1.25rem" strokeWidth={2.5} />
                        </button>
                        <div className="text-center">
                            <h1 className="text-lg font-black text-neutral-900 uppercase tracking-[0.2em] leading-none mb-1">計帳總覽</h1>
                            <span className="text-[0.5625rem] font-black text-[#c5a059] uppercase tracking-[0.3em]">Imperial Ledger</span>
                        </div>
                        <button onClick={() => {
                            setIsEditing(false);
                            setFormData({
                                date: new Date().toISOString().split('T')[0],
                                stakes: localStorage.getItem('mahjong_last_stakes') || '30/10',
                                rounds: 3,
                                winLoss: undefined,
                                actualAmount: undefined,
                                opponents: [{ name: '' }, { name: '' }, { name: '' }],
                                mood: 'neutral',
                                note: ''
                            });
                            setShowAddModal(true);
                        }} className="w-10 h-10 rounded-lg bg-[#c5a059] flex items-center justify-center text-white shadow-lg shadow-[#c5a059]/20 hover:scale-105 transition-all active:scale-90">
                            <Plus size="1.25rem" strokeWidth={3} />
                        </button>
                    </div>
                </div>
            )}

            {/* Month Selector - Redesigned Capsule Style */}
            <div className={`flex mb-3 sticky ${isOverlay ? 'top-0' : 'top-[calc(4rem+env(safe-area-inset-top))]'} z-[40] bg-[#f9f9f7]/95 backdrop-blur-md -mx-5 px-5 py-2 transition-all border-b border-black/[0.01]`}>
                <div className="flex w-full items-center justify-between bg-white/90 backdrop-blur-md rounded-lg border border-black/[0.04] shadow-[0_0.25rem_1.25rem_rgba(0,0,0,0.03)] p-1.5">
                    <button
                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                        className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 active:scale-90 transition-all"
                    >
                        <ChevronLeft size="1.125rem" strokeWidth={3} />
                    </button>

                    <div className="px-8 text-center min-w-[8.75rem]">
                        <h2 className="text-[0.875rem] font-black text-neutral-900 tracking-[0.1em] mb-0.5">
                            {currentMonth.getFullYear()} / {String(currentMonth.getMonth() + 1).padStart(2, '0')}
                        </h2>
                        <div className="flex items-center justify-center gap-1">
                            <div className="w-1 h-1 rounded-full bg-[#c5a059]"></div>
                            <span className="text-[0.5rem] font-black text-[#c5a059] uppercase tracking-[0.2em] opacity-80">Monthly Report</span>
                        </div>
                    </div>

                    <button
                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                        className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 active:scale-90 transition-all"
                    >
                        <ChevronRight size="1.125rem" strokeWidth={3} />
                    </button>
                </div>
            </div>

            {/* Summary Card - Imperial Gold Aesthetic */}
            <div className="relative mb-3 group">
                <div className="absolute -inset-1 bg-gradient-to-br from-[#c5a059]/20 to-transparent rounded-lg blur-2xl opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative bg-[#111111] rounded-lg p-6 overflow-hidden shadow-2xl border border-white/5">
                    {/* High-end mesh gradient effect */}
                    <div className="absolute top-0 right-0 w-[25rem] h-[25rem] bg-[#c5a059]/10 rounded-full blur-[7.5rem] -mr-48 -mt-48 transition-transform group-hover:scale-110 duration-700"></div>
                    <div className="absolute bottom-0 left-0 w-[18.75rem] h-[18.75rem] bg-white/5 rounded-full blur-[6.25rem] -ml-40 -mb-40"></div>

                    <div className="flex justify-between items-start mb-6 relative z-10">
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="w-1 h-3 bg-[#c5a059] rounded-full"></span>
                                <p className="text-[0.625rem] font-black text-neutral-500 uppercase tracking-[0.3em]">Imperial Balance</p>
                            </div>
                            <div className="flex items-baseline gap-3">
                                <h2 className="text-5xl font-black tracking-tighter text-white">
                                    {computedSummary.totalWinLoss >= 0 ? '+' : ''}{computedSummary.totalWinLoss}
                                </h2>
                                <span className="text-sm font-black text-[#c5a059] tracking-widest">PT</span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleShare}
                                className="w-10 h-10 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg flex items-center justify-center text-white transition-all active:scale-90"
                            >
                                <Share2 size="1.125rem" strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 relative z-10">
                        <div className="bg-white/[0.02] backdrop-blur-xl rounded-lg p-4 border border-white/[0.04]">
                            <p className="text-[0.5rem] font-black text-white/30 uppercase tracking-[0.2em] mb-1">場數</p>
                            <p className="text-lg font-black text-white">{computedSummary.totalRounds}</p>
                        </div>
                        <div className="bg-white/[0.02] backdrop-blur-xl rounded-lg p-4 border border-white/[0.04]">
                            <p className="text-[0.5rem] font-black text-white/30 uppercase tracking-[0.2em] mb-1">勝率</p>
                            <p className="text-lg font-black text-white">{Math.round(computedSummary.winRate)}%</p>
                        </div>
                        <div className="bg-white/[0.02] backdrop-blur-xl rounded-lg p-4 border border-white/[0.04]">
                            <p className="text-[0.5rem] font-black text-white/30 uppercase tracking-[0.2em] mb-1">底台</p>
                            <p className="text-lg font-black text-white">{Math.round(computedSummary.averageWin)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* 語音判台入口（訓練工具）—— 只導頁，不接記帳資料。
                🔴 放在這裡而不是 header：header 在 isOverlay 模式整段不算繪（Ledger 由
                Profile 以 LedgerOverlay 開啟時走的就是那條路），入口會跟著消失。
                正典 tools/mahjong-tai/DESIGN_APP.md §6／§11 待辦「入口放哪」。 */}
            <button
                onClick={() => {
                    // overlay 是 fixed inset-0 z-[100] 的 portal，不關掉的話導頁後
                    // 使用者只會看到蓋在上面的記帳本，像是按鈕沒反應。
                    if (isOverlay && onClose) onClose();
                    navigate('/training/voice-tai');
                }}
                className="w-full mb-3 flex items-center gap-4 bg-white rounded-lg border border-black/[0.03] shadow-sm px-5 py-4 text-left hover:shadow-md transition-all active:scale-[0.99]"
            >
                <div className="w-11 h-11 rounded-lg bg-neutral-900 flex items-center justify-center text-[#c5a059] flex-shrink-0">
                    <Mic size="1.25rem" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[0.8125rem] font-black text-neutral-900 tracking-[0.1em]">語音判台</h3>
                        <span className="text-[0.5rem] font-black text-[#c5a059] border border-[#c5a059]/30 px-1.5 py-0.5 rounded uppercase tracking-[0.2em]">訓練工具</span>
                    </div>
                    <p className="text-[0.6875rem] font-medium text-neutral-400 leading-relaxed">
                        講出牌型直接算台數 · <span className="text-neutral-500">不會寫入帳本</span>
                    </p>
                </div>
                <ChevronRight size="1.125rem" strokeWidth={2.5} className="text-neutral-300 flex-shrink-0" />
            </button>

            <div className="flex items-center mb-3 overflow-x-auto scrollbar-hide py-1">
                <div className="flex bg-white p-1.5 rounded-lg border border-black/[0.03] shadow-sm w-full">
                    <button
                        onClick={() => setViewMode('calendar')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-lg text-[0.625rem] font-black uppercase tracking-[0.2em] transition-all duration-300 ${viewMode === 'calendar' ? 'bg-neutral-900 text-white shadow-xl' : 'text-neutral-400 hover:text-neutral-900'}`}
                    >
                        <Calendar size="0.875rem" strokeWidth={2.5} />
                        趨勢日曆
                    </button>
                    <button
                        onClick={() => {
                            setViewMode('list');
                            setSelectedDate(null);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-lg text-[0.625rem] font-black uppercase tracking-[0.2em] transition-all duration-300 ${viewMode === 'list' ? 'bg-neutral-900 text-white shadow-xl' : 'text-neutral-400 hover:text-neutral-900'}`}
                    >
                        <History size="0.875rem" strokeWidth={2.5} />
                        詳細紀錄
                    </button>
                    <button
                        onClick={() => setViewMode('chart')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-lg text-[0.625rem] font-black uppercase tracking-[0.2em] transition-all duration-300 ${viewMode === 'chart' ? 'bg-neutral-900 text-white shadow-xl' : 'text-neutral-400 hover:text-neutral-900'}`}
                    >
                        <TrendingUp size="0.875rem" strokeWidth={2.5} />
                        戰力分析
                    </button>
                </div>
            </div>

            {/* Content Area - Conditional Rendering */}
            <div className="relative z-0">
                {viewMode === 'list' ? (
                    <div className="space-y-3 pb-20">
                        {filteredEntries.length === 0 ? (
                            <div className="my-4 p-16 text-center bg-white rounded-lg border border-black/[0.03] shadow-sm">
                                <div className="w-20 h-20 bg-neutral-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-black/[0.01]">
                                    <Layers size="2.5rem" className="text-neutral-200" />
                                </div>
                                <p className="text-neutral-900 font-black text-sm uppercase tracking-[0.2em] mb-3">尚無任何紀錄</p>
                                <p className="text-neutral-400 text-[0.8125rem] font-medium leading-relaxed mb-10 max-w-[15rem] mx-auto">您的記帳本目前是空的。建立您的第一筆紀錄來開始追蹤吧。</p>
                                <button
                                    onClick={() => setShowAddModal(true)}
                                    className="px-10 py-5 bg-neutral-900 text-white text-[0.6875rem] font-black uppercase tracking-[0.2em] rounded-lg hover:shadow-xl transition-all active:scale-95 shadow-md"
                                >
                                    立即建立新紀錄
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {filteredEntries.map((entry, idx) => (
                                    <LedgerEntryCard
                                        key={entry.ledgerId || idx}
                                        entry={entry}
                                        onEdit={() => {
                                            setFormData({
                                                ...entry,
                                                opponents: entry.opponents.concat([{ name: '' }, { name: '' }, { name: '' }]).slice(0, 3)
                                            });
                                            setResultType(entry.winLoss >= 0 ? 'win' : 'loss');
                                            setIsEditing(true);
                                            setShowAddModal(true);
                                        }}
                                        onDelete={() => confirmDelete(entry.ledgerId, entry.createdAt)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                ) : viewMode === 'chart' ? (
                    <div className="space-y-3 pb-20">
                        {/* P/L Chart */}
                        <div className="bg-white border border-black/[0.03] rounded-lg p-8 shadow-sm overflow-hidden relative">
                            <div className="px-2 mb-4">
                                <p className="text-[0.6875rem] font-black text-neutral-400 uppercase tracking-[0.25em]">盈虧分配統計</p>
                                <h3 className="text-lg font-black text-neutral-900 tracking-tight uppercase">收益曲線走勢</h3>
                            </div>

                            <div className="h-96 w-full relative group flex">
                                <div className="flex w-full h-full">
                                    {(() => {
                                        const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();

                                        const dailyTotals: Record<number, number> = {};
                                        for (let i = 1; i <= daysInMonth; i++) dailyTotals[i] = 0;

                                        let hasData = false;
                                        filteredEntries.forEach(e => {
                                            const day = parseInt(e.date.split('-')[2]);
                                            dailyTotals[day] = (dailyTotals[day] || 0) + e.winLoss;
                                            hasData = true;
                                        });

                                        if (!hasData) {
                                            return (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                    <div className="w-20 h-20 bg-neutral-50 rounded-full flex items-center justify-center mb-6 border border-black/[0.01]">
                                                        <TrendingUp size="1.5rem" className="text-neutral-200" />
                                                    </div>
                                                    <p className="text-neutral-400 text-[0.6875rem] font-black uppercase tracking-[0.2em]">分析數據不足</p>
                                                </div>
                                            );
                                        }

                                        const totals = Object.values(dailyTotals);
                                        const maxVal = Math.max(...totals);
                                        const minVal = Math.min(...totals);
                                        const absMax = Math.max(Math.abs(maxVal), Math.abs(minVal), 10);

                                        const ticks = [-absMax, -absMax / 2, 0, absMax / 2, absMax];

                                        const minDayWidth = 45;
                                        const chartValuesWidth = daysInMonth * minDayWidth;
                                        const padding = { top: 30, right: 30, bottom: 40, left: 30 };
                                        const totalWidth = Math.max(800, chartValuesWidth + padding.left + padding.right);
                                        const height = 350;

                                        const chartW = totalWidth - padding.left - padding.right;
                                        const chartH = height - padding.top - padding.bottom;

                                        const getY = (val: number) => {
                                            const pct = (val + absMax) / (2 * absMax);
                                            return padding.top + chartH - (pct * chartH);
                                        };

                                        const zeroY = getY(0);
                                        const getX = (day: number) => padding.left + ((day - 1) / daysInMonth) * chartW;
                                        const barWidth = (chartW / daysInMonth) * 0.6;

                                        return (
                                            <>
                                                <div className="w-[3.75rem] h-full relative z-20 shrink-0 border-r border-black/[0.02] bg-white">
                                                    <svg width="100%" height={height} className="overflow-visible">
                                                        {ticks.map((tick, i) => {
                                                            const y = getY(tick);
                                                            return (
                                                                <g key={i}>
                                                                    <text
                                                                        x={50}
                                                                        y={y}
                                                                        dy="0.4em"
                                                                        fill={tick === 0 ? "#9ca3af" : "#d1d5db"}
                                                                        fontSize="10"
                                                                        fontFamily="Inter, sans-serif"
                                                                        fontWeight="900"
                                                                        textAnchor="end"
                                                                        className="tracking-tighter"
                                                                    >
                                                                        {Math.round(tick)}
                                                                    </text>
                                                                    <line x1={52} y1={y} x2={60} y2={y} stroke="#f3f4f6" strokeWidth="1" />
                                                                </g>
                                                            )
                                                        })}
                                                        <text x={50} y={padding.top - 15} fontSize="8" fill="#d1d5db" fontWeight="900" textAnchor="end" className="tracking-widest">底台</text>
                                                    </svg>
                                                </div>
                                                <div className="flex-1 h-full overflow-x-auto overflow-y-hidden pb-4 scrollbar-thin scrollbar-thumb-neutral-100 scrollbar-track-transparent relative">
                                                    <svg width={totalWidth} height={height} className="overflow-visible">
                                                        <defs>
                                                            <linearGradient id="winGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="0%" stopColor="#c5a059" stopOpacity="1" />
                                                                <stop offset="100%" stopColor="#c5a059" stopOpacity="0.4" />
                                                            </linearGradient>
                                                            <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="0%" stopColor="#262626" stopOpacity="0.05" />
                                                                <stop offset="100%" stopColor="#262626" stopOpacity="0.4" />
                                                            </linearGradient>
                                                        </defs>

                                                        {/* Grid & Axis Lines */}
                                                        {ticks.map((tick, i) => {
                                                            const y = getY(tick);
                                                            return (
                                                                <g key={i}>
                                                                    <line
                                                                        x1={padding.left}
                                                                        y1={y}
                                                                        x2={totalWidth - padding.right}
                                                                        y2={y}
                                                                        stroke="#000"
                                                                        strokeOpacity={tick === 0 ? "0.05" : "0.02"}
                                                                        strokeWidth={tick === 0 ? "1.5" : "1"}
                                                                        strokeDasharray={tick === 0 ? "" : "8 8"}
                                                                    />
                                                                </g>
                                                            )
                                                        })}

                                                        {/* Bars */}
                                                        {Object.entries(dailyTotals).map(([d, val]) => {
                                                            const day = parseInt(d);
                                                            if (val === 0) return null;

                                                            const x = getX(day) + ((chartW / daysInMonth) - barWidth) / 2;
                                                            const y = val > 0 ? getY(val) : zeroY;
                                                            const h = Math.abs(getY(val) - zeroY);
                                                            const isWin = val > 0;

                                                            return (
                                                                <g key={day} className="cursor-default">
                                                                    <rect
                                                                        x={x}
                                                                        y={y}
                                                                        width={barWidth}
                                                                        height={Math.max(1, h)}
                                                                        fill={`url(#${isWin ? 'winGrad' : 'lossGrad'})`}
                                                                        rx="8"
                                                                        className="transition-all duration-300 hover:brightness-110"
                                                                    />
                                                                </g>
                                                            );
                                                        })}

                                                        {/* X Axis Labels */}
                                                        {Array.from({ length: daysInMonth }).map((_, i) => {
                                                            const day = i + 1;
                                                            return (
                                                                <text
                                                                    key={day}
                                                                    x={getX(day) + (chartW / daysInMonth) / 2}
                                                                    y={height - 5}
                                                                    fill="#d1d5db"
                                                                    fontSize="11"
                                                                    fontWeight="900"
                                                                    textAnchor="middle"
                                                                    className="font-black"
                                                                >
                                                                    {day}
                                                                </text>
                                                            );
                                                        })}
                                                    </svg>
                                                </div>
                                                <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent pointer-events-none"></div>
                                            </>
                                        );
                                    })()}
                                </div>
                                <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent pointer-events-none"></div>
                            </div>
                        </div>

                        {/* Chart Stats */}
                        <div className="grid grid-cols-2 gap-5">
                            <div className="bg-white border border-black/[0.03] rounded-lg p-8 shadow-sm transition-transform hover:scale-[1.02]">
                                <div className="text-[0.6875rem] font-black text-neutral-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-[#c5a059]"></div>
                                    單日最高盈餘
                                </div>
                                <p className="text-3xl font-black text-neutral-900 tracking-tighter">
                                    {Math.max(0, ...filteredEntries.map(e => e.winLoss))}
                                    <span className="text-sm font-black text-neutral-300 ml-2">PT</span>
                                </p>
                            </div>
                            <div className="bg-white border border-black/[0.03] rounded-lg p-8 shadow-sm transition-transform hover:scale-[1.02]">
                                <div className="text-[0.6875rem] font-black text-neutral-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-neutral-900"></div>
                                    單日最大虧損
                                </div>
                                <p className="text-3xl font-black text-neutral-900 tracking-tighter">
                                    {Math.min(0, ...filteredEntries.map(e => e.winLoss))}
                                    <span className="text-sm font-black text-neutral-300 ml-2">PT</span>
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-8 pb-10">
                        {/* Calendar Component */}
                        <div className="bg-white border border-black/[0.04] rounded-lg p-8 shadow-sm overflow-hidden relative">
                            {/* Calendar Header */}
                            <div className="flex items-center justify-between mb-8 px-2">
                                <p className="text-[0.6875rem] font-black text-neutral-400 uppercase tracking-[0.25em]">每日活動摘要</p>
                                <div className="flex items-center gap-5">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                        <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-[0.15em]">獲利</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                                        <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-[0.15em]">虧損</span>
                                    </div>
                                </div>
                            </div>

                            {/* Calendar Grid */}
                            <div className="grid grid-cols-7 gap-3">
                                {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                                    <div key={d} className="text-center text-[0.625rem] font-black text-neutral-300 py-3 tracking-[0.2em]">{d}</div>
                                ))}
                                {(() => {
                                    const year = currentMonth.getFullYear();
                                    const month = currentMonth.getMonth();
                                    const firstDay = new Date(year, month, 1).getDay();
                                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                                    const days = [];

                                    for (let i = 0; i < firstDay; i++) {
                                        days.push(<div key={`pad-${i}`} className="aspect-square opacity-0"></div>);
                                    }

                                    for (let d = 1; d <= daysInMonth; d++) {
                                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                                        const dayEntries = filteredEntries.filter(e => e.date === dateStr);
                                        const totalDayWinLoss = dayEntries.reduce((sum, e) => sum + e.winLoss, 0);
                                        const hasWin = dayEntries.some(e => e.winLoss > 0);
                                        const hasLoss = dayEntries.some(e => e.winLoss < 0);
                                        const isSelected = selectedDate === dateStr;
                                        const isToday = new Date().toISOString().split('T')[0] === dateStr;

                                        const getDayStyle = () => {
                                            if (isSelected) return 'bg-neutral-900 border-neutral-900 shadow-xl scale-110 z-10';
                                            if (dayEntries.length > 0) {
                                                if (totalDayWinLoss > 0) return 'bg-emerald-50 border-emerald-100/50 hover:bg-emerald-100/50';
                                                if (totalDayWinLoss < 0) return 'bg-rose-50 border-rose-100/50 hover:bg-rose-100/50';
                                                return 'bg-neutral-50 border-neutral-100 hover:bg-neutral-100';
                                            }
                                            return 'bg-transparent border-transparent hover:bg-neutral-50';
                                        };

                                        const getTextColor = () => {
                                            if (isSelected) return 'text-white';
                                            if (dayEntries.length > 0) {
                                                if (totalDayWinLoss > 0) return 'text-emerald-600';
                                                if (totalDayWinLoss < 0) return 'text-rose-600';
                                                return 'text-neutral-900';
                                            }
                                            return 'text-neutral-400';
                                        };

                                        days.push(
                                            <button
                                                key={d}
                                                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                                                className={`relative aspect-square rounded-lg flex flex-col items-center justify-center transition-all active:scale-95 border ${getDayStyle()}`}
                                            >
                                                <span className={`text-[0.8125rem] font-black leading-none ${getTextColor()} ${dayEntries.length > 0 ? 'mb-0.5' : ''}`}>{d}</span>

                                                {/* Amount Below Date */}
                                                {dayEntries.length > 0 && (
                                                    <span className={`text-[0.4375rem] font-black tracking-tighter transition-colors ${isSelected ? 'text-white/90' : (totalDayWinLoss > 0 ? 'text-emerald-500' : 'text-rose-500')}`}>
                                                        {totalDayWinLoss > 0 ? '+' : ''}{totalDayWinLoss}
                                                    </span>
                                                )}

                                                {/* Status Markers - Fixed at bottom */}
                                                <div className="absolute bottom-1.5 flex gap-0.5">
                                                    {hasWin && <div className={`w-0.5 h-0.5 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-400'}`}></div>}
                                                    {hasLoss && <div className={`w-0.5 h-0.5 rounded-full ${isSelected ? 'bg-white' : 'bg-rose-400'}`}></div>}
                                                    {isToday && !isSelected && dayEntries.length === 0 && <div className="w-1 h-1 rounded-full bg-[#c5a059]"></div>}
                                                </div>
                                            </button>
                                        );
                                    }
                                    return days;
                                })()}
                            </div>
                        </div>

                        {/* Selected Day Details */}
                        {selectedDate && (
                            <div className="space-y-6 animate-fade-in-up">
                                <div className="flex items-center justify-between px-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#c5a059]"></div>
                                        <h3 className="text-base font-black text-neutral-900 tracking-tight uppercase">
                                            {selectedDate}
                                            <span className="ml-3 text-[0.625rem] font-black text-neutral-300 uppercase tracking-widest">Selected Period</span>
                                        </h3>
                                    </div>
                                    <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest bg-neutral-50 px-3 py-1.5 rounded-full border border-black/[0.03]">
                                        {filteredEntries.filter(e => e.date === selectedDate).length} 筆資料
                                    </span>
                                </div>

                                <div className="space-y-5">
                                    {filteredEntries.filter(e => e.date === selectedDate).map((entry, idx) => (
                                        <LedgerEntryCard
                                            key={entry.ledgerId || idx}
                                            entry={entry}
                                            onEdit={() => {
                                                setFormData({
                                                    ...entry,
                                                    opponents: entry.opponents.concat([{ name: '' }, { name: '' }, { name: '' }]).slice(0, 3)
                                                });
                                                setResultType(entry.winLoss >= 0 ? 'win' : 'loss');
                                                setIsEditing(true);
                                                setShowAddModal(true);
                                            }}
                                            onDelete={() => confirmDelete(entry.ledgerId, entry.createdAt)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {!selectedDate && (
                            <div className="py-20 text-center bg-white rounded-lg border border-black/[0.03] shadow-sm">
                                <div className="p-4 bg-neutral-50 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-6">
                                    <Calendar className="text-neutral-200" size="1.5rem" />
                                </div>
                                <p className="text-[0.6875rem] font-black text-neutral-300 uppercase tracking-[0.3em] mb-3">選取日期以顯示詳情</p>
                                <p className="text-[0.8125rem] text-neutral-400 font-medium px-10">請從上方日曆中點選一個有紀錄的日期來查看完整數據。</p>
                            </div>
                        )}
                    </div>
                )}
                {/* Global Bottom Spacer */}
                <div className="h-20 flex-none" aria-hidden="true"></div>
            </div>


            {/* Add/Edit Modal - Redesigned as Full Screen Overlay with Portal（本體在 components/ledger/LedgerEntryFormModal.tsx，[A1-a-3]） */}
            {showAddModal && (
                <LedgerEntryFormModal
                    formData={formData}
                    setFormData={setFormData}
                    setShowAddModal={setShowAddModal}
                    setShowDatePicker={setShowDatePicker}
                    isSelectingGame={isSelectingGame}
                    setIsSelectingGame={setIsSelectingGame}
                    resultType={resultType}
                    setResultType={setResultType}
                    isEditing={isEditing}
                    saving={saving}
                    handleSave={handleSave}
                    confirmDelete={confirmDelete}
                    handleGameSelect={handleGameSelect}
                />
            )}

            {/* DatePicker Modal - Hard Edge Style */}
            {
                showDatePicker && createPortal(
                    <div className="fixed inset-0 z-[300] flex items-center justify-center p-5 bg-neutral-900/80 backdrop-blur-sm animate-fade-in" onClick={() => setShowDatePicker(false)}>
                        <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-white p-5 shadow-2xl border border-black/[0.04]">
                            <div className="flex items-center justify-between mb-5">
                                <h4 className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-[0.2em]">請選擇日期</h4>
                                <button onClick={() => setShowDatePicker(false)} className="w-8 h-8 flex items-center justify-center text-neutral-300 hover:text-neutral-900 hover:bg-neutral-100 transition-all">
                                    <X size="1.125rem" strokeWidth={2.5} />
                                </button>
                            </div>
                            <DatePicker
                                value={formData.date || ''}
                                onChange={(date) => {
                                    setFormData({ ...formData, date });
                                    setShowDatePicker(false);
                                }}
                                onClose={() => setShowDatePicker(false)}
                            />
                        </div>
                    </div>,
                    document.body
                )
            }

            {/* Delete Confirmation Modal - Minimal Lux Style */}
            <CyberpunkConfirmModal
                isOpen={!!deleteParams}
                onClose={() => setDeleteParams(null)}
                onConfirm={handleDelete}
                title="確認要刪除嗎？"
                message={"您即將從紀錄雲端中刪除此筆資料。\n此動作將無法復原。"}
                confirmText="確認刪除"
                cancelText="取消"
                type="danger"
                loading={saving}
            />


            <LedgerShareCard ref={shareRef} currentUser={currentUser} currentMonth={currentMonth} computedSummary={computedSummary} avatarBase64={avatarBase64} />
        </div>
    );
};

export default LedgerPage;
