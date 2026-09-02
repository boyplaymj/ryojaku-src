// pages/TrainingVoiceTai.tsx — 語音判台（訓練工具）D4-a：修正盤 ／ D4-b：麥克風
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §2／§3.1／§4／§6／§9
// 視覺經 gameboy 確認（§9 目視 gate，2026-09-02），參考預覽
// /opt/sml/repo/tools/mahjong-tai/preview_voice_tai.html。
//
// 🔴 範圍：D4-a 修正盤 ＋ D4-b 麥克風 ＋ D4-c 訂正飛輪（POST /voice-corrections）。
//    ✅ **入口已接**（2026-09-02 gameboy 拍板放 Ledger）：`pages/Ledger.tsx` 摘要卡下方
//    那張「語音判台」卡片，`navigate('/training/voice-tai')`。
//    ⚠️ **只有入口，沒有接資料** —— 判完不會寫進帳本（§6 待拍板那半仍未拍）。
//    判錯的代價要留在「練習答錯」，不要變成「帳記錯」。
//    ⚠️ Ledger 有 overlay 模式（Profile → LedgerOverlay，`fixed inset-0 z-[100]` portal），
//    入口卡片因此**不能放在 Ledger 的 header** —— 那段 `!isOverlay` 才繪。
//    （本段原本寫「本頁仍然沒有入口」。留著這句改寫是因為「模組寫好卻沒人叫」
//     這種洞平常零徵兆 —— 所有測試都會綠，而使用者數是 0，
//     且那個 0 與「做了沒人愛用」長得一樣。）
//
// 🔴 所有台數都走 utils/voiceTai.ts，本檔一個算術都不做 ——
//    連莊的 2N+1 有個 tai_base，自己乘會少一台而且看起來合理（見那支檔頭）。
//    判台管線一律走 utils/voiceTaiAsr.ts 的 recognize()，本檔不自己呼叫
//    MahjongPhonetic／MahjongTai —— 那兩支之間有個「必須先 buildIndex」的
//    全域狀態順序，漏掉時畫面完全正常、只有音近誤聽會失效（見那支檔頭）。
//
// ── D4-d：雙軌都接上了（§3.1）───────────────────────────────────────────
//
// 本頁不知道自己走的是哪一軌 —— `useVoiceAsr` 給的是統一介面。
// 選軌與兩軌相反的累積語意在 `utils/asrTrack.ts`（有測試）：
//   · 原生殼一律走原生軌，**即使那個 WebView 也有 Web Speech**
//     （Android WebView 就是這種；先看 hasWebSpeech 會在那裡走錯軌，而 iOS 上零徵兆）
//   · 原生 partialResults 是**取代**語意，Web Speech 的 final 是**累加** —— 方向相反
//
// 🔴 這一頁是本 App 第一個要敏感權限的功能。iOS 兩個 UsageDescription、
//    Android 一個 RECORD_AUDIO，都已宣告（見 ios/App/App/Info.plist、
//    android/app/src/main/AndroidManifest.xml）。少了它們會在執行期被系統擋下，
//    而那與「程式寫錯」在畫面上長得一樣。
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
import { Check, ChevronLeft, Mic, Minus, Plus, RotateCcw } from 'lucide-react';
import fanTable from '../engine/mahjong-tai/fan_table.json';
import { useVoiceAsr } from '../hooks/useVoiceAsr';
import {
  buildPad,
  fanById,
  step,
  totalTai,
  taiOf,
  toggle,
  type Selection,
} from '../utils/voiceTai';
import { recognize, type AsrFanTable, type Heard } from '../utils/voiceTaiAsr';
import { buildCorrection, nowTs, shouldUpload } from '../utils/voiceCorrection';
import { buildEvent, type MetricEventKind } from '../utils/voiceTaiMetrics';
import type { AsrSettle } from '../hooks/useVoiceAsr';
import { postVoiceCorrection, postVoiceTaiEvent } from '../services/apiService';

