// utils/rulesetSource.ts — App 端「這一局用哪一份台數表」的純邏輯（D5-d）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c（A 案四條紀律）。
// 本檔不碰 React、不碰 fetch、不碰 localStorage 本尊 —— 只做選擇與驗證。
// 分層理由同 utils/voiceTai.ts：測試 runner 的 glob 只收 utils/*.test.ts，
// 放進 pages/ 或 hooks/ 的邏輯**結構上不會被任何測試跑到**。
//
// ── 這一層要回答的問題 ────────────────────────────────────────────
//
// 手上最多有三份表：bundle（隨 App 出貨）、remote（GET /ruleset 這次拿到的）、
// cache（上一次 remote 的複本，存在 localStorage）。選一份出來用，
// 並且**誠實回報用的是哪一版**（紀律 4）—— 不是回報「我打算用的」。
//
// 🔴 ① 版本比較一律用數字元組，不可以拿字串比大小。
//    `"0.10.0" < "0.9.0"` 是**真的**，而那個錯誤方向是「把落後說成領先」＝放行。
//    比較語意刻意與 tools/mahjong-tai/check_ruleset_seeded.py 的 parse_version 對齊
//    （點分、每段全是數字、逐段比、段數不同時較短的較小）——
//    出貨前那道守衛與執行期這一支若對「誰比較新」意見不同，
//    就會出現「守衛放行、App 卻退回 bundle」這種沒有人看得懂的狀態。
//
// 🔴 ② 版本一樣時取 bundle，不是取 remote。
//    同版異容是**錯誤狀態**（check_ruleset_seeded.py 的 same-version-diff，rc=1），
//    出貨前那道守衛就會擋。執行期撞到它時，bundle 是「出貨前被檢查過的那一份」。
//    ⇒ 這條同時讓穩態（兩份同版同容）零行為差異：拿不拿得到遠端都跑同一份表。
//
// 🔴 ③ remote 比 bundle 舊 ⇒ 用 bundle。
//    紀律 4 只允許 `DDB.version >= bundle.version`（播種比發版快）。
//    反過來代表**忘了播種**，此時吃遠端那份等於主動降級到一份已知較舊的表。
//
// 🔴 ④ remote 的驗證是 fail-closed，而且**快取讀回來要再驗一次**。
//    localStorage 是別的東西也寫得進去的地方，格式又會隨版本改 ——
//    「存進去時驗過了」不涵蓋「讀出來的還是那個形狀」。
//    特別是 `fans: []`：空表會讓每一句話都判 0 台，
//    而那與「表還沒建」在 App 端讀數上逐字相同（§0.2 的 bug 根因同構）。
//
// ── 界線（不要讀成別的）──────────────────────────────────────────
//
// ⚠️ 遠端那份**沒有 `categories`**（下發契約是五鍵 version/fans/combos/ignores/config，
//    見 backend/cmd/lambdas/apis/mahjongclub_ruleset/main.go）。
//    `categories` 只決定修正盤的**分組顯示**，不參與任何計分
//    ⇒ 用 bundle 的那份補上。組出來的是一張混合表：
//      **計分五鍵來自 remote，分組來自 bundle。**
//    `rulesetVersion` 回報 remote 的版本是誠實的 —— 它回答的是
//    「這筆訂正是對哪一版**計分**表做的」（§4.2），而分組不影響台種 id 與台數。
//    遠端新增一個 bundle 不認得的 category 時，那些台種會落到「其他」
//    （buildPad 既有行為），看得到、只是分組沒那麼漂亮 —— 有內容的降級，不是靜默消失。

import type { AsrFanTable } from './voiceTaiAsr';
import type { Fan } from './voiceTai';

/** 用的是哪一份。`remote`＝這次連線拿到的；`cache`＝上一次拿到的複本。 */
export type RulesetSource = 'bundle' | 'remote' | 'cache';

/** 下發契約的五鍵。與 lambda 的 RulesetResponse 一致（success 除外）。 */
export interface RemoteRuleset {
  version: string;
  fans: Fan[];
  combos: unknown[];
  ignores: unknown[];
  config: Record<string, unknown>;
}

