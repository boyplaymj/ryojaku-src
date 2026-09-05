// utils/voiceTaiNbest.ts — ASR 給多條候選時，挑「解釋掉最多音」的那一條（N-best）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §3.1（雙軌 ASR）／§3.5（本檔）
// 候選怎麼採集在 utils/asrTrack.ts，判台管線在 utils/voiceTaiAsr.ts，殼在 hooks/useVoiceAsr.ts。
//
// ── 這一層為什麼有價值（而且是零成本的）──────────────────────────────
//
// 系統 ASR **本來就回多條候選**，兩軌都是、預設 5 條，而我們一直只用第 0 條：
//   · iOS   `SFSpeechRecognitionResult.transcriptions`（plugin Plugin.swift:90-96，
//           `maxResults` 預設 5）→ 事件 `partialResults` 的 `matches` 陣列
//   · Android `RecognizerIntent.EXTRA_MAX_RESULTS`（Constants.java:14 = 5）
//           → `RESULTS_RECOGNITION` 陣列，同樣走 `matches`
//   · Web    `SpeechRecognition.maxAlternatives`（預設 1，**要自己設**）
//   ⇒ `asrTrack.reduceNativePartial` 取的是 `matches[0]`，第 1~4 條當場丟掉。
//
// 麻將報台的候選長得特別適合這一招：使用者講的是**封閉詞彙**（35 個台種名），
// 而 ASR 的排序來自通用中文語言模型 —— 它沒有理由知道「大三元」比「打三元」常見。
// 判台引擎知道。所以「讓判得出來的那條勝出」是把領域知識補回去，不必等訂正資料、
// 不必改原生碼、不燒任何成本。
//
// 🔴 **它救不了「五條都聽錯」**。這一層的上界就是 ASR 候選集裡有沒有那個答案；
//    候選全錯時它與現況逐字相同（會選 index 0）。不要拿它宣稱準確度會提升多少 ——
//    真實提升幅度只能用真機的候選樣本量，而那個樣本**目前一筆都沒有**（§3.5）。

import { recognize, type AsrFanTable, type Heard } from './voiceTaiAsr.ts';
// 🔴 上限的唯一來源在 asrTrack.ts（那裡是採集端，兩軌原生預設值 5 的出處）。
//    這裡 re-export 只是為了讓呼叫端不必知道它住在哪一支 —— 不是第二份定義。
import { MAX_CANDIDATES } from './asrTrack.ts';

export { MAX_CANDIDATES };

export interface RankedCandidate {
  /** 在去重後清單裡的名次。**0 ＝ ASR 自己的首選**（也就是改這支之前唯一會用到的那條）。 */
  index: number;
  text: string;
  heard: Heard;
}

export interface NbestResult {
  /** 選中那條的判台結果。沒有任何可用候選時是空的 `Heard`。 */
  heard: Heard;
  /** 選中的名次。**-1 ＝ 沒有任何可用候選**，不是 0 —— 那兩件事的處置不同。 */
  chosen: number;
  /** 全部候選（依 ASR 原順序，不是排名順序），含各自的判台結果。 */
  candidates: RankedCandidate[];
}

/**
 * 清理候選清單：去空白、丟掉空字串、**去重**、截到 `MAX_CANDIDATES`。
 *
 * 🔴 去重不是美觀問題。iOS 的 `transcriptions` 常常回好幾條只差標點或空白的字串，
 *    留著的話「我比較過 5 條」在紀錄上成立、實際上只比過 1 條 ——
 *    而那正是之後要用來判斷「這一層到底有沒有用」的分母。
 * ⚠️ 去重比的是 trim 後的原字串，不是正規化後的：正規化要跑判台管線，
 *    而這支必須能在建索引之前呼叫（`recognizeBest` 才碰引擎）。
 */
export function normalizeCandidates(raw?: Array<string | null | undefined> | null): string[] {
  if (!raw || raw.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const t = (item || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * 排序判準。回傳 <0 代表 a 比較好。
 *
 * ① **`covered` 多者勝** —— 被台種／略過詞吃掉的音節數。
 *    問的是「哪一條把使用者真的講出來的音解釋掉最多」。
 * ② `covered` 平手時 **leftover 少者勝**（同樣解釋了 3 個音，那條沒有多出雜音的比較可信）。
 * ③ 再平手 **名次小者勝** ⇒ **完全平手時 ASR 的首選永遠不會被換掉**。
 *    也就是說：只有「嚴格比較好」才會改判，這一層不會製造無謂的變動。
 *
 * 🔴 **刻意不用「命中台種數」當判準**，雖然那個數字更直觀。
 *    命中數多者勝＝系統性地偏向把雜音讀成更多台種，而多算與少算的代價不對稱
 *    （多算八台有人改，少算一台常常沒人發現，見 voiceCorrection.ts 檔頭）。
 *    音節覆蓋問的是「哪條解釋得比較完整」，不是「哪條給的台數比較多」。
 *
 * ⚠️ **已知且未防的一種失效**：若某條候選把同一段話重複了一次
 *    （「大三元大三元」），它的 `covered` 會是兩倍而勝出，台數也跟著加倍。
 *    沒有加防護是因為所有候選來自**同一段音訊**、長度相近，這種形狀要 ASR
 *    在低名次幻覺出一次重複才會出現；而我沒有真機樣本可以量它的發生率
 *    ⇒ 現在加一條「音節數不得超過首選 +N」的閘門，等於用猜的數字擋一個沒量過的東西。
 *    記在這裡是為了拿到樣本之後知道要回來看哪裡。
 */
export function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  if (a.heard.covered !== b.heard.covered) return b.heard.covered - a.heard.covered;
  const la = a.heard.syllables - a.heard.covered;
  const lb = b.heard.syllables - b.heard.covered;
  if (la !== lb) return la - lb;
  return a.index - b.index;
}

/**
 * 對每一條候選跑一次判台，挑最好的那條。
 *
 * 🔴 判台一律走 `recognize()`，**不在這裡重寫一條精簡版**。候選多跑 5 次的成本
 *    是純字串運算（索引只建一次，`ensureIndex` 靠參照比對），而兩條判台路徑
 *    分岔時不會有任何東西轉紅。
 * ⚠️ `recognize` 的 fail-closed（音近索引建不起來）會照樣往外拋 —— 不吞。
 *    吞掉的話「詞庫壞了」會退化成「這條候選判不出來」，然後被別條候選蓋過去。
 */
export function recognizeBest(table: AsrFanTable, rawCandidates?: Array<string | null | undefined> | null): NbestResult {
  const texts = normalizeCandidates(rawCandidates);
  if (texts.length === 0) {
    return { heard: recognize(table, ''), chosen: -1, candidates: [] };
  }

  const candidates: RankedCandidate[] = texts.map((text, index) => ({
    index,
    text,
    heard: recognize(table, text),
  }));

  // 🔴 用 reduce 挑最小值，不是 `slice().sort()[0]`：排序完只留第一名的話，
  //    「它贏了誰」就沒有載體了，而 candidates 這份清單正是之後要拿來
  //    回答「換掉首選的頻率有多高」的唯一資料。
  const best = candidates.reduce((acc, cur) => (compareCandidates(cur, acc) < 0 ? cur : acc));
  return { heard: best.heard, chosen: best.index, candidates };
}
