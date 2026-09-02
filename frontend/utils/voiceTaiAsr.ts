// utils/voiceTaiAsr.ts — 語音判台的「聽到的一段字 → 修正盤狀態」管線（D4-b）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §2 資料流／§3.1／§3.2
// 管線與 demo.html:125-142 的 analyze() 是同一條，不另立第二種判台路徑。
//
// 🔴 本檔**不碰 SpeechRecognition、不碰 DOM**。麥克風那層在 pages/TrainingVoiceTai.tsx。
//    分層理由與 voiceTai.ts 同一個，不是潔癖：runner 的 glob 只收 utils/*.test.ts 與
//    engine/*.test.ts（scripts/run-tests.mjs 的 DEFAULT_TARGETS）——
//    放在 pages/ 或 hooks/ 的邏輯**結構上不會被任何 runner 跑到**，
//    而「從沒跑過」與「跑過全過」在輸出上逐字相同。
//
// ── 這支檔存在的唯一理由：那個「呼叫順序」不可以交給呼叫端記得 ──────────
//
// 🔴 `MahjongPhonetic` 的 INDEX 是**模組層全域狀態**。沒先 buildIndex 就 normalize，
//    回來的 normalizedText 恆為空字串 ⇒ 照 demo.html 的既有寫法會 fallback 用原文
//    ⇒ `MahjongTai.parse()` 對「講得字正腔圓」的輸入**照樣全中**。
//
//    也就是說：音近校正整層失效時，功能看起來完全正常。
//    「大三元」仍然 8 台，只有 ASR 把它聽成「拉三元」時才失效 ——
//    而那正是這一層存在的唯一理由。這個故障對「有沒有回傳台數」零鑑別力。
//
//    ⇒ recognize() 自己保證 index 建好（不設「請先呼叫 ensureIndex」這種約定），
//      而且 buildIndex 回傳 0 時**當場拋**，不默默降級成「只認得字面」。
//      buildIndex 的回傳值就是 INDEX.length（phonetic.js:95），所以這道
//      fail-closed 是量得到的，不是宣告的。
//
// ⚠️ 判準（測試 D4b-4 用它當正控）：`拉三元` → 校正成 `大三元` → dasanyuan。
//    index 沒建起來時它必然落空，而字面正確的輸入不會 —— 所以正控要挑音近的那種。

import { MahjongPhonetic, MahjongTai } from '../engine/mahjong-tai/index.mjs';
// ⚠️ 副檔名不可省。Node ESM（測試 runner 直接跑這支）要求顯式副檔名，
//    而 tsconfig 的 allowImportingTsExtensions 已經是開的、Vite/esbuild 也吃這種寫法
//    ⇒ 寫 `./voiceTai` 只有 vite build 會過，`node --test` 當場 ERR_MODULE_NOT_FOUND。
//    本檔是 utils/ 底下第一支 import 另一支 utils 的檔（實查無先例），所以在這裡定錨。
import { fromHits, type FanTable, type Selection } from './voiceTai.ts';

/**
 * 音近校正需要的兩個欄位，voiceTai.ts 的 FanTable 沒有（它只管修正盤）。
 * ⚠️ 兩者都可以是空的（D1-A 清空了 ignores，實查現在是 `[]`）——
 *    空不是壞掉，所以這裡不對它們的長度設下限。
 */
export interface AsrFanTable extends FanTable {
  combos?: Array<{ surfaces?: string[]; expand?: Array<{ id: string; count: number }> }>;
  ignores?: string[];
}

export interface Heard {
  /** ASR 原文，一個字都不動（飛輪 D4-c 要送這個，且畫面要照實顯示「聽到：」）。 */
  raw: string;
  /** 音近校正後的正規台種名序列；沒校正到任何東西時是空字串。 */
  normalized: string;
  /** 沒對到任何台種的音（拼音，空白分隔）。給使用者看「哪一段沒聽懂」。 */
  leftover: string;
  /** 認得、但依家規不計台的略過詞。 */
  ignored: string[];
  /** 修正盤狀態。使用者可以在這之上增刪 —— 這就是「確認關卡」。 */
  sel: Selection;
  /** 系統原判的台種 id（排序後）。D4-c 拿它跟使用者確認後的比對，不同才上傳。 */
  ids: string[];
}

/**
 * 上次建索引用的那份表。用**參照**比對而不是 deep equal：
 * 家規表由後台下發（§5），換表時會是一個新物件 ⇒ 參照變了就重建。
 * 同一份表重複呼叫則直接跳過（buildIndex 本身冪等、實測回傳同為 140，
 * 但它要把 35 個台種的每個 surface 都轉一次拼音，不是免費的）。
 */
let indexedTable: AsrFanTable | null = null;
let indexSize = 0;

/**
 * 建好音近索引，回傳索引條目數。已經是同一份表就直接回上次的數。
 * 🔴 fail-closed：條目數為 0 代表這張表沒有任何可辨識的詞面，
 *    繼續走下去只會得到「看起來正常但只認得字面」的判台 ⇒ 當場拋。
 */
export function ensureIndex(table: AsrFanTable): number {
  if (indexedTable === table && indexSize > 0) return indexSize;
  const n = MahjongPhonetic.buildIndex(table, table.combos || [], table.ignores || []);
  if (!n || n <= 0) {
    indexedTable = null;
    indexSize = 0;
    throw new Error(
      'voiceTaiAsr: 音近索引是空的（buildIndex 回 ' + n + '）—— ' +
        '這張 fan_table 沒有任何可辨識的詞面。繼續走下去會退化成「只認得字面」，' +
        '而那在畫面上與正常完全一樣。',
    );
  }
  indexedTable = table;
  indexSize = n;
  return n;
}

