import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, MapPin, Users, Coins, ChevronRight, Loader2, History, Star } from 'lucide-react';
import { Game, Category } from '../types';
import { api } from '../services/dataService';

interface TemplateSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (game: Game) => void;
}

const TemplateSelectorModal: React.FC<TemplateSelectorModalProps> = ({ isOpen, onClose, onSelect }) => {
    const [games, setGames] = useState<Game[]>([]);
    const [loading, setLoading] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
            loadHostedGames();
            document.body.style.overflow = 'hidden';
        } else {
            const timer = setTimeout(() => setIsVisible(false), 300);
            document.body.style.overflow = 'unset';
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    const loadHostedGames = async () => {
        setLoading(true);
        try {
            const hostedGames = await api.getRawMyGames();
            // Sort by createdAt descending
            const sortedGames = [...hostedGames].sort((a, b) => b.createdAt - a.createdAt);
            setGames(sortedGames);
        } catch (error) {
            console.error('Failed to load hosted games:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen && !isVisible) return null;

    return createPortal(
        <div className={`fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-0 sm:p-4 transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Content - 緊湊版歷史紀錄 */}
            <div className={`relative w-full h-[80vh] sm:h-auto sm:max-h-[85vh] sm:max-w-xl bg-[#f9f9f7] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-transform duration-500 ease-out transform ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}>

                {/* Header - 緊湊設計 */}
                <div className="bg-white px-5 h-16 flex items-center justify-between shrink-0 border-b border-black/[0.03] relative">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c5a059]/40 to-transparent"></div>

                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#c5a059]/10 text-[#c5a059] shadow-inner border border-[#c5a059]/10">
                            <History size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-neutral-900 tracking-tight">
                                歷史模板引入
                            </h3>
                            <p className="text-[0.5625rem] text-neutral-400 font-black uppercase tracking-widest">Select Past Sessions</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-neutral-50 text-neutral-400 hover:text-neutral-900 transition-all active:scale-90"
                    >
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </div>

                {/* List Content - 緊湊網格 */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <div className="animate-spin rounded-full h-7 w-7 border-2 border-neutral-100 border-t-[#c5a059]" />
                            <p className="text-[0.625rem] text-neutral-400 font-black uppercase tracking-widest">載入歷史紀錄...</p>
                        </div>
                    ) : games.length === 0 ? (
                        <div className="text-center py-20 space-y-4">
                            <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center mx-auto text-neutral-200 border border-black/[0.02] shadow-sm">
                                <History size={32} />
                            </div>
                            <div className="space-y-1">
                                <p className="text-neutral-900 font-black text-sm uppercase">尚無歷史資料</p>
                                <p className="text-neutral-400 text-[0.6875rem] font-medium px-10">您發起過的團局會自動儲存為模板</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {games.map((game) => (
                                <button
                                    key={game.gameId}
                                    onClick={() => onSelect(game)}
                                    className="group relative w-full text-left bg-white border border-black/[0.02] rounded-xl p-4 hover:bg-neutral-50 transition-all duration-200 active:scale-[0.98] shadow-sm"
                                >
                                    <div className="relative z-10">
                                        <div className="flex justify-between items-start gap-4 mb-2.5">
                                            <div className="space-y-0.5 flex-1 text-neutral-900">
                                                <h4 className="font-black group-hover:text-[#c5a059] transition-colors text-[1rem] tracking-tight truncate">
                                                    {game.location.placeName || '未命名場地'}
                                                </h4>
                                                <div className="flex items-center gap-1.5 text-[0.625rem] text-neutral-400 font-black uppercase">
                                                    <Clock size={11} strokeWidth={2.5} />
                                                    {game.gameInfo.startTime
                                                        ? `${new Date(game.gameInfo.startTime).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} ${new Date(game.gameInfo.startTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                                                        : new Date(game.createdAt).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })
                                                    }
                                                </div>
                                            </div>
                                            <div className="shrink-0 px-2 py-0.5 bg-[#c5a059]/5 text-[#c5a059] border border-[#c5a059]/20 rounded-md text-[0.5625rem] font-black uppercase tracking-widest">
                                                {Category.GAME}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-start gap-2 text-[0.75rem] text-neutral-600 font-medium">
                                                <MapPin size={12} className="text-[#c5a059] shrink-0 mt-0.5" />
                                                <span className="line-clamp-1">{game.location.address}</span>
                                            </div>

                                            <div className="flex flex-wrap gap-2 pt-0.5">
                                                <div className="flex items-center gap-1.5 text-[0.625rem] bg-neutral-50 px-2.5 py-1 rounded-lg text-neutral-800 font-black">
                                                    <Coins size={11} className="text-[#c5a059]" />
                                                    <span>{game.gameInfo.stakes}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[0.625rem] bg-neutral-50 px-2.5 py-1 rounded-lg text-neutral-800 font-black">
                                                    <Users size={11} className="text-neutral-400" />
                                                    <span>缺{game.playersNeeded}人</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-200 group-hover:text-[#c5a059] transition-colors">
                                        <ChevronRight size={18} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer - 緊湊版 */}
                <div className="px-5 py-4 border-t border-black/[0.03] bg-neutral-50 shrink-0 text-center">
                    <p className="text-[0.5625rem] text-neutral-200 font-black uppercase tracking-[0.4em]">
                        REI ARCHIVE PROTOCOL • VERIFIED
                    </p>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default TemplateSelectorModal;
