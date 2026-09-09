// utils/venueLocation.ts — 自建場座標的模糊化（[B1-j4]）。正典 §5.1。
//
// 🔴 §5.1 是硬規則：自建場「地圖上只顯示**大概位置**（建議：模糊到街廓／
//    隨機位移 300–500m 的圓）」，而且「不要做成使用者可以自己選要不要公開 ——
//    那會讓人不小心公開自己家」。
//
// 🔴🔴 **實查（2026-09-09）：這件事後端一個字都沒做。**
//    `NewVenueFromCreateRequest` 是 `ApproxLocation: r.ApproxLocation` ——
//    原樣照抄，全 backend 沒有任何 blur／jitter／取整。也就是說那個欄位
//    **只有名字是「大概」**；前端送什麼進去，DB 就存什麼。
//    ⇒ 本檔是**客戶端的自律，不是強制**。任何人直接打 `POST /create-venue`
//    都可以把精確座標塞進 approxLocation，而後端會收下。
//    真正的修法在後端（收到 home 時自己位移一次），記在設計冊 §5.3。
//    **不要把「App 會模糊」讀成「自建場的座標不會外流」。**
//
// 🔴 位移只在**建立那一刻算一次**，然後落地。
//    絕不可以改成「每次讀取時即時模糊」—— 那樣同一個場地會給出多個隨機點，
//    取平均就把真實座標還原回來了（模糊化的標準失效模式）。

/** §5.1 的位移範圍（公尺）。 */
export const HOME_BLUR_MIN_M = 300;
export const HOME_BLUR_MAX_M = 500;

/** 一度緯度的公尺數（WGS84 平均值）。經度要再乘 cos(緯度)。 */
const METERS_PER_DEG_LAT = 111_320;

/**
 * 高緯度時 cos(lat) 趨近 0，「往東 500 公尺」換算成經度會爆掉。夾住它。
 *
 * 🔴 **訂正（2026-09-09，突變測試逼出來的）**：這裡原本寫「否則會是 NaN」——
 *    那是錯的。JS 的 `Math.cos(Math.PI/2)` 是 `6.12e-17` 不是 0，所以不會除以零、
 *    也不會有 NaN；算出來的是 `經度 = 7.4e13` 這種**有限但不是座標**的數字。
 *    ⇒ 拿掉這行的症狀是「地圖上那個點飛到不存在的地方」，不是「地圖壞了」。
 *    B1jL-6 原本斷言 isFinite ⇒ 對這個突變**零鑑別力**（實測存活），已改成斷言經度在合法範圍。
 * ⚠️ 代價寫清楚：極高緯度時實際位移會**小於** 300m（夾住之後東西向走不了那麼遠）。
 *    可接受 —— 這個 App 的使用者在台灣，而「座標仍是合法座標」比「位移量精確」重要。
 */
const MIN_COS_LAT = 0.01;

export interface LatLng { latitude: number; longitude: number }

/**
 * 把座標隨機位移 300–500 公尺。
 *
 * `rng` 可注入（回 [0,1)），讓測試能問「位移量真的落在 300–500m 嗎」——
 * 用真的亂數的話那條斷言只能寫成範圍檢查，而範圍檢查對「常數 0 位移」
 * 以外的錯（例如永遠往正北）零鑑別力。
 */
export function blurLocation(p: LatLng, rng: () => number = Math.random): LatLng {
    const lat = Number(p?.latitude);
    const lng = Number(p?.longitude);
    // fail-closed：座標本身壞掉時原樣回傳（呼叫端的 Validate 會擋下來），
    // 不要憑空生一個「看起來合理」的點。
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { latitude: lat, longitude: lng };

    const bearing = rng() * 2 * Math.PI;
    const distance = HOME_BLUR_MIN_M + rng() * (HOME_BLUR_MAX_M - HOME_BLUR_MIN_M);

    const dLat = (distance * Math.cos(bearing)) / METERS_PER_DEG_LAT;
    const cosLat = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), MIN_COS_LAT);
    const dLng = (distance * Math.sin(bearing)) / (METERS_PER_DEG_LAT * cosLat);

    return { latitude: lat + dLat, longitude: lng + dLng };
}

/** 兩點距離（公尺，haversine）。給測試與 UI 提示用。 */
export function distanceMeters(a: LatLng, b: LatLng): number {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface VenueSubmitLocation {
    approxLocation: { latitude: number; longitude: number; placeName?: string };
    /** 只有 home 會用到；hall／event 的地址本來就是公開的。 */
    blurred: boolean;
}

/**
 * 依 type 決定送出去的 `approxLocation`。
 *
 * - `home`  ⇒ 位移過的座標，而且 **placeName 不帶**：那個欄位是「可公開的稱呼」，
 *   而自建場沒有可公開的稱呼（帶上地址就等於把模糊化白做了）。
 * - 其他    ⇒ 原座標 ＋ placeName（麻將館／活動場的位置本來就該準）。
 *
 * 🔴 判準是 `type === 'home'` 這個**白名單的補集**：認不得的 type 走**模糊**那條
 *   （fail-closed）。反過來寫（`type === 'hall' || type === 'event'` 才不模糊
 *   ⇒ 其他都模糊）是同一件事，但這裡刻意寫成明確的 switch，讓新增 type 時
 *   一定要來這裡做一次決定。
 */
export function locationForSubmit(
    type: string,
    exact: LatLng,
    placeName: string | undefined,
    rng: () => number = Math.random,
): VenueSubmitLocation {
    switch (type) {
        case 'hall':
        case 'event': {
            const trimmed = (placeName ?? '').trim();
            return {
                approxLocation: {
                    latitude: exact.latitude,
                    longitude: exact.longitude,
                    ...(trimmed ? { placeName: trimmed } : {}),
                },
                blurred: false,
            };
        }
        default: {
            const b = blurLocation(exact, rng);
            return { approxLocation: { latitude: b.latitude, longitude: b.longitude }, blurred: true };
        }
    }
}
