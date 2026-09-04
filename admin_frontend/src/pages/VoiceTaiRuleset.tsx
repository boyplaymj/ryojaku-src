// VoiceTaiRuleset.tsx — 家規台數表：**現在下發給玩家的是哪一份**（D5-e／E2）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c（A 案四條紀律）、
//       §D5-e(E1)（端點契約）、§🎨「D6 用量卡的視覺規格（另一個站台）」。
//
// 🔴 **這一頁唯讀，而且會一直是唯讀。** §5c 紀律 1：DDB 那一列只有一條寫入入口
//    —— 播種腳本 seed_ruleset.py，從 repo 的 fan_table.json 生成。A 案與 B 案的
//    差別不在於有幾份實體（兩案都是兩份），而在於**有幾個寫入入口**。
//    這一頁一旦能存，A 案就變成 B 案而沒有 B 案的守衛。⇒ 連 POST 都沒有。
//
// 🔴 **所有判讀在 utils/voiceRuleset.ts，這裡只負責畫。** 那些判斷
//    （404 不是 not-seeded、502 不是 not-seeded、不認得的 state 不是 seeded）
//    全都是「錯了不會報錯」的那一種 —— 判錯時畫面完全正常，只是給出一個
//    對其中一種情形是錯的指示。⇒ 這個檔裡不可以出現第二份判讀。
//
// 🔴 **這一頁不下「一不一致」的判定。** 它手上沒有 repo 正典那一份，要有就得把
//    fan_table.json 再複製一份進後台 bundle —— 那是第三份表，而它會漂
//    （E1 為了同一個理由拒絕把它複製進 lambda）。逐 byte 那把尺是
//    check_ruleset_seeded.py，本頁把**指令**印出來。
//    印一個算不出來的「✅ 一致」比印指令危險得多。
//
// 視覺：沿用後台既有的玻璃擬態卡片（與 D6 兩頁同一個決定，見 §🎨），
// 讓新頁看起來就是同一個後台。

import React, { useCallback, useEffect, useState } from 'react';
import {
    BookLock, Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
    Fingerprint, Hash, Database, Terminal,
} from 'lucide-react';
import { api } from '../services/api';
import {
    bytesLabel, checkCommand, interpret, present, shortSha, stageFromTable,
    type RulesetOutcome, type Tone,
} from '../utils/voiceRuleset.ts';

const CARD = 'bg-slate-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6';

/** 語氣 → 配色。⛔ 只有 `ok` 是綠的，其餘都不是 —— 語氣是判讀的一部分，不是裝飾。 */
const TONE: Record<Tone, { box: string; text: string; icon: React.ReactNode }> = {
    ok: {
        box: 'border-emerald-500/40 bg-emerald-500/10',
        text: 'text-emerald-200',
        icon: <CheckCircle2 className="text-emerald-400 shrink-0" size={22} />,
    },
    warn: {
        box: 'border-amber-500/40 bg-amber-500/10',
        text: 'text-amber-200',
        icon: <AlertTriangle className="text-amber-400 shrink-0" size={22} />,
    },
    bad: {
        box: 'border-rose-500/40 bg-rose-500/10',
        text: 'text-rose-200',
        icon: <XCircle className="text-rose-400 shrink-0" size={22} />,
    },
    muted: {
        box: 'border-white/5 bg-slate-900/40',
        text: 'text-slate-300',
        icon: <AlertTriangle className="text-slate-500 shrink-0" size={22} />,
    },
};

/**
 * 一格事實。`value` 為 `—` 時壓暗 —— **藏起來的話「沒有值」與「這一格沒接上」長得一樣**。
 */
const Fact: React.FC<{ icon: React.ReactNode; label: string; value: string; hint: string }> = ({
    icon, label, value, hint,
}) => (
    <div className={CARD}>
        <div className="flex items-center gap-3 mb-4 text-slate-400">
            {icon}
            <span className="text-sm font-bold uppercase tracking-widest">{label}</span>
        </div>
        <div className={`text-2xl font-black break-all ${value === '—' ? 'text-slate-600' : 'text-white'}`}>
            {value}
        </div>
        <p className="text-slate-500 text-xs mt-2 leading-relaxed">{hint}</p>
    </div>
);

