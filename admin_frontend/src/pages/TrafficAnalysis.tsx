import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Activity, MessageSquare, Gamepad2, Users, Layers, AlertCircle, RefreshCw } from 'lucide-react';

interface TrafficData {
    totalHits: number;
    categoryDistribution: Array<{ name: string; value: number }>;
    actionBreakdown: Record<string, Array<{ name: string; value: number }>>;
    trends: Array<{ date: string;[key: string]: string | number }>;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];
const CAT_COLORS: Record<string, string> = {
    'core': '#3b82f6', // blue-500
    'games': '#10b981', // emerald-500
    'community': '#f59e0b', // amber-500
    'chat': '#ec4899', // pink-500
    'user': '#8b5cf6', // violet-500
    'ledger': '#f43f5e', // rose-500
};

const TrafficAnalysis: React.FC = () => {
    const [data, setData] = useState<TrafficData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchTraffic();
    }, []);

    const fetchTraffic = async () => {
        try {
            setLoading(true);
            const res = await api.analysis.getTraffic();
            setData(res);
        } catch (err: any) {
            console.error(err);
            setError('無法加載流量數據');
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

    // Helper to get today's count for a category (from trends last entry)
    const getTodayCount = (category: string) => {
        if (!data?.trends || data.trends.length === 0) return 0;
        const todayStats = data.trends[data.trends.length - 1]; // Last item is today/latest
        return (todayStats[category] as number) || 0;
    };

    const categories = [
        { key: 'core', label: '核心系統', icon: <Layers size={20} /> },
        { key: 'games', label: '牌局系統', icon: <Gamepad2 size={20} /> },
        { key: 'community', label: '社群互動', icon: <MessageSquare size={20} /> },
        { key: 'chat', label: '即時通訊', icon: <Users size={20} /> },
        { key: 'user', label: '用戶中心', icon: <Activity size={20} /> },
        { key: 'ledger', label: '麻將計帳', icon: <Layers size={20} /> },
    ];

    return (
        <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-6 md:space-y-8">
            <header>
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                    流量深度分析
                </h2>
                <p className="text-slate-400 mt-1 text-sm md:text-base">即時監控系統各模組 API 請求量與趨勢</p>
            </header>

            {/* Top Cards: Today's Traffic per Category */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
                {categories.map((cat) => (
                    <div key={cat.key} className="glass-panel p-3 md:p-4 rounded-xl border border-white/10 bg-slate-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] md:text-xs text-slate-400 font-medium mb-1">{cat.label}</p>
                            <h3 className="text-xl md:text-2xl font-bold text-white font-mono">{getTodayCount(cat.key).toLocaleString()}</h3>
                        </div>
                        <div className={`p-2 md:p-3 rounded-lg bg-opacity-10 text-white self-end sm:self-auto`} style={{ backgroundColor: `${CAT_COLORS[cat.key]}20`, color: CAT_COLORS[cat.key] }}>
                            {React.cloneElement(cat.icon as React.ReactElement<any>, { size: 18 })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Trend Chart: 7 Day Trend for Each Category */}
            <div className="glass-panel rounded-2xl p-6 h-96">
                <h3 className="text-lg font-bold text-white mb-6">各分類流量趨勢 (近7日)</h3>
                <div className="w-full h-full min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data?.trends || []}>
                            <defs>
                                <linearGradient id="gradientCore" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CAT_COLORS['core']} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={CAT_COLORS['core']} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Legend />
                            {categories.map(cat => (
                                <Area
                                    key={cat.key}
                                    type="monotone"
                                    dataKey={cat.key}
                                    name={cat.label}
                                    stroke={CAT_COLORS[cat.key]}
                                    fillOpacity={0.1}
                                    fill={CAT_COLORS[cat.key]}
                                    strokeWidth={2}
                                />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Pie Charts: Action Breakdown for Each Category */}
            <h3 className="text-xl font-bold text-white mt-8 mb-4">分類細項分析 (動作分佈)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.map((cat) => {
                    const actions = data?.actionBreakdown[cat.key] || [];
                    const total = actions.reduce((sum, item) => sum + item.value, 0);

                    return (
                        <div key={cat.key} className="glass-panel p-6 rounded-2xl border border-white/10 bg-slate-900/60 flex flex-col items-center">
                            <h4 className="text-md font-bold text-slate-200 mb-4 w-full flex items-center gap-2">
                                <span className="w-2 h-6 rounded-r bg-cyan-500/50"></span>
                                {cat.label}
                            </h4>

                            {actions.length > 0 ? (
                                <div className="w-full h-64 relative">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={actions}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                            >
                                                {actions.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(value?: number) => [`${(value || 0)} (${(((value || 0) / total) * 100).toFixed(1)}%)`, '數量']}
                                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                itemStyle={{ color: '#1e293b' }}
                                            />
                                            <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '12px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    {/* Center Text */}
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                        <span className="text-2xl font-bold text-white">{total.toLocaleString()}</span>
                                        <span className="text-xs text-slate-400">Total</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center text-slate-500">
                                    <AlertCircle size={32} className="mb-2 opacity-50" />
                                    <span className="text-sm">無數據</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TrafficAnalysis;
