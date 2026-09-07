// utils/createGroupForm.ts — 發團表單的純函式（[A3-a]，從 pages/CreateGroup.tsx 的 confirmCreate 抽出）
//
// 🔴 本檔不 import React、不碰 DOM、不讀真時鐘。
//    `validateCreateGame` 的 `now` 一律由呼叫端傳進來（毫秒），函式裡沒有 Date.now()。
// 🔴 這一塊只做「行為不變的抽取」：features 的合併順序、images 的 undefined-vs-[]、
//    四道檢核的先後，全部逐字照搬 —— 怪的地方留在測試檔註解裡，不在這裡修。
//
// ⚠️ 個人資料完整性（isProfileComplete）刻意不搬：它要打 API，留在元件。

import type { CreateMahjongGamePayload } from '../types';

/** 元件裡 ImageItem 的最小子集：payload 只看 status 與 url。 */
export interface UploadedImageLike {
    url?: string;
    status: 'uploading' | 'done' | 'error';
}

/** 元件裡那七個「新選項」state。 */
export interface VenueOptions {
    smoking: string;
    parking: string[];
    elevator: string;
    mahjongTable: string;
    tableModel: string;
    venueType: string;
    skillLevel: string;
}

export interface Coordinates {
    latitude: number;
    longitude: number;
}

export interface BuildCreateGamePayloadInput {
    formData: CreateMahjongGamePayload;
    coordinates: Coordinates;
    options: VenueOptions;
    imageItems: UploadedImageLike[];
}

/**
 * 組出送給 API 的 payload。
 * - `startTime`：datetime-local 字串 → ISO 8601
 * - `features`：七個新選項在前、手填在後，順序固定；電動桌有型號時寫成「電動桌:型號」
 * - `latitude`/`longitude` 取自 `coordinates`（formData 裡那兩個是 0，不可用）
 * - `images`：只收上傳成功且有 url 的；**一張都沒有時是 `undefined` 不是 `[]`**
 */
export function buildCreateGamePayload(input: BuildCreateGamePayloadInput): CreateMahjongGamePayload {
    const { formData, coordinates, options, imageItems } = input;
    const { smoking, parking, elevator, mahjongTable, tableModel, venueType, skillLevel } = options;

    // Convert datetime-local to ISO 8601 format
    const startTimeISO = new Date(formData.startTime).toISOString();

    // Filter out empty strings from arrays
    const cleanManualFeatures = formData.features.filter(f => f.trim() !== '');

    // 整合新選項與場地特色
    const cleanFeatures = [
        smoking,
        ...parking,
        elevator,
        mahjongTable === '電動桌' && tableModel.trim()
            ? `電動桌:${tableModel.trim()}`
            : mahjongTable,
        venueType,
        skillLevel,
        ...cleanManualFeatures
    ].filter(f => f && f.trim() !== '');

    const cleanRules = formData.rules.filter(r => r.trim() !== '');
    const cleanRestrictions = formData.restrictions.filter(r => r.trim() !== '');

    // Collect all successfully uploaded URLs
    const uploadedImageUrls = imageItems
        .filter(item => item.status === 'done' && item.url)
        .map(item => item.url as string);

    return {
        ...formData,
        startTime: startTimeISO,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        rules: cleanRules,
        features: cleanFeatures,
        restrictions: cleanRestrictions,
        images: uploadedImageUrls.length > 0 ? uploadedImageUrls : undefined
    };
}

export interface ValidateCreateGameInput {
    formData: Pick<CreateMahjongGamePayload, 'startTime' | 'placeName' | 'location'>;
    coordinates: Coordinates;
    /** 「現在」的毫秒數（`Date.now()` 那個值）。函式內會把秒與毫秒歸零再比。 */
    now: number;
}

/**
 * 四道檢核，回傳**第一個**錯誤訊息；全過回 `null`。順序不可換：
 * ① 開局時間早於現在（現在的秒與毫秒歸零，配合 datetime-local 只到分）
 * ② 座標仍是 (0,0) → 未定位
 * ③ 場地名稱空白
 * ④ 完整地址空白
 */
