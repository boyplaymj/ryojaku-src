// utils/asrTrack.ts — 兩軌 ASR 的「選哪一軌」與「兩軌語意差異」的純邏輯（D4-d）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §3.1（雙軌，都零成本）
// 殼在 hooks/useVoiceAsr.ts，判台管線在 utils/voiceTaiAsr.ts。本檔兩者都不碰。
//
// 分層理由同 voiceTai.ts／voiceTaiAsr.ts：runner 的 glob 只收 utils/*.test.ts
// 與 engine/*.test.ts ⇒ 放 hooks/ 的東西**結構上不會被任何測試跑到**。
// 所以「哪些東西值得從 hook 裡挖出來放這裡」的判準是：**它會不會判錯**。
// 下面三支都會，而且錯的時候不會有任何東西轉紅。
//
// ── 為什麼一定要有這一層（不是為了漂亮）───────────────────────────────
//
// 🔴 `@capacitor-community/speech-recognition` 的 **web 實作每一個方法都
//    `throw this.unimplemented('Method not implemented on web.')`**
//    （實查 `dist/esm/web.js`，2026-09-02）。包括 `available()`。
//    ⇒ 不能拿它的 `available()` 當能力偵測 —— 那行在瀏覽器裡會直接拋。
//    ⇒ 也不能「裝了套件就全部改走套件」，瀏覽器那半必須留著 Web Speech。
//    分派只能靠 `Capacitor.isNativePlatform()`，而且要在呼叫套件**之前**。

/** 走哪一軌。`none` = 這個環境兩條路都沒有（例如 iOS Safari 以外的舊 WebView）。 */
export type AsrTrack = 'native' | 'web' | 'none';

export interface AsrEnv {
  /** Capacitor.isNativePlatform() —— 跑在 iOS/Android 原生殼裡。 */
  isNative: boolean;
  /** window.SpeechRecognition ?? window.webkitSpeechRecognition 存不存在。 */
  hasWebSpeech: boolean;
}

/**
 * 選軌。**原生優先**，不是「有 Web Speech 就用 Web Speech」。
 *
 * 🔴 反過來寫很誘人（先看 hasWebSpeech，有就用），而且在 iPhone 上測不出差別 ——
 *    iOS 的 WKWebView 根本沒有 SpeechRecognition，兩種寫法都會落到原生軌。
 *    但 **Android 的 WebView 是有 Web Speech 的**，先看 hasWebSpeech 就會在
 *    Android 原生殼裡走 web 軌：那條路要把音訊送 Google、且離線不能用，
 *    而使用者裝的明明是有原生辨識能力的 App。
 *    ⇒ 這個判錯在 iOS 上零徵兆，只有 Android 使用者會踩到。
 */
export function pickAsrTrack(env: AsrEnv): AsrTrack {
  if (env.isNative) return 'native';
  if (env.hasWebSpeech) return 'web';
  return 'none';
}

/**
 * 原生 `partialResults` 事件的累積語意：**取代，不是累加**。
 *
 * 🔴 這是兩軌最容易寫錯的地方，而且錯的方向剛好會產生「看起來像有在動」的結果。
 *    - Web Speech：`onresult` 給的是**增量**片段，`isFinal` 的要自己累加起來
 *      （少累加 ⇒ 只剩最後一小段）。
 *    - 原生套件：每次 `partialResults` 給的是**當前完整**的辨識結果
 *      （拿去累加 ⇒「大三元」會變成「大 大三 大三元」）。
 *
 *    兩邊都是「一串字陸續進來」，型別也都是字串 ⇒ 抄錯不會有型別錯誤，
 *    而判台引擎吃到重複的字**仍然判得出台種**（parse 是掃描式的），
 *    所以連結果都可能看起來是對的 —— 只有份數會多算（花牌、連莊那種 per_unit）。
 *
 * @param prev 上一次的文字。matches 空的時候保留它（原生偶爾會送空事件）。
 */
export function reduceNativePartial(prev: string, matches?: string[]): string {
  if (!matches || matches.length === 0) return prev;
  const first = matches[0];
  // 空字串是「這一輪沒聽到東西」，不是「使用者把話收回去了」⇒ 保留上一次的。
  return first ? first : prev;
}

/**
 * Web Speech `onresult` 的累積語意：**累加**（與上面相反）。
 * 放在同一支檔案裡是刻意的 —— 兩者的差異就是這一層存在的理由，
 * 拆開放兩個地方的話，下一個人只會讀到其中一邊。
 */
export function reduceWebFinal(prev: string, chunk: string): string {
  return prev + chunk;
}

/**
 * 原生 `start()` 在 `partialResults: false` 時才會回 matches。
 * 我們用的是 `partialResults: true`（要即時回饋），那時它**直接回、不帶結果**
 * （套件 definitions.d.ts 原文：「respond directly without result」）
 * ⇒ 最終文字只能從最後一次 partial 取。
 *
 * 這支存在是為了讓「萬一將來改用 partialResults: false」時有個明確的取法，
 * 而不是在殼裡臨時寫一個 `matches?.[0] ?? ''`。
 */
export function nativeMatchesToText(matches?: string[]): string {
  if (!matches || matches.length === 0) return '';
  return matches[0] || '';
}

/**
 * 原生軌特有的錯誤 → 中文。認不得的交給呼叫端（頁面會再委派給
 * voiceTaiAsr.micErrorMessage，那支管的是 Web Speech 的 error code）。
 *
 * ⚠️ 回 null 表示「這不是我認得的原生錯誤」，不是「沒有錯誤」——
 *    這兩者混在一起的話，未知的原生錯誤會被講成 Web Speech 的錯誤訊息。
 */
export function nativeErrorMessage(raw: string): string | null {
  const s = (raw || '').toLowerCase();
  if (s.includes('denied') || s.includes('permission')) {
    return '沒有語音辨識權限。請到系統設定裡允許這個 App 使用麥克風與語音辨識。';
  }
  if (s.includes('not implemented on web')) {
    // 🔴 這句話出現＝選軌選錯了（在瀏覽器裡走了原生軌），不是使用者的問題。
    //    照實講出來，不要包裝成「請再試一次」——那會讓這個 bug 永遠查不到。
    return '選錯辨識軌了（在瀏覽器裡呼叫了原生語音辨識）。這是程式的問題，請回報。';
  }
  if (s.includes('unavailable') || s.includes('not available')) {
    return '這台裝置沒有可用的語音辨識服務。';
  }
  return null;
}
