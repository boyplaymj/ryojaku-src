// utils/asrTail.ts — 原生軌「停了之後還要不要再等一下」的純狀態機（§3.5c）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §3.5c
// 殼在 hooks/useVoiceAsr.ts（只負責 setTimeout 與呼叫 finish），本檔不碰計時器。
//
// ── 為什麼需要這一層 ────────────────────────────────────────────────
//
// 🔴 兩軌原生都把**帶完整 N-best 的最終結果**排在 `listeningState: stopped` 後面，
//    而我們的 `finish()` 就掛在 stopped 上 ⇒ 每次都用最後一次 partial 收尾，
//    最終那一發整包丟掉。實查（不是推測）：
//
//    · Android `SpeechRecognition.java`
//        onEndOfSpeech() : 264-279 → notifyListeners(listeningState, stopped)
//        onResults()     : 292-311 → partialResults:true 時**改送 `partialResults` 事件**
//                                    （帶 RESULTS_RECOGNITION 的完整 5 條）
//      ⇒ 最終 N-best 確實會送到我們手上，只是**在 stopped 之後**，
//        而且**不會再有第二個 stopped** ⇒ 今天是真的丟掉。
//
//    · iOS `Plugin.swift`
//        stop()        : 142-149 → 收到就立刻 notifyListeners(stopped)
//        resultHandler : 90-113  → 先送 partialResults，isFinal 時**才**再送一次 stopped
//      ⇒ iOS 會有**第二個 stopped**，那正是「辨識器自己說結束了」的訊號。
//
// 🔴 判準因此不是「等固定的 N 毫秒」，是**兩個訊號取先到的那個**：
//    ①又一個 stopped（iOS 的 isFinal）②尾巴安靜了 TAIL_QUIET_MS（Android）。
//    再加一道絕對上限 TAIL_MAX_MS，讓「什麼都沒等到」的代價封頂。
//
// 🔴 這個改動的安全性來自一個結構性質，不是來自我挑對了數字：
//    **計時器先到時，收尾用的資料與今天逐字相同**（就是最後一次 partial）。
//    ⇒ 最壞情況＝今天的結果 ＋ 一點延遲；等到了尾巴＝嚴格更好的資料。
//    沒有真機也能講的只有這句 —— 「延遲多少才不惱人」仍然要真機（§10b）。
//
// ⚠️ 下面兩個數字**是猜的**，沒有真機樣本可以校準。它們刻意做成具名常數
//    而不是散在 hook 裡的字面量，好讓真機量到之後改一個地方就好。

/**
 * 絕對上限：stopped 之後最多再等這麼久。
 * 這個數字的代價是**使用者放開按鈕後多等**，所以不敢設大；
 * 而設小的代價只是「退回今天的行為」，兩邊不對稱 ⇒ 往小的挑。
 */
export const TAIL_MAX_MS = 1000;

/**
 * 安靜期：收到一發尾巴 partial 之後，再等這麼久沒有新的就收尾。
 * 不是收到就立刻收尾 —— Android 的 onResults 之後理論上不會再有，
 * 但 iOS 的 resultHandler 可能連著送好幾發（每一發都是**當前完整**結果），
 * 立刻收尾會收到倒數第二發。
 */
export const TAIL_QUIET_MS = 250;

/**
 * 尾巴狀態。`pending=false` ⇒ 沒有在等（錄音中，或已經收尾了）。
 * 🔴 不變式：**計時器存在 ⟺ pending**。殼那邊靠這條把「過期的計時器」清乾淨。
 */
export interface TailState {
  pending: boolean;
  /** 絕對上限時刻（`Date.now()` 的刻度）。任何事件都不會把它往後推。 */
  deadline: number;
}

/**
 * 餵進來的事件。
 * · `started` ：listeningState:started —— 新的一輪，把殘留的等待清掉
 * · `stopped` ：listeningState:stopped
 * · `partial` ：partialResults 事件（錄音中與尾巴共用同一種事件，靠 pending 分辨）
 * · `timeout` ：殼那邊的計時器到了
 */
export type TailEvent = 'started' | 'stopped' | 'partial' | 'timeout';

export type TailAction =
  | { type: 'none' }
  /** 殼：清掉舊計時器，設一個 delayMs 之後送 `timeout` 進來的新計時器。 */
  | { type: 'arm'; delayMs: number }
  /** 殼：清掉計時器，呼叫 finish()。 */
  | { type: 'finish' };

export const tailIdle = (): TailState => ({ pending: false, deadline: 0 });

/**
 * 純函式。不碰計時器、不碰時鐘 —— `now` 一定要從外面餵進來，
 * 否則這支就得靠 fake timer 才測得動，而那種測試驗的是 fake timer 不是判斷。
 */
export function nativeTailStep(
  state: TailState,
  event: TailEvent,
  now: number,
): { state: TailState; action: TailAction } {
  if (event === 'started') {
    // 新的一輪。上一輪若還在等，那個等待已經沒有意義了。
    return { state: tailIdle(), action: { type: 'none' } };
  }

  if (!state.pending) {
    if (event === 'stopped') {
      return {
        state: { pending: true, deadline: now + TAIL_MAX_MS },
        action: { type: 'arm', delayMs: TAIL_MAX_MS },
      };
    }
    // 🔴 錄音中的 partial 不是尾巴。少了這一條，每一發即時文字都會去動計時器，
    //    而外觀完全正常（使用者還按著，根本還沒到收尾）。
    // 🔴 idle 時的 timeout 是**過期的計時器**（上一次按壓留下來的）。
    //    讓它結束這一次按壓的話，症狀是「才剛按下去就說沒聽到內容」。
    return { state, action: { type: 'none' } };
  }

  // ── 以下都是「正在等尾巴」 ──
  if (event === 'stopped') {
    // 第二個 stopped ＝ iOS 的 isFinal 分支 ⇒ 辨識器自己說結束了，不必等好等滿。
    return { state: tailIdle(), action: { type: 'finish' } };
  }

  if (event === 'timeout') {
    return { state: tailIdle(), action: { type: 'finish' } };
  }

  // event === 'partial'：尾巴來了。再等一個安靜期，但**不可以超過絕對上限**。
  const remaining = state.deadline - now;
  if (remaining <= 0) return { state: tailIdle(), action: { type: 'finish' } };
  return {
    state,
    action: { type: 'arm', delayMs: Math.min(TAIL_QUIET_MS, remaining) },
  };
}
