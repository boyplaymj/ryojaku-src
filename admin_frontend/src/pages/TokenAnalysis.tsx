import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Shield, ShieldOff, TrendingUp, AlertCircle, RefreshCw, CheckCircle, XCircle } from 'lucide-react';

interface DayStat {
    total: number;
    withToken: number;
    withoutToken: number;
    tokenRate: number;
}

interface EndpointStat {
    endpoint: string;
    total: number;
    withToken: number;
    withoutToken: number;
    tokenRate: number;
}

interface TokenData {
    overview: {
        today: DayStat;
        yesterday: DayStat;
    };
    trends: Array<{
        date: string;
        fullDate: string;
        total: number;
        withToken: number;
        withoutToken: number;
        tokenRate: number;
    }>;
    byEndpoint: EndpointStat[];
}

const TokenAnalysis: React.FC = () => {
    const [data, setData] = useState<TokenData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const res = await api.analysis.getToken();
            setData(res);
        } catch (err: any) {
            console.error(err);
            setError('無法加載 Token 使用統計');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <RefreshCw className="animate-spin text-cyan-400" size={32} />
            </div>
        );
    }
    if (error) return <div className="p-8 text-center text-red-400">{error}</div>;

    const today = data?.overview.today || { total: 0, withToken: 0, withoutToken: 0, tokenRate: 0 };
    const yesterday = data?.overview.yesterday || { total: 0, withToken: 0, withoutToken: 0, tokenRate: 0 };

    // 計算變化率
    const rateChange = today.tokenRate - yesterday.tokenRate;

    // 根據 Token Rate 決定顏色
    const getRateColor = (rate: number) => {
        if (rate >= 80) return 'text-emerald-400';
        if (rate >= 50) return 'text-amber-400';
        return 'text-rose-400';
    };

    return (
        <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-6 md:space-y-8">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                        JWT Token 使用分析
                    </h2>
                    <p className="text-slate-400 mt-1 text-sm md:text-base">
                        追蹤 API 請求的 Token 使用率，了解新版 APP 推廣進度
                    </p>
                </div>
                <button
                    onClick={fetchData}
                    className="self-start md:self-auto px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors flex items-center gap-2"
                >
                    <RefreshCw size={16} />
                    重新整理
                </button>
            </header>

            {/* 概覽卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* 今日請求總數 */}
                <div className="glass-panel p-4 rounded-xl border border-white/10 bg-slate-900/60">
                    <p className="text-xs text-slate-400 font-medium mb-1">今日請求總數</p>
                    <h3 className="text-2xl md:text-3xl font-bold text-white font-mono">
                        {today.total.toLocaleString()}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        昨日: {yesterday.total.toLocaleString()}
                    </p>
                </div>

                {/* 帶 Token 請求 */}
                <div className="glass-panel p-4 rounded-xl border border-white/10 bg-slate-900/60">
                    <div className="flex items-center gap-2 mb-1">
                        <Shield size={14} className="text-emerald-400" />
                        <p className="text-xs text-slate-400 font-medium">帶 Token 請求</p>
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold text-emerald-400 font-mono">
                        {today.withToken.toLocaleString()}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        昨日: {yesterday.withToken.toLocaleString()}
                    </p>
                </div>

                {/* 無 Token 請求 */}
                <div className="glass-panel p-4 rounded-xl border border-white/10 bg-slate-900/60">
                    <div className="flex items-center gap-2 mb-1">
                        <ShieldOff size={14} className="text-rose-400" />
                        <p className="text-xs text-slate-400 font-medium">無 Token 請求</p>
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold text-rose-400 font-mono">
                        {today.withoutToken.toLocaleString()}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        昨日: {yesterday.withoutToken.toLocaleString()}
                    </p>
                </div>

                {/* Token 使用率 */}
                <div className="glass-panel p-4 rounded-xl border border-white/10 bg-slate-900/60">
                    <div className="flex items-center gap-2 mb-1">
                        <TrendingUp size={14} className={getRateColor(today.tokenRate)} />
                        <p className="text-xs text-slate-400 font-medium">Token 使用率</p>
                    </div>
                    <h3 className={`text-2xl md:text-3xl font-bold font-mono ${getRateColor(today.tokenRate)}`}>
                        {today.tokenRate.toFixed(1)}%
                    </h3>
                    <p className={`text-xs mt-1 ${rateChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {rateChange >= 0 ? '+' : ''}{rateChange.toFixed(1)}% vs 昨日
                    </p>
                </div>
            </div>

            {/* Token 使用率目標進度 */}
            <div className="glass-panel p-6 rounded-2xl border border-white/10 bg-slate-900/60">
                <h3 className="text-lg font-bold text-white mb-4">目標進度</h3>
                <div className="space-y-4">
                    {[
                        { label: '第一階段 (開始監控)', target: 0, color: 'bg-cyan-500' },
                        { label: '第二階段 (漸進強制)', target: 50, color: 'bg-amber-500' },
                        { label: '第三階段 (全面強制)', target: 90, color: 'bg-emerald-500' },
                    ].map((phase, idx) => {
                        const isReached = today.tokenRate >= phase.target;
                        return (
                            <div key={idx} className="flex items-center gap-4">
                                {isReached ? (
                                    <CheckCircle size={20} className="text-emerald-400" />
                                ) : (
                                    <XCircle size={20} className="text-slate-600" />
                                )}
                                <div className="flex-1">
                                    <div className="flex justify-between mb-1">
                                        <span className={`text-sm ${isReached ? 'text-white' : 'text-slate-400'}`}>
                                            {phase.label}
                                        </span>
                                        <span className="text-sm text-slate-500">{phase.target}%</span>
                                    </div>
                                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${phase.color} transition-all duration-300`}
                                            style={{ width: `${Math.min(100, (today.tokenRate / phase.target) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Token 使用率趨勢圖 */}
            <div className="glass-panel rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-6">Token 使用率趨勢 (近14日)</h3>
                <div className="w-full h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data?.trends || []}>
                            <defs>
                                <linearGradient id="gradientToken" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
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
                                domain={[0, 100]}
                                tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{
                                    backgroundColor: '#ffffff',
                                    borderColor: '#e2e8f0',
                                    color: '#1e293b',
                                    borderRadius: '8px',
                                    opacity: 1,
                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                                }}
                                itemStyle={{ color: '#1e293b' }}
                                formatter={(value?: number) => [`${(value ?? 0).toFixed(1)}%`, 'Token 使用率']}
                                labelFormatter={(label) => `日期: ${label}`}
                            />
                            <Area
                                type="monotone"
                                dataKey="tokenRate"
                                stroke="#10b981"
                                fill="url(#gradientToken)"
                                strokeWidth={2}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* 按端點統計 */}
            <div className="glass-panel rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-6">今日各端點 Token 使用統計</h3>
                {data?.byEndpoint && data.byEndpoint.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="text-left py-3 px-4 text-slate-400 font-medium">API 端點</th>
                                    <th className="text-right py-3 px-4 text-slate-400 font-medium">總請求</th>
                                    <th className="text-right py-3 px-4 text-slate-400 font-medium">
                                        <span className="flex items-center justify-end gap-1">
                                            <Shield size={14} className="text-emerald-400" />
                                            帶 Token
                                        </span>
                                    </th>
                                    <th className="text-right py-3 px-4 text-slate-400 font-medium">
                                        <span className="flex items-center justify-end gap-1">
                                            <ShieldOff size={14} className="text-rose-400" />
                                            無 Token
                                        </span>
                                    </th>
                                    <th className="text-right py-3 px-4 text-slate-400 font-medium">使用率</th>
                                    <th className="py-3 px-4 text-slate-400 font-medium w-40">進度</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.byEndpoint.map((stat, idx) => (
                                    <tr
                                        key={idx}
                                        className="border-b border-white/5 hover:bg-white/5 transition-colors"
                                    >
                                        <td className="py-3 px-4 font-mono text-cyan-300">
                                            {stat.endpoint}
                                        </td>
                                        <td className="py-3 px-4 text-right text-white font-mono">
                                            {stat.total.toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-right text-emerald-400 font-mono">
                                            {stat.withToken.toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-right text-rose-400 font-mono">
                                            {stat.withoutToken.toLocaleString()}
                                        </td>
                                        <td className={`py-3 px-4 text-right font-mono font-bold ${getRateColor(stat.tokenRate)}`}>
                                            {stat.tokenRate.toFixed(1)}%
                                        </td>
                                        <td className="py-3 px-4">
                                            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-300 ${stat.tokenRate >= 80 ? 'bg-emerald-500' :
                                                        stat.tokenRate >= 50 ? 'bg-amber-500' :
                                                            'bg-rose-500'
                                                        }`}
                                                    style={{ width: `${stat.tokenRate}%` }}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                        <AlertCircle size={48} className="mb-4 opacity-50" />
                        <p className="text-lg">尚無統計數據</p>
                        <p className="text-sm mt-2">請等待 API 開始記錄 Token 使用情況</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TokenAnalysis;
