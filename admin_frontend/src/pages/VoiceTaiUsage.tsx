// VoiceTaiUsage.tsx — 語音判台用量卡（D6）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §📈（可觀測性）、
//       §11.11（D4-g 漏斗埋點）、§🎨「D6 用量卡的視覺規格（另一個站台）」。
//
// 🔴 **這張卡的主要用途是說出自己不可信。** 上線初期樣本一定不足，所以版面的方向錨是
//    「一份體檢報告」而不是「儀表板」：「這個數字能不能引用」要跟數字一樣顯眼。
//
// 🔴 **所有算術都在 utils/voiceUsage.ts，這裡只負責畫。** 那些規則
//    （跨頁加總、ts 的三種狀態、分母 0 回 null、樣本門檻）每一條都是
//    「錯了不會報錯」的，唯一能證明它對的方式是拿合成資料去問它 —— 而那要它可測。
//    ⇒ 這個檔裡不可以出現第二份計算。
//
// 視覺：甲案（2026-09-02 gameboy 拍板）——「繼承既有 8 頁的玻璃擬態卡片」，
// 讓新頁看起來就是同一個後台。VISUAL_SPEC §1-4 把「不要玻璃擬態」列為［技術］條，
// 這裡是**明知而刻意的例外**：一頁孤零零地不一樣，讀起來像壞掉而不像刻意。

import React, { useCallback, useEffect, useState } from 'react';
import {
    Mic, Loader2, RefreshCw, AlertTriangle, EyeOff, Layers,
    CheckCircle2, XCircle, Users as UsersIcon, HeartPulse,
} from 'lucide-react';
import { api } from '../services/api';
import {
    aggregate, collectPages, countLabel, pctLabel, MAX_PAGES, SAMPLE_GATE,
    type UsageSummary, type VoicePage,
} from '../utils/voiceUsage.ts';

const CARD = 'bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6';

/** 一格數字。`hint` 一定要寫 —— 這張卡裡沒有一個數字是「看數字就懂」的。 */
const Stat: React.FC<{
    icon: React.ReactNode; label: string; value: string; hint: string; tone?: 'normal' | 'muted';
}> = ({ icon, label, value, hint, tone = 'normal' }) => (
    <div className={CARD}>
        <div className="flex items-center gap-3 mb-4 text-slate-400">
            {icon}
            <span className="text-sm font-bold uppercase tracking-widest">{label}</span>
        </div>
        <div className={`text-4xl font-black ${tone === 'muted' ? 'text-slate-500' : 'text-white'}`}>
            {value}
        </div>
        <p className="text-slate-500 text-xs mt-2 leading-relaxed">{hint}</p>
    </div>
);

/**
 * 資料健康的小數字。**平常都是 0，所以不是零的時候要看得出來。**
 * 0 時刻意壓暗而不是隱藏：藏起來的話「一切正常」與「這一格沒接上」長得一樣。
 */
