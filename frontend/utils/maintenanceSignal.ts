// 維護模式（kill switch）的「使用者看得到」那一半。
//
// ── 根因不是翻譯錯，是那個字串死在呼叫點 ────────────────────────────────
//
// apiService.ts 早就把 403 翻成「服務維護中，請稍後再試」了，但它是**回傳值**，
// 而各頁面幾乎都只看 `response.success` 就走人：Ledger.tsx 直接渲染一本空帳本
// （+0 PT・場數 0・勝率 0%），首頁照常顯示公開資料。實測維護中登入還會落在一個
// 完全正常的首頁，印著「安全連線已啟動」——**App 的外觀是健康的**。
// （量測紀錄見 backend/cmd/lambdas/shared/maintenance.go 第六、七輪。）
//
// 🔴 所以修法不是「逐頁把 error 畫出來」。逐頁改的話，**漏掉的那一頁零徵兆** ——
//    它跟「那頁本來就沒資料」長得一模一樣。載體要放在**呼叫點之上**：
//    apiService 每次撞到 403 就發一個全域訊號，由一個常駐元件顯示提示。
//    這樣新增頁面不必記得做任何事。
//
// 🔴 為什麼不是「收到任何 2xx 就解除」：**維護中公開 route 照樣回 200**。
//    這不是推測，是量到的（infra/maintenance_public_routes_probe.sh）：
//    app-version-config / app-login / app-register 在旗標 ON 時全是 200，
//    而首頁餵的 community-get-posts、user-info 也都是公開的。
//    「任何 2xx 就解除」會讓提示在「公開 200」與「受保護 403」之間閃爍。
//    ⇒ 只有**曾經被擋過的那條路**自己回 2xx，才算解除。
//
// 本檔刻意只做狀態機、不碰 DOM：dispatch 留在 apiService，這樣這裡可以在 node 下
// 直接測（utils/maintenanceSignal.test.ts，落在 run-tests.mjs 的預設 glob 內）。
// ⚠️ 代價是「有沒有真的接上事件」這件事本檔測不到 —— 那一段由
//    infra/maintenance_browser_e2e.mjs 的 P3 在真瀏覽器裡守。

export const MAINTENANCE_EVENT = 'app:maintenance';
export const MAINTENANCE_CLEAR_EVENT = 'app:maintenance-clear';

/** 目前撞到 403 的路徑集合。空集合＝不在維護中。 */
const blockedPaths = new Set<string>();

/** 去掉 query string：`/ledger?userId=A` 與 `/ledger?userId=B` 是同一條路。 */
export function normalizePath(endpoint: string): string {
  return endpoint.split('?')[0];
}

/**
 * 記錄一次 403。
 * 回傳 true 代表「原本沒在維護 → 現在進入維護」這個**轉換**剛剛發生
 * （呼叫端據此只發一次事件，不會每個 403 都彈一個提示）。
 */
export function noteBlocked(endpoint: string): boolean {
  const wasClear = blockedPaths.size === 0;
  blockedPaths.add(normalizePath(endpoint));
  return wasClear;
}

/**
 * 記錄一次 2xx。回傳 true 代表「維護中 → 解除」這個轉換剛剛發生。
 *
 * 🔴 一旦某條**曾被擋過**的路通了，就把整個集合清空 —— 因為維護模式是一個
 *    全域旗標（後端只有一個 AdminConfigs.maintenanceMode），任何一條受保護的路
 *    走得通，就代表它已經關掉了。逐條移除的話，使用者得把每一條被擋過的路
 *    都重走一次提示才會消失。
 */
export function noteOk(endpoint: string): boolean {
  if (blockedPaths.size === 0) return false;
  if (!blockedPaths.has(normalizePath(endpoint))) return false; // 公開 route 的 200 不算數
  blockedPaths.clear();
  return true;
}

/**
 * WS 發言在本狀態機裡的鍵。
 *
 * WebSocket 沒有 URL path，但「曾被擋過才算解除」那條規則需要一個鍵才能參與。
 * 🔴 定義放這裡、由 chatService 匯入 —— 兩邊各寫一次字面值就會漂，而漂掉的症狀是
 *    「提示出得來、永遠消不掉」（noteBlocked 用 A、解除時比對 B）。
 * 後端推回來的幀長什麼樣，定義在
 * backend/cmd/lambdas/apis/mahjongclub_chat_ws_send_message/main.go 的 MaintenanceFrame。
 */
export const WS_SEND_PATH = 'ws:sendMessage';

/**
 * 記錄一個「證明維護已結束」的**強訊號**。回傳 true 代表解除轉換剛剛發生。
 *
 * 🔴 為什麼這支不像 noteOk 那樣要求「曾被擋過」：兩者的證明力不同。
 *    REST 的 2xx 弱 —— 維護中公開 route 照樣回 200（已量，見上方註解）。
 *    但 WS 發言成功不一樣：chat_ws_send_message **自己**會讀旗標並回 503
 *    （main.go 的 maintenanceCheck），所以「我的訊息被廣播回來了」代表那道閘門
 *    確實放行 ⇒ 旗標是關的。這是全域事實，不必管當初是哪條路被擋。
 *
 * ⚠️ 用它的前提是「發話者收得到自己的訊息」。那是廣播迴圈不排除 sender 的結果
 *    （main.go 的成員迴圈；排除只寫在推播那半邊）——**目前是讀程式碼得到的結論，
 *    尚未在真連線上量過**。真瀏覽器端到端驗證前不要把它當已證實。
 */
export function noteMaintenanceOver(): boolean {
  if (blockedPaths.size === 0) return false;
  blockedPaths.clear();
  return true;
}

export interface WsFrameVerdict {
  /** true = 這是系統幀，呼叫端**不可**再往 callback 傳（理由見 chatService.ts）。 */
  consumed: boolean;
  /** 要 dispatch 的事件名；null = 不發。 */
  event: string | null;
}

/**
 * 判讀一幀 WS 訊息對維護訊號的意義，並更新狀態機。
 *
 * 🔴 邏輯放這裡而不是 chatService，是被**測得到**這件事決定的：chatService.ts
 *    import 了 `../constants`（無副檔名），node 的 type-stripping 解析不動
 *    （實測 ERR_MODULE_NOT_FOUND）⇒ 那個檔在 node 下根本 import 不起來。
 *    本檔零 import，所以判讀邏輯擺這裡就有單元測試，chatService 只剩一行接線。
 *    ⚠️ 代價照舊：那一行「有沒有真的接上」本檔測不到，由 maintenance_browser_e2e.mjs 守。
 */
export function noteWsFrame(data: any, selfUserId: string | null): WsFrameVerdict {
  if (data?.type === 'system') {
    const raise = data.event === 'maintenance' && noteBlocked(WS_SEND_PATH);
    return { consumed: true, event: raise ? MAINTENANCE_EVENT : null };
  }
  // 自己的訊息廣播回來 ⇒ 發言閘門放行 ⇒ 旗標是關的（強訊號，見 noteMaintenanceOver）。
  if (data?.senderId && data.senderId === selfUserId && noteMaintenanceOver()) {
    return { consumed: false, event: MAINTENANCE_CLEAR_EVENT };
  }
  return { consumed: false, event: null };
}

export function isInMaintenance(): boolean {
  return blockedPaths.size > 0;
}

/** 只給測試用：模組級狀態會跨 test case 殘留（見 reference：測試殘留會遮蔽本次失敗）。 */
export function resetMaintenanceSignal(): void {
  blockedPaths.clear();
}
