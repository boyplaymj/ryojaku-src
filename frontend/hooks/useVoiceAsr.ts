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
  nativeErrorMessage,
  pickAsrTrack,
  reduceNativePartial,
  reduceWebFinal,
  type AsrTrack,
} from '../utils/asrTrack';
import { micErrorMessage } from '../utils/voiceTaiAsr';

/** Web Speech 的最小型別（這個環境沒有官方型別，只宣告我們真的用到的部分）。 */
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
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
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
export function useVoiceAsr(onFinal: (text: string) => void): VoiceAsr {
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
  const pressedRef = useRef(false);
  const listeningRef = useRef(false);
  const webRecRef = useRef<SpeechRecognitionLike | null>(null);
  const micGrantedRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const finish = useCallback(() => {
    const text = textRef.current.trim();
    if (text) onFinalRef.current(text);
    else setError((e) => e || '沒聽到內容，再試一次。');
  }, []);

  // ── Web 軌 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (track !== 'web') return;
    const Ctor = webSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'zh-TW';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => {
      listeningRef.current = true;
      setListening(true);
      setError('');
    };
    rec.onerror = (e) => setError(micErrorMessage(e.error));
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        // 🔴 web 是**累加**語意（原生相反，見 asrTrack.ts 的兩支 reduce）
        if (e.results[i].isFinal) textRef.current = reduceWebFinal(textRef.current, t);
        else interim += t;
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
  }, [track, finish]);

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
        setError(nativeErrorMessage(String(err)) ?? `語音辨識初始化失敗：${String(err)}`);
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
  }, [track, finish]);

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
      setError(micErrorMessage((err as { name?: string })?.name || 'not-allowed'));
      return false;
    }
  }, []);

  const start = useCallback(() => {
    if (listeningRef.current) return;
    pressedRef.current = true;
    textRef.current = '';
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
              setError('沒有語音辨識權限。請到系統設定裡允許這個 App 使用麥克風與語音辨識。');
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
          });
        } catch (err) {
          setError(nativeErrorMessage(String(err)) ?? `辨識啟動失敗：${String(err)}`);
          listeningRef.current = false;
          setListening(false);
        }
      })();
    }
  }, [track, ensureWebMic]);

  const stop = useCallback(() => {
    pressedRef.current = false;
    if (!listeningRef.current) return;
    if (track === 'web') {
      webRecRef.current?.stop();
    } else if (track === 'native') {
      // 原生的收尾走 'listeningState' 事件（status: 'stopped'），finish() 在那裡呼叫。
      SpeechRecognition.stop().catch((err) => {
        setError(nativeErrorMessage(String(err)) ?? `停止失敗：${String(err)}`);
      });
    }
  }, [track]);

  const clear = useCallback(() => {
    textRef.current = '';
    setPartial('');
    setError('');
  }, []);

  return { track, listening, partial, error, start, stop, clear };
}
