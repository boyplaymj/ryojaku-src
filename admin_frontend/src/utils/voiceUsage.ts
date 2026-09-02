// utils/voiceUsage.ts — 語音判台用量卡的聚合層（D6）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §📈（可觀測性）、§4.4、§11.11。
//
// ── 這支存在的理由 ──
//
// D4-g 之後資料開始累積，但「看得到」還沒有載體（§11.11 末段）。本檔就是那個載體的
// **算術部分**，刻意與 React 分開：頁面只負責畫，所有「一個數字代表什麼」的判斷在這裡，
// 因為那些判斷全都是**錯了不會報錯**的那一種。
//
// 🔴 **每一格都要能回答「這個數字是低估還是高估」。** 本功能整套埋點的目的就是分辨
//    「沒人用」與「壞掉」（§4.4）；而這裡每一個會出錯的地方，方向都指向
//    「看起來沒人用」。所以下面每一個 fail-safe 都是往「講出來」而不是往「歸零」走。
//
// ── 呼叫端契約 ──
//
// 吃的是 `GET /admin/voice-corrections` 的**多頁**回應（一頁 = 一次 Scan，200 筆）。
// 後端那支 `PageEvents` 的註解自己寫了：「名字裡的 Page 不是修飾語，是判準」——
// 要總數就得把每頁自己加起來，而那件事被指名是 D6 的責任。這裡就是它。

/** 一筆訂正列（`kind='correction'`，含 D4-c～D4-g 之間缺 kind 的舊列）。 */
export interface CorrectionRecord {
  userId: string;
  text: string;
  hadDiff: boolean;
  /** 秒級（`voiceCorrection.nowTs`）。缺欄時後端回 0 —— 見 `classifyTs`。 */
  ts: number;
}

/** 後端 `PageEvents`（**這一頁**的漏斗計數，不是全表）。 */
export interface PageEvents {
  open: number;
  asrOk: number;
  asrFailed: number;
  asrErrors: Record<string, number>;
  /** 認得出是事件、但 kind 不在已知清單裡。**不可併進其他格**，見後端註解。 */
  other: number;
}

/** 一頁回應。欄位全部可缺 —— 舊版後端／半壞的回應不該讓整張卡爆掉。 */
export interface VoicePage {
  data?: CorrectionRecord[];
  nextCursor?: string;
  skipped?: number;
  pageEvents?: Partial<PageEvents>;
}

export interface AggregateOptions {
  /** 現在（毫秒）。**一定要傳** —— 讀死 `Date.now()` 的話這支就不可測。 */
  nowMs: number;
  /** 「本週」的天數。預設 7。 */
  windowDays?: number;
}

/**
 * 時間戳的三種狀態。分開記是因為它們的處置完全不同，
 * 而合在一起的話**兩種壞掉都會偽裝成「不在本週」**（＝看起來沒人用）。
 */
export type TsClass = 'seconds' | 'undated' | 'future';

/** 秒 / 毫秒的分界。1e11 秒 ≈ 西元 5138 年，1e11 毫秒 ≈ 1973 年 ⇒ 中間沒有歧義帶。 */
const MS_THRESHOLD = 1e11;

/** 允許的時鐘超前量（秒）。裝置時鐘快幾分鐘很常見，不該被叫成壞資料。 */
const FUTURE_SLACK_SEC = 24 * 3600;

/**
 * 把一個 `ts` 正規化成秒，並說出它屬於哪一類。
 *
 * 🔴 **毫秒不是假想的。** `voiceCorrection.nowTs` 確實只送秒，但 §4.3b 的線上驗收
 *    **實際寫進 stg 表**過一筆毫秒級 `ts`（那段自己寫著「送毫秒級 ts」）。
 *    表裡真的有這種列，所以這裡不是防禦性猜測，是照著量到的東西寫。
 *    不換算的話它會落在西元 5138 年 ⇒ 掉出「本週」⇒ 靜靜少一筆。
 *
 * 🔴 **`ts <= 0` 不可以當成 0 秒。** 後端 `numAttr` 對缺欄／壞值回 0，而 0 秒是 1970 ——
 *    永遠不在任何一個「最近 N 天」的窗裡。當成有效時間戳的話，那些列會從窗內統計中
 *    安靜消失，而消失的方向正好是「看起來沒人用」。⇒ 另立一類，並且要在卡上顯示。
 */
export function classifyTs(ts: number, nowSec: number): { sec: number; cls: TsClass } {
  if (!Number.isFinite(ts) || ts <= 0) return { sec: 0, cls: 'undated' };
  const sec = ts >= MS_THRESHOLD ? Math.floor(ts / 1000) : Math.floor(ts);
  if (sec > nowSec + FUTURE_SLACK_SEC) return { sec, cls: 'future' };
  return { sec, cls: 'seconds' };
}