export interface RulesetPick {
  /** 可以直接餵給 buildPad()／recognize() 的表。 */
  table: AsrFanTable;
  /** 🔴 誠實回報：`table` 的計分欄位實際來自哪一版。送 rulesetVersion 用這個。 */
  version: string;
  source: RulesetSource;
  /** 為什麼選它。給 console／除錯用，不給使用者看。 */
  reason: string;
}

/**
 * ⚠️ 判別子用字串不用布林。本專案的 tsconfig 沒有開 `strict`
 * （見 tsconfig.json），而 `{ok:true}|{ok:false}` 這種**布林**判別子
 * 在 strictNullChecks 關掉時**不會 narrow** —— 實測：
 * `p.ok ? p.value : p.why` 會報 "Property 'why' does not exist on type"。
 * 那個錯很容易被一句 `as` 壓下去，而壓下去之後型別就再也擋不住寫錯欄位。
 */
export type ParseResult =
  | { kind: 'ok'; value: RemoteRuleset }
  | { kind: 'bad'; why: string };

/**
 * `0.2.0` → [0,2,0]。排不出先後就回 null —— **不猜**。
 * 見檔頭 ①：與 check_ruleset_seeded.py 的 parse_version 同語意。
 */
export function parseVersion(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split('.');
  if (parts.length === 0) return null;
  for (const p of parts) {
    // /^\d+$/：空字串、負號、小數點、全形數字全部排除。
    // ⚠️ 不可以用 Number(p) 判 —— Number('') 是 0、Number(' 1 ') 是 1，
    //    兩者都會讓「不是版本號的東西」變成一個看起來合法的版本。
    if (!/^\d+$/.test(p)) return null;
  }
  return parts.map((p) => Number(p));
}

