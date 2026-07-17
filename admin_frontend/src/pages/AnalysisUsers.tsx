import React from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    AreaChart, Area, BarChart, Bar
} from 'recharts';
import { Users as UsersIcon, UserPlus, Bell, TrendingUp, Smartphone, RefreshCw, AlertTriangle, Wallet } from 'lucide-react';
import { api } from '../services/api';

const AnalysisUsers: React.FC = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [data, setData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const fetch = async () => {
            try {
                const res = await api.analysis.getUsers();
                setData(res);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, []);

    const versionDist = React.useMemo(() => {
        const list = data?.versionDist || [];
        return [...list].sort((a: { name: string }, b: { name: string }) => {
            const v1 = a.name.split('.').map(Number);
            const v2 = b.name.split('.').map(Number);

            for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
                const n1 = v1[i] || 0;
                const n2 = v2[i] || 0;
                if (n1 !== n2) return n1 - n2;
            }
            return 0;
        });
    }, [data?.versionDist]);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <RefreshCw className="animate-spin text-cyan-400" size={32} />
            </div>
        );
    }

    const trends = data?.trends || [];
    const pushStats = data?.pushStats || { count: 0, rate: 0 };
    const pointsFrequency = data?.pointsFrequency || [];
    const lowBalanceHosts = data?.lowBalanceFrequentHosts || [];
    const highPointsUsers = data?.highPointsUsers || [];

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white">用戶深度分析</h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">追蹤活躍度、留存率與增長趨勢</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard icon={<UsersIcon />} title="總註冊用戶" value={data?.totalUsers || 0} sub="真實累計用戶" color="cyan" />
                <StatCard icon={<UserPlus />} title="今日新增" value={trends[trends.length - 1]?.new || 0} sub="及時更新" color="emerald" />
                <StatCard icon={<Bell />} title="開啟推播" value={`${pushStats.count} (${pushStats.rate.toFixed(1)}%)`} sub="接收通知用戶" color="blue" />
                <StatCard icon={<TrendingUp />} title="次日留存" value={`${data?.retention?.day1 || 0}%`} sub="平台平均" color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">活躍用戶趨勢 (簽到)</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={trends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickFormatter={(str) => (str ? str.slice(5) : '')} />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="dau" name="簽到 DAU" stroke="#06b6d4" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">新增用戶分佈</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={trends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickFormatter={(str) => (str ? str.slice(5) : '')} />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Area type="monotone" dataKey="new" name="新增用戶" stroke="#10b981" fill="#10b98120" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Row 2: Potential Demand & High Points Users */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[450px] overflow-y-auto">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
                                <AlertTriangle size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">潛在儲值需求用戶</h3>
                                <p className="text-xs text-slate-400">頻繁開局 (≥10次) 且 點數低水位 (≤360點)</p>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-white/5 text-slate-400 text-sm">
                                    <th className="pb-4 font-medium">用戶暱稱 / ID</th>
                                    <th className="pb-4 font-medium text-center">剩餘點數</th>
                                    <th className="pb-4 font-medium text-center">累計開局</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {lowBalanceHosts.map((user: any) => (
                                    <tr key={user.userId} className="group hover:bg-white/5 transition-colors">
                                        <td className="py-4">
                                            <div className="text-white font-medium">{user.nickname}</div>
                                            <div className="text-xs text-slate-500">{user.userId}</div>
                                        </td>
                                        <td className="py-4 text-center">
                                            <span className={`font-mono font-bold ${user.points <= 120 ? 'text-rose-400' : 'text-amber-400'}`}>
                                                {user.points} 點
                                            </span>
                                        </td>
                                        <td className="py-4 text-center text-slate-300 font-mono">
                                            {user.gamesHosted}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[450px] overflow-y-auto">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                                <Wallet size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">高點數大戶名單</h3>
                                <p className="text-xs text-slate-400">持有餘額 &gt; 5000 點之核心用戶</p>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-white/5 text-slate-400 text-sm">
                                    <th className="pb-4 font-medium">用戶暱稱 / ID</th>
                                    <th className="pb-4 font-medium text-center">剩餘點數</th>
                                    <th className="pb-4 font-medium text-center">累計開局</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {highPointsUsers.map((user: any) => (
                                    <tr key={user.userId} className="group hover:bg-white/5 transition-colors">
                                        <td className="py-4">
                                            <div className="text-white font-medium">{user.nickname}</div>
                                            <div className="text-xs text-slate-500">{user.userId}</div>
                                        </td>
                                        <td className="py-4 text-center">
                                            <span className="font-mono font-bold text-emerald-400">
                                                {user.points} 點
                                            </span>
                                        </td>
                                        <td className="py-4 text-center text-slate-300 font-mono">
                                            {user.gamesHosted}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Full Width Row: Points Distribution Histogram */}
                <div className="col-span-1 lg:col-span-2 bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[450px]">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
                            <Wallet size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-white">點數分佈情況 (精確分佈)</h3>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={pointsFrequency} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                            <XAxis
                                dataKey="points"
                                stroke="#94a3b8"
                                fontSize={12}
                                label={{ value: '點數', position: 'insideBottomRight', offset: -5, fill: '#94a3b8' }}
                            />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                cursor={{ fill: '#ffffff10' }}
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                                labelFormatter={(val) => `點數: ${val}`}
                            />
                            <Bar dataKey="count" name="人數" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Full Width Row: Frontend Version Distribution */}
                <div className="col-span-1 lg:col-span-2 bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[450px]">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-pink-500/10 rounded-lg text-pink-400">
                            <Smartphone size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-white">用戶前端版本分佈</h3>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={versionDist} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                cursor={{ fill: '#ffffff10' }}
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Bar dataKey="value" name="用戶數" fill="#ec4899" radius={[4, 4, 0, 0]} barSize={40} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Full Width Row: Push Device Count Distribution */}
                <div className="col-span-1 lg:col-span-2 bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[450px]">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                            <Bell size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-white">推播裝置數量分佈 (單一用戶)</h3>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={pushStats?.deviceDistribution || []} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis
                                dataKey="deviceCount"
                                stroke="#94a3b8"
                                fontSize={12}
                                label={{ value: '裝置數量', position: 'insideBottomRight', offset: -5, fill: '#94a3b8' }}
                            />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                cursor={{ fill: '#ffffff10' }}
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                                labelFormatter={(val) => `裝置數: ${val}`}
                            />
                            <Bar dataKey="userCount" name="用戶數" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
                        </BarChart>
                    </ResponsiveContainer>
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
    color: 'cyan' | 'emerald' | 'blue' | 'purple';
}

const StatCard: React.FC<StatCardProps> = ({ icon, title, value, sub, color }) => {
    const colorClasses: Record<string, string> = {
        cyan: "text-cyan-400 bg-cyan-500/10",
        emerald: "text-emerald-400 bg-emerald-500/10",
        blue: "text-blue-400 bg-blue-500/10",
        purple: "text-purple-400 bg-purple-500/10"
    };

    return (
        <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
                    {React.cloneElement(icon as any, { size: 24 })}
                </div>
                <div>
                    <p className="text-slate-400 text-sm">{title}</p>
                    <h3 className="text-2xl font-bold text-white">{value}</h3>
                    <p className="text-xs text-slate-500 mt-1">{sub}</p>
                </div>
            </div>
        </div>
    );
};

export default AnalysisUsers;
