// pages/TrainingVoiceTai.tsx — 語音判台（訓練工具）D4-a：修正盤 ／ D4-b：麥克風
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §2／§3.1／§4／§6／§9
// 視覺經 gameboy 確認（§9 目視 gate，2026-09-02），參考預覽
// /opt/sml/repo/tools/mahjong-tai/preview_voice_tai.html。
//
// 🔴 範圍：D4-a 修正盤（可點、可 ±、合計即時算）＋ D4-b 麥克風與語音辨識。
//    飛輪上傳（POST /voice-corrections）仍在 D4-c。
//    ⚠️ 本頁**目前沒有入口**（沒有任何地方 navigate 到 /training/voice-tai）——
//    這是刻意的中間狀態，不是忘了接：入口與飛輪一起在 D4-c 落地。
//    在那之前它只能靠手打網址到達，所以不會有使用者撞到半成品。
//    （記在這裡是因為「模組寫好卻沒人叫」這種洞平常零徵兆。）
//
// 🔴 所有台數都走 utils/voiceTai.ts，本檔一個算術都不做 ——
//    連莊的 2N+1 有個 tai_base，自己乘會少一台而且看起來合理（見那支檔頭）。
//    判台管線一律走 utils/voiceTaiAsr.ts 的 recognize()，本檔不自己呼叫
//    MahjongPhonetic／MahjongTai —— 那兩支之間有個「必須先 buildIndex」的
//    全域狀態順序，漏掉時畫面完全正常、只有音近誤聽會失效（見那支檔頭）。
//
// ── D4-b：只有 Web Speech 這一軌，這是有意的界線，不是漏做 ──────────────
//
// 🔴 §3.1 規劃的是**雙軌**（原生 Capacitor ＋ Web Speech），D4-b 只做後者。
//    實查（2026-09-02）：`@capacitor-community/speech-recognition`
//    **沒有裝**（package.json 只有 @capacitor/{core,cli,ios,android} 四個）。
//    裝它要一併動 iOS Info.plist 與 Android 權限宣告，那是原生專案設定，
//    不該混進這一塊。
//    ⚠️ **後果要講清楚**：iOS 的 WKWebView 沒有 SpeechRecognition
//    ⇒ 裝成 App 用的 iPhone 使用者按下去只會看到「這個環境不支援」。
//    瀏覽器／PWA（Chrome、Edge）才走得通。原生軌另開一塊做。
//    ⇒ 所以 `supported === false` 時必須把話說完整（是環境不支援，不是壞了），
//      而不是讓按鈕靜靜地按不動。
//
// 🔴 驗這一頁時,先關掉每日獎勵彈窗(或種好 localStorage),否則格子點不動。
//    DailyBonusModal 是 App.tsx 裡 render 在 <Routes> 旁邊的全域覆蓋層,
//    開啟時 `fixed inset-0 z-[300]` 蓋住整頁,而它的 backdrop 只有 10% 暗度
//    ⇒ **截圖看起來完全正常**,但每一次點擊都被它收走(aria-pressed 恆 false)。
//    useDailyBonus 的守門是 localStorage[`lastDailyClaim_${userId}`],
//    而 Playwright/無痕每次都是全新 profile ⇒ 守門永遠不成立 ⇒ 必中。
//    查法:`document.elementFromPoint(x,y)` 直接問「這點會被誰收走」。
//    完整量測與對照見 DESIGN_APP.md §11.6。
//
// 視覺遵守 §9：
//   · 合計台數釘在修正盤上方，不隨捲動消失（禁做①：它是唯一要被確認的數字）
//   · 不用模糊／半透明／漸層（質感層）
//   · 沒有自動送出倒數（禁做③）
//   · 麥克風是**狀態切換、不是循環動畫**（禁做②：牌桌上很吵，
//     回饋要靠狀態變化；`animate-pulse` 這類無條件循環動畫不得使用）

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Mic, Minus, Plus, RotateCcw } from 'lucide-react';
import fanTable from '../engine/mahjong-tai/fan_table.json';
import {
  buildPad,
  fanById,
  grandTotal,
  step,
  taiOf,
  toggle,
  type Selection,
} from '../utils/voiceTai';
import {
  micErrorMessage,
  recognize,
  type AsrFanTable,
  type Heard,
} from '../utils/voiceTaiAsr';

const TABLE = fanTable as unknown as AsrFanTable;

/**
 * Web Speech 的最小型別。刻意寫在本檔而不是 types.ts：
 * types.ts 是整個 App 共用的檔（別條 session 也在改），為了一頁的實驗性功能
 * 去動它，代價是別人的 diff 裡多出看不懂的東西。等原生軌也接上、
 * 這層變成共用的 ASR 抽象時再搬。
 */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

