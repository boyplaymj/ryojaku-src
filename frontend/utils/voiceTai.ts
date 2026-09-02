// utils/voiceTai.ts — 語音判台頁的「修正盤」純邏輯（D4-a）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4／§9
// UI 在 pages/TrainingVoiceTai.tsx，本檔不碰 React、不碰 DOM，只做狀態轉換與算術。
// 分層的理由不是潔癖：測試 runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts
// （scripts/run-tests.mjs:53-55）—— 放在 pages/ 的邏輯**結構上不會被任何測試跑到**。
//
// ── 三個不可以自己重寫的東西 ───────────────────────────────────────
//
// 🔴 ① 台數一律走 `MahjongTai.fanTai(fan, units)`，不准自己乘。
//    公式是 `tai × units + tai_base`，而 `tai_base` 承載「連莊 2N+1」家規裡的 +1
//    （即莊家台，故 lianzhuang excludes zhuang）。自己寫 `fan.tai * units`
//    會讓連莊每次都少 1 台，而那個結果**看起來完全合理**（連莊一次 2 台）。
//    demo.html:212 的註解已經為同一個坑寫過一次警告，這裡是第二個呼叫端。
//
// 🔴 ② `excludes` 是表裡的資料，不是我挑的。互斥關係共 10 組（實查 fan_table.json），
//    例如 lianzhuang↔zhuang、hunyise↔qingyise、dasanyuan→xiaosanyuan。
//    修正盤若允許使用者同時選中互斥的兩項，就會產出一個**引擎永遠不會產出的狀態**，
//    而合計台數會多算。⇒ 加入某項時，把與它互斥的都移除。
//    ⚠️ 表裡的 excludes **不是對稱寫的**（xiaosanyuan 沒有寫 excludes 大三元），
//    但互斥關係本身是對稱的 ⇒ 兩個方向都要查，只查單向會漏掉一半。
//
// 🔴 ③ per_unit 台種**沒有上限欄位**。實查 fan_table.json 的欄位全集，
//    只有 lianzhuang／hua／zhenghua 三個 per_unit，而**沒有任何一個帶 max**。
//    參考的 score_pad.html 是「點一下 +1、到 max 歸零」，但它的 max 寫在它自己
//    hardcode 的 yakuList 裡 —— 那是它的資料，不是我們的。
//    ⇒ 這裡不發明上限，改用 demo.html 既有的語意：點格子加入（units=1），
//      再用 ＋／− 調整，`−` 到 0 就移除（demo.html:205-207 同一條規則）。
//
// ⚠️ `totalTai` 是**純台數**（不含底），`grandTotal` 才含底
//    （`config.base_di`，現為 1）。設計冊的台數表全是純台數，
//    拿它去斷言含底的值會整排差 1 —— 而那個差看起來就像少算一台
//    （engine/mahjong-tai.test.ts 檔頭已為同一個坑定過錨）。

import { MahjongTai } from '../engine/mahjong-tai/index.mjs';

export interface Fan {
  id: string;
  name: string;
  tai: number;
  tai_base?: number;
  per_unit?: boolean;
  excludes?: string[];
  category?: string;
}

export interface FanTable {
  categories?: string[];
  fans: Fan[];
  config?: { base_di?: number };
}

/** id → 份數。份數恆 ≥ 1；不在表裡＝沒選。非 per_unit 的台種恆為 1。 */
export type Selection = Record<string, number>;

export interface PadSection {
  category: string;
  fans: Fan[];
}

const OTHER = '其他';

export function fanById(table: FanTable, id: string): Fan | undefined {
  return table.fans.find((f) => f.id === id);
}

/**
 * 依 `categories` 的宣告順序分組。
 * 🔴 沒有被 categories 涵蓋到的台種要落到「其他」，不可以靜靜消失 ——
 *    修正盤少一格不會報錯、不會少一支函式，只會讓某個台種**永遠補不上**。
 *    分組後的總數必須等於 table.fans.length（由測試釘住）。
 */
export function buildPad(table: FanTable): PadSection[] {
  const order = table.categories || [];
  const bucket = new Map<string, Fan[]>();
  for (const c of order) bucket.set(c, []);
  for (const f of table.fans) {
    const c = f.category && bucket.has(f.category) ? f.category : OTHER;
    if (!bucket.has(c)) bucket.set(c, []);
    bucket.get(c)!.push(f);
  }
  return [...bucket.entries()]
    .filter(([, fans]) => fans.length > 0)
    .map(([category, fans]) => ({ category, fans }));
}

/** 單一台種在給定份數下的台數。唯一來源＝引擎的 fanTai（見檔頭 ①）。 */
export function taiOf(table: FanTable, id: string, units: number): number {
  const fan = fanById(table, id);
  if (!fan) return 0;
  return MahjongTai.fanTai(fan, units);
}

/**
 * 與 `id` 互斥的、目前已選中的台種 id。
 * 兩個方向都查（見檔頭 ②）。
 */
function conflictsWith(table: FanTable, sel: Selection, id: string): string[] {
  const fan = fanById(table, id);
  if (!fan) return [];
  const mine = new Set(fan.excludes || []);
  return Object.keys(sel).filter((other) => {
    if (other === id) return false;
    if (mine.has(other)) return true;
    const of = fanById(table, other);
    return !!of?.excludes?.includes(id);
  });
}

/** 點一下格子：沒選就加入（份數 1，並移除互斥項）；已選就移除。 */
export function toggle(table: FanTable, sel: Selection, id: string): Selection {
  if (!fanById(table, id)) return sel;
  const next: Selection = { ...sel };
  if (next[id]) {
    delete next[id];
    return next;
  }
  for (const c of conflictsWith(table, next, id)) delete next[c];
  next[id] = 1;
  return next;
}

/**
 * per_unit 台種的 ＋／−。降到 0 就移除（demo.html:205-207 同一條規則）。
 * 對非 per_unit 的台種是 no-op —— 它們沒有「幾份」的概念，
 * 允許步進會讓「門清 ×3」這種不存在的狀態算得出台數來。
 */
export function step(table: FanTable, sel: Selection, id: string, delta: number): Selection {
  const fan = fanById(table, id);
  if (!fan || !fan.per_unit || !sel[id]) return sel;
  const next: Selection = { ...sel };
  const u = (next[id] || 1) + delta;
  if (u <= 0) delete next[id];
  else next[id] = u;
  return next;
}

/** 純台數（**不含底**）。 */
export function totalTai(table: FanTable, sel: Selection): number {
  return Object.entries(sel).reduce((s, [id, units]) => s + taiOf(table, id, units), 0);
}

/** 含底的合計（畫面上顯示的那個數字）。 */
export function grandTotal(table: FanTable, sel: Selection): number {
  return totalTai(table, sel) + (table.config?.base_di ?? 0);
}

/**
 * 把引擎 `parse()` 的 hits 轉成修正盤的選取狀態。
 * ⚠️ 只取 id 與 units —— hits 裡的 `tai` 是引擎當時算的值，
 * 在這裡重新用 `taiOf` 算一次，讓畫面上的台數只有一個來源。
 * （否則同一個台種會有兩個台數來源，分岔時不會有任何東西轉紅。）
 */
export function fromHits(hits: Array<{ id: string; units?: number }>): Selection {
  const sel: Selection = {};
  for (const h of hits) sel[h.id] = h.units && h.units > 0 ? h.units : 1;
  return sel;
}

/** 給飛輪用：目前選取的 id 陣列（排序後，讓比對穩定）。 */
export function selectedIds(sel: Selection): string[] {
  return Object.keys(sel).sort();
}