/** a 與 b 的先後：a>b 回正、a<b 回負、相同回 0。段數不同時較短的較小。 */
export function compareVersion(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = i < a.length ? a[i] : -1;
    const y = i < b.length ? b[i] : -1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 驗一份「聲稱是台數表」的東西。fail-closed：任何一項說不清楚就整份不收。
 * 回 why 而不是只回 null —— 退回 bundle 的**原因**是除錯時唯一的線索
 * （「拿不到」與「拿到但不收」處置完全不同）。
 */
export function parseRemote(raw: unknown): ParseResult {
  if (!isPlainObject(raw)) return { kind: 'bad', why: '不是物件' };
  if (typeof raw.version !== 'string' || raw.version.trim() === '') {
    return { kind: 'bad', why: 'version 缺席或空字串' };
  }
  if (parseVersion(raw.version) === null) {
    // 排不出先後就無法執行紀律 4（DDB.version >= bundle.version）——
    // 收下它等於在一個量不了的維度上放行。
    return { kind: 'bad', why: `version 不是點分數字（${raw.version}）` };
  }
  if (!Array.isArray(raw.fans) || raw.fans.length === 0) {
    // 🔴 空陣列不是「這家沒有台種」，是壞掉。見檔頭 ④。
    return { kind: 'bad', why: 'fans 不是陣列或是空的' };
  }
  for (const f of raw.fans) {
    if (!isPlainObject(f) || typeof f.id !== 'string' || f.id === '') {
      return { kind: 'bad', why: 'fans 裡有沒有 id 的項目' };
    }
  }
  if (!Array.isArray(raw.combos)) return { kind: 'bad', why: 'combos 不是陣列' };
  if (!Array.isArray(raw.ignores)) return { kind: 'bad', why: 'ignores 不是陣列' };
  // ⚠️ config 只驗形狀，不驗裡面有什麼。`config: {}` 是合法的
  //    （base_di 缺席＝這家沒有底，scoring.js:165 的 `if (cfg.base_di)`
  //     讓缺席與 0 逐值相同）—— 要求它有內容等於發明一條引擎沒有的約束。
  if (!isPlainObject(raw.config)) return { kind: 'bad', why: 'config 不是物件' };
  return {
    kind: 'ok',
    value: {
      version: raw.version,
      fans: raw.fans as Fan[],
      combos: raw.combos,
      ignores: raw.ignores,
      config: raw.config,
    },
  };
}

/**
 * 把遠端五鍵組成一張可用的表。`categories` 借 bundle 的（見檔頭界線那段）。
 * 🔴 `meta` 只帶 version：bundle 的 meta 有 title／notes／usage 那些說明文字，
 *    搬過來的話畫面上會出現「這一版根本沒有的說明」，而它看起來完全正常。
 */
export function toTable(remote: RemoteRuleset, bundle: AsrFanTable): AsrFanTable {
  return {
    meta: { version: remote.version },
    categories: bundle.categories,
    fans: remote.fans,
    combos: remote.combos as AsrFanTable['combos'],
    ignores: remote.ignores as string[],
    config: remote.config as AsrFanTable['config'],
  };
}

export interface PickInput {
  bundle: AsrFanTable;
  /** 這次連線拿到的（已通過 parseRemote）。沒拿到就別傳。 */
  remote?: RemoteRuleset | null;
  /** 上一次的複本（已通過 parseRemote）。 */
  cached?: RemoteRuleset | null;
}

/**
 * 選一份出來用。bundle 永遠是保底（它一定在，且一定是出貨前被守衛檢查過的那份）。
 *
 * 規則（見檔頭 ①②③）：取版本最大的一份；**平手取 bundle**；
 * remote 與 cache 同為最大時取 remote（比較新鮮）。
 */
export function pickRuleset(input: PickInput): RulesetPick {
  const { bundle } = input;
  const bundleVersion = bundle.meta?.version ?? 'unknown';
  const fallback: RulesetPick = {
    table: bundle,
    version: bundleVersion,
    source: 'bundle',
    reason: '沒有比 bundle 新的表',
  };

  const bv = parseVersion(bundleVersion);
  if (bv === null) {
    // bundle 自己的版本排不出先後 ⇒ 紀律 4 這條尺在這台機器上量不了。
    // 此時**不准**讓遠端勝出：那等於在量不了的維度上放行。
    return { ...fallback, reason: `bundle 版本排不出先後（${bundleVersion}）⇒ 不採用遠端` };
  }

  const cands: Array<{ src: RulesetSource; r: RemoteRuleset; v: number[] }> = [];
  // 順序即平手時的優先序：remote 比 cache 新鮮。
  for (const [src, r] of [['remote', input.remote], ['cache', input.cached]] as const) {
    if (!r) continue;
    const v = parseVersion(r.version);
    if (v === null) continue; // parseRemote 已擋掉，這裡是第二道
    cands.push({ src, r, v });
  }
  if (cands.length === 0) return fallback;

  let best = cands[0];
  for (const c of cands.slice(1)) {
    if (compareVersion(c.v, best.v) > 0) best = c;
  }

  const d = compareVersion(best.v, bv);
  if (d < 0) {
    return {
      ...fallback,
      reason: `${best.src} 是 ${best.r.version}，比 bundle 的 ${bundleVersion} 舊 ⇒ 用 bundle（忘了播種？）`,
    };
  }
  if (d === 0) {
    return { ...fallback, reason: `${best.src} 與 bundle 同為 ${bundleVersion} ⇒ 用 bundle` };
  }
  return {
    table: toTable(best.r, bundle),
    version: best.r.version,
    source: best.src,
    reason: `${best.src} 是 ${best.r.version}，比 bundle 的 ${bundleVersion} 新`,
  };
}

// ── 這一次連線的結果 ────────────────────────────────────────────────

/**
 * 🔴 `not-found` 與 `unavailable` 必須分開，處置是**相反**的：
 *   - 404 ＝ 後端**權威地**說「那一列不存在」（DDB 沒有下發這回事）
 *     ⇒ 清掉快取、退回 bundle。留著一份沒有來源的複本才是不誠實。
 *   - 502／斷線／401／403 ＝ 這次**沒問到** ⇒ 保留快取，什麼都不改。
 * 合成同一種的話，一次後端故障就會把所有人手上的下發表清光，
 * 而畫面上完全看不出來（台數表換回 bundle 不會有任何錯誤訊息）。
 */
export type RulesetFetch =
  | { kind: 'ok'; value: RemoteRuleset }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; why: string };

