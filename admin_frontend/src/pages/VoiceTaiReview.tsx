// VoiceTaiReview.tsx — 語音判台「訂正審核頁」（D6）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4.3（後台端不算建議）、
//       §4.5（回灌紀律）、§📈、§🎨「D6 用量卡的視覺規格（另一個站台）」。
//
// 用量卡（VoiceTaiUsage）答「有沒有人在用」；這一頁答**判錯在哪**，
// 以及「有沒有東西值得回灌進台數表」。
//
// 🔴 **所有算術都在 utils/voiceReview.ts，這裡只負責畫。** 尤其是 `extractSuggestions`
//    —— 正典明訂它只該有一個實作（§4.3），那份是 `feedback.js`（引擎副本）。
//    這個檔裡不可以出現第二份計算，包括「順手在畫面上再篩一次 type」那種。
//
// 🔴 **這一頁會把人導向「改台數表」這個動作**，所以「這份結論可不可信」必須排在
//    結論前面，而不是塞在角落：掃描範圍、台數表版本、樣本量三條都在建議清單之上。
//    ⚠️ `review_mapping` 一律只印、交人工（§4.5）—— 畫面上不提供任何一鍵套用。
//
// 視覺：甲案（2026-09-02 gameboy 拍板）—— 繼承既有頁的玻璃擬態卡片。

import React, { useCallback, useEffect, useState } from 'react';
import {
    ClipboardCheck, Loader2, RefreshCw, XCircle, Layers, BookOpen,
    Sparkles, UserCheck, ArrowRight, HeartPulse, Inbox,
} from 'lucide-react';
import { api } from '../services/api';
import { collectPages, countLabel, MAX_PAGES, type VoicePage } from '../utils/voiceUsage.ts';
import {
    buildReview, MIN_COUNT,
    type FanTable, type ReviewPage, type ReviewSummary,
} from '../utils/voiceReview.ts';
import fanTableJson from '../engine/mahjong-tai/fan_table.json';

// 🔴 這份表是**同步副本**（src/engine/mahjong-tai/，由正典的 sync_to_app.sh 產生），
//    不是線上下發的那一份（§5：台數表存後台、隨 rulesetVersion 下發）。
//    兩者可能不同版 —— 所以 `health.versionMismatch` 那一條不是裝飾，是這一頁的前提。
//    斷言用的形狀只有 `meta.version` 與 `fans[].id/name`，其餘欄位不碰。
const TABLE = fanTableJson as unknown as FanTable;

const CARD = 'bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6';

