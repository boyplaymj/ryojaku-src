import React, { useEffect, useState } from 'react';
import { Users, Gamepad2, TrendingUp, AlertCircle, RefreshCw, UserPlus } from 'lucide-react';
import { api } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DashboardStats {
    users: { total: number; newToday: number; growthRate: number };
    games: {
        total: number;
        active: number;
        recruitingToday: number;
        recruitingYesterday: number;
        fullToday: number;
        fullYesterday: number;
        newToday: number;
    };
    registrations: { total: number; pending: number; accepted: number; acceptanceRate: number };
    trends: Array<{ date: string; value: number }>;
    gamesTrend: Array<{ date: string; label: string; count: number }>;
    regTrend: Array<{ date: string; label: string; total: number; success: number }>;
    trafficTrend: Array<{ date: string; label: string; community: number; games: number }>;
}

const Dashboard: React.FC = () => {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [error, setError] = useState('');

    const fetchStats = async () => {
        try {
            setLoading(true);
            const [statsData, trafficData] = await Promise.all([
                api.dashboard.getStats(),
                api.analysis.getTraffic().catch(() => null)
            ]);

            // Map traffic data to trafficTrend
            // Backend returns trends: [{date: "YYYY-MM-DD", core: N, ...}] with 7 entries
            let newTrafficTrend = [];
            if (trafficData && trafficData.trends) {
                newTrafficTrend = trafficData.trends.map((t: any) => ({
                    date: t.date, // "MM/DD" from backend
                    label: t.date,
                    // Logic: Community = view_posts + view_post_detail. 
                    // Currently backend trends only has category sums. 
                    // Since we haven't implemented other logged actions for community yet, category 'community' is correct sum.
                    // Same for games ~ category 'games'.
                    community: t.community || 0,
                    games: t.games || 0
                }));
            } else {
                // Fallback or empty
                newTrafficTrend = Array.from({ length: 7 }, (_, i) => ({ date: `Day ${i + 1}`, label: `Day ${i + 1}`, community: 0, games: 0 }));
            }

            setStats({
                ...statsData,
                trafficTrend: newTrafficTrend
            });

        } catch (err: any) {
            console.error(err);
            setError('Failed to load dashboard data');
            // Mock data fallback for demonstration if API fails (e.g. not deployed yet)
            setStats({
                users: { total: 1234, newToday: 12, growthRate: 12.5 },
                games: {
                    total: 156,
                    active: 42,
                    recruitingToday: 8,
                    recruitingYesterday: 5,
                    fullToday: 3,
                    fullYesterday: 2,
                    newToday: 11
                },
                registrations: { total: 100, pending: 18, accepted: 12, acceptanceRate: 85.0 },
                trends: Array.from({ length: 7 }, (_, i) => ({ date: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], value: 100 + i * 10 })),
                gamesTrend: Array.from({ length: 7 }, (_, i) => ({ date: `2023-12-${20 + i}`, label: `12/${20 + i}`, count: 5 + i })),
                regTrend: Array.from({ length: 7 }, (_, i) => ({ date: `2023-12-${20 + i}`, label: `12/${20 + i}`, total: 10 + i, success: 7 + i })),
                trafficTrend: Array.from({ length: 7 }, (_, i) => ({ date: `2023-12-${20 + i}`, label: `12/${20 + i}`, community: 100 + i * 20, games: 80 + i * 15 }))
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, []);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <RefreshCw className="animate-spin text-cyan-400" size={32} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-6 md:space-y-8">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                        總覽儀表板
                    </h2>
                    <p className="text-slate-400 mt-1">歡迎回來，Super Admin</p>
                </div>
                <button
                    onClick={fetchStats}
                    className="p-2 bg-slate-800 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition self-end sm:self-auto"
                >
                    <RefreshCw size={20} />
                </button>
            </header>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="grid grid-cols-2 gap-6">
                    <StatCard
                        title="總用戶數"
                        value={stats?.users?.total?.toLocaleString() || '0'}
                        change={stats?.users?.growthRate ? `${stats.users.growthRate > 0 ? '+' : ''}${stats.users.growthRate.toFixed(2)}%` : '0%'}
                        isPositive={(stats?.users?.growthRate || 0) >= 0}
                        icon={<Users className="text-cyan-400" />}
                        color="cyan"
                        compact
                    />
                    <StatCard
                        title="今日新增用戶"
                        value={stats?.users?.newToday || '0'}
                        change="今日"
                        isPositive={true}
                        icon={<UserPlus className="text-emerald-400" />}
                        color="emerald"
                        compact
                    />
                </div>

                {/* Recruiting vs Full Split Card */}
                <div className="lg:col-span-1 glass-panel rounded-2xl p-6 border border-white/10 bg-slate-900/60 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 rounded-xl bg-slate-800/50">
                            <Gamepad2 className="text-emerald-400" />
                        </div>
                        <span className="text-xs font-bold px-2 py-1 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                            即時
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <h3 className="text-slate-400 text-sm font-medium">招募中團局</h3>
                            <div className="text-xl font-bold text-white font-mono mt-1">{stats?.games?.recruitingToday}</div>
                            <p className="text-[10px] text-slate-500 mt-1">昨日: {stats?.games?.recruitingYesterday}</p>
                        </div>
                        <div>
                            <h3 className="text-slate-400 text-sm font-medium">已滿團局</h3>
                            <div className="text-xl font-bold text-white font-mono mt-1">{stats?.games?.fullToday}</div>
                            <p className="text-[10px] text-slate-500 mt-1">昨日: {stats?.games?.fullYesterday}</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <StatCard
                        title="總團局數"
                        value={stats?.games?.total || '0'}
                        change="累計"
                        isPositive={true}
                        icon={<Gamepad2 className="text-indigo-400" />}
                        color="cyan"
                        compact
                    />
                    <StatCard
                        title="今日新團局"
                        value={stats?.games?.newToday || '0'}
                        change="今日"
                        isPositive={true}
                        icon={<TrendingUp className="text-yellow-400" />}
                        color="orange"
                        compact
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StatCard
                    title="待處理報名"
                    value={stats?.registrations?.pending || '0'}
                    subValue="主揪尚未審核"
                    change="待辦"
                    isPositive={stats?.registrations?.pending === 0}
                    icon={<AlertCircle className="text-orange-400" />}
                    color="orange"
                />
                <StatCard
                    title="今日報名點擊"
                    value={stats?.registrations?.accepted || '0'}
                    subValue="今日新增申請"
                    change={`${stats?.registrations?.acceptanceRate?.toFixed(1) || 0}% 接受率`}
                    isPositive={true}
                    icon={<TrendingUp className="text-fuchsia-400" />}
                    color="fuchsia"
                />
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. New User Count (formerly Traffic) */}
                <div className="glass-panel rounded-2xl p-6 flex flex-col h-80">
                    <h3 className="text-lg font-bold text-white mb-4">新增用戶數量 (近7日)</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats?.trends || []}>
                                <defs>
                                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
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
                                <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 2. New Games Trend */}
                <div className="glass-panel rounded-2xl p-6 flex flex-col h-80">
                    <h3 className="text-lg font-bold text-white mb-4">每日創建團局數 (近7日)</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats?.gamesTrend || []}>
                                <defs>
                                    <linearGradient id="colorGames" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                                <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorGames)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* 3. Traffic Analysis Row (Full Width) */}
            <div className="glass-panel rounded-2xl p-6 flex flex-col h-96">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-white">平台流量分析 (分日統計)</h3>
                    <div className="flex gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-cyan-400"></div>
                            <span className="text-xs text-slate-400">社群流量</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-fuchsia-400"></div>
                            <span className="text-xs text-slate-400">團局流量</span>
                        </div>
                    </div>
                </div>
                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats?.trafficTrend || []}>
                            <defs>
                                <linearGradient id="colorComm" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorGamesTraffic" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#d946ef" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#d946ef" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                            <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Area name="社群" type="monotone" dataKey="community" stroke="#22d3ee" strokeWidth={3} fillOpacity={1} fill="url(#colorComm)" />
                            <Area name="團局" type="monotone" dataKey="games" stroke="#d946ef" strokeWidth={3} fillOpacity={1} fill="url(#colorGamesTraffic)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 4. Registration Trend (Attempts vs Success) */}
                <div className="lg:col-span-2 glass-panel rounded-2xl p-6 flex flex-col h-80">
                    <h3 className="text-lg font-bold text-white mb-4">報名趨勢統計 (近7日)</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats?.regTrend || []}>
                                <defs>
                                    <linearGradient id="colorRegTotal" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#d946ef" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#d946ef" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorRegSuccess" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                                <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Area name="報名次數" type="monotone" dataKey="total" stroke="#d946ef" strokeWidth={3} fillOpacity={0.5} fill="url(#colorRegTotal)" />
                                <Area name="成功次數" type="monotone" dataKey="success" stroke="#22d3ee" strokeWidth={3} fillOpacity={0.5} fill="url(#colorRegSuccess)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-panel rounded-2xl p-6 h-80 overflow-y-auto">
                    <h3 className="text-lg font-bold text-white mb-4">系統公告</h3>
                    <div className="space-y-4">
                        <div className="p-4 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                            <span className="text-xs font-mono text-cyan-400">2023-12-25</span>
                            <p className="text-sm text-slate-300 mt-1">系統 v2.0.0 更新完成，新增管理員權限控制模組。</p>
                        </div>
                        <div className="p-4 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                            <span className="text-xs font-mono text-cyan-400">2023-12-24</span>
                            <p className="text-sm text-slate-300 mt-1">伺服器例行維護報告：延遲降低 15%。</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

