// 帳號刪除在前端用到的兩個常數與一個翻譯 —— 純邏輯，可單獨測試。
//
// 對外承諾寫在 legal/delete-account.txt；後端的判定在
// backend/cmd/lambdas/shared/account_deletion.go。這裡的天數是第三個載體，
// accountDeletion.test.ts 會拿它去對原稿。

/** 停用期天數。與刪除頁第三條、後端 AccountDeletionGrace 是同一個數字。 */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

/** 後端在「停用期已滿、不可登入」時回的 error 值（HTTP 410）。 */
export const ACCOUNT_DELETED_ERROR = 'account_deleted';

/**
 * 把後端的機器用 error 值換成給人看的句子；不是這支認得的值就回 null（呼叫端照原樣顯示）。
 * 少了它，登入頁會把 `account_deleted` 這個字串原樣秀給使用者。
 */
export function friendlyAccountError(raw: unknown): string | null {
    if (raw === ACCOUNT_DELETED_ERROR) return '這個帳號已經刪除，無法登入。';
    return null;
}
