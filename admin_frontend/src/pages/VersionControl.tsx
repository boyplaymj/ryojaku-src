import React, { useState, useEffect } from 'react';
import { Save, Smartphone, Globe, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../services/api';

interface VersionConfig {
    minVersion: string;
    latestVersion: string;
    updateUrl: string;
    forceUpdate: boolean;
    maintenanceMode: boolean;
}

const VersionControl: React.FC = () => {
    const [config, setConfig] = useState<VersionConfig>({
        minVersion: '1.0.0',
        latestVersion: '1.2.0',
        updateUrl: 'https://apps.apple.com/app/mahjong-club',
        forceUpdate: false,
        maintenanceMode: false
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                setLoading(true);
                const data = await api.config.getVersion();
                if (data) {
                    setConfig(prev => ({
                        ...prev,
                        ...data,
                        forceUpdate: data.forceUpdate === 'true' || data.forceUpdate === true,
                        maintenanceMode: data.maintenanceMode === 'true' || data.maintenanceMode === true,
                    }));
                }
            } catch (err) {
                console.error('Failed to fetch config', err);
            } finally {
                setLoading(false);
            }
        };
        fetchConfig();
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setConfig(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await api.config.updateVersion(config as any);
            alert('設定已儲存');
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            alert('儲存失敗: ' + (err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="p-8 flex justify-center items-center h-64">
                <Loader2 className="animate-spin text-cyan-500" size={40} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <header>
                <h1 className="text-2xl md:text-3xl font-bold text-white">版本與系統管理</h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">設定 App 強制更新策略與全域系統開關</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
                {/* Version Config Card */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl space-y-6">
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Smartphone className="text-cyan-400" />
                        <h2 className="text-xl font-bold text-white">App 版本控制</h2>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">最低版本 (Min Version)</label>
                                <input
                                    type="text"
                                    name="minVersion"
                                    value={config.minVersion}
                                    onChange={handleChange}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-cyan-500/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">最新版本 (Latest Version)</label>
                                <input
                                    type="text"
                                    name="latestVersion"
                                    value={config.latestVersion}
                                    onChange={handleChange}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-cyan-500/50 focus:outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">商店更新連結 (Store URL)</label>
                            <input
                                type="text"
                                name="updateUrl"
                                value={config.updateUrl}
                                onChange={handleChange}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-cyan-500/50 focus:outline-none"
                            />
                        </div>

                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="text-orange-400" size={20} />
                                <div>
                                    <div className="text-orange-200 font-medium">強制更新模式</div>
                                    <div className="text-orange-400/60 text-sm">低於最低版本的用戶將無法使用 App</div>
                                </div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="forceUpdate"
                                    checked={config.forceUpdate}
                                    onChange={handleChange}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                            </label>
                        </div>
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 text-slate-950 font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                        {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                        {saving ? '儲存中...' : '儲存版本設定'}
                    </button>
                </div>

                {/* System Status Card */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl space-y-6">
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Globe className="text-purple-400" />
                        <h2 className="text-xl font-bold text-white">全域系統狀態</h2>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-slate-950/30 rounded-xl p-4 flex items-center justify-between">
                            <div>
                                <div className="text-white font-medium">系統維護模式</div>
                                <div className="text-slate-500 text-sm">開啟後，除管理員外所有 API 將回傳 503</div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="maintenanceMode"
                                    checked={config.maintenanceMode}
                                    onChange={handleChange}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VersionControl;