/**
 * 把 apiRequest 的回傳收斂成三種。純函式，好在 utils 這一層被測到。
 *
 * ⚠️ 200 但內容不收（parseRemote 失敗）算 `unavailable` 不算 `not-found` ——
 *    「拿到但不收」不是「後端說沒有」，拿它去清快取是把自己的懷疑
 *    當成後端的結論。
 */
export function classifyRulesetResponse(res: unknown): RulesetFetch {
  if (!isPlainObject(res)) return { kind: 'unavailable', why: '回應不是物件' };
  const status = typeof res.status === 'number' ? res.status : undefined;
  if (res.success === true) {
    const p = parseRemote(res);
    if (p.kind === 'bad') return { kind: 'unavailable', why: `200 但內容不收：${p.why}` };
    return { kind: 'ok', value: p.value };
  }
  if (status === 404) return { kind: 'not-found' };
  const why = typeof res.error === 'string' && res.error ? res.error : `HTTP ${status ?? '?'}`;
  return { kind: 'unavailable', why };
}

/**
 * 拿到這次的結果之後**該做什麼**。純函式，理由是分層：
 * 「404 清快取、502 不清」是本功能最容易寫反的一條判準，
 * 而 hooks/ 不在 run-tests.mjs 的 glob 裡 —— 判準留在那裡等於沒有守衛。
 * ⇒ hook 只負責把這裡的結論接到 setState，不自己再判一次。
 */
export interface FetchOutcome {
  /** 這次拿到的表。null＝不動現況（不是「沒有表」）。 */
  remote: RemoteRuleset | null;
  /** 要不要把 remote 寫進快取。 */
  store: boolean;
  /** 🔴 要不要丟掉手上那份快取。只有 404 為真。 */
  dropCache: boolean;
  /** 給 console 的一句話。空字串＝這次沒有話要說。 */
  note: string;
}

export function applyFetch(f: RulesetFetch): FetchOutcome {
  if (f.kind === 'ok') {
    return { remote: f.value, store: true, dropCache: false, note: '' };
  }
  if (f.kind === 'not-found') {
    // 後端權威地說「沒有下發這回事」⇒ 手上那份複本沒有來源了。
    return { remote: null, store: false, dropCache: true, note: '/ruleset 回 404：後台沒有下發表，用 bundle 內的那份' };
  }
  // 這次沒問到 —— 什麼都不改，繼續用手上那份。
  return { remote: null, store: false, dropCache: false, note: `/ruleset 這次沒問到（保留現用的表）：${f.why}` };
}

// ── 快取 ────────────────────────────────────────────────────────────
//
// 收一個 storage-like 介面而不是直接摸 localStorage：模組載入時就碰全域物件
// 會讓這支在測試／SSR 裡無法載入，而那種失敗長得像「程式寫錯」。

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** v1：形狀改了就換鍵名，讓舊格式自然失效，不要去猜舊資料。 */
export const CACHE_KEY = 'mahjongclub_voice_tai_ruleset_v1';

/**
 * 讀快取。**讀回來要重跑 parseRemote**（檔頭 ④）。
 * 任何一種讀不出來都回 null —— 這裡沒有「半份表」這個選項。
 */
export function readCache(storage: StorageLike | null | undefined): RemoteRuleset | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(CACHE_KEY);
  } catch {
    return null; // Safari 無痕模式的 localStorage 會直接拋
  }
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const p = parseRemote(obj);
  return p.kind === 'ok' ? p.value : null;
}

/** 寫快取。寫不進去不是錯誤（配額滿／無痕）—— 下次照樣會去抓。 */
export function writeCache(storage: StorageLike | null | undefined, r: RemoteRuleset): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清快取。
 * 🔴 只有 404 該呼叫它，502／網路錯誤不可以（見 hooks/useRuleset.ts）：
 *    404 是後端**權威地說「沒有下發這回事」**，
 *    502／斷線是「這次沒問到」—— 兩者處置相反。
 */
export function clearCache(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(CACHE_KEY);
  } catch {
    /* 清不掉就算了：下一次 pick 仍會拿它跟 bundle 比版本，而 bundle 保底 */
  }
}