/** 資料健康的小數字。平常都是 0，所以不是零的時候要看得出來（同用量卡的規矩）。 */
const Health: React.FC<{ label: string; n: number; why: string }> = ({ label, n, why }) => (
    <div className={`rounded-xl border p-4 ${n > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-white/5 bg-slate-900/40'}`}>
        <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold text-slate-400">{label}</span>
            <span className={`text-2xl font-black ${n > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{n}</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 leading-snug">{why}</p>
    </div>
);

const VoiceTaiReview: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<ReviewSummary | null>(null);
    const [hitCap, setHitCap] = useState(false);
    const [pagesScanned, setPagesScanned] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { pages, hitCap } = await collectPages(
                (cursor) => api.voiceTai.getCorrectionsPage(cursor) as Promise<VoicePage>
            );
            const last = pages[pages.length - 1];
            const complete = pages.length > 0 && !last?.nextCursor;
            setHitCap(hitCap);
            setPagesScanned(pages.length);
            setSummary(buildReview(pages as ReviewPage[], TABLE, complete));
        } catch (e) {
            // 失敗時清成 null，不留上一次的數字 —— 留著的話「後端掛了」
            // 會長得像「這批資料沒有新的訂正」。
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
    const h = s?.health;
    const n = (v: number) => countLabel(v, h?.complete ?? false);
    const auto = (s?.suggestions ?? []).filter((x) => x.autoApplicable);
    const manual = (s?.suggestions ?? []).filter((x) => !x.autoApplicable);

    return (
        <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                        <span className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl border border-cyan-500/20 text-cyan-400">
                            <ClipboardCheck size={24} />
                        </span>
                        語音判台訂正審核
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium">
                        判錯在哪 —— 哪些台種最常被補上（漏判）、被刪掉（誤判）
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
                        <p className="text-rose-200 font-bold">讀不到資料 —— 這不等於「沒有訂正」</p>
                        <p className="text-rose-300/70 text-sm mt-1 font-mono break-all">{error}</p>
                    </div>
                </div>
            )}

            {s && h && (
                <>
                    {/* ① 掃描範圍 —— 放最上面，它決定底下每一格怎麼讀 */}
                    <div className={`rounded-2xl border p-5 flex flex-wrap items-center gap-x-6 gap-y-2 ${h.complete ? 'border-white/5 bg-slate-900/40' : 'border-amber-500/40 bg-amber-500/10'}`}>
                        <Layers className={h.complete ? 'text-slate-400' : 'text-amber-400'} size={20} />
                        <span className="text-sm font-bold text-slate-200">
                            掃了 {pagesScanned} 頁（每頁 200 筆），共 {n(h.totalRows)} 筆訂正
                        </span>
                        <span className={`text-sm font-bold ${h.complete ? 'text-emerald-300' : 'text-amber-300'}`}>
                            {h.complete
                                ? '已掃到底 —— 下面是全表數字'
                                : hitCap
                                    ? `停在 ${MAX_PAGES} 頁上限 —— 下面每一個數字都只是下限`
                                    : '沒有掃到底 —— 下面每一個數字都只是下限'}
                        </span>
                    </div>

                    {/* ② 台數表版本 —— 建議是拿「後台這份表」評的，跟資料未必同版 */}
                    <div className={`rounded-2xl border p-5 ${h.versionMismatch ? 'border-amber-500/40 bg-amber-500/10' : 'border-white/5 bg-slate-900/40'}`}>
                        <div className="flex items-center gap-3">
                            <BookOpen className={h.versionMismatch ? 'text-amber-400' : 'text-slate-400'} size={20} />
                            <span className="text-sm font-bold text-slate-200">
                                建議是拿<strong>後台這份</strong>台數表 v{h.tableVersion} 評出來的
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                            資料裡出現過的版本：
                            {h.dataVersions.length === 0
                                ? ' （沒有資料）'
                                : h.dataVersions.map((d) => ` ${d.version}（${d.count} 筆）`).join('、')}
                        </p>
                        {h.versionMismatch && (
                            <p className="text-amber-200 text-xs mt-2 leading-relaxed">
                                ⚠️ 有訂正是在<strong>別的版本</strong>下產生的。那些資料裡的台種，這份表未必有；
                                方向是<strong>多報</strong> —— App 那邊已經收錄的詞，這裡仍會被當成「新詞」提出來。
                                回灌前先確認兩邊同版。
                            </p>
                        )}
                    </div>

                    {/* ③ 可回灌的建議 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className={CARD}>
                            <div className="flex items-center gap-3 mb-4 text-slate-400">
                                <Sparkles size={18} className="text-emerald-400" />
                                <span className="text-sm font-bold uppercase tracking-widest">可自動回灌</span>
                                <span className="text-xs text-slate-500">add_confusion</span>
                            </div>
                            {auto.length === 0 ? (
                                <p className="text-slate-500 text-sm">
                                    沒有。門檻是「{MIN_COUNT} 個<strong>不同</strong>使用者各講過一次」
                                    —— 這個 0 也可能只是還沒有那麼多人用。
                                </p>
                            ) : (
                                <ul className="space-y-3">
                                    {auto.map((x, i) => (
                                        <li key={i} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                                            <div className="flex items-center gap-2 flex-wrap text-sm">
                                                <code className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 font-bold">{x.term}</code>
                                                <ArrowRight size={14} className="text-slate-500" />
                                                <span className="text-white font-bold">{x.fanName ?? x.fanId}</span>
                                                {x.fanName === null && (
                                                    <span className="text-amber-300 text-xs">（這份表裡沒有這個 id）</span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-slate-500 mt-1">
                                                {x.count} 次 · {x.distinctUsers} 位不同使用者
                                                {x.examples?.length ? ` · 例：${x.examples.join('、')}` : ''}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className={CARD}>
                            <div className="flex items-center gap-3 mb-4 text-slate-400">
                                <UserCheck size={18} className="text-amber-400" />
                                <span className="text-sm font-bold uppercase tracking-widest">需人工判斷</span>
                                <span className="text-xs text-slate-500">review_mapping</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                                「A 常被改成 B」可能是共用的糾錯詞指錯家。§4.5 明訂這一類
                                <strong>一律只印、交人工</strong> —— 所以這裡沒有套用按鈕，不是還沒做。
                            </p>
                            {manual.length === 0 ? (
                                <p className="text-slate-500 text-sm">沒有。</p>
                            ) : (
                                <ul className="space-y-3">
                                    {manual.map((x, i) => (
                                        <li key={i} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                                            <div className="flex items-center gap-2 flex-wrap text-sm">
                                                <span className="text-white font-bold">{x.fromFanName ?? x.fromFanId}</span>
                                                <ArrowRight size={14} className="text-slate-500" />
                                                <span className="text-white font-bold">{x.toFanName ?? x.toFanId}</span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 mt-1">
                                                {x.count} 次 · {x.distinctUsers} 位不同使用者
                                                {x.examples?.length ? ` · 例：${x.examples.join('、')}` : ''}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* ④ 依台種的訂正排行 */}
                    <div className={CARD}>
                        <div className="flex items-center gap-3 mb-4 text-slate-400">
                            <ClipboardCheck size={18} />
                            <span className="text-sm font-bold uppercase tracking-widest">哪些台種最常被改</span>
                        </div>
                        {s.fans.length === 0 ? (
                            <div className="flex items-center gap-3 text-slate-500 text-sm">
                                <Inbox size={18} />
                                還沒有任何訂正。⚠️ 這個 0 要先排除「寫入端還沒上線」——
                                前端埋點沒部署時，這裡本來就會是空的。
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-slate-500 text-xs uppercase tracking-widest">
                                            <th className="text-left font-bold py-2">台種</th>
                                            <th className="text-right font-bold py-2">被補上（系統漏判）</th>
                                            <th className="text-right font-bold py-2">被刪掉（系統誤判）</th>
                                            <th className="text-right font-bold py-2">合計</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {s.fans.map((f) => (
                                            <tr key={f.fanId} className="border-t border-white/5">
                                                <td className="py-2">
                                                    <span className="text-white font-bold">{f.name ?? f.fanId}</span>
                                                    {!f.known && (
                                                        <span className="ml-2 text-[11px] text-amber-300">
                                                            這份表裡沒有 · {f.fanId}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="text-right text-cyan-300 font-bold">{n(f.timesAdded)}</td>
                                                <td className="text-right text-rose-300 font-bold">{n(f.timesRemoved)}</td>
                                                <td className="text-right text-white font-black">{n(f.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* ⑤ 資料健康 */}
                    <div>
                        <div className="flex items-center gap-3 mb-3 text-slate-400">
                            <HeartPulse size={18} />
                            <span className="text-sm font-bold uppercase tracking-widest">資料健康</span>
                            <span className="text-xs text-slate-500">平常應該都是 0</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Health
                                label="沒帶 userId 的列"
                                n={h.rowsWithoutUserId}
                                why="會把「兩個不同使用者才建議」悄悄降級成「同一個人講兩次也算」——上面的建議會變寬鬆"
                            />
                            <Health
                                label="形狀壞掉的列"
                                n={h.rowsWithBrokenDiffShape}
                                why="added／removed 任一欄不是陣列。半壞的回應跟全壞的一樣值得看見"
                            />
                            <Health
                                label="表裡沒有的台種"
                                n={h.unknownFanIds.length}
                                why={h.unknownFanIds.length ? `版本不一致最直接的證據：${h.unknownFanIds.join('、')}` : '資料裡的 fanId 都在這份表裡'}
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default VoiceTaiReview;
