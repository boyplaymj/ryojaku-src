import React from 'react';
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell
} from 'recharts';
import { BookOpen, Users, Link, Activity, RefreshCw, Smile, Meh, Frown } from 'lucide-react';
import { api } from '../services/api';

const COLORS = ['#10b981', '#64748b', '#ef4444']; // emerald, slate, red (for moods)
const INTEGRATION_COLORS = ['#f43f5e', '#ec4899']; // rose, pink

const AnalysisLedger: React.FC = () => {
    const [data, setData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const fetch = async () => {
            try {
                const res = await api.analysis.getLedger();
                setData(res);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, []);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <RefreshCw className="animate-spin text-cyan-400" size={32} />
            </div>
        );
    }

    const integrationDistribution = [
        { name: '關聯團局', value: data?.integratedCount || 0 },
        { name: '手動輸入', value: data?.manualCount || 0 },
    ];

    const moodStats = data?.moodStats || [];

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                    麻將計帳簿深度分析
                </h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">監控計帳使用頻率、系統整合度與用戶回饋</p>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    icon={<BookOpen />}
                    title="總記帳筆數"
                    value={data?.totalEntries || 0}
                    sub="所有用戶累積"
                    color="rose"
                />
                <StatCard
                    icon={<Users />}
                    title="記帳使用人數"
                    value={data?.uniqueUsers || 0}
                    sub="至少有一筆記錄的用戶"
                    color="pink"
                />
                <StatCard
                    icon={<Link />}
                    title="團局整合比例"
                    value={`${data?.integrationRatio?.toFixed(1) || 0}%`}
                    sub={`已結算團局: ${data?.completedGames || 0}`}
                    color="amber"
                />
                <StatCard
                    icon={<Activity />}
                    title="今日計帳流量"
                    value={data?.todayTraffic || 0}
                    sub="API 請求次數 (Hits)"
                    color="emerald"
                />
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Growth Trend */}
                <div className="glass-panel p-6 rounded-2xl h-[450px]">
                    <h3 className="text-lg font-bold text-white mb-6">計帳增長趨勢 (近14日)</h3>
                    <ResponsiveContainer width="100%" height={320}>
                        <AreaChart data={data?.trends || []}>
                            <defs>
                                <linearGradient id="gradientLedger" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                            <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="count"
                                name="新增記錄"
                                stroke="#f43f5e"
                                fillOpacity={1}
                                fill="url(#gradientLedger)"
                                strokeWidth={3}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Integration vs Manual */}
                <div className="glass-panel p-6 rounded-2xl h-[450px] flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6">記帳來源分佈</h3>
                    <div className="flex-1 flex flex-col md:flex-row items-center justify-around">
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={integrationDistribution}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={70}
                                    outerRadius={90}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {integrationDistribution.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={INTEGRATION_COLORS[index % INTEGRATION_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>

                        <div className="w-full md:w-1/3 space-y-4">
                            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                                <p className="text-slate-400 text-xs mb-1">團局關聯總數</p>
                                <p className="text-xl font-bold text-white">{data?.integratedCount || 0}</p>
                            </div>
                            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                                <p className="text-slate-400 text-xs mb-1">手動輸入總數</p>
                                <p className="text-xl font-bold text-white">{data?.manualCount || 0}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">
                {/* Mood Distribution */}
                <div className="glass-panel p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">用戶心情回饋分佈</h3>
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={moodStats}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={70}
                                    paddingAngle={8}
                                    dataKey="value"
                                >
                                    {moodStats.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Performance Summary */}
                <div className="lg:col-span-2 glass-panel p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">記帳行為特徵分析</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-6">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                    <Smile size={24} />
                                </div>
                                <div>
                                    <p className="text-slate-400 text-xs">最常見心情</p>
                                    <p className="text-lg font-bold text-white">
                                        {moodStats.reduce((prev: any, current: any) => (prev.value > current.value) ? prev : current, moodStats[0] || {}).name || '無數據'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400">
                                    <Link size={24} />
                                </div>
                                <div>
                                    <p className="text-slate-400 text-xs">系統依賴度</p>
                                    <p className="text-lg font-bold text-white">
                                        {data?.integrationRatio > 70 ? '極高' : data?.integrationRatio > 40 ? '中等' : '偏低'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-800/50 rounded-2xl p-6 border border-white/5 flex flex-col justify-center">
                            <p className="text-slate-400 text-sm mb-4 italic">「記帳功能目前與團局系統的整合率為 {data?.integrationRatio?.toFixed(1) || 0}%，顯示用戶傾向於在完成實體牌局後使用此功能記錄戰果。」</p>
                            <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-rose-500 to-pink-500"
                                    style={{ width: `${data?.integrationRatio || 0}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

interface StatCardProps {
    icon: React.ReactElement;
    title: string;
    value: string | number;
    sub: string;
    color: 'rose' | 'pink' | 'amber' | 'emerald';
}

const StatCard: React.FC<StatCardProps> = ({ icon, title, value, sub, color }) => {
    const colorClasses: Record<string, string> = {
        rose: "text-rose-400 bg-rose-500/10",
        pink: "text-pink-400 bg-pink-500/10",
        amber: "text-amber-400 bg-amber-500/10",
        emerald: "text-emerald-400 bg-emerald-500/10"
    };

    return (
        <div className="glass-panel p-6 rounded-2xl border border-white/5 bg-slate-900/40">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
                    {React.cloneElement(icon as any, { size: 24 })}
                </div>
                <div>
                    <p className="text-slate-400 text-sm font-medium">{title}</p>
                    <h3 className="text-2xl font-black text-white mt-1">{value}</h3>
                    <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">{sub}</p>
                </div>
            </div>
        </div>
    );
};

export default AnalysisLedger;
