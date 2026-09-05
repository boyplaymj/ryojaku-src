// hooks/useVoiceAsr.ts — 兩軌 ASR 的殼（D4-d）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §3.1
// 判斷邏輯在 utils/asrTrack.ts（有測試），判台管線在 utils/voiceTaiAsr.ts（有測試）。
//
// 🔴 **本檔結構上沒有測試涵蓋** —— runner 的 glob 只收 utils/*.test.ts 與
//    engine/*.test.ts，hooks/ 不在裡面。這不是漏做，是刻意的分層：
//    凡是「會判錯而且錯了不會有東西轉紅」的東西都已經挖去 utils/asrTrack.ts
//    （選軌順序、原生 partial vs web final 的相反語意、錯誤分類）。
//    留在這裡的只有「呼叫外部 API 並把回呼接起來」，那一層要驗只能靠真實裝置。
//    ⇒ 往這裡加 if 之前先問：這個判斷放得進 asrTrack.ts 嗎？
//
// ⚠️ 兩軌的事件模型完全不同，不要試圖用一個迴圈把它們寫成同一段：
//    · Web Speech：onstart/onresult/onend/onerror，onresult 給**增量**，要自己累加
//    · 原生套件：start() 直接回（partialResults:true 時不帶結果，見其 definitions.d.ts），
//      文字靠 'partialResults' 事件、狀態靠 'listeningState' 事件，且每次給的是**當前完整結果**
//    這個相反的語意由 asrTrack.ts 的 reduceNativePartial／reduceWebFinal 承載並有測試守著。

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  MAX_CANDIDATES,
  nativeErrorMessage,
  pickAsrTrack,
  reduceNativeCandidates,
  reduceNativePartial,
  reduceWebCandidates,
  reduceWebFinal,
  type AsrTrack,
} from '../utils/asrTrack';
import { micErrorCode, micErrorMessage } from '../utils/voiceTaiAsr';

/** Web Speech 的最小型別（這個環境沒有官方型別，只宣告我們真的用到的部分）。 */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  /**
   * 一個片段要回幾條候選（N-best）。**預設是 1**，不設就永遠只拿得到一條 ——
   * 而「只有一條候選」與「N-best 沒接上」在畫面上逐字相同（§3.5）。
   */
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult:
    | ((e: {
        resultIndex: number;
        // 一個片段底下是**多條**候選（`length` ＝ 實際回了幾條，可能少於 maxAlternatives）
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean; length: number }>;
      }) => void)
    | null;
}

function webSpeechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | null;
}

/**
 * 一次按壓的結果（D4-g 漏斗埋點）。
 *
 * 🔴 `errorCode` 是**代碼**不是畫面上那句中文。用顯示訊息當指標＝用外觀定址：
 *    文案改一個字，指標就靜靜地換一個分類，而不會有任何東西轉紅。
 *    代碼的來源是 Web Speech 的 `e.error`／`getUserMedia` 的 `err.name`／
 *    我們自己給的幾個（`no-speech`／`init-failed`／`start-failed`／`stop-failed`）。
 */
export interface AsrSettle {
  ok: boolean;
  track: AsrTrack;
  errorCode?: string;
}

export interface VoiceAsr {
  /** 這個環境走哪一軌。`none` ⇒ UI 要講清楚是環境不支援，不是壞了。 */
  track: AsrTrack;
  listening: boolean;
  /** 講到一半的即時文字，只當回饋用（判台在放開之後）。 */
  partial: string;
  error: string;
  start: () => void;
  stop: () => void;
  /** 清掉上一次的殘留（換一局時用）。 */
  clear: () => void;
}

/**
 * @param onFinal 講完之後拿到的完整文字。空字串不會呼叫（那是「沒聽到」）。
 */
/**
 * @param onFinal 講完之後拿到的完整文字。空字串不會呼叫（那是「沒聽到」）。
 * @param onSettle 一次按壓結束時回報成敗（成功也會叫）。
 *   🔴 **每一條會結束這次嘗試的路徑都要叫到它**，包含那些**根本走不到 `finish()`**
 *      的早退：權限被拒、原生 `start()` 拋、初始化失敗。少叫任何一條，
 *      那一類失敗就會從漏斗裡消失 —— 而它消失的樣子是「使用者沒有嘗試」，
 *      正好是本功能要分辨的兩件事之一。
 */