const Health: React.FC<{ label: string; n: number; why: string }> = ({ label, n, why }) => (
    <div className={`rounded-xl border p-4 ${n > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-white/5 bg-slate-900/40'}`}>
        <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold text-slate-400">{label}</span>
            <span className={`text-2xl font-black ${n > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{n}</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 leading-snug">{why}</p>
    </div>
);

const VoiceTaiUsage: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<UsageSummary | null>(null);
    const [hitCap, setHitCap] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { pages, hitCap } = await collectPages(
                (cursor) => api.voiceTai.getCorrectionsPage(cursor) as Promise<VoicePage>
            );
            setHitCap(hitCap);
            setSummary(aggregate(pages, { nowMs: Date.now() }));
        } catch (e) {
            // 🔴 失敗時把 summary 清成 null，**不留上一次的數字**。
            //    留著的話「後端掛了」會長得像「數字沒有變動」。
            setSummary(null);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-cyan-400" size={48} />
            </div>
        );
    }

    const s = summary;
    const n = (v: number) => countLabel(v, s?.complete ?? false);

    return (
        <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                        <span className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl border border-cyan-500/20 text-cyan-400">
                            <Mic size={24} />
                        </span>
                        語音判台用量
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium">
                        分辨「沒人用」與「用不了」—— 這兩件事都是 0，處置卻相反
                    </p>
                </div>
                <button
                    onClick={() => void load()}
                    className="px-4 py-2 bg-slate-800/50 border border-white/10 rounded-xl text-slate-300 text-sm font-bold hover:bg-slate-700/50 transition-all flex items-center gap-2 w-fit"
                >
                    <RefreshCw size={16} />
                    重新掃描
                </button>
            </div>

            {error && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 flex gap-3">
                    <XCircle className="text-rose-400 shrink-0" size={20} />
                    <div>
                        <p className="text-rose-200 font-bold">讀不到資料 —— 這不等於「沒有資料」</p>
                        <p className="text-rose-300/70 text-sm mt-1 font-mono break-all">{error}</p>
                    </div>
                </div>
            )}

            {s && (
                <>
                    {/* ① 掃描範圍條 —— 放最上面，因為它決定底下每一格怎麼讀 */}
                    <div className={`rounded-2xl border p-5 flex flex-wrap items-center gap-x-6 gap-y-2 ${s.complete ? 'border-white/5 bg-slate-900/40' : 'border-amber-500/40 bg-amber-500/10'}`}>
                        <Layers className={s.complete ? 'text-slate-400' : 'text-amber-400'} size={20} />
                        <span className="text-sm font-bold text-slate-200">
                            掃了 {s.pagesScanned} 頁（每頁 200 筆）
                        </span>
                        <span className={`text-sm font-bold ${s.complete ? 'text-emerald-300' : 'text-amber-300'}`}>
                            {s.complete
                                ? '已掃到底 —— 下面是全表數字'
                                : hitCap
                                    ? `停在 ${MAX_PAGES} 頁上限 —— 下面每一個數字都只是下限`
                                    : '沒有掃到底 —— 下面每一個數字都只是下限'}
                        </span>
                    </div>

                    {/* ② 樣本門檻封條 —— 數字照顯示，但標明不得引用 */}
                    {!s.sampleSufficient && (
                        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 flex gap-3">
                            <AlertTriangle className="text-amber-400 shrink-0" size={20} />
                            <div>
                                <p className="text-amber-200 font-bold">
                                    樣本不足 —— 不得據此宣稱準確率高或低
                                </p>
                                <ul className="text-amber-300/80 text-sm mt-2 space-y-1 list-disc list-inside">
                                    {s.sampleGateReasons.map((r) => <li key={r}>{r}</li>)}
                                </ul>
                                <p className="text-amber-300/60 text-xs mt-2">
                                    門檻（設計冊 §📈「上線後何時回頭看」）：
                                    ≥ {SAMPLE_GATE.minCorrections} 筆且 ≥ {SAMPLE_GATE.minDistinctUsers} 人。
                                    數字照算給你看，擋的是「引用」不是「計算」。
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ③ 漏斗 */}
                    <div>
                        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Mic className="text-cyan-400" size={20} />漏斗
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                            {/* ① 曝光：刻意不埋 ⇒ 畫成寫明的缺口，不是留白 */}
                            <div className={`${CARD} border-dashed`}>
                                <div className="flex items-center gap-3 mb-4 text-slate-500">
                                    <EyeOff size={20} />
                                    <span className="text-sm font-bold uppercase tracking-widest">① 看到入口</span>
                                </div>
                                <div className="text-4xl font-black text-slate-600">刻意不埋</div>
                                <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                                    曝光要埋在 Ledger（別人的頁），成本與污染風險大於它能回答的問題（§11.11）。
                                    <strong className="text-slate-400">所以「open ÷ 曝光」算不出來，這裡不假裝算得出來。</strong>
                                </p>
                            </div>

                            <Stat
                                icon={<Mic size={20} />} label="② 進到判台頁"
                                value={n(s.open)}
                                hint={`次數，不是人數。事件列不回 userId ⇒ 不重複人數結構上不可得，不可以拿這個數字代替。`}
                            />
                            <Stat
                                icon={<CheckCircle2 size={20} />} label="③④ 按下麥克風"
                                value={`${n(s.asrOk)} 成 / ${n(s.asrFailed)} 敗`}
                                hint={`失敗率 ${pctLabel(s.asrFailRate)}${s.asrFailRate === null ? '（一次都還沒按過）' : ''}。含「權限被拒／start() 拋／初始化失敗」那些走不到 finish() 的早退。`}
                            />
                            <Stat
                                icon={<UsersIcon size={20} />} label="⑤ 確認送出"
                                value={n(s.corrections)}
                                hint={`不重複使用者 ${n(s.distinctUsers)} 人。近 ${s.windowDays} 天 ${n(s.windowCorrections)} 筆 / ${n(s.windowDistinctUsers)} 人。`}
                            />
                        </div>
                    </div>

                    {/* 未訂正率 ＋ ASR 失敗原因 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className={CARD}>
                            <div className="flex items-center gap-3 mb-4 text-slate-400">
                                <CheckCircle2 size={20} />
                                <span className="text-sm font-bold uppercase tracking-widest">未訂正率</span>
                            </div>
                            <div className="text-4xl font-black text-white">{pctLabel(s.noDiffRate)}</div>
                            <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                                {n(s.noDiff)} / {n(s.corrections)} 筆送出時不必改任何一格。
                                {s.noDiffRate === null && ' 還沒有人送過 —— 這是「沒有分母」，不是 0%。'}
                            </p>
                            <p className="text-amber-300/70 text-xs mt-3 leading-relaxed">
                                ⚠️ 這是<strong>「察覺到的錯誤率」的下限</strong>，不是準確率：
                                使用者沒察覺判錯就不會去改，那些筆在這裡長得跟判對了一樣（§4.4）。
                            </p>
                        </div>

                        <div className={CARD}>
                            <div className="flex items-center gap-3 mb-4 text-slate-400">
                                <XCircle size={20} />
                                <span className="text-sm font-bold uppercase tracking-widest">ASR 失敗原因</span>
                            </div>
                            {Object.keys(s.asrErrors).length === 0 ? (
                                <p className="text-slate-500 text-sm">
                                    目前沒有失敗紀錄。
                                    {s.asrOk === 0 && ' —— 但成功也是 0，所以這是「還沒有人按過」而不是「都很順」。'}
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {Object.entries(s.asrErrors)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([code, count]) => (
                                            <li key={code} className="flex items-center justify-between gap-4 text-sm">
                                                <span className="font-mono text-slate-300">{code}</span>
                                                <span className="font-black text-white">{n(count)}</span>
                                            </li>
                                        ))}
                                </ul>
                            )}
                            <p className="text-slate-500 text-xs mt-3 leading-relaxed">
                                代碼由 <span className="font-mono">micErrorCode()</span> 統一翻譯過。
                                認不得的<strong>原樣保留</strong>（不吞成 not-allowed）——
                                吞掉的話新的失敗原因會偽裝成「權限問題變多了」。
                                <span className="font-mono">unknown</span> ＝失敗但沒寫原因。
                            </p>
                        </div>
                    </div>

                    {/* ④ 資料健康 —— 平常全是 0，不是零的時候要看得出來 */}
                    <div>
                        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <HeartPulse className="text-cyan-400" size={20} />資料健康
                        </h2>
                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                            <Health label="skipped" n={s.skipped}
                                why="pk 不是 USER#… 的列，後端跳過不猜。>0 ＝寫入端或表結構出事。" />
                            <Health label="未知事件" n={s.otherEvents}
                                why="kind 認得出是事件、但不在已知清單裡。>0 ＝有新 kind 在寫入而讀取端沒跟上。" />
                            <Health label="無時間戳" n={s.undated}
                                why="ts 缺欄或 <=0。這些列不在任何時間窗裡 ⇒ 會讓「近 N 天」少算。" />
                            <Health label="未來時間" n={s.futureDated}
                                why="ts 超前現在 24 小時以上。同上，也會讓時間窗少算。" />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default VoiceTaiUsage;
