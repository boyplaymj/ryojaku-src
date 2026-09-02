// utils/voiceReview.ts — 語音判台「後台審核頁」的聚合層（D6）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4.3（後台端不算建議）、
//       §4.5（回灌紀律）、§📈（可觀測性）。
//
// ── 這支存在的理由 ──
//
// 用量卡（voiceUsage.ts）回答「有沒有人在用」；本檔回答另一個問題：**判錯在哪**。
// 兩件事：
//   ① 依 fanId 聚合 `added`／`removed` —— 哪些台種最常被人補上（系統漏判）、
//      哪些最常被刪掉（系統誤判）。這是新算的，沒有既有實作。
//   ② 呼叫 `feedback.js` 的 `extractSuggestions` 產出可回灌的建議。
//
// 🔴 ②**不可以在這裡重寫一份**。正典明訂 `extractSuggestions` 只該有一個實作
//    （§4.3：Go 叫不到它，所以後端只吐原始紀錄、由後台頁面呼叫 JS 那一份）。
//    後台能拿到它，是因為引擎副本被同步進 `src/engine/mahjong-tai/`
//    （正典側 `sync_manifest.txt` 的第二個 `# dest:`，D6-c）。
//
// 🔴 **本檔刻意直接 import 真引擎，測試也用真引擎、不用 stub。**
//    stub 會讓「引擎載得起來」這件事在接線時退化而沒有任何東西轉紅 ——
//    而 D6-c 量到的正是「`vite build` rc=0 而執行產物直接 throw」那種故障。

import { MahjongFeedback } from '../engine/mahjong-tai/index.mjs';
import type { CorrectionRecord, VoicePage } from './voiceUsage.ts';

/**
 * 一筆訂正列在**審核**視角需要的欄位。
 *
 * `voiceUsage.CorrectionRecord` 刻意只宣告用量卡用得到的四欄；這裡是同一個 API 回應的
 * 更寬視角，用 extends 而不是另立一個型別 —— 兩個各自宣告的話，後端改欄位時
 * 只會有一邊轉紅，而另一邊安靜地少讀一欄。
 *
 * 🔴 全部是可選的：後端對空集合回 `[]`（線上 V16 驗過），但「舊版後端」與
 *    「半壞的回應」不該讓整張頁爆掉 —— 它們該被**數出來**，見 `ReviewSummary.health`。
 */
export interface ReviewRecord extends CorrectionRecord {
  normalizedText?: string;
  parsed?: string[];
  corrected?: string[];
  /** 使用者補上的 fanId（系統漏判）。 */
  added?: string[];
  /** 使用者刪掉的 fanId（系統誤判）。 */
  removed?: string[];
  /** parse 沒對到任何台種的殘字。`extractSuggestions` 的型一建議全靠它。 */
  unmatched?: string;
  /** App 送出時它內建的 `fan_table.meta.version`（`TrainingVoiceTai.tsx:102`）。 */
  rulesetVersion?: string;
}

/** 一頁回應（審核視角）。`VoicePage` 可直接傳進來 —— `ReviewRecord` 是它的超集。 */
export interface ReviewPage extends Omit<VoicePage, 'data'> {
  data?: ReviewRecord[];
}

/** 台數表的最小形狀。只宣告本檔真的讀到的東西。 */
export interface FanTable {
  meta?: { version?: string };
  fans: { id: string; name: string; aliases?: string[]; asr_confusions?: string[] }[];
}

/**
 * 🔴 **`minCount` 上線後不可用 1**（§4.5）。`demo.html:99` 的 1 是 single-user demo
 * 為了即時見效才設的；多人環境要用 `feedback.js:78` 的預設 2，並倚賴 `distinctUsers`
 * —— 那道防護是「兩個**不同**使用者各一次才建議」，防單人灌爆。
 */
export const MIN_COUNT = 2;

/** 一個台種被訂正的次數。 */
export interface FanImpact {
  fanId: string;
  /** 台數表裡的中文名；表裡沒有這個 id 時是 `null`（見 `known`）。 */
  name: string | null;
  /**
   * 這個 id 在**後台這份**台數表裡找得到嗎。
   * 🔴 `false` 不是「壞資料」，最可能是**版本不一致**：App 那邊的表有這個台種、
   *    後台這份沒有。不可以靜靜丟掉 —— 丟掉的方向是「這個台種從來沒被訂正過」。
   */
  known: boolean;
  /** 被使用者補上的次數＝系統**漏判**。 */
  timesAdded: number;
  /** 被使用者刪掉的次數＝系統**誤判**。 */
  timesRemoved: number;
  total: number;
}

