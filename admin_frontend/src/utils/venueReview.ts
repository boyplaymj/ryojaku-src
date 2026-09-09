// venueReview.ts — 場地審核頁（B1-f3）的**全部算術**。
//
// 正典：/opt/sml/repo/tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §5.1（隱私硬規則）、
//       §5.3（初始 status 依 type）、§13（漏斗）。
//
// 🔴 頁面只負責畫，這裡負責判斷 —— 同 VoiceTaiReview 的規矩。
//
// 🔴 這一頁存在的理由：`hall` 建立後是 `pending`，非 owner 拿不到它的地址。
//    沒有這個審核動作，館方付了錢而功能是壞的，**而且他自己看得到地址所以不會發現**。
//    ⇒ 「等最久的排前面」不是排版偏好，是這個功能的核心。

export type VenueType = 'hall' | 'home' | 'event';
export type VenueStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export interface AdminVenue {
    venueId: string;
    type: string;
    name: string;
    phone?: string;
    businessHours?: string;
    approxLocation?: { latitude?: number; longitude?: number; placeName?: string };
    /** 後台專用欄位（後端 adminVenueView 明確加回來的；玩家端拿不到）。 */
    exactAddress?: string;
    ownerId: string;
    isDojo?: boolean;
    status: string;
    createdAt?: number;
}

const TYPE_LABEL: Record<string, string> = {
    hall: '🏛 麻將館',
    home: '🏠 自建場',
    event: '🎪 活動場',
};

const STATUS_LABEL: Record<string, string> = {
    pending: '待審核',
    active: '已上線',
    rejected: '審核未通過',
    suspended: '已停權',
};

/** 不認得的值原樣印出來並標記 —— 靜靜顯示成空白的話，型別漂掉就沒有徵兆。 */
export function venueTypeLabel(type: string): string {
    return TYPE_LABEL[type] ?? `⚠️ 未知類型（${type || '空'}）`;
}

export function venueStatusLabel(status: string): string {
    return STATUS_LABEL[status] ?? `⚠️ 未知狀態（${status || '空'}）`;
}

/** 審核前的資料健康：每一條都是「這筆資料看起來不像真的」的訊號。 */
export interface Readiness {
    /** 沒有精確地址 —— 對 hall 來說，這是「無法判斷是不是真店」。 */
    noAddress: boolean;
    /**
     * 座標是 (0,0)。
     * 🔴 這不是吹毛求疵：0,0 是「欄位沒填」最常見的形態，而它在地圖上會落在
     * 幾內亞灣外海。核准之後那個圖釘就會出現在那裡，而後台這一頁看起來完全正常。
     */
    nullIsland: boolean;
    /** 名稱只有空白。 */
    blankName: boolean;
    /** 沒有 ownerId —— 不該發生（伺服器從 JWT 填），出現代表資料是別的路徑寫進來的。 */
    noOwner: boolean;
}

export function readinessOf(v: AdminVenue): Readiness {
    const lat = v.approxLocation?.latitude;
    const lng = v.approxLocation?.longitude;
    return {
        noAddress: !v.exactAddress || v.exactAddress.trim() === '',
        // 用 === 0 而不是 !lat：真實的赤道／本初子午線座標極罕見，但
        // `!lat` 會把 undefined 也算進來，而「沒有座標」與「座標是 0」是兩件事。
        nullIsland: lat === 0 && lng === 0,
        blankName: !v.name || v.name.trim() === '',
        noOwner: !v.ownerId || v.ownerId.trim() === '',
    };
}

/** 有任何一條亮起來就值得先看一眼。 */
export function hasWarning(r: Readiness): boolean {
    return r.noAddress || r.nullIsland || r.blankName || r.noOwner;
}

/**
 * 排序：**等最久的排前面**（createdAt 小的在前）。
 *
 * 🔴 這是這一頁的核心，不是排版偏好：館方付了錢在等，而「被遺忘的那一筆」
 * 與「剛送出的那一筆」在畫面上長得一樣。沒有 createdAt 的排最後
 * （它們是舊資料或寫入路徑有問題，不該擠掉正在等的人）。
 */
export function sortForReview(list: AdminVenue[]): AdminVenue[] {
    return [...list].sort((a, b) => {
        const ta = a.createdAt ?? Number.POSITIVE_INFINITY;
        const tb = b.createdAt ?? Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        // 同一秒建立時用 venueId 決勝，讓順序穩定（否則每次重整順序會跳）。
        return a.venueId.localeCompare(b.venueId);
    });
}

/** 等待天數（給畫面顯示「已等 N 天」）。nowSec 由呼叫端傳入，不在這裡讀時鐘。 */
export function waitingDays(v: AdminVenue, nowSec: number): number | null {
    if (v.createdAt === undefined || v.createdAt === null) return null;
    const days = Math.floor((nowSec - v.createdAt) / 86400);
    return days < 0 ? 0 : days;
}