/**
 * 把毫秒時間戳轉成 `<input type="datetime-local">` 用的**本地時間**字串（截到分）。
 *
 * 🔴 這支存在的理由是「只留一份算法」：元件裡的 `getMinDateTime()` 與
 *    下面 `refreshStaleStartTime()` 要產出**完全一樣**的字串，各寫一份必定會漂
 *    —— 而漂掉的徵兆是「預設值看起來只差一分鐘」，沒有人會注意到。
 */
export function toDateTimeLocalString(now: number): string {
    const d = new Date(now);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

/**
 * 開局時間是否早於現在（現在的秒與毫秒歸零，配合 datetime-local 只到分）。
 *
 * 🔴 `validateCreateGame` 檢核① 與 `refreshStaleStartTime` 都呼叫這一支。
 *    兩邊各寫一次比較式的話，「什麼叫過期」就有兩個定義 ——
 *    而它們只要差一個 `<`／`<=`，就會出現「自動推進了但驗證仍然擋下來」這種
 *    從畫面上完全看不出原因的死結。
 * ⚠️ `startTime` 解析不出來時（NaN）回 false —— 與抽取前的行為逐字相同。
 */
export function isStartTimeInPast(input: { startTime: string; now: number }): boolean {
    const selectedTime = new Date(input.startTime).getTime();
    const now = new Date(input.now);
    // Reset seconds and milliseconds to 0 for fair comparison with datetime-local input
    now.setSeconds(0);
    now.setMilliseconds(0);
    return selectedTime < now.getTime();
}

export interface RefreshStaleStartTimeInput {
    startTime: string;
    /** 使用者有沒有**自己動過**開局時間欄位。true ⇒ 一律不動它。 */
    touched: boolean;
    now: number;
}

/**
 * 預設的開局時間會餿掉：`CreateGroup` 開頁時把它設成「現在」，而使用者填完那張表
 * 幾乎不可能在一分鐘內；草稿還原更糟（有效期 24 小時，還原回來的**必然**是過去）。
 * ⇒ 這支負責「使用者沒碰過的欄位，程式自己保持新鮮」。
 *
 * 回傳新字串＝要覆蓋；回傳 `null`＝不要動。
 *
 * 🔴 `touched` 是這支的全部重點。少了它，「預設值餿掉」與「使用者**故意**填一個
 *    過去的時間」在程式眼裡逐字相同 —— 而後者必須繼續被 `validateCreateGame` 擋下來
 *    （那 5 條斷言是對的行為，不要為了修前者去改它們）。
 */
export function refreshStaleStartTime(input: RefreshStaleStartTimeInput): string | null {
    if (input.touched) return null;
    if (!isStartTimeInPast({ startTime: input.startTime, now: input.now })) return null;
    return toDateTimeLocalString(input.now);
}

export function validateCreateGame(input: ValidateCreateGameInput): string | null {
    const { formData, coordinates } = input;

    // Validate start time
    if (isStartTimeInPast({ startTime: formData.startTime, now: input.now })) {
        return '開局時間不能早於目前時間';
    }

    // Validate coordinates
    if (coordinates.latitude === 0 && coordinates.longitude === 0) {
        return '請完成地址定位';
    }

    // Validate required fields
    if (!formData.placeName.trim()) {
        return '請輸入場地名稱';
    }

    if (!formData.location.trim()) {
        return '請輸入完整地址';
    }

    return null;
}

export interface ValidateCreateGameStage1Input {
    formData: Pick<CreateMahjongGamePayload, 'startTime' | 'placeName' | 'location' | 'stakes'>;
    coordinates: Coordinates;
    /** 「現在」的毫秒數。與 validateCreateGame 同義，函式內不讀真時鐘。 */
    now: number;
}

/**
 * [A3-c1] 精靈第 1 步 → 第 2 步的閘門：Stage1 該擋的東西**全部**用程式擋起來。
 *
 * 為什麼需要它：整張表單只有兩個原生 `required`（`stakes` 與 `placeName`），都在 Stage1；
 * 其中 `stakes` **從來沒有程式檢核**，只靠瀏覽器原生 `required`。畫面分成兩步之後，
 * 最終送出時 Stage1 已經卸載 ⇒ 欄位不在 DOM 裡，原生驗證不會跑，那個 `required` 靜默失效，
 * 而 `validateCreateGame` 也不檢查它。⇒ 這是行為保存，不是新功能。
 *
 * 順序不可換：
 * ① 先把四道檢核**委派**給 `validateCreateGame`（不抄它的算術 —— 抄一份的話，
 *    以後改 `validateCreateGame` 時這裡會靜靜過期），非 null 就直接回傳。
 * ② 四道都過了，才檢查 `stakes` 空白 → '請輸入籌碼'。
 *
 * `stakes` 排最後的理由：既有四道的順序被 26 條測試釘死，不能插隊；而在真的瀏覽器裡，
 * 原生 `required` 本來就會在 onSubmit 之前先跳氣泡，所以**使用者看到的順序不會因為
 * 排最後而改變** —— 本函式是原生驗證的後備（原生驗證可被繞過、且欄位卸載後就不跑），
 * 不是它的替代品。
 */
export function validateCreateGameStage1(input: ValidateCreateGameStage1Input): string | null {
    const delegated = validateCreateGame(input);
    if (delegated !== null) {
        return delegated;
    }

    if (!input.formData.stakes.trim()) {
        return '請輸入籌碼';
    }

    return null;
}

export interface ValidateCreateGameStage2Input {
    options: Pick<VenueOptions, 'smoking' | 'elevator' | 'mahjongTable'>;
}

/**
 * [A3-j] 精靈第 2 步的閘門：三個標著 `(必填)` 的環境選項**真的**必填。
 *
 * 🔴 這一支存在的理由是一個**已經在線上發生**的缺陷，不是新功能的閘門。
 *    `菸選項`／`電梯`／`麻將桌` 三個標籤從一開始就寫著 `(必填)`，而
 *    `validateCreateGame` 的四道檢核**一項都沒有碰它們** —— 沒被抓到，是因為
 *    它們的 `useState` 初始值分別是 `'無菸'`／`'有電梯'`／`'電動桌'`，
 *    ⇒ **永遠是「已填」的**，那個 `(必填)` 從來沒有機會失敗。
 *
 * 🔴 而代價不是「檢核沒作用」這麼輕：`buildCreateGamePayload` 只濾掉空字串，
 *    那三個預設值非空 ⇒ **必定被送進 `features`**。使用者從沒碰過那三個欄位，
 *    也會publish 成「這個場地無菸、有電梯、是電動桌」。
 *    那是有人會據以出門的資訊 —— 錯的方向是**多宣稱**，不是少宣稱。
 *
 * ⇒ 修法是**兩半，缺一不可**：
 *    ① 初始值改成 `''`（不預選）—— 光是這一半的話，沒選就變成靜靜不送，
 *      而畫面上的 `(必填)` 依然是謊話。
 *    ② 本函式把 `(必填)` 變成真的 —— 光是這一半的話，預設值仍然通過檢核，
 *      缺陷原封不動。
 *    兩半各自都「看起來有做事」，**只有合起來才會改變行為**。
 *
 * ⚠️ 界線：本函式只管「有沒有做出宣告」，不管宣告的內容對不對
 *    （沒有任何方式驗證那個場地真的有電梯）。
 * ⚠️ 順序固定：與畫面由上而下一致（菸 → 電梯 → 麻將桌），
 *    否則使用者被指到的欄位跟他眼睛掃描的順序不同。
 *
 * @returns 第一個錯誤訊息；全過回 `null`
 */
export function validateCreateGameStage2(input: ValidateCreateGameStage2Input): string | null {
    const { smoking, elevator, mahjongTable } = input.options;

    if (!smoking.trim()) {
        return '請選擇菸選項';
    }

    if (!elevator.trim()) {
        return '請選擇電梯';
    }

    if (!mahjongTable.trim()) {
        return '請選擇麻將桌';
    }

    return null;
}
