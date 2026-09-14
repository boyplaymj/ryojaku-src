// utils/voiceExport.ts — 回灌工單：把後台看到的訂正紀錄打包成 repo 端可套用的檔（B案）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4.5（飛輪）、§5c 紀律 1（只有一條寫入路徑）。
//
// 🔴 **為什麼不是「後台直接寫 DDB」**：§5c 紀律 1 規定 DDB 那一列只有 `seed_ruleset.py`
//    一個寫入者，而 `check_ruleset_seeded.py` 整支守衛建立在這個前提上（它有一格叫
//    `ddb-malformed`：「那一列被別的東西寫過」）。後台直接寫的話會多出第二條路徑 ⇒
//    線上被改、repo 正典沒跟上 ⇒ **下一次任何人播種就把回灌沖掉，而版本號還是舊的
//    ⇒ 守衛會說 identical**。那是零徵兆的資料遺失，不是可以事後補的。
//
// 🔴 **匯出的是「函式的輸入」，不是「函式的輸出」。**
//    records 用 `toFeedbackRecords()` 產出，那正是 `extractSuggestions` 讀的形狀 ⇒
//    repo 端拿同一份 `feedback.js` 重算，**兩邊的輸入逐欄相同**，於是 `expected`
//    才有資格當一道對照。匯出已算好的建議的話，後台就變成第二個真值來源，
//    而「兩邊算出不同答案」會靜靜消失（沒有東西會去比）。
//
// 🔴 **不可以只匯出「有貢獻的那幾列」。** 門檻是 `distinctUsers >= minCount`，
//    那是**對整個母體**算的。挑過的子集會讓 repo 端重算出不同的 distinctUsers ⇒
//    對照必然不符，而那與「回灌算錯了」逐字相同。⇒ 掃到的列全帶。
//
// 🔴 **userId 一律雜湊後才出檔。** 後台頁面本身不顯示 userId，匯出等於一個**新的**
//    暴露面，而這個檔會被拿到開發機上跑。門檻只需要分辨「是不是同一個人」，
//    不需要知道是誰 ⇒ 雜湊完全夠用。
//    ⚠️ 碰撞會把兩個人算成一個 ⇒ distinctUsers **偏低** ⇒ 門檻**變嚴**（漏報而非誤報）。
//       方向是安全的那一邊，所以 16 hex 夠。
//    ⚠️ 但它**不是匿名化**：`text` 是使用者講的話，本來就在頁面上，匯出同級不變。

import { MIN_COUNT, toFeedbackRecords, type ReviewRecord, type ReviewSuggestion, type ReviewSummary } from './voiceReview.ts';

/** 匯出格式版本。repo 端 `apply.js` 認這個字串，不認副檔名。 */
export const EXPORT_FORMAT = 'ryojaku-voice-reflow/v1';

/** 一列訂正，剛好是 `extractSuggestions` 會讀到的那幾欄，不多不少。 */
export interface ExportRecord {
    text: string;
    /** 雜湊後的使用者代號；原本就沒帶的維持 `null`（**不要**合成一個假的）。 */
    userId: string | null;
    unmatched: string;
    added: string[];
    removed: string[];
}

export interface ExportBundle {
    _format: typeof EXPORT_FORMAT;
    /** 產生時間，只給人看；不參與任何判定。 */
    generatedAt: string;
    /**
     * 後台這份台數表的版本。repo 端不同版時要出聲 —— 見 `apply.js`。
     * ⚠️ 後台讀不到 `meta.version` 時是字面字串 `'(未知)'`，**不是** `null`
     *    （`voiceReview.ts:279` 的預設）—— 照抄它，不要自己改寫成 null，
     *    否則「後台真的沒有版本」與「我在這裡轉換掉了」分不出來。
     */
    tableVersion: string;
    /** 後台用的門檻。repo 端必須用同一個，否則 expected 不可比。 */
    minCount: number;
    /**
     * 資料裡有訂正是在**別的**表版本下產生的嗎。
     * `true` ⇒ expected 的方向是**多報**（App 已收錄的詞在這份表裡仍算新詞），
     * repo 端算出比較少是正常的。⚠️ 不帶這一欄的話，那個差會被讀成「回灌算錯」。
     */
    versionMismatch: boolean;
    /** 掃到幾列。 */
    scannedRows: number;
    /**
     * 掃完了嗎。`false` ⇒ `expected` 是**下限**，repo 端算出更多是正常的，
     * **不可以**讀成「對照不符」。
     */
    complete: boolean;
    /** userId 是不是雜湊過的。恆為 true；留這個欄位是為了讓「沒雜湊」講得出來。 */
    userIdHashed: boolean;
    records: ExportRecord[];
    /** 後台算出來的可自動回灌建議，供 repo 端對照（只有 add_confusion）。 */
    expected: ExpectedSuggestion[];
    /**
     * `review_mapping` 那類：**一律只印、交人工**（§4.5）。
     * 放在另一個欄位而不是混進 `expected`，因為 `apply.js` 不會套它們 ——
     * 混在一起的話對照必然不符，而那個「不符」沒有任何意義。
     */
    manualReview: ManualReviewItem[];
}

