// utils/memberSlots.ts — 「目前人數」那排格子要畫幾格、每格滿不滿（[A2-④]）
//
// 🔴 為什麼抽出來：EventCard.tsx 與 EventDetailModal.tsx 各自**硬寫四格**（P1…P4），
//    而容量根本不是固定 4 —— 開局表單的「缺幾人」只給 [1,2,3]（CreateGroupStage1.tsx:85），
//    後端的滿員判準是 `CurrentPlayers >= PlayersNeeded+1`（web_register/main.go:501）
//    ⇒ 容量＝缺幾人＋1＝**2～4**。一場「缺 1 人」的局會被畫成四格，其中兩格永遠填不滿。
//    `maxMembers` 前端**早就算好了**（dataService.ts:57 = playersNeeded + 1），只是沒有人用它。
//
// 🔴 P1 恆滿是**對的**，不要「修」它：建局時後端就設 CurrentPlayers: 1（create_game/main.go:366），
//    主揪本人已經計入；報名只建 pending，要主揪核准才遞增
//    （web_accept_registration/main.go:438 的 `currentPlayers = :next`）。
//    ⇒ 這個數字的語意是「**已加入／已核准**」，不是「已報名申請」。
//    要顯示含未核准的申請是另一件事（要帶 pending registrations 進來，屬 [D2]）。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §4.2（那句「已報名 N/4」已於 2026-09-09 訂正）。

/** 容量的合法範圍。下限 2 是因為一場局至少有主揪＋1；上限 4 是麻將桌。 */
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 4;

/**
 * 🔴 容量解不出來時退回 4 —— 而這個 4 是**刻意保留今天的行為**，不是算出來的猜測。
 *
 * 為什麼需要它：`playersNeeded` 後端**沒有任何驗證**（create_game/main.go:365 直接吃
 * `req.NeedPlayers`），所以 DDB 裡可以躺著 0 或負數；前端 `maxMembers` 由它 +1 算出來，
 * 也就可能是 1、0、NaN。
 *
 * 為什麼是 4 而不是 2：資料壞掉時我們**不知道**真實容量，而 4 是這個改動之前
 * 每一張卡片都在畫的東西 ⇒ 退回它＝壞資料的顯示不變，不會因為這次修改而多出新的錯法。
 * ⚠️ 代價寫清楚：**壞資料仍然會看到四格**，這一格沒有被修好，只是沒有變得更糟。
 */
export const CAPACITY_FALLBACK = MAX_CAPACITY;

export function resolveCapacity(maxMembers: unknown): number {
    if (typeof maxMembers !== 'number' || !Number.isInteger(maxMembers)) return CAPACITY_FALLBACK;
    if (maxMembers < MIN_CAPACITY || maxMembers > MAX_CAPACITY) return CAPACITY_FALLBACK;
    return maxMembers;
}

/** 已加入人數：夾在 [0, capacity]。負數與非整數當 0，超過容量的夾到容量。 */
export function resolveJoined(currentMembers: unknown, capacity: number): number {
    if (typeof currentMembers !== 'number' || !Number.isFinite(currentMembers)) return 0;
    const n = Math.floor(currentMembers);
    if (n < 0) return 0;
    return n > capacity ? capacity : n;
}

export interface MemberSlot {
    /** 座位編號，1 起算。圖檔名用它（icon-…-No<seat>@3x.png）。 */
    seat: number;
    filled: boolean;
    /** 第 1 格是主揪，用的是另一組圖（selfIcon）。 */
    isHost: boolean;
}

/**
 * 算出要畫哪幾格。
 * ⚠️ 刻意回傳陣列而不是「畫幾格＋幾格滿」兩個數字：呼叫端一旦自己 map 出座位編號，
 *    就會再出現一份「第幾格用哪張圖」的規則，而那正是這次要收掉的東西。
 */
export function buildMemberSlots(maxMembers: unknown, currentMembers: unknown): MemberSlot[] {
    const capacity = resolveCapacity(maxMembers);
    const joined = resolveJoined(currentMembers, capacity);
    return Array.from({ length: capacity }, (_, i) => {
        const seat = i + 1;
        return { seat, filled: seat <= joined, isHost: seat === 1 };
    });
}

/** 圖檔路徑。主揪那格與其他格是不同組圖。 */
export function memberSlotIcon(slot: MemberSlot): string {
    if (slot.isHost) return '/userJoin/icon-watiing_lightMode_selfIcon-No1@3x.png';
    return slot.filled
        ? `/userJoin/icon-userJoined-No${slot.seat}@3x.png`
        : `/userJoin/icon-userEmpty-No${slot.seat}@3x.png`;
}

/**
 * 「已加入 N/M」那行文字。
 * 🔴 用「已加入」不是「已報名」——§4.2 原文那三個字是錯的（見該節 2026-09-09 訂正）：
 *    報名只建 pending，核准才進人數。寫「已報名」會讓主揪以為待審的人已經算進去了。
 */
export function memberCountLabel(maxMembers: unknown, currentMembers: unknown): string {
    const capacity = resolveCapacity(maxMembers);
    return `已加入 ${resolveJoined(currentMembers, capacity)}/${capacity}`;
}