export function useVoiceAsr(
  onFinal: (text: string, candidates: string[]) => void,
  onSettle?: (s: AsrSettle) => void,
): VoiceAsr {
  const [track] = useState<AsrTrack>(() =>
    pickAsrTrack({
      isNative: Capacitor.isNativePlatform(),
      hasWebSpeech: webSpeechCtor() !== null,
    }),
  );
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');

  // 🔴 這些必須是 ref 不是 state：事件回呼在 rec／plugin 上只掛一次，
  //    closure 會永遠看到第一次 render 的值。累積中的文字若放 state，
  //    結束時讀到的會是空字串 —— 而那與「真的沒講話」在畫面上一模一樣。
  const textRef = useRef('');
  /**
   * 這一次按壓的 N-best 候選（§3.5）。ref 的理由與 textRef 逐字相同。
   * 🔴 不變式：`candidatesRef.current[0]` 恆等於 `textRef.current`
   *    （兩軌的 reduce 都保證這件事，asrTrack.test.ts N3-4／N3-5 守著）。
   *    不成立的話，畫面上顯示的即時文字會與判台吃的第 0 條不是同一句。
   */
  const candidatesRef = useRef<string[]>([]);
  const pressedRef = useRef(false);
  const listeningRef = useRef(false);
  const webRecRef = useRef<SpeechRecognitionLike | null>(null);
  const micGrantedRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const trackRef = useRef(track);
  trackRef.current = track;
  // 一次按壓只回報一次。web 軌的 onerror 後面還會來一個 onend → finish()，
  // 沒有這道旗標的話同一次失敗會被記成兩筆（而且第二筆的原因是 no-speech，
  // 把真正的原因稀釋掉）。
  const settledRef = useRef(false);

  const settle = useCallback((ok: boolean, errorCode?: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSettleRef.current?.({ ok, track: trackRef.current, errorCode });
  }, []);

  /** 設錯誤訊息 ＋ 記一筆失敗。兩件事一定要一起做，分開寫就會漏掉其中一半。 */
  const fail = useCallback(
    (code: string, message: string) => {
      setError(message);
      settle(false, code);
    },
    [settle],
  );

  const finish = useCallback(() => {
    const text = textRef.current.trim();
    if (text) {
      // 🔴 候選為空時退回 `[text]`，不是傳空陣列：空陣列在 recognizeBest 那邊是
      //    「一條候選都沒有」（chosen = -1），而這裡明明有一句話。
      //    兩者混在一起的話，「N-best 沒採集到」會被記成「使用者沒講話」。
      const cands = candidatesRef.current.length > 0 ? candidatesRef.current : [text];
      onFinalRef.current(text, cands);
      settle(true);
      return;
    }
    setError((e) => e || '沒聽到內容，再試一次。');
    // 🔴 這裡用 settle 而不是 fail：錯誤訊息要保留「先發生的那個原因」
    //    （setError 的 updater 形式就是為了這個），但成敗一定要記。
    //    走到這裡而 settledRef 已經是 true，代表原因更早就記過了。
    settle(false, 'no-speech');
  }, [settle]);

  // ── Web 軌 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (track !== 'web') return;
    const Ctor = webSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'zh-TW';
    rec.interimResults = true;
    rec.continuous = false;
    // 🔴 不設這一行，web 軌永遠只有一條候選 ⇒ N-best 在瀏覽器上是 no-op，
    //    而它 no-op 的樣子就是「這台裝置的 ASR 剛好每次都只給一條」。
    rec.maxAlternatives = MAX_CANDIDATES;

    rec.onstart = () => {
      listeningRef.current = true;
      setListening(true);
      setError('');
    };
    rec.onerror = (e) => fail(e.error || 'unknown', micErrorMessage(e.error));
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i];
        const t = seg[0].transcript;
        // 🔴 web 是**累加**語意（原生相反，見 asrTrack.ts 的兩支 reduce）
        if (seg.isFinal) {
          textRef.current = reduceWebFinal(textRef.current, t);
          // 同一個片段的其餘候選（§3.5）。`seg` 是 ArrayLike，沒有 map。
          const alts: string[] = [];
          for (let j = 0; j < seg.length; j++) alts.push(seg[j].transcript);
          candidatesRef.current = reduceWebCandidates(candidatesRef.current, alts);
        } else interim += t;
      }
      setPartial(textRef.current + interim);
    };
    rec.onend = () => {
      listeningRef.current = false;
      setListening(false);
      finish();
    };

    webRecRef.current = rec;
    return () => {
      rec.onstart = rec.onend = rec.onerror = rec.onresult = null;
      try {
        rec.abort();
      } catch {
        /* 已經停了就算了 */
      }
      webRecRef.current = null;
    };
  }, [track, finish, fail]);

  // ── 原生軌 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (track !== 'native') return;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];

    (async () => {
      try {
        const partialH = await SpeechRecognition.addListener('partialResults', (data) => {
          // 🔴 原生是**取代**語意：每次給的是當前完整結果。累加會得到「大 大三 大三元」。
          textRef.current = reduceNativePartial(textRef.current, data?.matches);
          // 兩軌的 N-best 都藏在同一個 matches 陣列裡（§3.5）：
          // iOS 是 SFTranscription 逐條、Android 是 RESULTS_RECOGNITION 逐條。
          // 之前只取 [0]，其餘 4 條當場丟掉。
          candidatesRef.current = reduceNativeCandidates(candidatesRef.current, data?.matches);
          setPartial(textRef.current);
        });
        const stateH = await SpeechRecognition.addListener('listeningState', (data) => {
          const on = data?.status === 'started';
          listeningRef.current = on;
          setListening(on);
          if (!on) finish();
        });
        if (disposed) {
          partialH.remove();
          stateH.remove();
          return;
        }
        handles.push(partialH, stateH);
      } catch (err) {
        fail('init-failed', nativeErrorMessage(String(err)) ?? `語音辨識初始化失敗：${String(err)}`);
      }
    })();

    return () => {
      disposed = true;
      handles.forEach((h) => h.remove());
      // 離開頁面時一定要停，否則原生辨識會繼續佔著麥克風。
      SpeechRecognition.stop().catch(() => {
        /* 本來就沒在聽 */
      });
    };
  }, [track, finish, fail]);

  /**
   * Web 軌用：iOS Safari 直接 rec.start() 會丟 not-allowed 且**不跳權限對話框**，
   * 先用 getUserMedia 把授權叫出來（沿用 demo.html 已驗證的做法）。
   * 原生軌不走這裡 —— 它有自己的 requestPermissions()。
   */
  const ensureWebMic = useCallback(async () => {
    if (micGrantedRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      micGrantedRef.current = true;
      return true;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      micGrantedRef.current = true;
      return true;
    } catch (err) {
      // 🔴 先翻成 Web Speech 的字彙再用：兩條路徑的代碼必須是同一套，
      //    否則畫面顯示萬用訊息、指標也會分裂成兩半（見 micErrorCode 的說明）。
      const code = micErrorCode((err as { name?: string })?.name || 'NotAllowedError');
      fail(code, micErrorMessage(code));
      return false;
    }
  }, [fail]);

  const start = useCallback(() => {
    if (listeningRef.current) return;
    pressedRef.current = true;
    textRef.current = '';
    candidatesRef.current = []; // 上一次按壓的候選不可以留到這一次
    settledRef.current = false; // 新的一次按壓＝新的一次嘗試
    setPartial('');
    setError('');

    if (track === 'web') {
      void (async () => {
        const ok = await ensureWebMic();
        // 授權對話框期間可能已經放開 ⇒ 不要開始（否則變成「按一下就一直錄」）
        if (!ok || !pressedRef.current) return;
        try {
          webRecRef.current?.start();
        } catch {
          /* 連續快速按會丟 InvalidStateError */
        }
      })();
      return;
    }

    if (track === 'native') {
      void (async () => {
        try {
          const perm = await SpeechRecognition.checkPermissions();
          if (perm.speechRecognition !== 'granted') {
            const asked = await SpeechRecognition.requestPermissions();
            if (asked.speechRecognition !== 'granted') {
              fail('not-allowed', '沒有語音辨識權限。請到系統設定裡允許這個 App 使用麥克風與語音辨識。');
              return;
            }
          }
          if (!pressedRef.current) return;
          // partialResults: true ⇒ start() 直接回、不帶結果，文字走事件。
          // popup: false ⇒ Android 不要跳系統的辨識視窗（我們自己有 UI）。
          await SpeechRecognition.start({
            language: 'zh-TW',
            partialResults: true,
            popup: false,
            // 兩軌原生預設本來就是 5（iOS defaultMatches／Android MAX_RESULTS），
            // 顯式帶上是為了讓「我們要幾條」有一個看得見的位置，而不是靠對方的預設值。
            maxResults: MAX_CANDIDATES,
          });
        } catch (err) {
          fail('start-failed', nativeErrorMessage(String(err)) ?? `辨識啟動失敗：${String(err)}`);
          listeningRef.current = false;
          setListening(false);
        }
      })();
    }
  }, [track, ensureWebMic, fail]);

  const stop = useCallback(() => {
    pressedRef.current = false;
    if (!listeningRef.current) return;
    if (track === 'web') {
      webRecRef.current?.stop();
    } else if (track === 'native') {
      // 原生的收尾走 'listeningState' 事件（status: 'stopped'），finish() 在那裡呼叫。
      SpeechRecognition.stop().catch((err) => {
        fail('stop-failed', nativeErrorMessage(String(err)) ?? `停止失敗：${String(err)}`);
      });
    }
  }, [track, fail]);

  const clear = useCallback(() => {
    textRef.current = '';
    setPartial('');
    setError('');
  }, []);

  return { track, listening, partial, error, start, stop, clear };
}
