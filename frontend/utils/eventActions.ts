// utils/eventActions.ts — 局內（EventDetail）行動按鈕的顯示判準（[A1-b]）
//
// 🔴 為什麼抽成純函式：frontend/ 沒有任何元件測試，直接寫在 JSX 裡的條件
//    沒有任何東西接得住。這裡零 React 相依，utils/eventActions.test.ts 釘它。
//    EventDetail.tsx 只能呼叫它，不可把條件再抄一份回 JSX。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §8 第 2 項
//      （語音判台從記帳頁第 4 層提到局內主行動）。

export interface VoiceTaiEntryInput {
    isOwner?: boolean;
    joined?: boolean;
    /** 局的狀態："recruiting" | "full" | "closed" | "cancelled"（types.ts 的 Event.status） */
    status?: string;
}

/** 局已經結束、不會再開桌的狀態。判台是桌邊工具 ⇒ 這些狀態不顯示入口。 */
const FINISHED_STATUSES = new Set(['cancelled', 'closed']);

/**
 * 局內要不要顯示「語音判台」入口。
 *
 *   (isOwner || joined) && !FINISHED_STATUSES.has(status)
 *
 * - 判台是**桌邊工具**，只有這局的參與者需要（主揪或已加入者）。
 * - 取消的局不會開桌 ⇒ 不顯示。
 * - 🔴 `closed` 也不顯示。這一條 2026-09-03 訂正過：原本的工單寫「closed 要看得到」，
 *   理由是把它讀成「停止招募」。實查後端 `mahjongclub_web_submit_rating/main.go:547`，
 *   `closed` 是**四家評價全部完成後**才設的 ⇒ 語意是「已封存」，
 *   EventDetail.tsx:445 也把它畫成 `ARCHIVED`。那正是判台不需要的狀態。
 *   ⚠️ 這個字面值騙人的地方在於：`recruiting`／`full`／`closed`／`cancelled` 四個裡，
 *   只有它讀起來像「招募關閉」而實際是「整局結案」。
 * - 🔴 刻意**不綁** gameDetail.status === 'completed'：那是「評價」的條件，
 *   判台正好相反 —— 打完就不需要了。
 * - 🔴 刻意**不看有沒有過期**（`MyEvents.tsx` / `MyGamesSection.tsx` 排序用的
 *   `isExpired = 開局時間 < now`）。那把尺答的是「該排在清單多下面」，
 *   不是「這桌現在活著嗎」—— 桌子正好是**開局時間之後**才活著。
 *   拿它來擋，會在唯一真正需要判台的那段時間把按鈕收走。
 * - fail-closed：欄位是 undefined 一律當 false（看不到入口比誤顯示好）。
 *   `isOwner`／`joined` 在 types.ts 是 `boolean`，這裡仍用 `=== true`，
 *   擋的是 API 回 `1`／`'true'` 這種型別上進不來的東西。
 */
export function shouldShowVoiceTaiEntry(input: VoiceTaiEntryInput): boolean {
    const isParticipant = input.isOwner === true || input.joined === true;
    if (!isParticipant) return false;
    if (typeof input.status !== 'string') return false;
    return !FINISHED_STATUSES.has(input.status);
}
