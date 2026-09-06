// utils/mapCost.ts — 地圖成本止血的純函式與常數（[C1]，正典 PLAYER_APP_REDESIGN.md §9）
//
// 為什麼這些東西住在 utils/ 而不是寫在 MapPicker 裡：
//   MapPicker 需要一個真的 WebGL canvas 才活得起來，本機測不到；
//   而「框哪裡／縮到多少／要不要再打一次地理編碼」這三件事全都是純算術。
//   把它們搬出來之後，貴的那幾個判斷有測試守著，元件那邊只剩接線。
//
// ── §9 的成本結構（實查，不是推論）────────────────────────────────
//
// `MapPicker` 走 `maplibre-gl-js-amplify` 的 `createMap`，圖磚來自
// **Amazon Location Service**。這條路上有**兩種**各自計費的請求，
// 而 §9.2 的短期止血只講到第一種：
//
//   ① **圖磚**（Maps）—— 拖動與縮放時取得的每一張 tile 都算錢。
//      止血手段＝把「可以拖到哪裡」與「可以縮到多細」關起來，見 TAIWAN_MAX_BOUNDS／MAP_MAX_ZOOM。
//   ② **地理編碼**（Places, `Geo.searchByCoordinates`）—— **按請求計費，與圖磚分開算**。
//      每次 `moveend` 打一次。§9.2 一個字都沒提到它，而它是「拖一下就一次」的量級。
//      止血手段＝ shouldReverseGeocode()，見下。
//
// 🔴 **本檔不宣稱省了多少錢。** 省多少要照 §9.3 那份量測協定（同一組操作腳本、
//    量 Location Service 的請求數）跑過才知道，而那是 `[C2]` 的事。
//    這裡做的是**結構性限制**：把無上限的東西變成有上限的。
//    「有上限」與「省了 N%」是兩個命題，不要用前者去講後者。

/** 經緯度。與 maplibre 的 LngLatLike 相容順序無關 —— 這裡欄位有名字，不會擺錯。 */
export interface LatLng {
    lat: number;
    lng: number;
}

/**
 * 可拖動範圍（西南角 / 東北角）。maplibre 的 `maxBounds` 吃 [[西, 南], [東, 北]]。
 *
 * 🔴 **這個框是「哪些地點揪得成局」的實質定義，不只是省錢**：框外的地點
 * **選不到**，而症狀不是錯誤訊息，是地圖拖到邊界就不動了。所以錨點要寫下來：
 *
 * | 邊 | 值 | 為什麼是它 |
 * |---|---|---|
 * | 西 117.9 | 金門（約 118.3E）再往西留一點餘裕 |
 * | 東 122.3 | 蘭嶼／綠島（約 121.5E）與宜蘭外海 |
 * | 南 21.7  | 鵝鑾鼻（約 21.9N）再往南留一點餘裕 |
 * | 北 26.5  | 馬祖東引（約 26.4N） |
 *
 * ⚠️ **刻意排除**：東沙（約 116.7E）、太平島（約 114.4E）。它們在框外 ⇒
 * 那裡的使用者**選不到自己的位置**。這是取捨不是疏漏：把西邊拉到 114 等於
 * 把整個南海納入可拖範圍，而那正是要關掉的東西。
 */
export const TAIWAN_MAX_BOUNDS: [[number, number], [number, number]] = [
    [117.9, 21.7],
    [122.3, 26.5],
];

/**
 * 縮放上下限。
 *
 * 🔴 **`MAP_MAX_ZOOM` 的省錢效果有上限，而且比直覺小得多** ——
 * 向量圖磚超過來源本身的 maxzoom 之後是**放大既有圖磚**，不會再取新的。
 * 所以把 22（maplibre 預設）壓到 18 省下的不是「四級的圖磚」，
 * 而是「來源 maxzoom 到 18 之間那幾級」。⇒ 這一項的主要價值其實是
 * **擋住『縮到看得見門牌卻仍在猜地址』那種沒有意義的互動**，成本是附帶的。
 *
 * `MAP_MIN_ZOOM` 才是與 `maxBounds` 配套的那一半：不設下限的話，
 * 使用者可以縮到看見整個地球 —— 那時 `maxBounds` 形同虛設（整個框都在畫面內），
 * 而且會去取一整組低縮放層級的圖磚。7 大約是「整個台灣剛好塞滿手機螢幕」。
 */
export const MAP_MIN_ZOOM = 7;
export const MAP_MAX_ZOOM = 18;

/** 開圖預設縮放。原本寫死在 MapPicker 裡，搬出來是為了讓上下限守得住它。 */
export const MAP_DEFAULT_ZOOM = 16;

/**
 * 兩次地理編碼之間至少要移動多遠（公尺）才值得再打一次。
 *
 * 15 公尺的來由：這張圖是「拖動選點」的 UX，`moveend` 在每一次手指離開時都會觸發，
 * 包含**使用者只是想看清楚而輕輕挪一下**的那些。15 公尺以內基本上不會換門牌
 * （台灣街廓的門牌間距量級是 10 公尺上下）⇒ 這一格是把「同一個地址問兩次」關掉，
 * 不是把「換了地方不問」關掉。
 *
 * ⚠️ **這個值沒有實測校準過。** 它是從門牌間距推的，不是從「多少公尺會換地址」量的。
 * 訂太大會出現「明明拖了一段路，地址卻沒更新」——那個症狀比多花幾次請求嚴重得多，
 * ⇒ 有疑慮時往小的調。
 */
export const REGEOCODE_MIN_MOVE_M = 15;

/** 地球半徑（公尺）。haversine 用。 */
const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * 兩點的大圓距離（公尺）。
 *
 * ⚠️ 為什麼不用「經緯度差的平方和」那種近似：緯度差一度到哪裡都是 111 公里，
 * 但**經度差一度的實際距離隨緯度縮**（台灣約 101 公里）。在 15 公尺這種量級上
 * 兩者差不了多少，但近似式會讓「東西向」與「南北向」的門檻不一樣 ——
 * 而那個不對稱沒有任何理由，只是懶。
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 這次 `moveend` 要不要再打一次地理編碼？
 *
 * 🔴 **`last` 是 null 時一律回 `true`** —— 那代表「還沒問過任何地址」，
 * 而這一格如果 fail-open 成 false，畫面上會留著「正在取得地址…」永遠不動。
 * ⇒ 省錢的閘門要往**多打一次**的方向失敗，不是往**不問**的方向。
 */
export function shouldReverseGeocode(
    last: LatLng | null | undefined,
    next: LatLng,
    thresholdM: number = REGEOCODE_MIN_MOVE_M,
): boolean {
    if (!last) return true;
    return distanceMeters(last, next) >= thresholdM;
}

/**
 * 這個座標在可拖範圍內嗎？
 *
 * 用途只有一個，但它很重要：**定位到使用者當下位置之前要先問這一句**。
 * 不問的話，人在框外（出國、或在東沙）時 `flyTo` 會被 `maxBounds` **默默夾到邊界**，
 * 然後我們對那個**被夾過的**座標做地理編碼 ⇒ 畫面上出現一個他從沒去過的地址，
 * 而且沒有任何一行錯誤訊息。⇒ 寧可不動（留在預設的台北），也不要給一個看起來合理的錯值。
 */
export function isWithinMapBounds(
    p: LatLng,
    bounds: [[number, number], [number, number]] = TAIWAN_MAX_BOUNDS,
): boolean {
    const [[west, south], [east, north]] = bounds;
    return p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north;
}
