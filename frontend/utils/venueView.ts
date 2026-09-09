// utils/venueView.ts — venue 回應的**判讀**（[B1-j1]）。零 React 相依，純函式。
//
// 正典：tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §5（場地）／§7（評價）。
//
// 這個檔存在的理由是：venue 這條路徑上有**四個**「兩種情況在畫面上長得一樣」的坑，
// 而它們每一個都可以在元件裡用一行很自然的寫法踩到。抽成純函式才有尺量得到。
//
//   ① 地址：「被授權擋下」與「主揪還沒填地址」——  `if (!v.exactAddress)` 兩者同一格
//   ② 評價：「尚無評價」與「差評滿貫」——           `0/0` 算出來都是 0%
//   ③ 分頁：「掃完了」與「這一頁剛好全被篩掉」——   `venues.length === 0` 兩者同一格
//   ④ type：「我們不認得的值」與「自建場」——       fail-open 的 default 會把未知當成可評
//
// ⚠️ 界線：本檔只判讀**後端已經回來的東西**。它證明不了「後端授權判斷是對的」，
//    那是 shared/venue_address.go 那條線的事（線上矩陣 8/8，§5.3）。

import type { PublicVenueCard, VenueDetail, VenueListPage } from '../types';

// ─── ① 地址三態（其實是五態）───────────────────────────────────────────────

/**
 * 精確地址在這次回應裡的狀態。
 *
 * 🔴 後端的合約是「**鍵在不在**就是有沒有授權」（shared/venue_address.go 的 VenueView 註解）：
 *    沒授權 ⇒ `exactAddress` 整個鍵不存在；放行 ⇒ 鍵一定存在，**即使值是空字串**。
 *    ⇒ 空字串是「授權了，但這個場地根本沒填地址」，與「被擋」是**不同**的兩件事，
 *      而 `if (!v.exactAddress)` 會把它們合成一格 —— 那正是後端註解裡點名要避免的。
 *
 * 🔴 三種 withheld 也要分開：它們對使用者的意義完全不同（「等核准」是**會變的**，
 *    「審核中」是**別人要動的**，而 unexpected 是**我們這邊壞了**）。
 *    全部畫成「沒有地址」的話，被誤擋的玩家看到的東西與規則正確運作時逐字相同 ——
 *    §13 自己寫過那是這整套隱私設計最可能的失敗形狀。
 */
export type VenueAddressState =
    /** 有授權，而且真的有地址 ⇒ 顯示它 */
    | 'granted'
    /** 有授權，但這個場地的地址是空的 ⇒ 是**資料沒填**，不是被擋 */
    | 'granted-empty'
    /** 沒授權，自建場 ⇒ 報名被核准後才會出現（§5.1 硬規則） */
    | 'withheld-home'
    /** 沒授權，而且這個場地不是 active（審核中／已停權） */
    | 'withheld-review'
    /**
     * 沒授權，而規則說這裡**本該給** ⇒ 不假裝正常。
     *
     * 走到這一格的組合是：登入使用者 ＋ active ＋ hall/event，而地址沒回來。
     * 後端 CanSeeExactAddress 規則 5 對這個組合一律放行（venue-detail 掛著
     * user authorizer，匿名根本進不來，會在 gateway 就 401）⇒ 它**不該發生**。
     * 也涵蓋「type 是我們不認得的值」（後端 deny:unknown-type，那是資料壞了）。
     */
    | 'withheld-unexpected';

/** readAddressState 需要的最小形狀。刻意不收整個 VenueDetail，讓測試能餵殘缺資料。 */
export interface AddressStateInput {
    type?: unknown;
    status?: unknown;
    exactAddress?: unknown;
}

/**
 * 判讀 venue-detail 回應裡的地址狀態。
 *
 * 🔴 「有沒有授權」的判準是 **`typeof exactAddress === 'string'`**，不是真假值、
 *    也不是 `'exactAddress' in v`。
 *    - 真假值（`!!v.exactAddress`）會把空字串判成沒授權 ⇒ 坑 ①。
 *    - `in` 對 `{exactAddress: undefined}` 這種手工物件回 true ⇒ 會把 undefined
 *      當成「授權了」再往下傳，而那個值畫出來是字面的 "undefined"。
 *      JSON.parse 產不出這種物件，但測試假件與元件的預設值產得出來。
 *    ⇒ 用 typeof 兩邊都擋得住，而且它對 null/數字也是 fail-closed。
 *
 * 🔴 deny 分類的順序**故意與後端規則順序相同**（status 檢查排在 type 之前）：
 *    CanSeeExactAddress 規則 4（status != active）排在規則 6（home）之前，
 *    所以一個 pending 的自建場，後端給的理由是 venue-not-active 而不是 no-registration。
 *    前端若先問 type，會對同一筆資料說出與後端不同的理由 —— 而兩邊都「看起來合理」。
 */
