import React, { useState, useEffect } from 'react';
import { Gift, Save, Loader2, Sparkles, AlertCircle, Info } from 'lucide-react';
import { api } from '../services/api';

const ActivitySettings: React.FC = () => {
    const [configs, setConfigs] = useState<Record<string, string>>({
        'DailyBonusBase': '10',
        'DailyBonusStreak': '50'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        loadConfigs();
    }, []);

    const loadConfigs = async () => {
        try {
            setLoading(true);
            const data = await api.activities.list();
            if (data) {
                // Merge with defaults in case some keys are missing
                setConfigs(prev => ({ ...prev, ...data }));
            }
        } catch (error) {
            console.error('Failed to load configs:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setMessage(null);
            await api.activities.update(configs);
            setMessage({ text: '設定已成功儲存', type: 'success' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error: any) {
            setMessage({ text: '儲存失敗: ' + error.message, type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (key: string, value: string) => {
        setConfigs(prev => ({ ...prev, [key]: value }));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-cyan-500" size={48} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div>
                <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                    <span className="p-2 bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-xl border border-pink-500/20 text-pink-400">
                        <Gift size={24} />
                    </span>
                    行銷活動設定
                </h1>
                <p className="text-slate-400 mt-2 font-medium">調整每日簽到點數與各項行銷活動參數</p>
            </div>

            {/* Config Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Daily Bonus Section */}
                <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl group hover:border-cyan-500/20 transition-all">
                    <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-cyan-500/10 to-transparent">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Sparkles className="text-cyan-400" size={20} />
                            每日簽到點數
                        </h3>
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-400 mb-2 uppercase tracking-widest">基礎簽到獎勵</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-all font-mono"
                                        value={configs['DailyBonusBase']}
                                        onChange={(e) => handleChange('DailyBonusBase', e.target.value)}
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-bold">PTS</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                                    <Info size={12} />
                                    用戶每日點擊簽到可獲得的基礎點數
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-400 mb-2 uppercase tracking-widest">連續 7 天加碼獎勵</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-all font-mono"
                                        value={configs['DailyBonusStreak']}
                                        onChange={(e) => handleChange('DailyBonusStreak', e.target.value)}
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-bold">PTS</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                                    <Info size={12} />
                                    用戶連續簽到至第 7 天時，額外獲贈的點數
                                </p>
                            </div>
                        </div>

                        <div className="bg-cyan-500/5 border border-cyan-500/10 p-4 rounded-xl">
                            <h4 className="text-cyan-400 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                                <AlertCircle size={14} />
                                試算參考
                            </h4>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                若不中斷簽到，用戶平均每週可獲得 <span className="text-white font-mono">{(parseInt(configs['DailyBonusBase']) * 7 + parseInt(configs['DailyBonusStreak'])) || 0}</span> 點。
                                每月(30天)約可獲得 <span className="text-white font-mono">{(parseInt(configs['DailyBonusBase']) * 30 + Math.floor(30 / 7) * parseInt(configs['DailyBonusStreak'])) || 0}</span> 點。
                            </p>
                        </div>
                    </div>
                </div>

                {/* Invite Code Section */}
                <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl group hover:border-purple-500/20 transition-all">
                    <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-purple-500/10 to-transparent">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Gift className="text-purple-400" size={20} />
                            邀請碼活動設定
                        </h3>
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-400 mb-2 uppercase tracking-widest">單人最大邀請上限</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-all font-mono"
                                        value={configs['InviteMaxUsage'] || '10'}
                                        onChange={(e) => handleChange('InviteMaxUsage', e.target.value)}
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-bold">人</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-400 mb-2 uppercase tracking-widest">邀請人獎勵</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-all font-mono"
                                            value={configs['InviterPoints'] || '100'}
                                            onChange={(e) => handleChange('InviterPoints', e.target.value)}
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-bold">PTS</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-400 mb-2 uppercase tracking-widest">被邀請人獎勵</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-all font-mono"
                                            value={configs['InviteePoints'] || '50'}
                                            onChange={(e) => handleChange('InviteePoints', e.target.value)}
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-bold">PTS</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-purple-500/5 border border-purple-500/10 p-4 rounded-xl">
                            <h4 className="text-purple-400 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                                <AlertCircle size={14} />
                                活動說明
                            </h4>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                用戶可以分享個人的邀請碼給朋友。當新用戶註冊時輸入該邀請碼，雙方將獲得上述設定的獎勵點數。
                                每位邀請人最多可獲得 <span className="text-white font-mono">{configs['InviteMaxUsage'] || '10'}</span> 次獎勵。
                            </p>
                        </div>
                    </div>
                </div>
                <div className="space-y-6">
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-8 rounded-2xl relative overflow-hidden h-full flex flex-col justify-center">
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <Gift size={200} />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-4">設定說明</h3>
                        <ul className="space-y-4 text-slate-400 text-sm">
                            <li className="flex gap-3">
                                <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full mt-1.5 flex-shrink-0"></div>
                                <span>設定修改後將即時生效，新的一天用戶簽到時將套用此參數。</span>
                            </li>
                            <li className="flex gap-3">
                                <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full mt-1.5 flex-shrink-0"></div>
                                <span>點數發放將自動記錄於用戶點數歷史與 DailyClaims 表。</span>
                            </li>
                            <li className="flex gap-3">
                                <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full mt-1.5 flex-shrink-0"></div>
                                <span>分析頁面將根據簽到數據計算每日活躍用戶 (DAU)。</span>
                            </li>
                        </ul>

                        {message && (
                            <div className={`mt-8 p-4 rounded-xl border animate-in slide-in-from-bottom-2 ${message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
                                }`}>
                                {message.text}
                            </div>
                        )}

                        <div className="mt-8">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 text-slate-950 font-black py-4 rounded-xl transition-all shadow-lg flex items-center justify-center gap-3"
                            >
                                {saving ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                                儲存所有行銷設定
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ActivitySettings;
