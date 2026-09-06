// utils/mapCost.test.ts — 地圖成本止血的回歸網（[C1]，正典 PLAYER_APP_REDESIGN.md §9）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    TAIWAN_MAX_BOUNDS,
    MAP_MIN_ZOOM,
    MAP_MAX_ZOOM,
    MAP_DEFAULT_ZOOM,
    REGEOCODE_MIN_MOVE_M,
    distanceMeters,
    shouldReverseGeocode,
    isWithinMapBounds,
} from './mapCost.ts';

// ── 尺本身要先對過已知答案，否則後面每一條都是同義反覆 ──────────────

test('C1a-1 distanceMeters 對得上已知答案：緯度差一度 ≈ 111.19 km', () => {
    // 子午線上一度 = 地球半徑 × π/180 = 111,195 m。這個數字不是我編的，是定義算出來的。
    const d = distanceMeters({ lat: 25, lng: 121 }, { lat: 26, lng: 121 });
    assert.ok(Math.abs(d - 111_195) < 50, `緯度一度量到 ${Math.round(d)} m`);
});

test('C1a-2 反控：經度一度在台灣緯度上「比較短」—— 尺分得出東西向與南北向', () => {
    // cos(25°) × 111.32 km ≈ 100.9 km。若改用「經緯度差平方和」的近似，
    // 這一條會與 C1a-1 量出同一個數字 ⇒ 它是那個近似的反控。
    const ew = distanceMeters({ lat: 25, lng: 121 }, { lat: 25, lng: 122 });
    assert.ok(Math.abs(ew - 100_900) < 400, `經度一度量到 ${Math.round(ew)} m`);
    const ns = distanceMeters({ lat: 25, lng: 121 }, { lat: 26, lng: 121 });
    assert.ok(ns - ew > 9_000, `南北 ${Math.round(ns)} 與東西 ${Math.round(ew)} 該差一萬公尺量級`);
});

test('C1a-3 同一點距離為 0（退化格，確認沒有 NaN）', () => {
    const p = { lat: 25.033976, lng: 121.564421 };
    assert.equal(distanceMeters(p, p), 0);
});

// ── 重複地理編碼的閘門 ────────────────────────────────────────────

test('C1a-4 沒問過就一定要問 —— fail-open 到「多打一次」那一側', () => {
    const next = { lat: 25.03, lng: 121.56 };
    assert.equal(shouldReverseGeocode(null, next), true);
    assert.equal(shouldReverseGeocode(undefined, next), true);
});

test('C1a-5 原地輕輕挪一下不再問（門檻內）', () => {
    const a = { lat: 25.033976, lng: 121.564421 };
    // 往北 5 公尺：5 / 111195 度
    const b = { lat: a.lat + 5 / 111_195, lng: a.lng };
    assert.ok(distanceMeters(a, b) < REGEOCODE_MIN_MOVE_M);
    assert.equal(shouldReverseGeocode(a, b), false);
});

test('C1a-6 拖過門檻就要問（正控，且恰好在門檻上要算過）', () => {
    const a = { lat: 25.033976, lng: 121.564421 };
    const far = { lat: a.lat + 50 / 111_195, lng: a.lng };
    assert.equal(shouldReverseGeocode(a, far), true);
    // 邊界是 >=，不是 >：距離**恰好等於**門檻時要問。
    // 🔴 這裡拿「量到的距離」當門檻，不是拿「111195 度換算出來的 15 公尺」——
    //    第一版就是那樣寫的，結果它紅了：`15 / 111_195` 這個度數換回公尺是
    //    14.99999… 公尺（我那個每度公尺數是四捨五入過的）⇒ 那條測試量到的是
    //    **我的捨入誤差**，不是 `>=` 與 `>` 的差別。用 d 自己當門檻才碰得到邊界。
    const d = distanceMeters(a, far);
    assert.equal(shouldReverseGeocode(a, far, d), true, '恰好等於門檻要問');
    assert.equal(shouldReverseGeocode(a, far, d + 1e-9), false, '差一點點就不問');
});

test('C1a-7 門檻可覆寫 —— 同一組座標換門檻會翻面（證明它真的在讀那個參數）', () => {
    const a = { lat: 25.033976, lng: 121.564421 };
    const b = { lat: a.lat + 20 / 111_195, lng: a.lng };
    assert.equal(shouldReverseGeocode(a, b, 15), true);
    assert.equal(shouldReverseGeocode(a, b, 100), false);
});

// ── 可拖範圍 ─────────────────────────────────────────────────────

test('C1a-8 框內：本島南北端、金門、馬祖、蘭嶼、澎湖都選得到', () => {
    const inside: Array<[string, number, number]> = [
        ['台北 101', 25.033976, 121.564421],
        ['鵝鑾鼻', 21.901, 120.851],
        ['金門金城', 24.433, 118.317],
        ['馬祖南竿', 26.160, 119.950],
        ['蘭嶼', 22.043, 121.541],
        ['澎湖馬公', 23.566, 119.579],
    ];
    for (const [name, lat, lng] of inside) {
        assert.equal(isWithinMapBounds({ lat, lng }), true, `${name} 應該在框內`);
    }
});

