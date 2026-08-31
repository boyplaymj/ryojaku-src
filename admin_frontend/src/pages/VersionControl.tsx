import React, { useState, useEffect } from 'react';
import { Save, Smartphone, AlertTriangle, Loader2, Info, ShieldAlert } from 'lucide-react';
import { api } from '../services/api';

// 這一頁只留「真的會生效」的控制項。
// 先前還有 latestVersion／forceUpdate／maintenanceMode 三個，它們存得進 DDB、
// 重新整理值也還在（所以「設定有沒有生效」這個檢查會給假的 ✅），但實際上：
//   - forceUpdate     後端永遠回 false，App 端根本沒讀 → 轉了沒有任何效果
//   - latestVersion   後端有讀有回，但 App 端零消費者 → 同上
//   - maintenanceMode 後端零實作（當時）
// 一個會給正面回饋卻什麼都不做的開關，比沒有這個開關更危險，所以當時先拆掉。
//
// 🔴 maintenanceMode 已回歸，而且這次是真的：f1d667e 把它接到 user authorizer、
// 9870d34 補上 WebSocket 既有連線那條、後端 config_validate.go 有白名單驗證。
// forceUpdate / latestVersion 仍然沒有讀取端，維持不放回來。

interface VersionConfig {
    minVersion: string;
    updateUrl: string;
}

/** 與 App 端 utils/versionGate.ts 的白名單一致；不合格的連結會讓閘門直接放行（不擋）。 */
const ALLOWED_UPDATE_SCHEMES = ['https:', 'market:', 'itms-apps:', 'itms:'];

/** 與 App 端 versionGate.ts 的 VERSION_PATTERN、後端 config_validate.go 的 versionPattern 一致。 */
const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

/**
 * 無效的版本字串在 App 端會讓 isOutdated() 解析失敗而放行 —— 也就是**閘門靜靜地消失**，
 * 畫面上跟「設定成功且沒人需要更新」長得一模一樣。所以必須在送出前就擋下來。
 * 後端 config_validate.go 有同一道檢查，擋的是繞過這個畫面直接打 API 的情形。
 */
function minVersionProblem(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed === '') return '最低版本不可為空。';
    if (!VERSION_PATTERN.test(trimmed)) {
        return `只接受 1 / 1.2 / 1.2.3 這種純數字版本。「${raw}」在 App 端會解析失敗，結果是閘門完全不生效。`;
    }
    return null;
}

/**
 * warn 與 error 要分開：清空連結是**合法操作**（退回程式預設值），只是後果要講清楚；
 * 填了一個 App 端會忽略的連結才是錯誤。兩者混成同一種的話，不是擋掉合法操作，
 * 就是放過真正的錯誤。
 */
type Problem = { level: 'warn' | 'error'; message: string };