export function readAddressState(v: AddressStateInput | null | undefined): VenueAddressState {
    if (!v || typeof v !== 'object') return 'withheld-unexpected';

    if (typeof v.exactAddress === 'string') {
        return v.exactAddress.trim() === '' ? 'granted-empty' : 'granted';
    }
    // 以下皆為「沒授權」。分類的順序對齊後端規則順序（見上方註解）。
    if (v.status !== 'active') return 'withheld-review';
    if (v.type === 'home') return 'withheld-home';
    return 'withheld-unexpected';
}

/** 這個狀態下要給使用者看的字。與 state 分開，讓文案改動不會動到判讀的尺。 */
export function addressCopy(state: VenueAddressState): string {
    switch (state) {
        case 'granted':
            return '';
        case 'granted-empty':
            return '這個場地還沒有填寫詳細地址';
        case 'withheld-home':
            return '自建場的完整地址，主揪核准你的報名後才會顯示';
        case 'withheld-review':
            return '這個場地還在審核中，暫不提供地址';
        case 'withheld-unexpected':
            return '暫時取不到地址，請稍後再試';
    }
}

/** 這個狀態要不要把地址那塊畫出來（granted 才畫真地址）。 */
export function isAddressVisible(state: VenueAddressState): boolean {
    return state === 'granted';
}

// ─── ④ 場地分類 ──────────────────────────────────────────────────────────

export interface VenueTypeMeta {
    emoji: string;
    label: string;
    /**
     * 這種場地能不能**評場地**。
     * 🔴 自建場是 false —— §7：「自建場：評主揪，不評場地」（家場評「場地」等於評別人的家）。
     * 🔴 認不得的 type 也是 false（fail-closed）：把未知當成可評，等於讓一筆壞資料
     *    開出一條我們沒設計過的路徑，而它看起來完全正常。
     */
    canRateVenue: boolean;
    /** 是不是我們認得的三種之一。false ⇒ 資料有問題，不要靜靜畫成正常的卡片。 */
    known: boolean;
}

const VENUE_TYPE_META: Record<string, VenueTypeMeta> = {
    hall: { emoji: '🏛', label: '麻將館', canRateVenue: true, known: true },
    home: { emoji: '🏠', label: '自建場', canRateVenue: false, known: true },
    event: { emoji: '🎪', label: '活動場', canRateVenue: true, known: true },
};

const UNKNOWN_VENUE_TYPE: VenueTypeMeta = {
    emoji: '❓', label: '未知場地', canRateVenue: false, known: false,
};

/** §5.1 的三分類。🔴 `'dojo'` 走的是 unknown 那條 —— 道館不是 type（§5.2）。 */
export function venueTypeMeta(type: unknown): VenueTypeMeta {
    if (typeof type !== 'string') return UNKNOWN_VENUE_TYPE;
    return VENUE_TYPE_META[type] ?? UNKNOWN_VENUE_TYPE;
}

/**
 * 卡片上要掛的徽章。
 *
 * ⚠️ **`isDojo` 目前結構上恆為 false**：三條認證條件之一是「至少一位已認證裁判」，
 *    而裁判系統（§6.6）還沒實作 ⇒ `certifiedRefereeCount` 恆為 0。
 *    ⇒ 「⛩ 道館」這顆徽章**還沒有任何真資料能讓它亮起來**。留著它不是死碼
 *    （裁判系統上線那天就會亮），但**不要把「線上沒看到道館」讀成這段程式有問題**。
 */
export function venueBadges(v: { isDojo?: unknown }): string[] {
    return v && v.isDojo === true ? ['⛩ 道館'] : [];
}

// ─── ② 評價 ──────────────────────────────────────────────────────────────

export interface RatingDisplay {
    /** 'none' ⇒ 不要畫百分比。 */
    kind: 'none' | 'rate';
    text: string;
    /** kind==='rate' 時的整數百分比；'none' 時是 null（**不是 0**）。 */
    percent: number | null;
}

const NO_RATING: RatingDisplay = { kind: 'none', text: '尚無評價', percent: null };

/**
 * §7：**比例與則數一起顯示**，而且 🔴「新玩家顯示『尚無評價』，不可顯示 0%」——
 * 0% 跟「差評滿貫」在版面上逐字相同。
 *
 * 🔴 壞資料（負數／好評數大於總則數／非整數）也走 'none'：
 *    我們**不知道**真實比例，而印一個算得出來的數字會讓壞資料看起來像事實。
 *    ⚠️ 代價：這一格與「真的沒人評過」在畫面上仍然相同 —— 那是刻意的取捨
 *    （使用者不需要看到我們的資料壞了），但它意味著**畫面不是這個問題的偵測器**。
 */
