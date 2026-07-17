import React, { useState, useEffect } from 'react';
import { Gamepad2, Plus, Loader2, Play, Pause, Trash2, Eye, X, ChevronRight } from 'lucide-react';
import { api } from '../services/api';

interface CommandStats {
    totalCommands: number;
    activeCommands: number;
    totalCodes: number;
    usedCodes: number;
}

interface Command {
    commandId: string;
    command: string;
    codeCount: number;
    usedCount: number;
    points: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
    createdBy: string;
}

interface Redemption {
    displayName: string;
    codeId: string;
    points: number;
    redeemedAt: string;
}

const EventCommands: React.FC = () => {
    const [stats, setStats] = useState<CommandStats | null>(null);
    const [commands, setCommands] = useState<Command[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Redemption Modal
    const [showRedemptionModal, setShowRedemptionModal] = useState(false);
    const [redemptions, setRedemptions] = useState<Redemption[]>([]);
    const [loadingRedemptions, setLoadingRedemptions] = useState(false);

    const [form, setForm] = useState({
        command: '',
        codeCount: 100,
        points: 500,
        startTime: '',
        endTime: '',
        createdBy: 'Admin'
    });

    const loadData = async () => {
        try {
            setLoading(true);
            const [statsData, commandsList] = await Promise.all([
                api.eventCommands.getStats(),
                api.eventCommands.list()
            ]);
            setStats(statsData);
            setCommands(commandsList);
        } catch (error) {
            console.error('Failed to load event commands:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (new Date(form.endTime) <= new Date(form.startTime)) {
                alert('結束時間必須晚於開始時間');
                return;
            }

            setIsSubmitting(true);
            // Convert datetime-local to ISO string
            const data = {
                ...form,
                startTime: new Date(form.startTime).toISOString(),
                endTime: new Date(form.endTime).toISOString()
            };

            await api.eventCommands.create(data);
            alert('活動指令創建成功！');
            setShowCreateModal(false);
            setForm({
                command: '',
                codeCount: 100,
                points: 500,
                startTime: '',
                endTime: '',
                createdBy: 'Admin'
            });
            loadData();
        } catch (error: any) {
            alert('創建失敗: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleStatus = async (commandId: string, isActive: boolean) => {
        if (!confirm(`確定要${isActive ? '啟用' : '停用'}此指令嗎？`)) return;
        try {
            await api.eventCommands.updateStatus(commandId, isActive);
            // Optimistic update or reload
            loadData();
        } catch (error: any) {
            alert('操作失敗: ' + error.message);
        }
    };

    const handleDelete = async (commandId: string) => {
        if (!confirm('確定要刪除此指令嗎？此操作無法復原！')) return;
        try {
            await api.eventCommands.delete(commandId);
            loadData();
        } catch (error: any) {
            alert('刪除失敗: ' + error.message);
        }
    };

    const handleViewRedemptions = async (commandId: string) => {
        try {
            setLoadingRedemptions(true);
            setShowRedemptionModal(true);
            const data = await api.eventCommands.getRedemptions(commandId);
            setRedemptions(data || []);
        } catch (error: any) {
            console.error(error);
            alert('無法載入領取記錄');
        } finally {
            setLoadingRedemptions(false);
        }
    };

    if (loading && !stats) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-cyan-500" size={48} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                        <span className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl border border-purple-500/20 text-purple-400">
                            <Gamepad2 size={24} />
                        </span>
                        活動指令管理
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium text-sm md:text-base">設置聊天室活動指令與獎勵</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-5 py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:scale-105 flex items-center justify-center gap-2"
                >
                    <Plus size={20} />
                    創建新指令
                </button>
            </div>

            {/* Metrics */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-cyan-500/30 transition-colors">
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">總指令數</h3>
                        <p className="text-3xl font-black text-white">{stats.totalCommands}</p>
                    </div>
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">啟用中</h3>
                        <p className="text-3xl font-black text-emerald-400">{stats.activeCommands}</p>
                    </div>
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-purple-500/30 transition-colors">
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">可領取序號</h3>
                        <p className="text-3xl font-black text-purple-400">{stats.totalCodes.toLocaleString()}</p>
                    </div>
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-500/30 transition-colors">
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">已領取</h3>
                        <p className="text-3xl font-black text-slate-200">{stats.usedCodes.toLocaleString()}</p>
                    </div>
                </div>
            )}

            {/* Commands List */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-white/5">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="w-1 h-6 bg-purple-500 rounded-full"></span>
                        指令列表
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px]">
                        <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase font-bold tracking-wider">
                            <tr>
                                <th className="px-6 py-4 text-left">指令</th>
                                <th className="px-6 py-4 text-center">數量 / 進度</th>
                                <th className="px-6 py-4 text-right">面額</th>
                                <th className="px-6 py-4 text-left">時間範圍</th>
                                <th className="px-6 py-4 text-center">狀態</th>
                                <th className="px-6 py-4 text-left">創建者</th>
                                <th className="px-6 py-4 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {commands.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                        目前沒有活動指令
                                    </td>
                                </tr>
                            ) : commands.map((cmd) => {
                                const now = new Date();
                                const start = new Date(cmd.startTime);
                                const end = new Date(cmd.endTime);
                                let statusText = '進行中';
                                let statusColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

                                if (!cmd.isActive) {
                                    statusText = '已停用';
                                    statusColor = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
                                } else if (now < start) {
                                    statusText = '未開始';
                                    statusColor = 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
                                } else if (now > end) {
                                    statusText = '已結束';
                                    statusColor = 'bg-red-500/10 text-red-400 border-red-500/20';
                                }

                                const progress = cmd.codeCount > 0 ? Math.round((cmd.usedCount / cmd.codeCount) * 100) : 0;

                                return (
                                    <tr key={cmd.commandId} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4 font-bold text-white text-lg">
                                            {cmd.command}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex justify-between text-xs text-slate-400">
                                                    <span>{cmd.usedCount} / {cmd.codeCount}</span>
                                                    <span>{progress}%</span>
                                                </div>
                                                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                                    <div
                                                        className="bg-gradient-to-r from-purple-500 to-pink-500 h-full"
                                                        style={{ width: `${progress}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right text-cyan-400 font-bold">
                                            {cmd.points}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-400">
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-emerald-400/80">Start: {start.toLocaleString()}</span>
                                                <span className="text-red-400/80">End: {end.toLocaleString()}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={`text-xs px-2 py-1 rounded-md border ${statusColor}`}>
                                                {statusText}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-400 text-sm">
                                            {cmd.createdBy}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleViewRedemptions(cmd.commandId)}
                                                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-lg transition-colors"
                                                    title="查看領取"
                                                >
                                                    <Eye size={16} />
                                                </button>
                                                {cmd.isActive ? (
                                                    <button
                                                        onClick={() => handleToggleStatus(cmd.commandId, false)}
                                                        className="bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 p-2 rounded-lg transition-colors"
                                                        title="停用"
                                                    >
                                                        <Pause size={16} />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleToggleStatus(cmd.commandId, true)}
                                                        className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 p-2 rounded-lg transition-colors"
                                                        title="啟用"
                                                    >
                                                        <Play size={16} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDelete(cmd.commandId)}
                                                    className="bg-red-500/10 hover:bg-red-500/20 text-red-500 p-2 rounded-lg transition-colors"
                                                    title="刪除"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-white/10 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-slate-950/50">
                            <h3 className="text-xl font-bold text-white">創建新活動指令</h3>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="text-slate-400 hover:text-white transition-colors hover:bg-white/10 p-2 rounded-lg"
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleCreate} className="p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-400 mb-1">指令文字 (Command)</label>
                                    <input
                                        type="text" required
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors text-lg font-bold"
                                        placeholder="例如: 新年快樂2025"
                                        value={form.command}
                                        onChange={e => setForm({ ...form, command: e.target.value })}
                                    />
                                    <small className="text-slate-600 block mt-1">使用者輸入此指令即可領取獎勵</small>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">序號數量</label>
                                    <input
                                        type="number" min="1" max="10000" required
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                        value={form.codeCount}
                                        onChange={e => setForm({ ...form, codeCount: parseInt(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">獎勵點數</label>
                                    <input
                                        type="number" min="1" required
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                        value={form.points}
                                        onChange={e => setForm({ ...form, points: parseInt(e.target.value) })}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">開始時間</label>
                                    <input
                                        type="datetime-local" required
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors" // Style input[type="datetime-local"] via css if needed using dark theme
                                        style={{ colorScheme: 'dark' }}
                                        value={form.startTime}
                                        onChange={e => setForm({ ...form, startTime: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">結束時間</label>
                                    <input
                                        type="datetime-local" required
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                        style={{ colorScheme: 'dark' }}
                                        value={form.endTime}
                                        onChange={e => setForm({ ...form, endTime: e.target.value })}
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-400 mb-1">創建者</label>
                                    <input
                                        type="text" required
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                        value={form.createdBy}
                                        onChange={e => setForm({ ...form, createdBy: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-8 py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] flex items-center gap-2"
                                >
                                    {isSubmitting ? <Loader2 className="animate-spin" /> : '確認創建指令'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Redemptions Modal */}
            {showRedemptionModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-white/10 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-slate-950/50">
                            <h3 className="text-xl font-bold text-white">領取記錄</h3>
                            <button
                                onClick={() => setShowRedemptionModal(false)}
                                className="text-slate-400 hover:text-white transition-colors hover:bg-white/10 p-2 rounded-lg"
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-0 overflow-y-auto flex-1 custom-scrollbar">
                            {loadingRedemptions ? (
                                <div className="flex justify-center py-12">
                                    <Loader2 className="animate-spin text-cyan-500" size={32} />
                                </div>
                            ) : redemptions.length === 0 ? (
                                <div className="text-center py-12 text-slate-500">
                                    暫無領取記錄
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead className="bg-slate-950/30 sticky top-0 z-10 text-slate-400 text-xs uppercase font-bold tracking-wider backdrop-blur-md">
                                        <tr>
                                            <th className="px-6 py-3 text-left">用戶</th>
                                            <th className="px-6 py-3 text-left">序號</th>
                                            <th className="px-6 py-3 text-right">點數</th>
                                            <th className="px-6 py-3 text-left">領取時間</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {redemptions.map((r, i) => (
                                            <tr key={i} className="hover:bg-white/5">
                                                <td className="px-6 py-3 text-white font-medium">{r.displayName}</td>
                                                <td className="px-6 py-3 font-mono text-xs text-slate-400">{r.codeId}</td>
                                                <td className="px-6 py-3 text-right text-cyan-400">{r.points}</td>
                                                <td className="px-6 py-3 text-slate-500 text-sm">{new Date(r.redeemedAt).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EventCommands;