const TABLE = fanTable as unknown as AsrFanTable;

const TrainingVoiceTai: React.FC = () => {
  const navigate = useNavigate();
  const [sel, setSel] = useState<Selection>({});
  const [heard, setHeard] = useState<Heard | null>(null);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const pad = useMemo(() => buildPad(TABLE), []);

  /**
   * 漏斗事件（D4-g）。正典 DESIGN_APP.md §📈。
   *
   * 🔴 **fail-open 且不彈訊息** —— 這一條與送出訂正那條（submit）刻意不同：
   *    訂正是使用者按了「確認送出」，他有權知道成敗；漏斗事件是**我們**要的資料，
   *    為了它去打斷使用者是本末倒置。
   *
   * ⚠️ 但「不彈訊息」不等於「看不見」。事件與訂正走**同一個端點**，
   *    所以「事件不見了而訂正還在」是查得出來的（同一組 auth、同一份護欄，
   *    只有事件消失＝這裡出事，兩者一起消失＝端點或登入出事）。
   *    另外留一行 console.warn，真機除錯時它是唯一的線索。
   */
  const sendEvent = useCallback((kind: MetricEventKind, asr?: AsrSettle) => {
    try {
      const payload = buildEvent({
        kind,
        ts: nowTs(Date.now()),
        rulesetVersion: TABLE.meta?.version ?? 'unknown',
        asr: asr ? { ok: asr.ok, track: asr.track, errorCode: asr.errorCode } : undefined,
      });
      void postVoiceTaiEvent(payload).catch((err) => {
        console.warn('[voice-tai] 漏斗事件送不出去（不影響判台）:', kind, err);
      });
    } catch (err) {
      // buildEvent 自己會擋壞掉的 ts／缺結果的 asr。走到這裡代表呼叫端寫錯了，
      // 不是網路問題 —— 一樣不擋使用者，但要留痕。
      console.warn('[voice-tai] 漏斗事件組不出來:', kind, err);
    }
  }, []);

  /**
   * 進到這一頁就記一筆。
   *
   * 🔴 沒有這一筆的話，「沒人點入口」與「點了但沒算完」在資料上**逐字相同**
   *    （兩者都是 0 筆訂正）—— 而它們的處置完全不同：前者改入口位置，
   *    後者修頁面或文案。這一筆就是那兩件事之間唯一的分界。
   *
   * ⚠️ ref 擋重複：index.tsx 有 React.StrictMode，開發模式下 effect 會跑兩次。
   *    production build 不會，但依賴「正式環境剛好不會」去保證計數正確，
   *    等於把一個量測的正確性交給一個 build 旗標。
   */
  const openSentRef = useRef(false);
  useEffect(() => {
    if (openSentRef.current) return;
    openSentRef.current = true;
    sendEvent('open');
  }, [sendEvent]);
  // 🔴 **純台數，不含底**（2026-09-02 gameboy 定案：「什麼都沒選是屁胡 0 台，
  //    1 台不是底 —— 底不會報語音」）。
  //    原本這裡是 `grandTotal`（＝純台數 ＋ `config.base_di`），於是**每一個讀數都多 1 台**：
  //    什麼都沒選顯示「1 台」、選了莊家（1 台）顯示「2 台」。
  //    ⚠️ 它壞得很安靜 —— 空白狀態那個「1 台」看起來像「已經選了什麼」而不像算錯，
  //    而有選的時候整排一起差 1，沒有任何一格看起來突兀。
  //    ⚠️ 這個錯**沒有污染飛輪資料**：送出的 payload 只帶 heard/sel，不帶台數。
  const total = totalTai(TABLE, sel);
  const picked = Object.keys(sel);

  /** 辨識完的字丟進判台管線。錯誤要顯示出來，不可以讓整頁白掉。 */
  const analyze = useCallback((text: string) => {
    try {
      const h = recognize(TABLE, text);
      setHeard(h);
      // 新的一次辨識＝新的一局，上一局的「已送出」不算數
      // （否則講第二局時按鈕還停在「已送出」，那一局永遠送不出去）。
      setSubmitted(false);
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

  // 🔴 兩軌（原生 Capacitor ／ Web Speech）的差異全部關在 useVoiceAsr 裡，
  //    本頁只看得到一個統一介面。會判錯而且錯了不會有東西轉紅的那些判斷
  //    （選哪一軌、原生 partial 是取代而 web final 是累加）已經挖到
  //    utils/asrTrack.ts 並有測試守著 —— 不要把它們搬回這裡。
  /**
   * 一次按壓結束（成功或失敗都要記）。
   *
   * 🔴 這裡分的是「不想用」與「用不了」。只有 open 與 correction 兩個載體的話，
   *    「進了頁面卻沒有訂正」有兩種完全不同的原因：他看了看就走（產品問題），
   *    或者他講了但麥克風沒權限／沒聽到（技術問題）。混在一起會修錯東西。
   */
  const onAsrSettle = useCallback((s: AsrSettle) => sendEvent('asr', s), [sendEvent]);

  const asr = useVoiceAsr(analyze, onAsrSettle);
  const listening = asr.listening;
  const supported = asr.track !== 'none';

  // 講話中顯示即時文字，講完顯示判台後的原文。
  // 兩者共用同一塊版面，因為它們回答的是同一個問題：「它聽到什麼」。
  const displayRaw = listening ? asr.partial : (heard?.raw ?? '');

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

  /**
   * 任何對選取的改動都要解除「已送出」狀態。
   *
   * 🔴 少了這一層的話：使用者送出 → 發現漏了一台 → 補上 → **再也送不出去**，
   *    而按鈕上寫著「已送出」，看起來完全正常。
   *    而且那一筆訂正（正是最有價值的那種：他真的改了東西）永遠不會被記錄到。
   */
  const updateSel = useCallback((fn: (s: Selection) => Selection) => {
    setSel(fn);
    setSubmitted(false);
  }, []);

  /**
   * 確認送出 → 記一筆訂正資料（§4）。
   *
   * 🔴 **沒有訂正也要送**（§4.4）：`hadDiff=false` 的紀錄是準確度的分母。
   *    只送有差異的話，「訂正筆數 = 0」同時代表「判得很準」與「根本沒人用」。
   *    ⚠️ 設計冊 §4.1 寫的「沒有差異就不送」是錯的，見 utils/voiceCorrection.ts 檔頭。
   *
   * 🔴 **fail-open，但不靜默**：飛輪是我們要的東西，不是使用者要的。
   *    上傳失敗不可以擋住他繼續算下一局 —— 但也不可以假裝成功，
   *    否則「沒人用」與「上傳壞了」在資料上會長得一模一樣（正是 §4.4 要避免的）。
   */
  const submit = async () => {
    if (sending) return;
    setSending(true);
    setNotice('');
    try {
      const payload = buildCorrection({
        heard: heard ?? { raw: '', normalized: '', leftover: '', ignored: [], sel: {}, ids: [] },
        sel,
        ts: nowTs(Date.now()),
        rulesetVersion: TABLE.meta?.version ?? 'unknown',
      });
      if (shouldUpload(payload)) await postVoiceCorrection(payload);
      setSubmitted(true);
      setNotice('已記錄，謝謝 —— 這會讓之後判得更準。');
    } catch (err) {
      setNotice(
        `送出失敗（${err instanceof Error ? err.message : String(err)}）。` +
          '台數還是對的，可以繼續用；這一筆訂正沒有記錄到。',
      );
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setSel({});
    setHeard(null);
    setNotice('');
    setSubmitted(false);
    asr.clear(); // 麥克風層的殘留（上一次的即時文字與錯誤）也要一起清
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
              <span className="text-neutral-900 break-words">{breakdown}</span>
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
        {displayRaw && (
          <div className="mt-2.5 pt-2.5 border-t border-black/[0.04] text-[0.625rem] font-bold leading-relaxed">
            <div className="text-neutral-500">
              聽到：<span className="text-neutral-900">{displayRaw}</span>
            </div>
            {/* 講話中不顯示校正／未對到的音：那兩項要等整句講完才算得準，
                中途顯示會讓它們在使用者眼前跳動，看起來像判錯。 */}
            {!listening && heard?.normalized && heard.normalized !== heard.raw && (
              <div className="text-neutral-500">
                校正為：<span className="text-[#c5a059]">{heard.normalized}</span>
              </div>
            )}
            {!listening && heard?.leftover && (
              <div className="text-neutral-400">沒對到的音：{heard.leftover}</div>
            )}
          </div>
        )}

        {/* 🔴 兩個錯誤來源：notice 是判台層（詞庫壞了／沒對到台種），
            asr.error 是麥克風層（沒權限／沒聲音／選錯軌）。
            合成一句顯示，但判台層優先 —— 它是使用者當下正在做的事。 */}
        {(notice || asr.error) && (
          <div className="mt-2.5 text-[0.625rem] font-bold leading-relaxed text-[#b4532f]">
            {notice || asr.error}
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
                      onClick={() => updateSel((s) => toggle(TABLE, s, fan.id))}
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
                          onClick={() => updateSel((s) => step(TABLE, s, fan.id, -1))}
                          className="flex-1 flex justify-center py-1 text-white/90 active:bg-black/10"
                        >
                          <Minus size="0.875rem" strokeWidth={3} />
                        </button>
                        <div className="w-px bg-white/25" />
                        <button
                          type="button"
                          aria-label={`${fan.name} 加一份`}
                          onClick={() => updateSel((s) => step(TABLE, s, fan.id, 1))}
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
          // 🔴 講完整：是這個環境兩條路都沒有，不是功能壞了。
          //    ⚠️ 這段文案在 D4-d 之前寫的是「iPhone 的 App 內建瀏覽器就沒有」——
          //    原生軌接上之後那句話變成**反的**（App 殼現在是最好的那條路），
          //    而它讀起來完全合理。改文案是 D4-d 的一部分，不是順手潤稿。
          <div className="mb-2.5 text-[0.625rem] font-bold leading-relaxed text-neutral-500">
            這個瀏覽器沒有語音辨識。
            <br />
            用 Chrome、Edge，或直接用両雀 App 都可以講話；在這裡仍可以直接點格子算台。
          </div>
        )}

        {/* 確認送出（§9：底部固定的送出列）。
            🔴 沒有自動送出倒數（§9 禁做③）—— 判錯多算 8 台的情境下，
               倒數會把錯誤送出去。送出永遠是使用者按下去的。
            ⚠️ 誠實一點：v1 沒有接 Ledger，所以「送出」對使用者**沒有可見效果** ——
               它記的是訂正資料（給我們改進判台用）。按鈕文案與送出後的訊息
               都照這個事實寫，不要做成「已完成結算」那種暗示。 */}
        <button
          type="button"
          onClick={submit}
          disabled={sending || submitted || (picked.length === 0 && !heard)}
          className={`w-full mb-2 rounded-[0.8125rem] py-3 text-[0.875rem] font-black tracking-wide flex items-center justify-center gap-2 transition-colors ${
            sending || submitted || (picked.length === 0 && !heard)
              ? 'bg-[#f2f2f0] text-neutral-300'
              : 'bg-[#c5a059] text-white active:bg-[#b08d4a]'
          }`}
        >
          <Check size="1rem" strokeWidth={2.8} />
          {sending ? '送出中…' : submitted ? '已送出' : `確認送出 ${total} 台`}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!supported}
            aria-label="按住講話"
            aria-pressed={listening}
            onMouseDown={asr.start}
            onMouseUp={asr.stop}
            onMouseLeave={asr.stop}
            onTouchStart={(e) => {
              e.preventDefault();
              asr.start();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              asr.stop();
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
