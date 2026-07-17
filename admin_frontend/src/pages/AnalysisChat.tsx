import React from 'react';
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { MessageCircle, Users, Radio, Activity, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import ChatMessagesModal from '../components/ChatMessagesModal';

const AnalysisChat: React.FC = () => {
    const [data, setData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);
    const [selectedRoom, setSelectedRoom] = React.useState<{ id: string, title: string } | null>(null);

    const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const isSuperAdmin = adminUser.role === 'super_admin';

    React.useEffect(() => {
        const fetch = async () => {
            try {
                const res = await api.analysis.getChat();
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

    const overview = data?.overview || {};
    const trends = data?.trends || [];
    const topRooms = data?.topRooms || [];

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white">聊天室深度分析</h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">即時監控聊天室活躍度、訊息吞吐量與熱門頻道</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard icon={<Users />} title="總聊天室" value={overview.totalRooms || 0} sub="累計創建" color="cyan" />
                <StatCard icon={<Radio />} title="在線人數" value={overview.onlineUsers || 0} sub="WebSocket 連接數" color="green" />
                <StatCard icon={<MessageCircle />} title="近七日訊息" value={overview.totalMessages || 0} sub="活躍訊息量" color="orange" />
                <StatCard icon={<Activity />} title="活躍度" value="---" sub="平均每人每日" color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 訊息趨勢圖 */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">每日訊息量趨勢 (近7日)</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height={300}>
                            <AreaChart data={trends}>
                                <defs>
                                    <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                                <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Area type="monotone" dataKey="count" name="訊息數" stroke="#f97316" fillOpacity={1} fill="url(#colorMsg)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 熱門聊天室排行 */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px] overflow-hidden flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-4">熱門聊天室排行 (Top 10)</h3>
                    <div className="overflow-auto flex-1 custom-scrollbar">
                        <div className="min-w-[300px]">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-slate-400 border-b border-white/10">
                                        <th className="p-3 text-sm font-medium">排名</th>
                                        <th className="p-3 text-sm font-medium">聊天室名稱</th>
                                        <th className="p-3 text-sm font-medium text-right">訊息數</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {topRooms.map((room: any, index: number) => (
                                        <tr
                                            key={index}
                                            className={`hover:bg-white/10 transition-colors group ${isSuperAdmin ? 'cursor-pointer' : ''}`}
                                            onClick={() => isSuperAdmin && setSelectedRoom({ id: room.roomId, title: room.title || 'Unknown Room' })}
                                        >
                                            <td className="p-3 text-slate-300 w-12 text-center">
                                                {index < 3 ? (
                                                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                                                        index === 1 ? 'bg-slate-300/20 text-slate-300' :
                                                            'bg-orange-700/20 text-orange-400'
                                                        }`}>
                                                        {index + 1}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500 text-xs">{index + 1}</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-slate-200 text-sm truncate max-w-[200px]" title={room.title}>
                                                <div className="flex flex-col">
                                                    <span>{room.title || 'Unknown Room'}</span>
                                                    {isSuperAdmin && (
                                                        <span className="text-[10px] text-slate-500 group-hover:text-cyan-400/70 transition-colors uppercase">點擊查看對話</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-3 text-cyan-400 text-sm font-mono text-right">
                                                {room.count?.toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {topRooms.length === 0 && (
                            <div className="text-center text-slate-500 py-10">暫無數據</div>
                        )}
                    </div>
                </div>
            </div>

            {selectedRoom && (
                <ChatMessagesModal
                    roomId={selectedRoom.id}
                    roomTitle={selectedRoom.title}
                    onClose={() => setSelectedRoom(null)}
                />
            )}
        </div>
    );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StatCard = ({ icon, title, value, sub, color }: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const colorClasses: any = {
        cyan: "text-cyan-400 bg-cyan-500/10",
        green: "text-emerald-400 bg-emerald-500/10",
        orange: "text-orange-400 bg-orange-500/10",
        purple: "text-purple-400 bg-purple-500/10"
    };

    return (
        <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl transition hover:scale-[1.02]">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${colorClasses[color] || colorClasses.cyan}`}>
                    {React.cloneElement(icon, { size: 24 })}
                </div>
                <div>
                    <p className="text-slate-400 text-sm">{title}</p>
                    <h3 className="text-2xl font-bold text-white font-mono mt-1">{value}</h3>
                    <p className="text-xs text-slate-500 mt-1">{sub}</p>
                </div>
            </div>
        </div>
    );
};

export default AnalysisChat;
