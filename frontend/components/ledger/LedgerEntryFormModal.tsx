// components/ledger/LedgerEntryFormModal.tsx — 帳本頁「新增／修改紀錄」全螢幕表單彈窗（[A1-a-3]）
//
// 從 pages/Ledger.tsx 逐字搬出來的 props-only 元件：沒有 useState／useEffect、不呼叫 api／authService，
// 表單狀態與儲存／刪除／選團局的 handler 全部從 props 進來。createPortal 的呼叫在這裡面。
//
// ⚠️ prop 名字刻意跟 LedgerPage 裡的 state／setter／handler 同名（setShowAddModal、confirmDelete …），
//    這樣 JSX 本體才能一個字都不改地搬過來：本檔 createPortal( 的第一個引數到 document.body 那段，
//    與 HEAD 的 Ledger.tsx 950-1221 行逐位元相同（外面包的那層 <> 是為了讓縮排也對得上，不是有功能）。
//    要對的話：
//      diff <(git show <A1-a-3 前的 HEAD>:frontend/pages/Ledger.tsx | sed -n '950,1221p') \
//           <(sed -n '<起>,<迄>p' frontend/components/ledger/LedgerEntryFormModal.tsx)
//
// 🔴 DatePicker 彈窗（z-[300]）不在這裡：它跟 Delete 確認框一樣留在 LedgerPage，
//    這裡只透過 setShowDatePicker 把它叫出來。

import React from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Calendar, ChevronRight, Plus, X, MessageSquare, Trophy, Target, Activity, CheckCircle, User as UserIcon, History } from 'lucide-react';
import LedgerGameSelectorModal from '../LedgerGameSelectorModal';
import { AppInput, AppButton } from '../ui/CommonUI';
import { Game } from '../../types';
import { LedgerEntry } from '../../utils/ledgerStats';

export type LedgerResultType = 'win' | 'loss';

export interface LedgerEntryFormModalProps {
    formData: Partial<LedgerEntry>;
    setFormData: React.Dispatch<React.SetStateAction<Partial<LedgerEntry>>>;
    /** 關閉彈窗（原本就是 LedgerPage 的 setShowAddModal，這裡只會以 false 呼叫） */
    setShowAddModal: React.Dispatch<React.SetStateAction<boolean>>;
    setShowDatePicker: React.Dispatch<React.SetStateAction<boolean>>;
    isSelectingGame: boolean;
    setIsSelectingGame: React.Dispatch<React.SetStateAction<boolean>>;
    resultType: LedgerResultType;
    setResultType: React.Dispatch<React.SetStateAction<LedgerResultType>>;
    isEditing: boolean;
    saving: boolean;
    handleSave: () => void | Promise<void>;
    confirmDelete: (entryId?: string, createdAt?: number) => void;
    handleGameSelect: (game: Game) => void;
}