/** 一則可回灌的建議（`feedback.js` 的輸出，這裡只加上人看得懂的名字）。 */
export interface ReviewSuggestion {
  type: 'add_confusion' | 'review_mapping' | string;
  count: number;
  distinctUsers: number;
  examples: string[];
  /** type=add_confusion：要收進 `asr_confusions` 的殘字。 */
  term?: string;
  fanId?: string;
  fanName?: string | null;
  /** type=review_mapping：常被從 A 改成 B。 */
  fromFanId?: string;
  fromFanName?: string | null;
  toFanId?: string;
  toFanName?: string | null;
  /**
   * 可不可以自動套用。`add_confusion` 可以（`applySuggestion` 會做），
   * `review_mapping` **一律只印、交人工**（§4.5，`apply.js` 檔頭同一條）。
   */
  autoApplicable: boolean;
}

/** 這份結論有哪些地方不可信 —— 每一格都是「講出來」而不是「歸零」。 */
export interface ReviewHealth {
  totalRows: number;
  /** 掃完了嗎。`false` ⇒ 下面每個計數都是**下限**。 */
  complete: boolean;
  /**
   * 沒帶 `userId` 的列數。
   * 🔴 這不是小事：`extractSuggestions` 的門檻在有 `userId` 時看「幾個**不同**使用者」，
   *    完全沒帶時**退回筆數**（`feedback.js:104` 的向後相容分支）。
   *    ⇒ 缺 userId 的列會把「防單人灌爆」這道防護悄悄降級成「同一個人講兩次也算」。
   */
  rowsWithoutUserId: number;
  /**
   * `added`／`removed` **任一欄**不是陣列的列數（舊版後端／半壞的回應）。
   *
   * 🔴 判準是「任一」不是「兩者都」。這條是被突變測試逼出來的（M16 一開始存活）：
   *    兩版只在「只缺一欄」那種列上不同，而我原本的 fixture 沒有那種列。
   *    想清楚之後發現我挑錯邊了 —— 這一格問的是「回應的形狀有沒有壞」，
   *    不是「這列有沒有貢獻」。半壞的回應跟全壞的一樣值得看見，
   *    而「兩者都缺」會讓只壞一半的批次**靜靜通過**，方向正是這整套設計要避免的少報。
   *    ⚠️ 健康的後端兩欄都回 `[]`（線上 V16 驗過）⇒ 正常情況下這一格恆為 0，
   *      兩種寫法都是 0。它只在資料真的壞掉時才分得出來。
   */
  rowsWithBrokenDiffShape: number;
  /** 後台這份台數表的版本（算建議用的就是它）。 */
  tableVersion: string;
  /** 資料裡出現過的 `rulesetVersion` 及筆數，多到少排序。 */
  dataVersions: { version: string; count: number }[];
  /**
   * 資料裡有任何一版與 `tableVersion` 不同嗎。
   * 🔴 不同的話，建議是拿**另一張表**去評的：App 那邊已經收錄的詞，
   *    在這裡仍會被當成「新詞」提出來。方向是**多報**，不是漏報。
   */
  versionMismatch: boolean;
  /** 台數表裡找不到的 fanId（版本不一致最直接的證據）。 */
  unknownFanIds: string[];
}

export interface ReviewSummary {
  fans: FanImpact[];
  suggestions: ReviewSuggestion[];
  health: ReviewHealth;
}

/** `extractSuggestions` 真正讀的五個鍵（`feedback.js:86-104`）。 */
export interface FeedbackRecord {
  text: string;
  userId: string | null;
  unmatched: string;
  added: string[];
  removed: string[];
}

/**
 * 把 API 回應正規化成 `extractSuggestions` 吃的形狀。
 *
 * 🔴 五個鍵一個都不能少（§4.3「回傳欄位是對 feedback.js 的契約」）：
 *    少任何一個，飛輪只會**安靜地少找到一類建議** —— 不報錯、不少一支函式。
 * 🔴 `userId` 缺席時給 `null` 而不是 `''`：`feedback.js` 用 `if (r.userId)` 判斷，
 *    兩者行為相同，但 `null` 讓「沒有」在型別上是顯式的。
 */
export function toFeedbackRecords(rows: ReviewRecord[]): FeedbackRecord[] {
  return rows.map((r) => ({
    text: r.text ?? '',
    userId: r.userId ? r.userId : null,
    unmatched: r.unmatched ?? '',
    added: Array.isArray(r.added) ? r.added : [],
    removed: Array.isArray(r.removed) ? r.removed : [],
  }));
}

