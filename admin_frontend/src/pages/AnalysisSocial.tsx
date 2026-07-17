import React from 'react';
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend
} from 'recharts';
import { MessageSquare, Heart, Share2, Award, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

const socialTrend = [
    { date: '12/01', posts: 12, likes: 45, comments: 22 },
    { date: '12/02', posts: 8, likes: 38, comments: 15 },
    { date: '12/03', posts: 15, likes: 62, comments: 30 },
    { date: '12/04', posts: 10, likes: 50, comments: 25 },
    { date: '12/05', posts: 18, likes: 85, comments: 42 },
    { date: '12/06', posts: 25, likes: 120, comments: 55 },
    { date: '12/07', posts: 20, likes: 95, comments: 48 },
];

const AnalysisSocial: React.FC = () => {
    const [data, setData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const fetch = async () => {
            try {
                const res = await api.analysis.getSocial();
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

    const trends = data?.trends || [];
    const latest = trends[trends.length - 1] || {};

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white">社群與互動分析</h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">評估貼文品質、互動率與用戶活躍深度</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard icon={<MessageSquare />} title="今日貼文" value={latest.posts || 0} sub="即時動態" color="cyan" />
                <StatCard icon={<Heart />} title="今日按讚" value={latest.likes || 0} sub="互動量" color="pink" />
                <StatCard icon={<Share2 />} title="優質作者" value={data?.topAuthors?.length || 0} sub="活躍創作者" color="blue" />
                <StatCard icon={<Award />} title="累計權重" value="---" sub="系統評分" color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">社群互動趨勢</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={trends}>
                            <defs>
                                <linearGradient id="colorLikes" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Area type="monotone" dataKey="likes" name="按讚" stroke="#ec4899" fillOpacity={1} fill="url(#colorLikes)" />
                            <Area type="monotone" dataKey="comments" name="評論" stroke="#3b82f6" fillOpacity={0} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">每日發文量統計</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={trends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                cursor={{ fill: '#ffffff05' }}
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Legend />
                            <Bar dataKey="posts" name="貼文數" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ icon, title, value, sub, color }: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const colorClasses: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        cyan: "text-cyan-400 bg-cyan-500/10",
        pink: "text-pink-400 bg-pink-500/10",
        blue: "text-blue-400 bg-blue-500/10",
        purple: "text-purple-400 bg-purple-500/10"
    };

    return (
        <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
                    {React.cloneElement(icon, { size: 24 })}
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

export default AnalysisSocial;