test('C1a-9 框外：東沙與太平島選不到 —— 這是取捨，不是它壞了', () => {
    assert.equal(isWithinMapBounds({ lat: 20.7, lng: 116.717 }), false, '東沙');
    assert.equal(isWithinMapBounds({ lat: 10.377, lng: 114.365 }), false, '太平島');
});

test('C1a-10 反控：框外的「常見誤入點」確實被擋 —— 否則這個框等於沒框', () => {
    // 少了這一條，把 bounds 改成整個地球，C1a-8 照樣全綠。
    assert.equal(isWithinMapBounds({ lat: 35.689, lng: 139.692 }), false, '東京');
    assert.equal(isWithinMapBounds({ lat: 22.319, lng: 114.169 }), false, '香港');
    assert.equal(isWithinMapBounds({ lat: 31.230, lng: 121.474 }), false, '上海（經度幾乎與台北同）');
});

test('C1a-11 bounds 的形狀是 maplibre 要的 [[西,南],[東,北]]，且西<東、南<北', () => {
    const [[west, south], [east, north]] = TAIWAN_MAX_BOUNDS;
    assert.ok(west < east, '西要小於東');
    assert.ok(south < north, '南要小於北');
    assert.equal(TAIWAN_MAX_BOUNDS.length, 2);
    assert.equal(TAIWAN_MAX_BOUNDS[0].length, 2);
});

// ── 縮放 ─────────────────────────────────────────────────────────

test('C1a-12 預設縮放要落在上下限之內 —— 不然開圖當下就被夾', () => {
    assert.ok(MAP_MIN_ZOOM < MAP_DEFAULT_ZOOM, `${MAP_MIN_ZOOM} < ${MAP_DEFAULT_ZOOM}`);
    assert.ok(MAP_DEFAULT_ZOOM <= MAP_MAX_ZOOM, `${MAP_DEFAULT_ZOOM} <= ${MAP_MAX_ZOOM}`);
});

test('C1a-13 上限要真的比 maplibre 預設的 22 緊，否則這一項是 no-op', () => {
    assert.ok(MAP_MAX_ZOOM < 22, 'maxZoom 沒有比預設緊的話，設它等於沒設');
    assert.ok(MAP_MIN_ZOOM > 0, 'minZoom 是 0 的話可以縮到看見整個地球，maxBounds 形同虛設');
});

// ── 接線守衛（沿用 matchmakingTab.test.ts 的做法：純函式全綠不代表有人在用）──
//
// 🔴 為什麼需要這一段：上面 13 條全部只求值 mapCost.ts 自己。把 MapPicker 裡的
//    `maxBounds` 那一行整個刪掉，它們**一條都不會紅** —— 那正是「模組寫好卻沒人叫」。
//    ⚠️ 界線：這是**文字**守衛，它證明的是「原始碼引用了那個常數」，
//    證明不了「maplibre 真的收到並照做」。後者要真瀏覽器，屬 [C2] 量測協定的範圍。

test('C1a-14 MapPicker 的 createMap 確實帶了三個止血選項', () => {
    const src = readFileSync(new URL('../components/MapPicker.tsx', import.meta.url), 'utf8');
    // 正控：檔案裡要真的有 createMap，否則下面三條在一個空字串上也會「通過」。
    assert.ok(src.includes('createMap({'), 'MapPicker 找不到 createMap( —— 尺壞了或地圖換了建構方式');
    assert.ok(src.includes('maxBounds: TAIWAN_MAX_BOUNDS'), 'createMap 沒帶 maxBounds');
    assert.ok(src.includes('minZoom: MAP_MIN_ZOOM'), 'createMap 沒帶 minZoom');
    assert.ok(src.includes('maxZoom: MAP_MAX_ZOOM'), 'createMap 沒帶 maxZoom');
});

test('C1a-15 兩條定位路徑都先問過邊界，且 moveend 有距離閘', () => {
    const src = readFileSync(new URL('../components/MapPicker.tsx', import.meta.url), 'utf8');
    // 正控：flyTo 還在。它不在了的話，「邊界守衛不見了」與「這個元件不再飛」分不出來。
    const flyTos = src.split('\n').filter(l => l.includes('.flyTo(')).length;
    assert.ok(flyTos >= 2, `flyTo 只剩 ${flyTos} 處 —— 尺壞了或定位路徑被改寫`);

    const guards = src.split('\n').filter(l => l.includes('isWithinMapBounds(')).length;
    assert.ok(guards >= 2, `只有 ${guards} 處邊界守衛，開圖自動定位與「目前位置」按鈕兩條路都要有`);

    assert.ok(src.includes('shouldReverseGeocode('), 'moveend 沒有距離閘，會每拖一次就打一次 Places');
});

test('C1a-16 硬編碼的縮放值不可再出現 —— 否則上下限守不住它', () => {
    const src = readFileSync(new URL('../components/MapPicker.tsx', import.meta.url), 'utf8');
    // `zoom: 16` 本身不會壞（16 在範圍內），但它是**沒有被常數管到的第二個來源**：
    // 改 MAP_DEFAULT_ZOOM 時它不會跟著動，而兩個值不一致沒有任何徵兆。
    const hardcoded = src.split('\n').filter(l => /zoom:\s*\d/.test(l) && !l.includes('MAP_'));
    assert.deepEqual(hardcoded, [], `還有寫死的 zoom：\n${hardcoded.join('\n')}`);
});
