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

/**
 * 局內要不要顯示「語音判台」入口。
 *
 *   (isOwner || joined) && status !== 'cancelled'
 *
 * - 判台是**桌邊工具**，只有這局的參與者需要（主揪或已加入者）。
 * - 取消的局不會開桌 ⇒ 不顯示。
 * - 🔴 刻意**不綁** gameDetail.status === 'completed'：那是「評價」的條件，
 *   判台正好相反 —— 打完就不需要了。recruiting／full／closed 都要看得到。
 * - fail-closed：欄位是 undefined 一律當 false（看不到入口比誤顯示好）。
 */
export function shouldShowVoiceTaiEntry(input: VoiceTaiEntryInput): boolean {
    const isParticipant = input.isOwner === true || input.joined === true;
    if (!isParticipant) return false;
    if (typeof input.status !== 'string') return false;
    return input.status !== 'cancelled';
}
