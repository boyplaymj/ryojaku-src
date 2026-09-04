// utils/authParam.ts — 決定 API 的身分參數要用 `userId=` 還是 `lineID=`
//
// 這支從 `services/apiService.ts` 的私有 `getAuthParam()` 抽出來，理由跟
// `clientPlatform.ts` 一樣：它是一個**判斷**，而私有函式測不到，
// 而 runner 的 glob 只收 `utils/*.test.ts`。
//
// ── 它為什麼需要被修（2026-09-04，稽核報告 finding 2 §3b 順帶發現）─────
//
// 原本的判準是：
//
//     const isAppUser = userIdentifier.startsWith('APP_') || userIdentifier.startsWith('U');
//
// 而 `authService.loginWithLineId()` 的 LINE 登入 fallback 傳進來的是
// **加密後的 LINE ID** —— 後端 `DecryptLineID` 讀的是 AES-GCM 密文的
// **URL-safe base64**（`mahjongclub_web_verify_user/main.go:117`）。
//
// 🔴 base64 的字元集有 64 個字元，其中一個就是 `U`
//    ⇒ **約 1/64 的密文會以 `U` 開頭**，那一次登入就會被判成「APP 用戶」，
//    送出 `userId=<密文>`。後端拿密文當 userId 主鍵直查 ⇒ 查不到 ⇒ 登入失敗。
//
// 它的形狀最難查：**同一個帳號、同一組操作，偶爾失敗、重試就好**
// （每次登入的密文都不同，因為 GCM nonce 是隨機的）。
//
// ── 為什麼判準是「長度」而不是「hex 字元集」──────────────────────────
//
// 兩個方向的錯法代價不對稱：
//   判太寬（把密文當 userId）→ 就是現在這個 bug，約 1/64 的登入失敗
//   判太嚴（把真的 userId 當密文）→ 100% 失敗
// 所以只收窄到**剛好足以排除密文**，不要更嚴。
//
// 🔴 而「長度 33」對密文是**結構上**安全的分界，不是經驗值：
//    Go 的 `base64.URLEncoding` 帶 padding ⇒ 密文字串長度必為 **4 的倍數**，
//    而 33 不是 4 的倍數 ⇒ 任何密文都不可能長 33。
//    （實際密文長 84：nonce 12 + LINE id 33 + GCM tag 16 = 61 bytes → 84 字元。）
//    改用 hex 字元集判反而更脆：LINE 哪天改格式就會 100% 失敗。

/** APP 帳號的 userId 前綴（實測 stg：`APP_` + 16 字元，全長 20）。 */
const APP_USER_ID_PREFIX = 'APP_';

/**
 * LINE 明文 user id 的長度：`U` + 32 字元 = 33。
 * 後端對 LINE Bot 帳號就是拿這個值當 Users 表的 `userId` 主鍵
 * （`DecryptLineID` 的輸出直接餵給 `GetUser`）。
 */
const LINE_PLAINTEXT_USER_ID_LENGTH = 33;

/** 這個識別碼是「可以直接當 userId 用的明文」還是「要當密文送」。 */
export function isPlainUserId(userIdentifier: string): boolean {
  if (userIdentifier.startsWith(APP_USER_ID_PREFIX)) return true;
  return (
    userIdentifier.startsWith('U') &&
    userIdentifier.length === LINE_PLAINTEXT_USER_ID_LENGTH
  );
}

/** 組出 query string 片段：`userId=…` 或 `lineID=…`。 */
export function authParamFor(userIdentifier: string): string {
  const paramName = isPlainUserId(userIdentifier) ? 'userId' : 'lineID';
  return `${paramName}=${encodeURIComponent(userIdentifier)}`;
}
