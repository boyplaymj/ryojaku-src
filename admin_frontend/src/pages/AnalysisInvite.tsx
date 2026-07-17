import React, { useState, useEffect } from 'react';
import { Gift, TrendingUp, Users, PieChart, BarChart, Loader2, Calendar } from 'lucide-react';
import { api } from '../services/api';
import {
    BarChart as ReChartsBarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    Cell,
    PieChart as ReChartsPieChart,
    Pie
} from 'recharts';

const AnalysisInvite: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const res = await api.analysis.getInvite();
            if (res.success) {
                setData(res.data);
            }
        } catch (error) {
            console.error('Failed to load invite analysis:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-purple-500" size={48} />
            </div>
        );
    }

    const COLORS = ['#A855F7', '#8B5CF6', '#7C3AED', '#6D28D9', '#5B21B6'];

    return (
        <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                        <span className="p-2 bg-gradient-to-br from-purple-500/20 to-indigo-500/20 rounded-xl border border-purple-500/20 text-purple-400">
                            <Gift size={24} />
                        </span>
                        邀請碼成效分析
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium">追蹤用戶邀請行為與獎勵發放統計</p>
                </div>
                <button
                    onClick={loadData}
                    className="px-4 py-2 bg-slate-800/50 border border-white/10 rounded-xl text-slate-300 text-sm font-bold hover:bg-slate-700/50 transition-all flex items-center gap-2 w-fit"
                >
                    <Calendar size={16} />
                    更新數據
                </button>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-6 rounded-2xl">
                    <div className="flex items-center gap-4 mb-4 text-slate-400">
                        <Gift size={20} />
                        <span className="text-sm font-bold uppercase tracking-widest">總邀請註冊數</span>
                    </div>
                    <div className="text-4xl font-black text-white">{data?.totalUsage || 0}</div>
                    <p className="text-slate-500 text-xs mt-2 italic">累積至目前為止的總數</p>
                </div>
                {/* Could add more stats here, like total points awarded etc if backend provided */}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Trend Chart */}
                <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <TrendingUp className="text-cyan-400" size={20} />
                        每日邀請註冊趨勢 (14天)
                    </h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data?.trends}>
                                <defs>
                                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                <XAxis
                                    dataKey="label"
                                    stroke="#64748b"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="#64748b"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: '#0f172a',
                                        border: '1px solid #ffffff10',
                                        borderRadius: '12px',
                                        color: '#fff'
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="count"
                                    stroke="#8B5CF6"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorCount)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Distribution Chart */}
                <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <Users className="text-purple-400" size={20} />
                        邀請人數分布
                    </h3>
                    <div className="h-[300px] flex flex-col md:flex-row items-center">
                        <div className="w-full md:w-1/2 h-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ReChartsPieChart>
                                    <Pie
                                        data={data?.distribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {data?.distribution?.map((entry: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#0f172a',
                                            border: '1px solid #ffffff10',
                                            borderRadius: '12px',
                                            color: '#fff'
                                        }}
                                    />
                                </ReChartsPieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="w-full md:w-1/2 space-y-3 p-4">
                            {data?.distribution?.map((entry: any, index: number) => (
                                <div key={entry.name} className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                        <span className="text-slate-400">{entry.name}</span>
                                    </div>
                                    <span className="text-white font-mono font-bold">{entry.value} 人</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AnalysisInvite;
