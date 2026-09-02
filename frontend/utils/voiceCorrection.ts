// utils/voiceCorrection.ts — 訂正飛輪的 payload 組裝（D4-c）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4（表 schema／什麼時候送／
// 「嘗試」與「完成」要分開記）。端點 `POST /voice-corrections`（auth: user）。
// 本檔不碰 React、不碰 fetch —— 送出在 services/apiService.ts，UI 在 pages/。
//
// ── 🔴 §4.1 與 §4.4 互相矛盾，這裡照 §4.4 ────────────────────────────────
//
// §4.1 寫「**沒有差異就不送**」，而 §4.4 的結論是「**每次送出都記一筆**，用
// hadDiff 區分」。兩句直接衝突，而且 §4.1 那句後面還接著「這點很重要，見 §4.4」
// —— 它以為 §4.4 在支持它。**交叉引用讓錯的那句看起來已經被查證過了。**
//
// 照 §4.4，理由是量得出來的：`hadDiff=false` 的紀錄是**準確度的分母**。
// 只記有差異的話，「訂正筆數 = 0」同時代表「判得很準」與「根本沒人用」，
// 而這兩件事的處置完全相反（OBSERVABILITY §1-4 的鐵律）。
// ⇒ `shouldUpload()` 永遠回 true。它存在不是為了過濾，是為了讓這個決定
//   有一個看得見的位置 —— 寫成 `if (hadDiff)` 的話，那個決定會消失在一行 if 裡。
//
// ⚠️ 而且 `hadDiff=false` **不等於「判對」**，只等於「使用者沒有改」。
//    只有錯到被看見的才會被訂正（少算一台常常沒人發現，多算八台會）。
//    算準確率時那是「使用者察覺到的錯誤率」下限，不是真實錯誤率。

import { MahjongFeedback } from '../engine/mahjong-tai/index.mjs';
import { selectedIds, type Selection } from './voiceTai.ts';
import type { Heard } from './voiceTaiAsr.ts';

/**
 * 判台引擎的版本。
 *
 * 🔴 這個值**不是我發明的版本號**，是 `engine/mahjong-tai/SYNC.sha256`
 *    這份逐檔雜湊清單自身的 sha256 前 12 碼 —— 引擎任何一支檔變了它就會變。
 *    `utils/voiceCorrection.test.ts` 有一條會重新算一次並比對，
 *    所以它腐爛的時候會**轉紅**，而不是靜靜地繼續宣稱一個假的版本。
 *
 * ⚠️ 人工維護的版本號在這裡沒有意義：它永遠不變，而後台拿它來判斷
 *    「這筆訂正是哪一版引擎判的」—— 一個不變的版本號比沒有更糟，
 *    因為它宣稱了資訊卻沒有承載資訊。
 */
export const ENGINE_VERSION = 'sync:da1e36775633';

export interface CorrectionInput {
  /** 語音辨識與判台的結果（系統原判）。 */
  heard: Heard;
  /** 使用者確認後的修正盤狀態。 */
  sel: Selection;
  /** 呼叫端提供的時間戳。**秒**，不是毫秒 —— 見 buildCorrection 的說明。 */
  ts: number;
  /** 家規台數表版本（fan_table.meta.version）。 */
  rulesetVersion: string;
}

/** 與後端 CorrectionRequest 逐欄對齊（main.go:46-58）。 */
export interface CorrectionPayload {
  /**
   * 這一列是什麼（D4-g）。訂正列一律 `'correction'`。
   *
   * 🔴 **一定要顯式送**，即使後端把「缺欄」也當成 correction。
   *    缺欄的預設值是為了**既有資料**（D4-c 上線到現在寫下的那些沒有這個欄位），
   *    不是給新程式偷懶用的 —— 讓每一列自己說明自己是什麼，
   *    後台才不必靠「有沒有 text」這種間接證據去猜。
   */
  kind: 'correction';
  text: string;
  normalizedText: string;
  parsed: string[];
  corrected: string[];
  added: string[];
  removed: string[];
  unmatched: string;
  hadDiff: boolean;
  rulesetVersion: string;
  engineVersion: string;
  ts: number;
}

/**
 * 秒級時間戳。
 *
 * 🔴 **不可以送毫秒。** `sk` 是 `TS#<ts>#<uuid>`（§4.2）——毫秒值的字串排序
 *    會與正常的秒級 SK 錯開，時間順序就亂了。
 *    ⚠️ 後端已經不用 `ts` 算 `expiresAt`（那個坑 D3-b 修過了），
 *    所以毫秒誤送**不會再有任何錯誤**，只會靜靜地把排序弄壞。
 *    ⇒ 這個轉換要有一個明確的位置，不能散在呼叫端寫 `Date.now()`。
 */
export function nowTs(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}

/**
 * 組出要 POST 的 payload。差異（added／removed）一律走引擎的
 * `MahjongFeedback.recordCorrection`，**不自己算差集** ——
 * 後台的回灌建議也是吃同一份差異，兩邊各算一次就會有兩個來源，
 * 分岔時不會有任何東西轉紅。
 */
export function buildCorrection(input: CorrectionInput): CorrectionPayload {
  const parsed = input.heard.ids.slice().sort();
  const corrected = selectedIds(input.sel);

  const rec = MahjongFeedback.recordCorrection({
    parsed,
    corrected,
    text: input.heard.raw,
    unmatched: input.heard.leftover,
    ts: input.ts,
  });

  return {
    kind: 'correction',
    text: rec.text,
    normalizedText: input.heard.normalized,
    parsed: rec.parsed,
    corrected: rec.corrected,
    added: rec.added,
    removed: rec.removed,
    unmatched: rec.unmatched,
    hadDiff: rec.added.length > 0 || rec.removed.length > 0,
    rulesetVersion: input.rulesetVersion,
    engineVersion: ENGINE_VERSION,
    ts: input.ts,
  };
}

/**
 * 要不要送。**永遠是 true** —— 理由見檔頭那段 §4.1／§4.4 的矛盾。
 *
 * 保留這支函式而不是把 true 內聯掉，是因為「每次都送」是一個**被推翻過的決定**，
 * 它需要一個看得見的位置。寫成 `if (hadDiff) post()` 的話，
 * 下一個人讀到的會是「這裡本來就只送有差異的」，而不是「這件事被討論過」。
 */
export function shouldUpload(_payload: CorrectionPayload): boolean {
  return true;
}
