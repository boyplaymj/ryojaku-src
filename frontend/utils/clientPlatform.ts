// utils/clientPlatform.ts — 送給後端的 `X-Platform` 值（D4-e）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §11.9
//
// ── 這支檔為什麼存在（它看起來只該是一行）─────────────────────────────
//
// 在這之前，`services/apiService.ts` 送的是**寫死的字面值** `'X-Platform': 'Web'`，
// 而 `apiRequest` 是整個 App 幾乎唯一的出口（63 個呼叫點）
// ⇒ 不管跑在 iPhone 的 App 殼還是 Chrome，後端收到的都是 `'Web'`。
//
// 🔴 危險的不是「沒有資料」，是**有一份看起來像答案的資料**：
//    DDB 的 `platform` 欄位滿滿都是值，任何人去查都會得到「使用者全是 Web」——
//    而這個讀數在「一半使用者用 App 殼」的世界裡**逐字相同**。
//
// ── 為什麼不可以回空字串（這才是本檔唯一的邏輯）───────────────────────
//
// 🔴 後端 `mahjongclub_app_login` 的 `UpdateLastLogin`（實查 main.go:267-270）：
//
//      if platform != "" {
//          updateExpression += ", platform = :platform"
//      }
//
//    空值時 `platform` **根本不會進 UpdateExpression** ⇒ DDB 裡的舊值
//    （也就是我們正要淘汰的那個 `'Web'`）**原封不動留著**。
//    登入照樣成功、`lastLoginAt` 照樣更新、沒有任何錯誤 ——
//    **也就是我們要修的那個病，換個形式又回來了，而且更難察覺**
//    （這次連「值是常數」都看不出來，因為它是「值沒被更新」）。
//
//    ⇒ 拿不到 platform 時送 `'unknown'`，不送空字串。
//      「有人的 platform 是 unknown」是**看得見**的訊號；
//      「platform 停在舊值」不是。
//
// ⚠️ 刻意**不做白名單**（不寫 `['ios','android','web'].includes(p) ? p : 'unknown'`）。
//    Capacitor 將來多一個平台時，白名單會把那個**已知的新平台名**降級成 `unknown`
//    —— 那是把手上真的有的資訊丟掉。未知的平台名本身就是資訊，原樣送上去。
//
// 附帶（不是設計目標，是撿到的）：新值是小寫 `ios`／`android`／`web`，
// 而歷史資料是大寫 `Web` ⇒ **大小寫本身就分得出改版前後的資料**，不必另外標記。

/** 拿不到平台時送這個，而不是空字串。理由見檔頭。 */
export const UNKNOWN_PLATFORM = 'unknown';

/**
 * 把 `Capacitor.getPlatform()` 的回傳整理成要送出去的 header 值。
 *
 * @param raw 通常是 `Capacitor.getPlatform()`（`'ios'` / `'android'` / `'web'`）。
 *            型別上收 undefined/null 是因為呼叫端在極早期或非瀏覽器情境下可能拿不到。
 */
export function clientPlatformHeader(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  return s === '' ? UNKNOWN_PLATFORM : s;
}
