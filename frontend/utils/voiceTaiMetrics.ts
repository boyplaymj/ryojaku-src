// utils/voiceTaiMetrics.ts — 語音判台的漏斗埋點（D4-g）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §📈（可觀測性）與 §4.4。
//
// ── 這支存在的理由：入口接上之後，「沒人點」與「點了沒完成」長得一模一樣 ──
//
// D4-c 之前唯一的紀錄是「按下確認送出」那一刻（`voiceCorrection.ts`）。於是漏斗
// 五步裡只有最後一步有載體：
//
//   ① 看到入口  ② 點入口進到判台頁  ③ 按麥克風講  ④ ASR 成功／失敗  ⑤ 確認送出
//                     ↑ 無紀錄            ↑ 無紀錄      ↑ 無紀錄        ↑ 有紀錄
//
// ⇒ 使用者數 0 至少有四種讀法，而它們的處置完全不同：入口沒人看到（改位置）、
//   點了但頁面壞掉（修頁面）、講了但 ASR 失敗（權限／裝置問題）、
//   算完但不想送（文案或誘因問題）。§📈 的鐵律「嘗試與完成要分開記」講的就是這件事。
//
// ⇒ 本檔補 ② 與 ④ 兩個載體。①（曝光）**刻意不做** —— 那要在 Ledger 頁上埋，
//   而 Ledger 是別人的頁；曝光埋點的成本與污染風險都比它能回答的問題大。
//   ⚠️ 所以「open 數 / 曝光數」這個轉換率**算不出來**，不要在後台假裝算得出來。
//
// ── 復用既有管道 ──
//
// 走**同一個端點、同一張表**（`POST /voice-corrections` → `MahjongClub_VoiceCorrections`），
// 用 `kind` 欄位區分。理由：既有表加欄位不算額外成本（CLAUDE.md 成本控管），
// 而且訂正與漏斗事件本來就要放在一起看（分母與分子在同一張表才對得起來）。
//
// 🔴 **代價是讀取端一定要跟著改。** 事件列的 `text` 是空字串、`hadDiff` 是 false ——
//    與「判對了的訂正」在既有欄位上**逐欄相同**。後台若不排除它們，
//    「未訂正率 = hadDiff=false ÷ 總筆數」會被灌水，而且是往「判得很準」的方向灌。
//    ⇒ `mahjongclub_admin_voice_corrections` 已同步加上過濾（同一顆 commit）。
//
// 🔴 **既有列沒有 `kind`。** 判斷一律是「缺欄 ⇒ correction」，不可以反過來
//    （反過來的話，D4-c 上線後到今天為止的所有真實訂正會被當成事件丟掉）。

import type { AsrTrack } from './asrTrack.ts';
import { ENGINE_VERSION } from './voiceCorrection.ts';

/** 表裡一列是什麼。`correction` 由 `voiceCorrection.ts` 產出，這裡只產事件。 */
export const EVENT_KINDS = ['open', 'asr', 'correction'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** 事件列的 kind（`correction` 不走這支）。 */
export type MetricEventKind = Exclude<EventKind, 'correction'>;

export interface AsrOutcome {
  /** 有沒有拿到可以判台的文字。**不是**「有沒有報錯」—— 沒報錯但一個字都沒聽到也是失敗。 */
  ok: boolean;
  track: AsrTrack;
  /**
   * 失敗代碼。🔴 這裡收的是**代碼**（`not-allowed`／`no-speech`／…），
   * 不是畫面上那句中文。用顯示訊息當指標＝用外觀定址：文案改一個字，
   * 指標就靜靜地換一個分類，而沒有任何東西會轉紅。
   */
  errorCode?: string;
}

export interface MetricEventInput {
  kind: MetricEventKind;
  /** **秒**級時間戳（與訂正列同一把尺，見 voiceCorrection.nowTs）。 */
  ts: number;
  rulesetVersion: string;
  /** 只有 `kind:'asr'` 帶。 */
  asr?: AsrOutcome;
}

/**
 * 事件列的 payload。
 *
 * 🔴 **刻意沒有 `text`／`normalizedText`／`parsed`／`corrected`／`added`／`removed`。**
 *    兩個理由，缺一都不足以擋住下一個人順手加回來：
 *    ① 隱私（§4.5）：事件不需要知道使用者講了什麼，那就不要送。
 *    ② 一旦事件列帶了 `added`／`removed`，回灌飛輪（`feedback.js` 的
 *       `extractSuggestions`）就吃得到它們 —— 後台那道 kind 過濾是第一道，
 *       「根本沒有那些欄位」是第二道。
 *    `voiceTaiMetrics.test.ts` 有一條把欄位集合整個釘死，加欄位會轉紅。
 */
export interface MetricEventPayload {
  kind: MetricEventKind;
  ts: number;
  rulesetVersion: string;
  engineVersion: string;
  asrOk?: boolean;
  asrTrack?: AsrTrack;
  asrError?: string;
}

/**
 * 組出事件 payload。
 *
 * 🔴 `ts` 必須是正整數秒 —— 後端 `buildItem` 對 `ts <= 0` 回 **400**（刻意的），
 *    而這支是 fail-open 的呼叫端：送不出去不會擋使用者。兩件事加起來的意思是
 *    「壞掉的時間戳會安靜地少掉一筆」，所以在這裡先擋，不要丟給後端擋。
 */
export function buildEvent(input: MetricEventInput): MetricEventPayload {
  if (!Number.isInteger(input.ts) || input.ts <= 0) {
    throw new Error(`ts 必須是正整數秒，收到 ${String(input.ts)}`);
  }
  const p: MetricEventPayload = {
    kind: input.kind,
    ts: input.ts,
    rulesetVersion: input.rulesetVersion,
    engineVersion: ENGINE_VERSION,
  };
  if (input.kind === 'asr') {
    if (!input.asr) throw new Error("kind:'asr' 必須帶 asr 結果，否則這一筆分不出成敗");
    p.asrOk = input.asr.ok;
    p.asrTrack = input.asr.track;
    // 成功時不帶 errorCode；失敗時沒有代碼也要留一個佔位，
    // 否則「失敗但不知道為什麼」與「成功」在欄位上又變成同一種形狀。
    if (!input.asr.ok) p.asrError = input.asr.errorCode || 'unknown';
  }
  return p;
}