export function formatRating(v: { ratingPositive?: unknown; ratingCount?: unknown }): RatingDisplay {
    const count = v?.ratingCount;
    const positive = v?.ratingPositive;
    if (!Number.isInteger(count) || !Number.isInteger(positive)) return NO_RATING;
    const c = count as number;
    const p = positive as number;
    if (c <= 0) return NO_RATING;
    if (p < 0 || p > c) return NO_RATING;
    const percent = Math.round((p / c) * 100);
    return { kind: 'rate', text: `${percent}% ・ ${c} 則`, percent };
}

// ─── ③ 分頁 ──────────────────────────────────────────────────────────────

/**
 * 一次瀏覽最多打幾輪 venue-list。
 *
 * 🔴 這個上限不是效能潔癖，是**成本**：venue-list 背後是**無閘門的 Scan**
 *    （§5.3：「它的風險不在授權，在成本」）。而 ③ 那個坑會讓「還沒掃完」
 *    變成常態 —— 一整頁都被 IsPubliclyListable 篩掉時，正確的行為就是繼續翻。
 *    沒有上限的話，一個自建場很多的資料庫會讓打開列表 ＝ 掃全表。
 */
export const VENUE_PAGE_ROUND_CAP = 8;

export type VenuePageDecision = 'fetch' | 'done' | 'cap-reached';

/**
 * 還要不要再翻一頁。
 *
 * 🔴 終止條件**只有 `nextToken` 為空**，不是「這一頁回 0 筆」（§5.3 點名的坑）：
 *    DDB 的 `Limit` 限制的是**掃描**的項目數不是回傳的項目數 ⇒ 一整頁都被
 *    `IsPubliclyListable` 篩掉時，`venues` 是 0 筆而底下還有幾百筆沒掃到。
 *    用筆數判斷的話，第一頁全是自建場就會停住，而畫面上是「附近沒有場地」——
 *    完全合理的樣子。
 *
 * 🔴 `'done'` 與 `'cap-reached'` 必須分開：前者可以對使用者說「就這些了」，
 *    後者**不可以** —— 那是我們自己停下來的，底下還有。合成一格的話，
 *    「真的沒有更多」與「我們不再找了」在畫面上又是同一句話。
 */
export function nextPageDecision(
    page: Pick<VenueListPage, 'nextToken'> | null | undefined,
    roundsDone: number,
    cap: number = VENUE_PAGE_ROUND_CAP,
): VenuePageDecision {
    const token = page?.nextToken;
    // 🔴 不看 page.venues.length —— 見上方註解。
    if (typeof token !== 'string' || token === '') return 'done';
    if (roundsDone >= cap) return 'cap-reached';
    return 'fetch';
}

/**
 * 列表的空狀態要說哪一句。
 *
 * 🔴 「一筆都沒有」與「我們停在上限」不同：後者說「就這些了」是說謊。
 * ⚠️ 目前線上 Venues 表是 0 筆（2026-09-09 實查）⇒ 這一頁上線後的**預設**畫面
 *    就是 'empty'。那不是壞掉，是還沒有人建過場地。
 */
export function listEmptyCopy(count: number, decision: VenuePageDecision): string {
    if (count > 0) return '';
    if (decision === 'cap-reached') return '找了一輪還沒找到場地，下拉可以再找找';
    return '目前還沒有公開的場地';
}

/**
 * 把多頁合併，並用 venueId 去重。
 *
 * 🔴 去重不是保險：Scan 帶 ExclusiveStartKey 在項目被改動時可能回到重複的 key，
 *    而 React 的 list key 重複只會在 console 警告，畫面上是**同一間店出現兩次** ——
 *    那看起來像資料真的有兩筆。
 */
export function mergeVenuePages(pages: readonly (PublicVenueCard[] | undefined)[]): PublicVenueCard[] {
    const seen = new Set<string>();
    const out: PublicVenueCard[] = [];
    for (const page of pages) {
        for (const card of page ?? []) {
            if (!card || typeof card.venueId !== 'string' || card.venueId === '') continue;
            if (seen.has(card.venueId)) continue;
            seen.add(card.venueId);
            out.push(card);
        }
    }
    return out;
}

/** 詳情頁標題列要顯示的東西，一次算好（元件只負責畫）。 */
export function venueHeadline(v: VenueDetail | null | undefined) {
    const meta = venueTypeMeta(v?.type);
    return {
        emoji: meta.emoji,
        typeLabel: meta.label,
        name: (v?.name ?? '').trim() || '未命名場地',
        badges: venueBadges(v ?? {}),
        rating: formatRating(v ?? {}),
        addressState: readAddressState(v),
    };
}