const TrainingVoiceTai: React.FC = () => {
  const navigate = useNavigate();
  const [sel, setSel] = useState<Selection>({});
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<Heard | null>(null);
  const [notice, setNotice] = useState('');

  const pad = useMemo(() => buildPad(TABLE), []);
  const total = grandTotal(TABLE, sel);
  const picked = Object.keys(sel);

  // ── 麥克風 ────────────────────────────────────────────────────────────
  //
  // 🔴 這裡的三個 ref 不是「不想用 state」，是 state 在這裡**不會動**：
  //    SpeechRecognition 的 callback 是在 rec 物件上掛一次的，closure 會永遠
  //    看到第一次 render 的 state 值。累積中的辨識文字若放 state，
  //    onend 讀到的會是空字串 —— 而那與「真的沒講話」在畫面上一模一樣。
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTextRef = useRef('');
  const pressedRef = useRef(false);
  const micGrantedRef = useRef(false);

  const supported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  /** 辨識完的字丟進判台管線。錯誤要顯示出來，不可以讓整頁白掉。 */
  const analyze = useCallback((text: string) => {
    try {
      const h = recognize(TABLE, text);
      setHeard(h);
      if (h.ids.length === 0) {
        // 🔴 「聽到了但沒有台種」與「沒聽到」要分開講 —— 前者是講法不在詞庫裡
        //    （使用者該做的是用下面的格子補），後者是再講一次。
        setNotice(`聽到「${h.raw}」，但沒有對到任何台種。可以直接點下面的格子補上。`);
      } else {
        setNotice('');
        setSel(h.sel);
      }
    } catch (err) {
      // recognize 的 fail-closed（音近索引建不起來）會走到這裡。
      // 那代表詞庫壞了，不是使用者講錯 ⇒ 照實講，別說「請再試一次」。
      setNotice(`判台失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // rec 實例建一次。掛在 ref 上，卸載時 abort（否則離開頁面麥克風還開著）。
  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'zh-TW';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => {
      setListening(true);
      setNotice('');
    };
    rec.onerror = (e) => setNotice(micErrorMessage(e.error));
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTextRef.current += t;
        else interim += t;
      }
      // 講到一半的即時字：只當回饋，不進判台（判台在 onend）。
      setHeard((prev) => ({
        raw: (finalTextRef.current + interim).trim(),
        normalized: '',
        leftover: '',
        ignored: [],
        sel: prev?.sel ?? {},
        ids: prev?.ids ?? [],
      }));
    };
    rec.onend = () => {
      setListening(false);
      const text = finalTextRef.current.trim();
      if (text) analyze(text);
      else setNotice((n) => n || '沒聽到內容，再試一次。');
    };

    recRef.current = rec;
    return () => {
      rec.onstart = rec.onend = rec.onerror = rec.onresult = null;
      try {
        rec.abort();
      } catch {
        /* 已經停了就算了 */
      }
      recRef.current = null;
    };
  }, [analyze]);

  /**
   * iOS Safari 直接 rec.start() 會丟 not-allowed 且**不跳權限對話框**，
   * 所以先用 getUserMedia 主動把授權叫出來，拿到就立刻關掉那條軌。
   * （沿用 demo.html:275-290 已驗證的做法。）
   */
  const ensureMic = useCallback(async () => {
    if (micGrantedRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      micGrantedRef.current = true; // 沒有這個 API 就直接讓 rec.start() 自己去要
      return true;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      micGrantedRef.current = true;
      return true;
    } catch (err) {
      setNotice(micErrorMessage((err as { name?: string })?.name || 'not-allowed'));
      return false;
    }
  }, []);

  const startListening = useCallback(async () => {
    if (listening || !recRef.current) return;
    pressedRef.current = true;
    const ok = await ensureMic();
    // 授權對話框期間使用者可能已經放開 ⇒ 那就不要開始（否則會變成「按一下就一直錄」）
    if (!ok || !pressedRef.current) return;
    finalTextRef.current = '';
    setHeard(null);
    try {
      recRef.current.start();
    } catch {
      /* 連續快速按會丟 InvalidStateError，忽略即可 */
    }
  }, [listening, ensureMic]);

  const stopListening = useCallback(() => {
    pressedRef.current = false;
    if (recRef.current && listening) recRef.current.stop();
  }, [listening]);

  // 算式明細：讓合計不是一個「憑空出現的數字」。
  // 使用者要確認的是台數對不對，看得到組成才有辦法確認。
  const breakdown = picked
    .map((id) => {
      const fan = fanById(TABLE, id);
      const units = sel[id];
      const label = fan?.per_unit && units > 1 ? `${fan?.name} ×${units}` : fan?.name;
      return `${label} ${taiOf(TABLE, id, units)}`;
    })
    .join(' ＋ ');

  const reset = () => {
    setSel({});
    setHeard(null);
    setNotice('');
  };

  return (
    // 🔴 全螢幕頁一律用 `h-screen`，**不可以用 `fixed inset-0`**（2026-09-02 實測踩到）。
    //    App.tsx 的 Layout 把每一頁包在 PullToRefresh 裡，而它有
    //    `transform: translateY(...)` ＋ `willChange:transform`（PullToRefresh.tsx:112-114）
    //    ⇒ 那個祖先成為 fixed 的**容器塊**，`inset-0` 於是對齊它而不是視窗。
    //    它自己的高度又因為唯一的子元素被抽離文檔流而塌成 0
    //    ⇒ 量到 MYROOT=500x0：class 全部生效（display 確實是 flex）、
    //      DOM 有全部 35 個格子、scrollHeight 913，**只是畫面上什麼都看不到**。
    //    這個故障對「typecheck rc=0 / build rc=0 / 產物指紋全中 / DOM 查得到字串」
    //    四道檢查通通零鑑別力 —— 只有真的截圖看得出來。
    //    既有全螢幕頁的寫法在 ChatRoom.tsx:301，照它走。
    <div className="flex flex-col h-screen bg-[#f9f9f7] relative overflow-hidden">
      {/* 頁首 */}
      <div className="flex-none flex items-center justify-between bg-white border-b border-black/[0.04] px-4 pt-[calc(0.75rem+var(--safe-top))] pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            aria-label="返回"
            className="-ml-2 p-1 text-neutral-400 active:scale-95 transition-transform"
          >
            <ChevronLeft size="1.375rem" strokeWidth={2.4} />
          </button>
          <div>
            <h1 className="text-[0.9375rem] font-black tracking-tight text-neutral-900">語音報台</h1>
            <div className="text-[0.5625rem] font-bold tracking-widest text-neutral-400 uppercase">
              Voice Tai
            </div>
          </div>
        </div>
        <span className="text-[0.625rem] font-black text-[#c5a059] border border-[#c5a059]/25 rounded-md px-2 py-1">
          家規 v1
        </span>
      </div>

      {/* 判台結果：釘住，不隨修正盤捲走（§9 禁做①） */}
      <div className="flex-none bg-white border-b border-black/[0.04] px-4 pt-3.5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-[0.6875rem] font-bold leading-relaxed text-neutral-500">
            {picked.length === 0 ? (
              <>
                按住下面的<span className="text-neutral-900">麥克風報台</span>
                <br />
                或直接點格子自己算
              </>
            ) : (
              <span className="text-neutral-900 break-words">
                {breakdown} ＋ 底 {TABLE.config?.base_di ?? 0}
              </span>
            )}
          </div>
          <div className="flex-none text-right">
            <div className="text-[2.75rem] font-black leading-none tracking-tighter text-neutral-900">
              {total}
              <span className="text-[0.9375rem] font-extrabold ml-0.5">台</span>
            </div>
          </div>
        </div>

        {/* 聽到什麼、校正成什麼。
            🔴 原文一定要照實顯示：使用者要能判斷「是我講錯還是它聽錯」，
               只給正規名的話這兩者長得一模一樣。 */}
        {heard && heard.raw && (
          <div className="mt-2.5 pt-2.5 border-t border-black/[0.04] text-[0.625rem] font-bold leading-relaxed">
            <div className="text-neutral-500">
              聽到：<span className="text-neutral-900">{heard.raw}</span>
            </div>
            {heard.normalized && heard.normalized !== heard.raw && (
              <div className="text-neutral-500">
                校正為：<span className="text-[#c5a059]">{heard.normalized}</span>
              </div>
            )}
            {heard.leftover && (
              <div className="text-neutral-400">沒對到的音：{heard.leftover}</div>
            )}
          </div>
        )}

        {notice && (
          <div className="mt-2.5 text-[0.625rem] font-bold leading-relaxed text-[#b4532f]">
            {notice}
          </div>
        )}
      </div>

      {/* 修正盤：3 欄可點格子（照 score_pad.html 的 .yaku 盤，配色換成両雀奶油＋金） */}
      <div className="flex-1 overflow-y-auto px-4 pt-3.5 pb-4">
        <div className="text-[0.625rem] font-bold text-neutral-500 mb-2.5">
          點一下加入，再點一下移除
        </div>

        {pad.map((section) => (
          <div key={section.category}>
            <div className="text-[0.5625rem] font-black tracking-widest text-neutral-400 uppercase mt-3 mb-1.5 first:mt-0">
              {section.category}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {section.fans.map((fan) => {
                const units = sel[fan.id] || 0;
                const on = units > 0;
                return (
                  <div
                    key={fan.id}
                    className={`rounded-[0.625rem] border text-center transition-colors ${
                      on
                        ? 'bg-[#c5a059] border-[#c5a059]'
                        : 'bg-white border-black/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSel((s) => toggle(TABLE, s, fan.id))}
                      aria-pressed={on}
                      className="w-full px-1 py-2 active:scale-[0.97] transition-transform"
                    >
                      <span
                        className={`block text-[0.75rem] font-extrabold leading-tight tracking-tight ${
                          on ? 'text-white' : 'text-neutral-900'
                        }`}
                      >
                        {fan.name}
                        {fan.per_unit && units > 1 ? ` ×${units}` : ''}
                      </span>
                      <span
                        className={`block text-[0.5625rem] font-extrabold mt-0.5 ${
                          on ? 'text-white/80' : 'text-[#c5a059]'
                        }`}
                      >
                        {taiOf(TABLE, fan.id, units || 1)} 台
                      </span>
                    </button>

                    {/* per_unit 的份數步進。
                        🔴 不做「點到上限歸零」——fan_table.json 沒有 max 欄位，
                        那個上限得由我發明，而發明出來的規則沒有任何東西會檢查它。
                        改用 demo.html 既有語意：− 到 0 就移除。 */}
                    {on && fan.per_unit && (
                      <div className="flex border-t border-white/25">
                        <button
                          type="button"
                          aria-label={`${fan.name} 減一份`}
                          onClick={() => setSel((s) => step(TABLE, s, fan.id, -1))}
                          className="flex-1 flex justify-center py-1 text-white/90 active:bg-black/10"
                        >
                          <Minus size="0.875rem" strokeWidth={3} />
                        </button>
                        <div className="w-px bg-white/25" />
                        <button
                          type="button"
                          aria-label={`${fan.name} 加一份`}
                          onClick={() => setSel((s) => step(TABLE, s, fan.id, 1))}
                          className="flex-1 flex justify-center py-1 text-white/90 active:bg-black/10"
                        >
                          <Plus size="0.875rem" strokeWidth={3} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 底部：釘住。麥克風是主要動作，清空是次要。 */}
      <div className="flex-none bg-white border-t border-black/[0.04] px-4 pt-3 pb-[calc(1rem+var(--safe-bottom))]">
        {!supported && (
          // 🔴 講完整：是這個環境沒有這個 API，不是功能壞了。
          //    iOS 的 WKWebView（＝裝成 App 的 iPhone）就屬於這一類。
          <div className="mb-2.5 text-[0.625rem] font-bold leading-relaxed text-neutral-500">
            這個環境沒有語音辨識（iPhone 的 App 內建瀏覽器就沒有）。
            <br />
            用 Chrome 或 Edge 開這一頁可以講話；在這裡仍可以直接點格子算台。
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!supported}
            aria-label="按住講話"
            aria-pressed={listening}
            onMouseDown={startListening}
            onMouseUp={stopListening}
            onMouseLeave={stopListening}
            onTouchStart={(e) => {
              e.preventDefault();
              startListening();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopListening();
            }}
            // 🔴 §9 禁做②：狀態切換，不是循環動畫。這裡只有 transition-colors，
            //    沒有 animate-pulse／animate-ping 之類無條件播放的東西。
            className={`flex-1 select-none touch-none rounded-[0.8125rem] py-3.5 text-[0.875rem] font-black tracking-wide flex items-center justify-center gap-2 transition-colors ${
              !supported
                ? 'bg-[#f2f2f0] text-neutral-300'
                : listening
                  ? 'bg-[#b4532f] text-white'
                  : 'bg-neutral-900 text-white active:bg-black'
            }`}
          >
            <Mic size="1rem" strokeWidth={2.6} />
            {listening ? '聆聽中…放開結束' : '按住講話'}
          </button>

          <button
            type="button"
            onClick={reset}
            disabled={picked.length === 0 && !heard}
            aria-label="清空重算"
            className={`flex-none rounded-[0.8125rem] px-4 py-3.5 transition-colors ${
              picked.length === 0 && !heard
                ? 'bg-[#f2f2f0] text-neutral-300'
                : 'bg-[#f2f2f0] text-neutral-900 active:bg-[#e6e6e2]'
            }`}
          >
            <RotateCcw size="1rem" strokeWidth={2.6} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrainingVoiceTai;
