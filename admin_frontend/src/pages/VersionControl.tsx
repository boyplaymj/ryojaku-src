import React, { useState, useEffect } from 'react';
import { Save, Smartphone, AlertTriangle, Loader2, Info } from 'lucide-react';
import { api } from '../services/api';

// 這一頁刻意只留「真的會生效」的兩個欄位。
// 先前還有 latestVersion／forceUpdate／maintenanceMode 三個控制項，它們存得進 DDB、
// 重新整理值也還在（所以「設定有沒有生效」這個檢查會給假的 ✅），但實際上：
//   - forceUpdate     後端永遠回 false，App 端根本沒讀 → 轉了沒有任何效果
//   - latestVersion   後端有讀有回，但 App 端零消費者 → 同上
//   - maintenanceMode 後端零實作。UI 曾寫「除管理員外所有 API 回 503」，
//                     而要讓那句話成立得改 ~64 顆 lambda 的入口（無單一節流點）。
// 一個會給正面回饋卻什麼都不做的開關，比沒有這個開關更危險，所以先拆掉。
// DDB 裡先前寫入的那幾筆 key 留著不動（沒人讀，無害）。

interface VersionConfig {
    minVersion: string;
    updateUrl: string;
}

/** 與 App 端 utils/versionGate.ts 的白名單一致；不合格的連結會讓閘門直接放行（不擋）。 */
const ALLOWED_UPDATE_SCHEMES = ['https:', 'market:', 'itms-apps:', 'itms:'];

function updateUrlProblem(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed === '') return '沒有填連結時，原生 App 遇到版本過舊會直接放行（不擋）。';
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return '這不是一個完整的網址（要包含 https:// 之類的開頭）。';
    }
    if (!ALLOWED_UPDATE_SCHEMES.includes(parsed.protocol)) {
        return `App 端只接受 ${ALLOWED_UPDATE_SCHEMES.join(' / ')} 開頭的連結，這個會被忽略。`;
    }
    return null;
}

const VersionControl: React.FC = () => {
    const [config, setConfig] = useState<VersionConfig>({
        minVersion: '1.0.0',
        updateUrl: ''
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                setLoading(true);
                const data = await api.config.getVersion();
                if (data) {
                    // 只挑這一頁認得的欄位；後端回的是整張 AdminConfigs，含已無人讀的舊 key。
                    setConfig(prev => ({
                        minVersion: data.minVersion ?? prev.minVersion,
                        updateUrl: data.updateUrl ?? prev.updateUrl,
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
        const { name, value } = e.target;
        setConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            await api.config.updateVersion({
                minVersion: config.minVersion.trim(),
                updateUrl: config.updateUrl.trim(),
            });
            alert('設定已儲存');
        } catch (err) {
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

    const urlProblem = updateUrlProblem(config.updateUrl);

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <header>
                <h1 className="text-2xl md:text-3xl font-bold text-white">App 版本控制</h1>
                <p className="text-slate-400 mt-2 text-sm md:text-base">設定強制更新的門檻與更新出口</p>
            </header>

            <div className="max-w-2xl">
                <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 rounded-2xl space-y-6">
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Smartphone className="text-cyan-400" />
                        <h2 className="text-xl font-bold text-white">強制更新設定</h2>
                    </div>

                    <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 flex gap-3">
                        <Info className="text-cyan-400 shrink-0 mt-0.5" size={18} />
                        <div className="text-sm text-cyan-100/80 leading-relaxed">
                            <span className="text-cyan-200 font-medium">強制更新怎麼運作：</span>
                            把「最低版本」設成高於使用者手上的版本，App 就會擋下來並把他導向下方的商店連結。
                            <br />
                            沒有另外的「強制更新」開關 —— <span className="text-cyan-200">最低版本本身就是那個開關</span>。
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">最低版本 (Min Version)</label>
                            <input
                                type="text"
                                name="minVersion"
                                value={config.minVersion}
                                onChange={handleChange}
                                placeholder="2.0.4"
                                className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-cyan-500/50 focus:outline-none"
                            />
                            <p className="text-xs text-slate-500 mt-1">只接受 1 / 1.2 / 1.2.3 這種純數字版本；帶 -beta 之類的字樣 App 端會解析不出來而放行。</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">商店更新連結 (Store URL)</label>
                            <input
                                type="text"
                                name="updateUrl"
                                value={config.updateUrl}
                                onChange={handleChange}
                                placeholder="https://apps.apple.com/app/idXXXXXXXX 或 market://details?id=com.boyplaymj.ryojaku"
                                className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-cyan-500/50 focus:outline-none"
                            />
                            {urlProblem && (
                                <div className="mt-2 bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 flex gap-2 items-start">
                                    <AlertTriangle className="text-orange-400 shrink-0 mt-0.5" size={16} />
                                    <span className="text-orange-200/90 text-xs leading-relaxed">{urlProblem}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-950/30 border border-white/5 rounded-xl p-4 text-xs text-slate-400 leading-relaxed">
                        原生 App 拿不到有效的商店連結時會<span className="text-slate-200">放行（不擋）</span>，
                        而不是把使用者留在一個按不掉的畫面上 —— 那種畫面在 App 裡按「重新載入」也不會換到新版本。
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
            </div>
        </div>
    );
};

export default VersionControl;
