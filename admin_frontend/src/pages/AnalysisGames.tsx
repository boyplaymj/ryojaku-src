import React from 'react';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell
} from 'recharts';
import { LayoutGrid, PlayCircle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { api } from '../services/api';

// Fix for default marker icons in Leaflet with Webpack/Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Taiwan City Centers for Regional Analysis
const TAIWAN_REGIONS: Record<string, [number, number]> = {
    "台北市": [25.032, 121.565],
    "新北市": [25.017, 121.462],
    "桃園市": [24.993, 121.301],
    "台中市": [24.147, 120.673],
    "台南市": [22.999, 120.226],
    "高雄市": [22.627, 120.301],
    "基隆市": [25.127, 121.739],
    "新竹市": [24.813, 120.967],
    "嘉義市": [23.480, 120.449],
    "新竹縣": [24.5, 121.0], // Approx center
    "苗栗縣": [24.560, 120.821],
    "彰化縣": [24.051, 120.516],
    "南投縣": [23.960, 120.971],
    "雲林縣": [23.709, 120.431],
    "嘉義縣": [23.451, 120.255],
    "屏東縣": [22.551, 120.548],
    "宜蘭縣": [24.702, 121.737],
    "花蓮縣": [23.987, 121.601],
    "台東縣": [22.797, 121.074],
    "澎湖縣": [23.571, 119.579],
    "金門縣": [24.440, 118.322],
    "連江縣": [26.150, 119.950],
};

const HeatmapLayer = ({ points }: { points: [number, number, number][] }) => {
    const map = useMap();

    React.useEffect(() => {
        if (!points || points.length === 0) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const heat = (L as any).heatLayer(points, {
            radius: 25,
            blur: 15,
            maxZoom: 10,
        }).addTo(map);

        return () => {
            map.removeLayer(heat);
        };
    }, [map, points]);

    return null;
};

const AnalysisGames: React.FC = () => {
    const [data, setData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const fetch = async () => {
            try {
                const res = await api.analysis.getGames();
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

    const getStatusLabel = (status: string) => {
        const map: Record<string, string> = {
            'recruiting': '招募中',
            'full': '滿員/進行中',
            'completed': '已結束',
            'cancelled': '已取消',
            'expired': '已過期'
        };
        return map[status] || status;
    };

    const gameDistribution = (data?.distribution || []).map((item: any) => ({
        ...item,
        name: getStatusLabel(item.name),
        color: item.name === 'recruiting' ? '#06b6d4' :
            item.name === 'full' ? '#3b82f6' :
                item.name === 'completed' ? '#10b981' : '#64748b'
    }));

    // Prepare Heatmap Data
    const heatmapPoints: [number, number, number][] = (data?.locations || []).map((loc: any) => [loc.lat, loc.lng, 1]);

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white">團局深度分析</h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">分析開台趨勢、時段分佈與報名狀況</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard icon={<LayoutGrid />} title="累積團局" value={data?.totalGames || 0} sub="平台成立至今" color="cyan" />
                <StatCard icon={<PlayCircle />} title="目前開桌" value={gameDistribution.find((d: any) => d.name === '招募中')?.value || 0} sub="即時招募中" color="blue" />
                <StatCard icon={<CheckCircle2 />} title="完成率" value={`${data?.completedRate || 0}%`} sub="近期趨勢" color="emerald" />
                <StatCard icon={<Clock />} title="平均時長" value="124 min" sub="估算值" color="purple" />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">熱門時段統計 (24小時)</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={data?.timeSlots || []}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="type" stroke="#94a3b8" fontSize={10} interval={1} />
                            <YAxis stroke="#94a3b8" fontSize={12} />
                            <Tooltip
                                cursor={{ fill: '#ffffff05' }}
                                wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1e293b' }}
                            />
                            <Legend />
                            <Bar dataKey="count" name="開台數量" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[400px]">
                    <h3 className="text-lg font-bold text-white mb-6">團局狀態分佈</h3>
                    <div className="flex h-[300px] items-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={gameDistribution}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {gameDistribution.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    wrapperStyle={{ opacity: 1, zIndex: 1000 }}
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', opacity: 1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Legend verticalAlign="middle" align="right" layout="vertical" />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Maps Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Heatmap */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[500px]">
                    <h3 className="text-lg font-bold text-white mb-4">地理位置熱力圖</h3>
                    <div className="h-[400px] w-full rounded-xl overflow-hidden z-0">
                        <MapContainer center={[23.6978, 120.9605]} zoom={7} style={{ height: '100%', width: '100%' }}>
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <HeatmapLayer points={heatmapPoints} />
                        </MapContainer>
                    </div>
                </div>

                {/* Regional Stats Map */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl h-[500px]">
                    <h3 className="text-lg font-bold text-white mb-4">區域團局數量分佈</h3>
                    <div className="h-[400px] w-full rounded-xl overflow-hidden z-0">
                        <MapContainer center={[23.6978, 120.9605]} zoom={7} style={{ height: '100%', width: '100%' }}>
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            {Object.entries(TAIWAN_REGIONS).map(([city, coords]) => {
                                const count = data?.regionCounts?.[city] || 0;
                                if (count === 0) return null;
                                return (
                                    <CircleMarker
                                        key={city}
                                        center={coords}
                                        pathOptions={{ fillColor: '#ef4444', color: '#b91c1c', weight: 1, fillOpacity: 0.6 }}
                                        radius={10 + Math.min(count, 50)} // Scale radius by count
                                    >
                                        <LeafletTooltip direction="top" offset={[0, -10]} opacity={1} permanent>
                                            <div className="text-center">
                                                <div className="font-bold">{city}</div>
                                                <div className="text-lg">{count}</div>
                                            </div>
                                        </LeafletTooltip>
                                    </CircleMarker>
                                );
                            })}
                        </MapContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ icon, title, value, sub, color }: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const colorClasses: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        cyan: "text-cyan-400 bg-cyan-500/10",
        emerald: "text-emerald-400 bg-emerald-500/10",
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

export default AnalysisGames;