export interface UsageSummary {
  // ── 掃描範圍（先講「這份數字涵蓋多少」，再講數字本身）──
  /** 掃了幾頁。 */
  pagesScanned: number;
  /**
   * 是不是掃到底了。`false` ⇒ **底下每一個計數都是下限**，卡片必須寫「至少」。
   * 判準是最後一頁的 `nextCursor` 是不是空的。
   */
  complete: boolean;

  // ── 訂正列（分母只含 correction，事件已由後端擋在 data 之外）──
  /** 訂正總筆數。 */
  corrections: number;
  /** 不重複 userId 數（訂正列）。 */
  distinctUsers: number;
  /** `hadDiff=false` 的筆數 —— 「講完不必改就送出」的那一半（§4.4）。 */
  noDiff: number;
  /**
   * 未訂正率 = `noDiff ÷ corrections`。
   * 🔴 **分母 0 時是 `null`，不是 0。** 0 會被讀成「一次都沒判對」，
   *    而真相是「還沒有人送過」—— 兩者的處置相反（`fail-open 不是退回 0`）。
   */
  noDiffRate: number | null;

  // ── 時間窗（只對訂正列成立，見 windowNote）──
  windowDays: number;
  /** 窗內訂正筆數。 */
  windowCorrections: number;
  /** 窗內不重複 userId。 */
  windowDistinctUsers: number;
  /** `ts` 缺欄／<=0 的筆數。**這些列不在任何時間窗內**，所以要單獨講出來。 */
  undated: number;
  /** `ts` 落在未來的筆數（超過 24h slack）。同上，也是「窗會少算」的來源。 */
  futureDated: number;

  // ── 漏斗事件（跨頁加總）──
  open: number;
  asrOk: number;
  asrFailed: number;
  asrErrors: Record<string, number>;
  /** kind 認不得的事件列。>0 ⇒ 寫入端加了新 kind 而後端／本頁沒跟上。 */
  otherEvents: number;
  /** ASR 失敗率 = `asrFailed ÷ (asrOk + asrFailed)`；沒有任何一次按壓時是 `null`。 */
  asrFailRate: number | null;

  /**
   * 🔴 **事件列的不重複人數結構上算不出來。**
   * 後端 `countEvent` 只累加計數，`userId` 停在 `toRecord` 那一層就沒有再往外傳
   * （事件列 `continue` 掉、不進 `data`）。
   * ⇒ 這一格永遠是 `null`，而且型別就寫死 `null`：想填一個數字進來必須先改型別，
   *   改型別就會撞到這段註解。**不要拿 `open` 的次數去代替人數。**
   */
  openDistinctUsers: null;

  // ── 資料健康 ──
  /** 形狀壞掉、後端跳過的列（pk 不是 `USER#…`）。>0 ⇒ 寫入端或表結構出事。 */
  skipped: number;

  // ── 判準（§📈「上線後何時回頭看」）──
  /**
   * 樣本夠不夠談準確度。判準寫死在 `SAMPLE_GATE`：
   * **總筆數 < 20 或 不重複 userId < 3 ⇒ 不足**。
   * 不足時 `noDiffRate` 仍然算得出來，但**不得據此宣稱準確率高或低**。
   */
  sampleSufficient: boolean;
  /** 沒過的是哪幾條（給卡片直接顯示，不要在畫面那層重寫一次判斷）。 */
  sampleGateReasons: string[];
}

/** §📈「上線後何時回頭看」訂死的門檻。改這裡＝改判準，不是改樣式。 */
export const SAMPLE_GATE = { minCorrections: 20, minDistinctUsers: 3 } as const;

/**
 * 把多頁回應聚合成一張卡要用的數字。
 *
 * 🔴 這支**不做網路**、不讀 `Date.now()`、不吃 React —— 全部從參數進來。
 *    理由不是潔癖：這裡每一條規則都是「錯了不會報錯」的那種，
 *    唯一能證明它對的方式就是拿合成資料去問它，而那要它可測。
 */
