import React, { useState, useEffect } from 'react';
import { Ticket, Plus, Download, Loader2, ChevronRight, Search, FileText } from 'lucide-react';
import { api } from '../services/api';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    BarChart, Bar
} from 'recharts';

// Colors similar to config.js
const COLORS = ['#4CAF50', '#9E9E9E', '#FF8042', '#0088FE'];
const CHART_COLORS = ['#667eea', '#764ba2', '#f093fb', '#4facfe'];

interface VoucherStats {
    totalCodes: number;
    unusedCodes: number;
    usedCodes: number;
    totalPoints: number;
    pointsDistribution: { points: number; count: number }[];
}

interface Batch {
    batchId: string;
    points: number;
    quantity: number;
    usedCount: number;
    createdAt: string;
    createdBy?: string;
}

const Vouchers: React.FC = () => {
    const [stats, setStats] = useState<VoucherStats | null>(null);
    const [trendData, setTrendData] = useState<{ dates: string[]; counts: number[] } | null>(null);
    const [batches, setBatches] = useState<Batch[]>([]);
    const [loading, setLoading] = useState(true);
    const [showGenerateModal, setShowGenerateModal] = useState(false);

    // Form state
    const [generateForm, setGenerateForm] = useState({
        quantity: 100,
        points: 500,
        createdBy: 'Admin'
    });
    const [isGenerating, setIsGenerating] = useState(false);

    const loadData = async () => {
        try {
            setLoading(true);
            const [statsData, trend, batchList] = await Promise.all([
                api.vouchers.getStats(),
                api.vouchers.getUsageTrend(30),
                api.vouchers.getBatches(50)
            ]);
            setStats(statsData);
            setTrendData(trend);
            setBatches(batchList);
        } catch (error) {
            console.error('Failed to load voucher data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleGenerate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsGenerating(true);
            const result = await api.vouchers.generate(generateForm);
            alert(`成功產生 ${result.quantity} 個序號 (批次 ID: ${result.batchId})`);
            setShowGenerateModal(false);
            loadData(); // Refresh
        } catch (error: any) {
            alert('產生失敗: ' + error.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const downloadBatch = (batchId: string) => {
        const url = api.vouchers.getDownloadUrl(batchId);
        window.open(url, '_blank');
    };

    // Prepare chart data
    const statusData = stats ? [
        { name: '未使用', value: stats.unusedCodes },
        { name: '已使用', value: stats.usedCodes }
    ] : [];

    const trendChartData = trendData ? trendData.dates.map((date, i) => ({
        date,
        count: trendData.counts[i]
    })) : [];

    const pointsData = stats?.pointsDistribution ? stats.pointsDistribution.map(d => ({
        name: `${d.points} 點`,
        count: d.count
    })) : [];

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
                        <span className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl border border-cyan-500/20 text-cyan-400">
                            <Ticket size={24} />
                        </span>
                        序號管理
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium text-sm md:text-base">管理與追蹤兌換碼使用狀況</p>
                </div>
                <button
                    onClick={() => setShowGenerateModal(true)}
                    className="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-5 py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:scale-105 flex items-center justify-center gap-2"
                >
                    <Plus size={20} />
                    產生新序號
                </button>
            </div>

            {/* Metrics */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-cyan-500/30 transition-colors">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Ticket size={80} />
                        </div>
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">總序號數</h3>
                        <p className="text-3xl font-black text-white">{stats.totalCodes.toLocaleString()}</p>
                    </div>
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Ticket size={80} />
                        </div>
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">未使用</h3>
                        <p className="text-3xl font-black text-emerald-400">{stats.unusedCodes.toLocaleString()}</p>
                        <p className="text-xs text-emerald-500/70 font-mono mt-1">
                            {((stats.unusedCodes / stats.totalCodes) * 100).toFixed(1)}% available
                        </p>
                    </div>
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-500/30 transition-colors">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <FileText size={80} />
                        </div>
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">已使用</h3>
                        <p className="text-3xl font-black text-slate-200">{stats.usedCodes.toLocaleString()}</p>
                        <p className="text-xs text-slate-500 font-mono mt-1">
                            {((stats.usedCodes / stats.totalCodes) * 100).toFixed(1)}% redeemed
                        </p>
                    </div>
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-purple-500/30 transition-colors">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Ticket size={80} />
                        </div>
                        <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">總點數價值</h3>
                        <p className="text-3xl font-black text-purple-400">{stats.totalPoints.toLocaleString()}</p>
                    </div>
                </div>
            )}

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Status Distribution */}
                <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <span className="w-1 h-6 bg-cyan-500 rounded-full"></span>
                        序號狀態分佈
                    </h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={statusData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    fill="#8884d8"
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {statusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Usage Trend */}
                <div className="lg:col-span-2 bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                        30天使用趨勢
                    </h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trendChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis
                                    dataKey="date"
                                    stroke="#94a3b8"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="#94a3b8"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="count"
                                    stroke="#4ECDC4"
                                    strokeWidth={3}
                                    dot={{ r: 4, fill: '#1e293b', strokeWidth: 2 }}
                                    activeDot={{ r: 6 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Points Distribution */}
                <div className="lg:col-span-3 bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <span className="w-1 h-6 bg-purple-500 rounded-full"></span>
                        點數面額分佈
                    </h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={pointsData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} axisLine={false} tickLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} axisLine={false} tickLine={false} />
                                <Tooltip
                                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Bar dataKey="count" fill="#FF6B6B" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Batch List */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-white/5 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="w-1 h-6 bg-emerald-500 rounded-full"></span>
                        批次列表
                    </h3>
                    <div className="flex gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                            <input
                                type="text"
                                placeholder="搜尋批次ID..."
                                className="bg-slate-950/50 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors w-64"
                            />
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px]">
                        <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase font-bold tracking-wider">
                            <tr>
                                <th className="px-6 py-4 text-left">批次 ID</th>
                                <th className="px-6 py-4 text-right">面額</th>
                                <th className="px-6 py-4 text-right">數量</th>
                                <th className="px-6 py-4 text-right">已使用</th>
                                <th className="px-6 py-4">使用率</th>
                                <th className="px-6 py-4 text-left">創建時間</th>
                                <th className="px-6 py-4 text-left">創建者</th>
                                <th className="px-6 py-4 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {batches.map((batch, i) => {
                                const usageRate = batch.quantity > 0 ? (batch.usedCount / batch.quantity) * 100 : 0;
                                return (
                                    <tr key={batch.batchId || i} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4 font-mono text-cyan-400 text-sm">
                                            {batch.batchId ? `${batch.batchId.substring(0, 8)}...` : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 text-right text-white font-medium">
                                            {batch.points?.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-right text-slate-300">
                                            {batch.quantity?.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-right text-slate-300">
                                            {batch.usedCount?.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                                <div
                                                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full"
                                                    style={{ width: `${usageRate}%` }}
                                                />
                                            </div>
                                            <p className="text-[10px] text-right mt-1 text-slate-500">{usageRate.toFixed(1)}%</p>
                                        </td>
                                        <td className="px-6 py-4 text-slate-400 text-sm">
                                            {new Date(batch.createdAt).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-slate-400 text-sm">
                                            {batch.createdBy || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => downloadBatch(batch.batchId)}
                                                className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 p-2 rounded-lg transition-all"
                                                title="下載 CSV"
                                            >
                                                <Download size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Generate Modal */}
            {showGenerateModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-slate-950/50">
                            <h3 className="text-xl font-bold text-white">產生新序號</h3>
                            <button
                                onClick={() => setShowGenerateModal(false)}
                                className="text-slate-400 hover:text-white transition-colors hover:bg-white/10 p-2 rounded-lg"
                            >
                                <ChevronRight size={24} className="rotate-90" />
                            </button>
                        </div>
                        <form onSubmit={handleGenerate} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">產生數量 (1-10000)</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="10000"
                                    required
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                    value={generateForm.quantity}
                                    onChange={e => setGenerateForm({ ...generateForm, quantity: parseInt(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">每組點數</label>
                                <input
                                    type="number"
                                    min="1"
                                    required
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                    value={generateForm.points}
                                    onChange={e => setGenerateForm({ ...generateForm, points: parseInt(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">創建者</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                    value={generateForm.createdBy}
                                    onChange={e => setGenerateForm({ ...generateForm, createdBy: e.target.value })}
                                />
                            </div>
                            <div className="pt-4">
                                <button
                                    type="submit"
                                    disabled={isGenerating}
                                    className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] flex justify-center items-center gap-2"
                                >
                                    {isGenerating ? <Loader2 className="animate-spin" /> : '確認產生'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Vouchers;
