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
export function validateCreateGame(input: ValidateCreateGameInput): string | null {
    const { formData, coordinates } = input;

    // Validate start time
    const selectedTime = new Date(formData.startTime).getTime();
    const now = new Date(input.now);
    // Reset seconds and milliseconds to 0 for fair comparison with datetime-local input
    now.setSeconds(0);
    now.setMilliseconds(0);

    if (selectedTime < now.getTime()) {
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
