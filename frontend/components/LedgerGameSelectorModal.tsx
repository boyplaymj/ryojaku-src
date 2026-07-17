import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, MapPin, Users, Coins, ChevronRight, Loader2, History, Calendar } from 'lucide-react';
import { api } from '../services/dataService';
import { Game } from '../types';

interface LedgerGameSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (game: Game) => void;
}

const LedgerGameSelectorModal: React.FC<LedgerGameSelectorModalProps> = ({ isOpen, onClose, onSelect }) => {
    const [games, setGames] = useState<Game[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadGames();
        }
    }, [isOpen]);

    const loadGames = async () => {
        setLoading(true);
        try {
            const myGames = await api.getRawMyGames();
            // Sort by createdAt descending
            const sortedGames = [...myGames].sort((a, b) => b.createdAt - a.createdAt);
            setGames(sortedGames);
        } catch (error) {
            console.error('Failed to load games:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[300] flex flex-col bg-[#f9f9f7] animate-fade-in overflow-hidden">
            {/* Header */}
            {/* Header - Standardized */}
            <div className="flex-shrink-0 bg-white/80 backdrop-blur-md border-b border-black/[0.03] pt-safe z-30 relative">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/20 to-transparent"></div>
                <div className="h-16 px-4 max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onClose}
                            className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 border border-black/[0.01] shadow-sm active:scale-90 transition-all"
                        >
                            <X size={20} strokeWidth={2.5} />
                        </button>
                        <div>
                            <div className="flex items-center gap-2 text-[#c5a059] text-[0.5625rem] font-black uppercase tracking-[0.3em] mb-0.5">
                                <span>歷史對戰紀錄</span>
                            </div>
                            <h2 className="text-base font-black text-neutral-900 tracking-tight uppercase">匯入對戰資料</h2>
                        </div>
                    </div>
                </div>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto relative z-10 px-4 pt-6 pb-SafeBottom">
                <div className="max-w-2xl mx-auto space-y-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-40 gap-6">
                            <div className="relative">
                                <div className="h-16 w-16 rounded-full border-2 border-neutral-100 border-t-[#c5a059] animate-spin" />
                                <History size={24} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#c5a059]/30" />
                            </div>
                            <p className="text-[0.6875rem] text-neutral-300 font-black tracking-[0.3em] uppercase">正在讀取雲端存檔...</p>
                        </div>
                    ) : games.length === 0 ? (
                        <div className="py-24 text-center bg-white rounded-2xl border border-black/[0.03] shadow-sm">
                            <div className="w-20 h-20 bg-neutral-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <History size={36} className="text-neutral-200" />
                            </div>
                            <p className="text-neutral-900 font-black tracking-tight uppercase mb-1">查無歷史紀錄</p>
                            <p className="text-[0.6875rem] text-neutral-400 font-medium px-8">您尚未參與過任何歷史對戰紀錄。</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {games.map((game) => (
                                <button
                                    key={game.gameId}
                                    onClick={() => onSelect(game)}
                                    className="group relative w-full text-left bg-white border border-black/[0.03] rounded-xl overflow-hidden active:scale-[0.98] transition-all"
                                >
                                    <div className="p-4">
                                        {/* Header: Status & Category */}
                                        <div className="flex justify-between items-center mb-3">
                                            <div className="flex items-center gap-2">
                                                <span className="px-2 py-0.5 rounded text-[0.5625rem] font-black uppercase tracking-widest border bg-[#c5a059]/5 text-[#c5a059] border-[#c5a059]/20">
                                                    {game.type === 'one-time' ? '⚡ 臨時揪團' : '俱樂部團局'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-1.5 h-1.5 rounded-full bg-neutral-300"></div>
                                                <span className="text-[0.6875rem] font-black text-neutral-400 uppercase tracking-widest">
                                                    {new Date(game.gameInfo.startTime || game.createdAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Title: Place Name */}
                                        <h3 className="text-[1rem] font-black text-neutral-900 leading-snug tracking-tight mb-3 group-hover:text-[#c5a059] transition-colors line-clamp-1">
                                            {game.location.placeName || '未知地點'}
                                        </h3>

                                        {/* Key Info Row */}
                                        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-neutral-500 mb-4">
                                            <div className="flex items-center gap-1">
                                                <Clock size={12} className="text-neutral-300" />
                                                <span className="font-bold">
                                                    {new Date(game.gameInfo.startTime || game.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Coins size={12} className="text-neutral-300" />
                                                <span className="font-bold">{game.gameInfo.stakes}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Users size={12} className="text-neutral-300" />
                                                <span className="font-bold">{game.joinedPlayers.length} 人</span>
                                            </div>
                                        </div>

                                        {/* Participants Section */}
                                        <div className="bg-neutral-50/50 rounded-lg p-3 flex flex-col gap-2 border border-black/[0.02]">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1 h-3 bg-[#c5a059] rounded-full"></div>
                                                <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">參與成員</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {game.joinedPlayers.map((player, idx) => (
                                                    <div key={idx} className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-black/[0.03] shadow-sm">
                                                        <div className="w-4 h-4 rounded-full overflow-hidden bg-neutral-100 flex-shrink-0">
                                                            {player.pictureUrl ? (
                                                                <img src={player.pictureUrl} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-[0.5rem] font-black text-[#c5a059]">
                                                                    {player.displayName?.[0] || '?'}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="text-[0.6875rem] font-bold text-neutral-700 truncate max-w-[5rem]">
                                                            {player.displayName}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer: Bottom Action Visual */}
                                    <div className="px-4 py-2 bg-neutral-50/80 border-t border-black/[0.02] flex justify-between items-center group-hover:bg-[#c5a059]/5 transition-colors">
                                        <div className="flex items-center gap-2 text-neutral-300 group-hover:text-[#c5a059]/50 transition-colors">
                                            <MapPin size={10} />
                                            <span className="text-[0.625rem] font-medium truncate max-w-[12.5rem]">{game.location.address}</span>
                                        </div>
                                        <div className="w-7 h-7 rounded-lg bg-neutral-900 group-hover:bg-[#c5a059] flex items-center justify-center text-white transition-all">
                                            <ChevronRight size={14} strokeWidth={3} />
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default LedgerGameSelectorModal;