/** 依 fanId 聚合。回傳依 total 由多到少；同分時用 fanId 排序，讓輸出是決定性的。 */
export function aggregateByFan(rows: ReviewRecord[], table: FanTable): FanImpact[] {
  const names = new Map<string, string>();
  for (const f of table.fans ?? []) names.set(f.id, f.name);

  const acc = new Map<string, FanImpact>();
  const bump = (fanId: string, key: 'timesAdded' | 'timesRemoved') => {
    let e = acc.get(fanId);
    if (!e) {
      e = {
        fanId,
        name: names.get(fanId) ?? null,
        known: names.has(fanId),
        timesAdded: 0,
        timesRemoved: 0,
        total: 0,
      };
      acc.set(fanId, e);
    }
    e[key] += 1;
    e.total += 1;
  };

  for (const r of rows) {
    if (Array.isArray(r.added)) for (const id of r.added) bump(id, 'timesAdded');
    if (Array.isArray(r.removed)) for (const id of r.removed) bump(id, 'timesRemoved');
  }

  return [...acc.values()].sort(
    (a, b) => b.total - a.total || a.fanId.localeCompare(b.fanId)
  );
}

/**
 * 呼叫正典的 `extractSuggestions`，並補上人看得懂的台種名。
 *
 * 🔴 `minCount < MIN_COUNT` 直接拋錯，不悄悄夾到 2：夾住的話，呼叫端傳 1
 * 會拿到「看起來正常」的結果，而它以為門檻是 1。§4.5 那條規矩要擋得住，
 * 就不能只是預設值。
 */
export function extractReviewSuggestions(
  rows: ReviewRecord[],
  table: FanTable,
  minCount: number = MIN_COUNT
): ReviewSuggestion[] {
  if (!Number.isInteger(minCount) || minCount < MIN_COUNT) {
    throw new Error(
      `minCount 必須是 >= ${MIN_COUNT} 的整數（§4.5：1 是 single-user demo 專用，` +
        `多人環境會被單一使用者灌爆），實得 ${minCount}`
    );
  }
  const names = new Map<string, string>();
  for (const f of table.fans ?? []) names.set(f.id, f.name);
  const nameOf = (id?: string) => (id == null ? undefined : names.get(id) ?? null);

  const raw = MahjongFeedback.extractSuggestions(toFeedbackRecords(rows), table, { minCount });
  return (raw ?? []).map((s: Record<string, unknown>) => ({
    ...(s as unknown as ReviewSuggestion),
    fanName: nameOf(s.fanId as string | undefined),
    fromFanName: nameOf(s.fromFanId as string | undefined),
    toFanName: nameOf(s.toFanId as string | undefined),
    // review_mapping 一律交人工（§4.5）。這個旗標是頁面上「可自動／需人工」的唯一來源，
    // 不要在畫面那層再判一次 type —— 判準只該有一個地方。
    autoApplicable: s.type === 'add_confusion',
  }));
}

/** 把多頁回應攤平成列。 */
export function flattenPages(pages: ReviewPage[]): ReviewRecord[] {
  const out: ReviewRecord[] = [];
  for (const p of pages) if (Array.isArray(p?.data)) out.push(...p.data);
  return out;
}

/**
 * 整張審核頁的結論。
 *
 * @param complete 掃完了嗎（`collectPages` 的 `complete`）。
 *   🔴 一定要傳：`false` 時每個計數都是下限，而「只掃到一頁」與「表就這麼大」
 *   在數字上逐字相同。
 */
export function buildReview(
  pages: ReviewPage[],
  table: FanTable,
  complete: boolean,
  minCount: number = MIN_COUNT
): ReviewSummary {
  const rows = flattenPages(pages);
  const fans = aggregateByFan(rows, table);

  const versionCounts = new Map<string, number>();
  let rowsWithoutUserId = 0;
  let rowsWithBrokenDiffShape = 0;
  for (const r of rows) {
    if (!r.userId) rowsWithoutUserId += 1;
    if (!Array.isArray(r.added) || !Array.isArray(r.removed)) rowsWithBrokenDiffShape += 1;
    const v = r.rulesetVersion || '(未帶)';
    versionCounts.set(v, (versionCounts.get(v) ?? 0) + 1);
  }

  const tableVersion = table.meta?.version ?? '(未知)';
  const dataVersions = [...versionCounts.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version));

  return {
    fans,
    suggestions: extractReviewSuggestions(rows, table, minCount),
    health: {
      totalRows: rows.length,
      complete,
      rowsWithoutUserId,
      rowsWithBrokenDiffShape,
      tableVersion,
      dataVersions,
      // 只拿真的有帶版本的列去比：「(未帶)」是另一回事（舊列），
      // 混進來的話 mismatch 會對每一批舊資料都亮，亮到沒人看。
      versionMismatch: dataVersions.some(
        (d) => d.version !== '(未帶)' && d.version !== tableVersion
      ),
      unknownFanIds: fans.filter((f) => !f.known).map((f) => f.fanId),
    },
  };
}