const LedgerEntryFormModal: React.FC<LedgerEntryFormModalProps> = ({
    formData,
    setFormData,
    setShowAddModal,
    setShowDatePicker,
    isSelectingGame,
    setIsSelectingGame,
    resultType,
    setResultType,
    isEditing,
    saving,
    handleSave,
    confirmDelete,
    handleGameSelect,
}) => {
    return (
        <>
            {createPortal(
                <div className="fixed inset-0 z-[200] flex flex-col bg-[#f9f9f7] animate-fade-in overflow-hidden">
                    {/* Modal Header - Matches Minimal Lux style */}
                    <div className="flex-shrink-0 bg-white/80 backdrop-blur-md border-b border-black/[0.03] pt-safe z-30 relative">
                        <div className="h-16 px-4 max-w-7xl mx-auto flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => setShowAddModal(false)}
                                    className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-neutral-400 hover:text-neutral-900 border border-black/[0.01] shadow-sm active:scale-90 transition-all"
                                >
                                    <X size="1.25rem" strokeWidth={2.5} />
                                </button>
                                <div>
                                    <div className="flex items-center gap-2 text-[#c5a059] text-[0.625rem] font-black uppercase tracking-[0.3em] mb-0.5">
                                        <span>紀錄更新</span>
                                    </div>
                                    <h2 className="text-base font-black text-neutral-900 tracking-tight uppercase">
                                        {formData.ledgerId ? '修改紀錄' : '建立新紀錄'}
                                    </h2>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Modal Body - Scrollable */}
                    <div className="flex-1 overflow-y-auto relative z-10 px-4 pt-5 pb-SafeBottom">
                        <div className="max-w-2xl mx-auto space-y-4">
                            {/* Section: Basic Info */}
                            <section className="bg-white border border-black/[0.04] rounded-lg p-5 shadow-sm">
                                <div className="flex items-center gap-2 mb-5 text-[#c5a059]">
                                    <Plus size="1rem" strokeWidth={3} />
                                    <span className="text-[0.625rem] font-black uppercase tracking-[0.2em]">紀錄基礎設定</span>
                                </div>

                                {/* Quick Action: Import from Game */}
                                <button
                                    onClick={() => setIsSelectingGame(true)}
                                    className="w-full flex items-center gap-4 bg-neutral-50/50 border border-black/[0.03] rounded-lg p-3.5 mb-5 hover:bg-neutral-50 transition-all group active:scale-[0.99]"
                                >
                                    <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center text-[#c5a059] group-hover:scale-105 transition-transform shadow-sm border border-black/[0.03]">
                                        <History size="1.375rem" strokeWidth={2.5} />
                                    </div>
                                    <div className="text-left flex-1">
                                        <p className="text-sm font-black text-neutral-900 uppercase tracking-tight">同步歷史團局</p>
                                        <p className="text-[0.6875rem] text-neutral-400 font-medium">自動從歷史紀錄中填入底台、日期與成員。</p>
                                    </div>
                                    <ChevronRight size="1.25rem" className="text-neutral-200 group-hover:text-[#c5a059] transition-colors" />
                                </button>

                                <div className="space-y-3">
                                    {/* 紀錄日期 - 使用自定義 DatePicker */}
                                    <div className="space-y-1.5">
                                        <label className="block text-[0.5625rem] font-black text-neutral-400 uppercase tracking-[0.2em] ml-1">紀錄日期</label>
                                        <div
                                            className="relative bg-neutral-50/50 border border-black/[0.03] rounded-lg h-[2.75rem] px-4 flex items-center cursor-pointer transition-all hover:bg-white hover:border-[#c5a059]/40 active:scale-[0.99]"
                                            onClick={() => setShowDatePicker(true)}
                                        >
                                            <Calendar size="1.125rem" className="text-neutral-300 mr-3" strokeWidth={2.5} />
                                            <span className="text-[0.875rem] font-bold text-neutral-900">
                                                {(() => {
                                                    if (!formData.date) return '選擇日期';
                                                    const d = new Date(formData.date);
                                                    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
                                                })()}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <AppInput
                                            label="底台底注"
                                            placeholder="例如: 30/10"
                                            icon={Target}
                                            value={formData.stakes}
                                            onChange={(e) => setFormData({ ...formData, stakes: e.target.value })}
                                        />
                                        <AppInput
                                            label="圈數"
                                            type="number"
                                            placeholder="3"
                                            icon={Activity}
                                            value={formData.rounds || ''}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                setFormData({ ...formData, rounds: isNaN(val) ? undefined : val });
                                            }}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Section: Result */}
                            <section className={`transition-all duration-300 rounded-lg p-5 relative overflow-hidden border shadow-sm ${resultType === 'win' ? 'bg-emerald-50/80 border-emerald-100' : 'bg-orange-50/80 border-orange-100'}`}>
                                {/* 裝飾圖示 - 設定 pointer-events-none 避免遮擋點擊 */}
                                <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
                                    <Trophy size="7.5rem" className={resultType === 'win' ? 'text-emerald-500' : 'text-orange-500'} />
                                </div>

                                <div className="flex items-center justify-between mb-5 relative z-10">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${resultType === 'win' ? 'bg-white text-emerald-500' : 'bg-white text-orange-500'}`}>
                                            <Trophy size="1.375rem" />
                                        </div>
                                        <div>
                                            <span className="text-[0.6875rem] font-black uppercase tracking-[0.25em] text-neutral-400 block mb-1">結算狀態</span>
                                            <h3 className="text-base font-black text-neutral-900 uppercase tracking-widest">損益統計</h3>
                                        </div>
                                    </div>

                                    {/* Win/Loss Toggle */}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setResultType('win')}
                                            className={`px-5 py-2.5 text-[0.6875rem] font-black uppercase tracking-widest transition-all active:scale-95 ${resultType === 'win'
                                                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                                : 'bg-white/60 text-emerald-600 border border-emerald-200 hover:bg-emerald-50'}`}
                                        >
                                            獲利
                                        </button>
                                        <button
                                            onClick={() => setResultType('loss')}
                                            className={`px-5 py-2.5 text-[0.6875rem] font-black uppercase tracking-widest transition-all active:scale-95 ${resultType === 'loss'
                                                ? 'bg-red-500 text-white shadow-lg shadow-red-500/20'
                                                : 'bg-white/60 text-red-500 border border-red-200 hover:bg-red-50'}`}
                                        >
                                            虧損
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-8">
                                    <div className="space-y-2">
                                        <label className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">遊戲點數</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={formData.winLoss === undefined ? '' : Math.abs(formData.winLoss)}
                                                onChange={(e) => setFormData({ ...formData, winLoss: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                                                className={`w-full bg-white border border-black/[0.04] py-4 px-5 text-xl font-black outline-none transition-all focus:border-neutral-900/10 ${resultType === 'win' ? 'text-emerald-500' : 'text-orange-500'}`}
                                                placeholder="0"
                                            />
                                            <div className="absolute right-5 top-1/2 -translate-y-1/2 text-[0.5625rem] font-black text-neutral-200 tracking-widest uppercase">點</div>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest ml-1">實際金額</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={formData.actualAmount === undefined ? '' : Math.abs(formData.actualAmount)}
                                                onChange={(e) => setFormData({ ...formData, actualAmount: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                                                className={`w-full bg-white border border-black/[0.04] py-4 px-5 text-xl font-black outline-none transition-all focus:border-neutral-900/10 ${resultType === 'win' ? 'text-emerald-500' : 'text-orange-500'}`}
                                                placeholder="0"
                                            />
                                            <div className="absolute right-5 top-1/2 -translate-y-1/2 text-[0.5625rem] font-black text-neutral-200 tracking-widest uppercase">元</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Dynamic Preview */}
                                <div className="p-5 flex items-center justify-between transition-colors bg-white/40 border border-black/[0.04]">
                                    <span className="text-[0.625rem] font-black text-neutral-400 uppercase tracking-widest">紀錄預覽</span>
                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <p className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest mb-1">遊戲總額</p>
                                            <p className={`text-base font-black tracking-tight ${resultType === 'win' ? 'text-emerald-500' : 'text-orange-500'}`}>
                                                {resultType === 'win' ? '+' : '-'}{Math.abs(formData.winLoss || 0)}
                                            </p>
                                        </div>
                                        <div className="w-[0.0938rem] h-8 bg-black/[0.03]"></div>
                                        <div className="text-right">
                                            <p className="text-[0.5625rem] font-black text-neutral-300 uppercase tracking-widest mb-1">實際盈虧</p>
                                            <p className={`text-base font-black tracking-tight ${resultType === 'win' ? 'text-emerald-500' : 'text-orange-500'}`}>
                                                {resultType === 'win' ? '+' : '-'}{Math.abs(formData.actualAmount || 0)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* Section: Opponents */}
                            <section className="bg-white border border-black/[0.04] rounded-lg p-5 shadow-sm">
                                <div className="flex items-center gap-2 mb-4 text-[#c5a059]">
                                    <UserIcon size="0.875rem" strokeWidth={3} />
                                    <span className="text-[0.625rem] font-black uppercase tracking-[0.2em]">成員名單</span>
                                </div>
                                <div className="space-y-2.5">
                                    {[0, 1, 2].map(i => (
                                        <div key={i} className="group flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-neutral-50 border border-neutral-100 flex items-center justify-center text-neutral-400 text-[0.6875rem] font-black group-focus-within:border-[#c5a059]/50 group-focus-within:text-[#c5a059] transition-all">
                                                0{i + 1}
                                            </div>
                                            <div className="relative flex-1">
                                                <AppInput
                                                    placeholder="輸入對手名稱..."
                                                    value={formData.opponents?.[i]?.name || ''}
                                                    onChange={(e) => {
                                                        const newOpps = [...(formData.opponents || [{ name: '' }, { name: '' }, { name: '' }])];
                                                        newOpps[i] = { ...newOpps[i], name: e.target.value };
                                                        setFormData({ ...formData, opponents: newOpps });
                                                    }}
                                                />
                                                <button className="absolute right-5 top-1/2 -translate-y-1/2 text-neutral-200 hover:text-[#c5a059] transition-colors z-10">
                                                    <History size="1.125rem" strokeWidth={2.5} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* Section: Note */}
                            <section className="bg-white border border-black/[0.04] rounded-lg p-5 shadow-sm">
                                <div className="flex items-center gap-2 mb-4 text-[#c5a059]">
                                    <MessageSquare size="1rem" strokeWidth={3} />
                                    <span className="text-[0.625rem] font-black uppercase tracking-[0.2em]">備註內容</span>
                                </div>
                                <AppInput
                                    label="戰局備註"
                                    placeholder="這場戰局發生了什麼有趣的事？"
                                    icon={MessageSquare}
                                    value={formData.note}
                                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                                    isTextArea
                                    rows={5}
                                />
                            </section>

                            {/* Form Footer */}
                            <div className="pt-8 pb-SafeBottom space-y-5">
                                <div className="pt-4 flex flex-col gap-3">
                                    <AppButton
                                        onClick={handleSave}
                                        isLoading={saving}
                                        icon={CheckCircle}
                                        className="w-full"
                                    >
                                        確認儲存紀錄
                                    </AppButton>
                                    <AppButton
                                        variant="ghost"
                                        onClick={() => setShowAddModal(false)}
                                        className="w-full"
                                    >
                                        取消並返回
                                    </AppButton>
                                </div>

                                {
                                    isEditing && (
                                        <AppButton
                                            onClick={() => confirmDelete(formData.ledgerId, formData.createdAt)}
                                            isLoading={saving}
                                            variant="danger"
                                            icon={Trash2}
                                            className="w-full"
                                        >
                                            刪除這筆紀錄
                                        </AppButton>
                                    )}
                                <p className="text-center text-[0.625rem] text-neutral-300 font-black uppercase tracking-[0.4em] pt-8">REI PRESTIGE DATA • INTERNAL LEDGER v4.1</p>
                            </div>
                        </div>
                    </div>

                    {/* Game Selector Modal */}
                    < LedgerGameSelectorModal
                        isOpen={isSelectingGame}
                        onClose={() => setIsSelectingGame(false)}
                        onSelect={handleGameSelect}
                    />
                </div >,
                document.body
            )}
        </>
    );
};

export default LedgerEntryFormModal;