interface StatCardProps {
    title: string;
    value: string | number;
    subValue?: string;
    change: string;
    isPositive: boolean;
    icon: React.ReactNode;
    color: 'cyan' | 'emerald' | 'fuchsia' | 'orange';
    compact?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subValue, change, isPositive, icon, color, compact }) => {
    const colorStyles: Record<string, string> = {
        cyan: 'bg-cyan-500/10 border-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.15)]',
        emerald: 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.15)]',
        fuchsia: 'bg-fuchsia-500/10 border-fuchsia-500/20 shadow-[0_0_10px_rgba(217,70,239,0.15)]',
        orange: 'bg-orange-500/10 border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.15)]',
    };

    return (
        <div className={`${compact ? 'p-4' : 'p-6'} rounded-2xl border backdrop-blur-md transition hover:scale-[1.02] ${colorStyles[color]} border border-white/10 bg-slate-900/60 flex flex-col justify-between`}>
            <div className={`flex justify-between items-start ${compact ? 'mb-2' : 'mb-4'}`}>
                <div className={`${compact ? 'p-2' : 'p-3'} rounded-xl bg-slate-800/50`}>
                    {icon}
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${isPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                    {change}
                </span>
            </div>
            <div>
                <h3 className="text-slate-400 text-xs font-medium">{title}</h3>
                <div className={`${compact ? 'text-xl' : 'text-2xl'} font-bold text-white font-mono mt-1`}>{value}</div>
                {subValue && <p className="text-[10px] text-slate-500 mt-1">{subValue}</p>}
            </div>
        </div>
    );
};

export default Dashboard;