const VoiceTaiRuleset: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [outcome, setOutcome] = useState<RulesetOutcome | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        // 🔴 開始載入時把上一次的結果清掉。留著的話「這次讀不到」會長得像
        //    「狀態沒有變動」—— 而這一頁的每一個狀態都對應一個不同的處置。
        setOutcome(null);
        try {
            const { status, body } = await api.voiceTai.getRuleset();
            setOutcome(interpret(status, body));
        } catch (e) {
            // 走到這裡只剩「401 已導向登入」與「沒有 token」兩種。
            // 仍然交給 interpret 統一表達，不在這裡自己造一句文案。
            setOutcome(interpret(null, undefined));
            void e;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (loading || !outcome) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-cyan-400" size={48} />
            </div>
        );
    }

    const p = present(outcome);
    const tone = TONE[p.tone];
    // view 只在三種 200 的 kind 上存在；其餘沒有事實可列 —— ⛔ 不合成空表。
    const view = 'view' in outcome ? outcome.view : undefined;
    const stage = stageFromTable(view?.table);

    return (
        <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                        <span className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl border border-cyan-500/20 text-cyan-400">
                            <BookLock size={24} />
                        </span>
                        家規台數表（唯讀）
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium">
                        現在下發給玩家的是哪一份 —— 這一頁只看，寫入路徑只有 seed_ruleset.py
                    </p>
                </div>
                <button
                    onClick={() => void load()}
                    className="px-4 py-2 bg-slate-800/50 border border-white/10 rounded-xl text-slate-300 text-sm font-bold hover:bg-slate-700/50 transition-all flex items-center gap-2 w-fit"
                >
                    <RefreshCw size={16} />
                    重新讀取
                </button>
            </div>

            {/* 狀態：標題／意思／該做什麼。三段都要在，缺「該做什麼」的話這一頁只是個裝飾 */}
            <div className={`rounded-2xl border p-5 flex gap-4 ${tone.box}`}>
                {tone.icon}
                <div className="min-w-0">
                    <p className={`font-black text-lg ${tone.text}`}>{p.title}</p>
                    <p className="text-slate-300/80 text-sm mt-2 leading-relaxed">{p.body}</p>
                    <p className="text-slate-200 text-sm mt-3 leading-relaxed">
                        <span className="font-bold">該做什麼：</span>{p.action}
                    </p>
                </div>
            </div>

            {/* 事實。⛔ 只在真的拿到 200 時才畫 —— 沒有 view 的時候畫一排「—」，
                讀起來像「查過了，都是空的」，而實際上是「根本沒查到」 */}
            {view ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Fact
                            icon={<Hash size={18} />}
                            label="DDB 自稱版本"
                            value={view.version || '—'}
                            hint="那一列的 meta.version。壞掉的那一份仍然說得出自稱幾版（VersionOf 是另一把尺）—— 少了它，「壞掉」與「不存在」就沒有線索可分。"
                        />
                        <Fact
                            icon={<Fingerprint size={18} />}
                            label="原文 SHA256"
                            value={shortSha(view.sha256)}
                            hint="DDB 那一側的指紋。⛔ 本頁不拿它跟出貨那份比 —— 比對要另一份表，見下方指令。"
                        />
                        <Fact
                            icon={<Database size={18} />}
                            label="原文長度"
                            value={`${bytesLabel(view.bytes)} bytes`}
                            hint={`表 ${view.table || '—'}／info_key ${view.infoKey || '—'}。`}
                        />
                    </div>

                    {/* 原文：malformed 時它是唯一能查出「是誰寫的」的線索 ⇒ 一定要能看到全文 */}
                    {view.raw ? (
                        <div className={CARD}>
                            <div className="flex items-center gap-3 mb-4 text-slate-400">
                                <Terminal size={18} />
                                <span className="text-sm font-bold uppercase tracking-widest">那一列的原文</span>
                            </div>
                            <p className="text-slate-500 text-xs mb-3 leading-relaxed">
                                原封不動，未經本頁重新塑形。紀律 1：唯一的寫入入口是 seed_ruleset.py
                                —— 這裡出現非它寫的內容，本身就是要查的事。
                            </p>
                            <pre className="text-[11px] text-slate-300 bg-black/40 rounded-xl p-4 overflow-auto max-h-96 whitespace-pre-wrap break-all">
                                {view.raw}
                            </pre>
                        </div>
                    ) : null}
                </>
            ) : null}

            {/* 逐 byte 那把尺不在這一頁 —— 把指令印出來，不要印一個算不出來的「一致」 */}
            <div className={CARD}>
                <div className="flex items-center gap-3 mb-4 text-slate-400">
                    <Terminal size={18} />
                    <span className="text-sm font-bold uppercase tracking-widest">要問「跟出貨那份一不一致」</span>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed">
                    <span className="font-bold text-slate-200">本頁答不了這個問題。</span>
                    它手上只有 DDB 這一側的事實；要比對就得有 repo 那一份，
                    而把它複製進後台 bundle 等於第三份會漂的表。
                    逐 byte 那把尺是 <span className="font-mono text-slate-300">check_ruleset_seeded.py</span>
                    （七種判定、各自的 rc 與處置）：
                </p>
                <pre className="text-[11px] text-cyan-200/90 bg-black/40 rounded-xl p-4 mt-3 overflow-auto whitespace-pre">
                    {checkCommand(stage)}
                </pre>
                <p className="text-slate-500 text-xs mt-3 leading-relaxed">
                    ⚠️ <span className="font-mono">--table-json</span> 指的是
                    <span className="font-mono"> frontend/engine/</span> 那一份（即將出貨的），
                    不是 repo 正典 —— 沒跑 sync 就部署時，「repo 與 DDB 一致」是真的，
                    而出貨的那份仍然是壞的。
                    {stage ? null : ' 環境推不出來（表名不是已知前綴），所以上面留了佔位符。'}
                </p>
            </div>
        </div>
    );
};

export default VoiceTaiRuleset;