function updateUrlProblem(raw: string): Problem | null {
    const trimmed = raw.trim();
    if (trimmed === '') {
        return { level: 'warn', message: '沒有填連結時，原生 App 遇到版本過舊會直接放行（不擋）。' };
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { level: 'error', message: '這不是一個完整的網址（要包含 https:// 之類的開頭）。' };
    }
    if (!ALLOWED_UPDATE_SCHEMES.includes(parsed.protocol)) {
        return {
            level: 'error',
            message: `App 端只接受 ${ALLOWED_UPDATE_SCHEMES.join(' / ')} 開頭的連結，這個會被忽略。`,
        };
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

    // 🔴 維護模式的狀態刻意與 config 分開，送出也走自己的按鈕。
    // 理由是結構性的：下方「儲存版本設定」在 minVersion 格式有錯時會 disable。
    // 若把 kill switch 併進那顆批次按鈕，緊急時就會因為一個**無關的**版本格式錯誤
    // 而關不掉維護模式 —— 緊急控制項不可以繼承一般表單的故障模式。
    const [maintenance, setMaintenance] = useState(false);
    const [togglingMaintenance, setTogglingMaintenance] = useState(false);

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
                    // 與後端 shared.maintenanceModeFromItem 同一套判讀：等於 true 才算開，
                    // 其餘（含缺這一筆）一律當關。不要在這裡自己發明比較規則，
                    // 兩邊判讀不一致的話，畫面會顯示成跟實際狀態相反。
                    setMaintenance(String(data.maintenanceMode ?? '').trim().toLowerCase() === 'true');
                }
            } catch (err) {
                console.error('Failed to fetch config', err);
            } finally {
                setLoading(false);
            }
        };
        fetchConfig();
    }, []);

    const toggleMaintenance = async (next: boolean) => {
        // 開啟要確認、關閉不要 —— 這個不對稱是刻意的。
        // 開啟會把所有一般使用者擋在門外，是高代價且容易誤觸的動作；
        // 關閉是「把服務救回來」，任何多一步的阻力都是在延長故障時間。
        if (next) {
            const ok = window.confirm(
                '確定要開啟維護模式嗎？\n\n' +
                '開啟後會立刻發生（下一個請求就生效，沒有快取）：\n' +
                '・所有一般使用者的 App 請求被擋，畫面顯示「服務維護中」\n' +
                '・聊天室無法連線，已連線者也無法發言\n' +
                '・後台（本頁）不受影響，你仍然可以回來關掉\n\n' +
                '擋不到的部分：\n' +
                '・登入／註冊等公開端點仍然可用\n' +
                '・不會主動中斷已建立的連線，只是擋住動作'
            );
            if (!ok) return;
        }

        try {
            setTogglingMaintenance(true);
            await api.config.updateVersion({ maintenanceMode: next });
            // 🔴 只在 API 成功後才改本地狀態。先改 UI 再送出的話，送失敗時畫面會
            // 顯示「已開啟」而實際沒開 —— 那就是這一頁當初拆掉假旋鈕的理由。
            setMaintenance(next);
        } catch (err) {
            alert('維護模式切換失敗，狀態未改變：' + (err as Error).message);
        } finally {
            setTogglingMaintenance(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setConfig(prev => ({ ...prev, [name]: value }));
    };

    const versionProblem = minVersionProblem(config.minVersion);
    const urlProblem = updateUrlProblem(config.updateUrl);
    const blockingErrors = [
        versionProblem,
        urlProblem?.level === 'error' ? urlProblem.message : null,
    ].filter((m): m is string => m !== null);

    const handleSave = async () => {
        // 按鈕在有 error 時已被 disable，這裡再擋一次是因為 disable 擋得住點擊、
        // 擋不住鍵盤送出或狀態競態。後端 config_validate.go 還有第三道。
        if (blockingErrors.length > 0) {
            alert('設定有問題，尚未儲存：\n\n' + blockingErrors.join('\n'));
            return;
        }

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
                                className={`w-full bg-slate-950/50 border rounded-xl px-4 py-2 text-white focus:outline-none ${versionProblem ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-cyan-500/50'}`}
                            />
                            {versionProblem ? (
                                <div className="mt-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex gap-2 items-start">
                                    <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                                    <span className="text-red-200/90 text-xs leading-relaxed">{versionProblem}</span>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-500 mt-1">只接受 1 / 1.2 / 1.2.3 這種純數字版本。</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">商店更新連結 (Store URL)</label>
                            <input
                                type="text"
                                name="updateUrl"
                                value={config.updateUrl}
                                onChange={handleChange}
                                placeholder="https://apps.apple.com/app/idXXXXXXXX 或 market://details?id=com.boyplaymj.ryojaku"
                                className={`w-full bg-slate-950/50 border rounded-xl px-4 py-2 text-white focus:outline-none ${urlProblem?.level === 'error' ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-cyan-500/50'}`}
                            />
                            {urlProblem && (
                                <div className={`mt-2 rounded-lg p-3 flex gap-2 items-start ${urlProblem.level === 'error' ? 'bg-red-500/10 border border-red-500/20' : 'bg-orange-500/10 border border-orange-500/20'}`}>
                                    <AlertTriangle className={`shrink-0 mt-0.5 ${urlProblem.level === 'error' ? 'text-red-400' : 'text-orange-400'}`} size={16} />
                                    <span className={`text-xs leading-relaxed ${urlProblem.level === 'error' ? 'text-red-200/90' : 'text-orange-200/90'}`}>{urlProblem.message}</span>
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
                        disabled={saving || blockingErrors.length > 0}
                        title={blockingErrors.length > 0 ? blockingErrors.join('\n') : undefined}
                        className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                        {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                        {saving ? '儲存中...' : blockingErrors.length > 0 ? '設定有問題，無法儲存' : '儲存版本設定'}
                    </button>
                </div>

                {/* 維護模式（kill switch）。刻意獨立成卡片、獨立送出：
                    它不參與上面那顆批次儲存，才不會因為版本欄位有錯而關不掉。 */}
                <div className={`mt-6 backdrop-blur-md border p-6 rounded-2xl space-y-4 ${maintenance ? 'bg-red-950/40 border-red-500/40' : 'bg-slate-900/40 border-white/5'}`}>
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <ShieldAlert className={maintenance ? 'text-red-400' : 'text-slate-400'} />
                        <h2 className="text-xl font-bold text-white">緊急維護模式</h2>
                        <span className={`ml-auto text-xs font-bold px-3 py-1 rounded-full ${maintenance ? 'bg-red-500 text-slate-950' : 'bg-slate-700 text-slate-300'}`}>
                            {maintenance ? '● 進行中' : '○ 未啟用'}
                        </span>
                    </div>

                    <div className="text-sm text-slate-300 leading-relaxed space-y-2">
                        <p>
                            擋住所有一般使用者的 App 請求（顯示「服務維護中」）與聊天室發言。
                            <span className="text-slate-200"> 下一個請求就生效，沒有快取</span>；關掉也一樣即時。
                        </p>
                        <p className="text-xs text-slate-400">
                            <span className="text-slate-300">擋不到：</span>
                            登入／註冊等公開端點仍可用；不會主動中斷已建立的連線，只擋住動作。
                            後台不受影響 —— 你永遠可以回到這一頁把它關掉。
                        </p>
                    </div>

                    {maintenance && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex gap-2 items-start">
                            <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                            <span className="text-red-200/90 text-xs leading-relaxed">
                                目前所有一般使用者都被擋在門外。修復完成後請記得關閉。
                            </span>
                        </div>
                    )}

                    <button
                        onClick={() => toggleMaintenance(!maintenance)}
                        disabled={togglingMaintenance}
                        className={`w-full font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:bg-slate-700 disabled:cursor-not-allowed ${maintenance
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            : 'bg-red-500 hover:bg-red-400 text-slate-950'}`}
                    >
                        {togglingMaintenance ? <Loader2 className="animate-spin" size={20} /> : <ShieldAlert size={20} />}
                        {togglingMaintenance
                            ? '切換中...'
                            : maintenance ? '關閉維護模式，恢復服務' : '開啟維護模式'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VersionControl;