export function aggregate(pages: VoicePage[], opts: AggregateOptions): UsageSummary {
  const windowDays = opts.windowDays ?? 7;
  const nowSec = Math.floor(opts.nowMs / 1000);
  const windowStart = nowSec - windowDays * 86400;

  const users = new Set<string>();
  const windowUsers = new Set<string>();
  const asrErrors: Record<string, number> = {};

  let corrections = 0;
  let noDiff = 0;
  let windowCorrections = 0;
  let undated = 0;
  let futureDated = 0;
  let open = 0;
  let asrOk = 0;
  let asrFailed = 0;
  let otherEvents = 0;
  let skipped = 0;

  for (const page of pages) {
    for (const r of page.data ?? []) {
      corrections++;
      if (r.userId) users.add(r.userId);
      if (!r.hadDiff) noDiff++;

      const { sec, cls } = classifyTs(r.ts, nowSec);
      if (cls === 'undated') {
        undated++;
      } else if (cls === 'future') {
        futureDated++;
      } else if (sec >= windowStart) {
        windowCorrections++;
        if (r.userId) windowUsers.add(r.userId);
      }
    }

    const ev = page.pageEvents;
    if (ev) {
      open += ev.open ?? 0;
      asrOk += ev.asrOk ?? 0;
      asrFailed += ev.asrFailed ?? 0;
      otherEvents += ev.other ?? 0;
      for (const [code, n] of Object.entries(ev.asrErrors ?? {})) {
        asrErrors[code] = (asrErrors[code] ?? 0) + n;
      }
    }
    skipped += page.skipped ?? 0;
  }

  // 🔴 掃到底 = **最後一頁**沒有 nextCursor。中間頁有沒有 cursor 不代表任何事。
  //    沒有任何一頁時是 false（`complete` 的意思是「我掃完了」，
  //    而一頁都沒拿到時我什麼都沒掃完 —— 空陣列不可以長得像「全表為空」）。
  const last = pages[pages.length - 1];
  const complete = pages.length > 0 && !last?.nextCursor;

  const asrTotal = asrOk + asrFailed;
  const reasons: string[] = [];
  if (corrections < SAMPLE_GATE.minCorrections) {
    reasons.push(`訂正筆數 ${corrections} < ${SAMPLE_GATE.minCorrections}`);
  }
  if (users.size < SAMPLE_GATE.minDistinctUsers) {
    reasons.push(`不重複使用者 ${users.size} < ${SAMPLE_GATE.minDistinctUsers}`);
  }

  return {
    pagesScanned: pages.length,
    complete,
    corrections,
    distinctUsers: users.size,
    noDiff,
    noDiffRate: corrections > 0 ? noDiff / corrections : null,
    windowDays,
    windowCorrections,
    windowDistinctUsers: windowUsers.size,
    undated,
    futureDated,
    open,
    asrOk,
    asrFailed,
    asrErrors,
    otherEvents,
    asrFailRate: asrTotal > 0 ? asrFailed / asrTotal : null,
    openDistinctUsers: null,
    skipped,
    sampleSufficient: reasons.length === 0,
    sampleGateReasons: reasons,
  };
}

/**
 * 把一個計數寫成人看的字串。掃描未完成時一律加「至少」。
 *
 * 存在的理由跟 `complete` 是同一個：低估的方向是「看起來沒人用」，
 * 而 `1,203` 與 `至少 1,203` 在版面上長得很像、意思差很多。
 * 集中在這裡是為了不讓每一格各自決定要不要加那兩個字。
 */
export function countLabel(n: number, complete: boolean): string {
  return complete ? String(n) : `至少 ${n}`;
}

/** 百分比。`null` 一律回 `—`，**不回 `0%`**（理由同 `noDiffRate`）。 */
export function pctLabel(rate: number | null, digits = 1): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(digits)}%`;
}

// ── 翻頁 ─────────────────────────────────────────────────────────────

/**
 * 最多翻幾頁。25 × 200 = 5,000 列。
 *
 * 🔴 上限存在的理由不是效能，是**它一定要被說出來**：撞到上限時後面的資料沒有被看到，
 *    而「沒看到」與「沒有」在每一格數字上長得一模一樣。撞上限時最後一頁仍帶著
 *    `nextCursor` ⇒ `aggregate` 的 `complete` 自然是 `false` ⇒ 每個計數都會標「至少」。
 */
export const MAX_PAGES = 25;

export interface CollectResult {
  pages: VoicePage[];
  /** 是不是因為撞上限才停的（而不是因為翻完了）。給卡片講得更精確用。 */
  hitCap: boolean;
}

/**
 * 從第一頁一路翻到底（或到上限）。
 *
 * `fetchPage` 由呼叫端注入 —— 這支不碰 `fetch`，因為「翻頁會不會停下來」
 * 是這裡唯一值得測的東西，而它要可測就不能自己開連線。
 */
export async function collectPages(
  fetchPage: (cursor: string) => Promise<VoicePage>,
  maxPages: number = MAX_PAGES
): Promise<CollectResult> {
  const pages: VoicePage[] = [];
  let cursor = '';
  while (pages.length < maxPages) {
    const page = await fetchPage(cursor);
    pages.push(page);
    const next = page.nextCursor ?? '';
    if (!next) break;
    // 🔴 cursor 沒有前進就停。後端若因為某種原因一直回同一個 cursor，
    //    這裡會是一個**打真實 API 的無窮迴圈** —— 那不是慢，是打爆自己的後端。
    if (next === cursor) break;
    cursor = next;
  }
  const last = pages[pages.length - 1];
  return { pages, hitCap: pages.length >= maxPages && !!last?.nextCursor };
}