/** 只給測試用：把索引狀態清掉，讓「沒建索引」那個情境可以被真的重現。 */
export function resetIndex(): void {
  indexedTable = null;
  indexSize = 0;
}

/** 目前索引的條目數（0 = 還沒建）。給診斷用，不參與判台。 */
export function currentIndexSize(): number {
  return indexSize;
}

/**
 * 一段中文字 → 判台結果。與 demo.html 的 analyze() 同一條管線：
 *   ① 音近校正（不信任 ASR 的「字」，只信「音」）
 *   ② 用校正後的正規名去 parse；校正不到任何東西時退回原文
 *
 * ⚠️ ②那個「退回原文」是 demo.html:131 的既有語意，保留 ——
 *    使用者可能講的本來就是正規名而 normalize 全部消耗掉，也可能整句都聽不懂。
 *    這兩種在 normalizedText 上都是空字串，退回原文對前者無害、對後者也只是照樣沒命中。
 *
 * 🔴 台數不在這裡算。hits 裡的 `tai` 是引擎當時算的值，一律丟掉，
 *    畫面上的台數只由 voiceTai.ts 的 taiOf/totalTai 算（fromHits 的檔頭同一條）。
 *    ⚠️ 2026-09-02 訂正：本行原本寫 grandTotal —— 那是含底的,而報台報純台數。
 *    否則同一個台種會有兩個台數來源，分岔時不會有任何東西轉紅。
 */
export function recognize(table: AsrFanTable, rawText: string): Heard {
  const raw = (rawText || '').trim();
  const empty: Heard = { raw, normalized: '', leftover: '', ignored: [], sel: {}, ids: [] };
  if (!raw) return empty;

  ensureIndex(table);

  const norm = MahjongPhonetic.normalize(raw);
  const text: string = norm.normalizedText || raw;
  const res = MahjongTai.parse(text, table);
  const sel = fromHits(res.hits || []);

  return {
    raw,
    normalized: norm.normalizedText || '',
    leftover: norm.leftover || '',
    ignored: norm.ignored || [],
    sel,
    ids: Object.keys(sel).sort(),
  };
}

/**
 * SpeechRecognition 的 error code → 給牌桌上的人看的中文。
 *
 * 🔴 這裡是純函式而且在 utils/ 裡，是刻意的：錯誤訊息是這個功能**唯一**
 *    會在「東西壞掉時」被看到的東西，而壞掉的路徑不會有人手動去點。
 *    寫在頁面元件裡的話，它結構上不會被任何測試跑到。
 *
 * ⚠️ 不要把未知的 code 吞成「請再試一次」——那會把「瀏覽器不給權限」
 *    和「沒聽到聲音」講成同一句話，而這兩者的處置完全相反。
 *    認不得的 code 照實印出來，讓回報的人講得出是哪一種。
 */
/**
 * 把 `getUserMedia` 丟出來的 DOMException 名稱翻成 **Web Speech 的錯誤代碼字彙**。
 *
 * 🔴 這支存在的理由是量出來的（D4-g，2026-09-02 收件端實測）：
 *    麥克風授權失敗時 `ensureWebMic` 拿到的是 `err.name`（`NotAllowedError`／
 *    `NotFoundError`／…），而 `SpeechRecognition.onerror` 給的是
 *    `not-allowed`／`audio-capture`／…。兩者**指的是同一件事、寫法完全不同**。
 *
 *    兩個後果，第二個比第一個嚴重：
 *    ① 畫面上顯示的是 `micErrorMessage` 的萬用分支「辨識錯誤：NotFoundError」，
 *       而不是那句寫好的「沒有麥克風權限。請在瀏覽器允許…」——實測到的就是這句。
 *    ② D4-g 的 `asrError` 指標會**同時存在兩套字彙**：後台聚合時
 *       `not-allowed` 與 `NotAllowedError` 會被算成兩種不同的失敗原因，
 *       每一種都只有真實數量的一半。而它不會報錯，只會讓每一格都變小。
 *
 * ⚠️ 認不得的名稱**原樣回傳**，不吞成 `not-allowed`：吞掉的話，
 *    瀏覽器新增一種失敗原因時我們會看到「權限問題變多了」而不是「有個沒見過的東西」。
 */
export function micErrorCode(name: string): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'not-allowed';
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'NotReadableError':
      return 'audio-capture';
    case 'AbortError':
      return 'aborted';
    default:
      return name;
  }
}

export function micErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      // iPhone 的補充來自 demo.html:307-309 的實測，不是猜的。
      return '沒有麥克風權限。請在瀏覽器允許麥克風；iPhone 另需到「設定 → 一般 → 鍵盤 → 啟用聽寫」。';
    case 'no-speech':
      return '沒聽到聲音，再講一次。';
    case 'audio-capture':
      return '找不到麥克風裝置。';
    case 'network':
      return '辨識服務連不上（這一段需要網路）。';
    case 'aborted':
      return '辨識被中斷了，再試一次。';
    default:
      return `辨識錯誤：${code || '(沒有錯誤代碼)'}`;
  }
}