/** 對照用的最小形狀：term→fanId 與它的兩個計數。 */
export interface ExpectedSuggestion {
    term: string;
    fanId: string;
    count: number;
    distinctUsers: number;
}

export interface ManualReviewItem {
    fromFanId: string;
    toFanId: string;
    count: number;
    distinctUsers: number;
}

/**
 * SHA-256 前 16 hex。
 * ⚠️ 加 salt 沒有意義（salt 得跟著出檔，否則 repo 端無法重算）—— 這裡要的是
 *    「同一個人得到同一個代號」，不是「不可反推」。userId 是 UUID 形狀、空間夠大，
 *    但**不要**因此宣稱它防得住字典攻擊。
 */
export async function hashUserId(userId: string): Promise<string> {
    const bytes = new TextEncoder().encode(userId);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}

function toExpected(suggestions: ReviewSuggestion[]): ExpectedSuggestion[] {
    return suggestions
        // ⚠️ `s.type === 'add_confusion'` 這半**沒有任何測試涵蓋得到**（突變實測存活）：
        //    review_mapping 不帶 term/fanId，後面那兩個 shape guard 就先擋掉了 ⇒
        //    現行 feedback.js 產不出「非 add_confusion 卻帶 term+fanId」的建議，
        //    構不出能分開兩者的輸入。它是**防禦性冗餘**，不是被驗過的那一道 ——
        //    哪天 feedback.js 新增了帶 term 的建議型別，這裡是第二道而不是第一道。
        .filter((s) => s.type === 'add_confusion' && typeof s.term === 'string' && typeof s.fanId === 'string')
        .map((s) => ({
            term: s.term as string,
            fanId: s.fanId as string,
            count: s.count,
            distinctUsers: s.distinctUsers,
        }))
        // 決定性排序：同一份資料要產出逐 byte 相同的檔，否則兩次匯出無法比對。
        .sort((a, b) => (a.term === b.term ? a.fanId.localeCompare(b.fanId) : a.term.localeCompare(b.term)));
}

function toManual(suggestions: ReviewSuggestion[]): ManualReviewItem[] {
    return suggestions
        .filter((s) => s.type === 'review_mapping' && typeof s.fromFanId === 'string' && typeof s.toFanId === 'string')
        .map((s) => ({
            fromFanId: s.fromFanId as string,
            toFanId: s.toFanId as string,
            count: s.count,
            distinctUsers: s.distinctUsers,
        }))
        .sort((a, b) => (a.fromFanId === b.fromFanId ? a.toFanId.localeCompare(b.toFanId) : a.fromFanId.localeCompare(b.fromFanId)));
}

/**
 * 打包成回灌工單。
 *
 * @param rows    後台掃到的**全部**訂正列（不要先過濾）
 * @param summary `buildReview()` 的結果 —— 建議與健康度都從它來，不重算
 *                （重算一次 = 第二個實作 = 會漂）
 * @param minCount **傳給 `buildReview()` 的那一個**，不是「應該要是多少」。
 *   🔴 它得是顯式參數：`buildReview` 收得下自訂 minCount，而 `ReviewSummary`
 *      **不回傳它** ⇒ 這裡若自己去讀常數，呼叫端一旦覆寫過，出檔上寫的門檻
 *      就與 `expected` 實際的門檻不同 ⇒ repo 端用出檔上那個數字重算會得到
 *      不一樣的建議，而那與「後台算錯了」逐字相同。
 */
export async function buildExportBundle(
    rows: ReviewRecord[],
    summary: ReviewSummary,
    minCount: number = MIN_COUNT,
    now: Date = new Date(),
): Promise<ExportBundle> {
    const base = toFeedbackRecords(rows);
    const records: ExportRecord[] = [];
    for (const r of base) {
        records.push({
            text: r.text,
            userId: r.userId ? await hashUserId(r.userId) : null,
            unmatched: r.unmatched,
            added: r.added,
            removed: r.removed,
        });
    }
    return {
        _format: EXPORT_FORMAT,
        generatedAt: now.toISOString(),
        tableVersion: summary.health.tableVersion,
        minCount,
        versionMismatch: summary.health.versionMismatch,
        scannedRows: summary.health.totalRows,
        complete: summary.health.complete,
        userIdHashed: true,
        records,
        expected: toExpected(summary.suggestions),
        manualReview: toManual(summary.suggestions),
    };
}

/** 序列化。兩格縮排、鍵序固定 ⇒ 同一份資料兩次匯出逐 byte 相同。 */
export function serializeBundle(bundle: ExportBundle): string {
    return JSON.stringify(bundle, null, 2) + '\n';
}

/** 檔名帶日期與表版本 —— 拿到手上時分得出「這是哪一份」。 */
export function bundleFilename(bundle: ExportBundle): string {
    const day = bundle.generatedAt.slice(0, 10);
    const ver = bundle.tableVersion.replace(/[^0-9A-Za-z._-]/g, '_');
    return `voice-reflow-${day}-v${ver}.json`;
}
