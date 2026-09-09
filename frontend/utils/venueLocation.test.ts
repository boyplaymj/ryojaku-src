// utils/venueLocation.test.ts — [B1-j4]
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    blurLocation,
    distanceMeters,
    locationForSubmit,
    HOME_BLUR_MIN_M,
    HOME_BLUR_MAX_M,
} from './venueLocation.ts';

const TAIPEI = { latitude: 25.033976, longitude: 121.564421 };
/** 可注入的假亂數：依序吐出給定的值，用完循環。 */
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

test('B1jL-1 位移量落在 300–500 公尺（八個方位都量）', () => {
    for (let k = 0; k < 8; k++) {
        const bearing = k / 8;               // rng 第一次回這個 ⇒ 方位
        for (const t of [0, 0.5, 0.999]) {   // rng 第二次回這個 ⇒ 距離
            const out = blurLocation(TAIPEI, seq(bearing, t));
            const d = distanceMeters(TAIPEI, out);
            assert.ok(d >= HOME_BLUR_MIN_M - 1 && d <= HOME_BLUR_MAX_M + 1, `bearing=${bearing} t=${t} d=${d}`);
        }
    }
});

test('B1jL-2 🔴 距離真的隨 rng 變動 —— 否則「永遠位移 300m」也會讓 B1jL-1 綠', () => {
    const near = distanceMeters(TAIPEI, blurLocation(TAIPEI, seq(0.25, 0)));
    const far = distanceMeters(TAIPEI, blurLocation(TAIPEI, seq(0.25, 0.999)));
    assert.ok(far - near > 150, `near=${near} far=${far}`);
});

test('B1jL-3 🔴 方位真的隨 rng 變動 —— 否則「永遠往正北」也會讓 B1jL-1 綠', () => {
    const north = blurLocation(TAIPEI, seq(0, 0.5));
    const east = blurLocation(TAIPEI, seq(0.25, 0.5));
    assert.ok(north.latitude > TAIPEI.latitude, '0 應該往北');
    assert.ok(Math.abs(north.longitude - TAIPEI.longitude) < 1e-6, '0 不該往東西偏');
    assert.ok(east.longitude > TAIPEI.longitude, '0.25 應該往東');
    assert.ok(Math.abs(east.latitude - TAIPEI.latitude) < 1e-6, '0.25 不該往南北偏');
});

test('B1jL-4 位移過的座標不等於原座標', () => {
    const out = blurLocation(TAIPEI, seq(0.13, 0.42));
    assert.notEqual(out.latitude, TAIPEI.latitude);
    assert.notEqual(out.longitude, TAIPEI.longitude);
});

test('B1jL-5 壞座標原樣回傳，不生一個看起來合理的點', () => {
    const bad = blurLocation({ latitude: NaN, longitude: 121 } as never, seq(0.1, 0.1));
    assert.ok(Number.isNaN(bad.latitude));
});

test('B1jL-6 🔴 極高緯度算出來的仍是**合法座標**（不是只有 isFinite）', () => {
    // 🔴 這條原本斷言 isFinite，而那對「拿掉 cos(lat) 夾制」**零鑑別力**（突變 L7 存活）：
    //    Math.cos(Math.PI/2) 是 6.12e-17 不是 0 ⇒ 不會 NaN，只會算出經度 7.4e13 ——
    //    一個有限、但不是座標的數字。尺要問的是「還是不是座標」。
    for (const lat of [89.999, 90, -90]) {
        const out = blurLocation({ latitude: lat, longitude: 0 }, seq(0.25, 0.5));
        assert.ok(Number.isFinite(out.latitude) && Number.isFinite(out.longitude), JSON.stringify(out));
        assert.ok(out.longitude >= -180 && out.longitude <= 180, `經度飛出去了：${out.longitude}`);
    }
});

test('B1jL-7 🔴 自建場送出去的是位移過的座標，而且不帶 placeName', () => {
    const r = locationForSubmit('home', TAIPEI, '小明家', seq(0.3, 0.7));
    assert.equal(r.blurred, true);
    assert.equal(r.approxLocation.placeName, undefined, 'placeName 帶上地址等於模糊化白做');
    const d = distanceMeters(TAIPEI, r.approxLocation);
    assert.ok(d >= HOME_BLUR_MIN_M - 1 && d <= HOME_BLUR_MAX_M + 1, `d=${d}`);
});

test('B1jL-8 麻將館／活動場不模糊，而且保留 placeName（B1jL-7 的反控）', () => {
    // 少了這條，`locationForSubmit` 一律模糊也會讓 B1jL-7 綠 ——
    // 而那會讓麻將館的圖釘離店家 400 公尺，症狀是「地圖不準」而不是「隱私壞了」。
    for (const t of ['hall', 'event']) {
        const r = locationForSubmit(t, TAIPEI, '  大安麻將館  ', seq(0.3, 0.7));
        assert.equal(r.blurred, false, t);
        assert.deepEqual(r.approxLocation, { latitude: TAIPEI.latitude, longitude: TAIPEI.longitude, placeName: '大安麻將館' }, t);
    }
});

test('B1jL-9 認不得的 type 走模糊那條（fail-closed）', () => {
    for (const t of ['dojo', '', 'HOME', 'whatever']) {
        assert.equal(locationForSubmit(t, TAIPEI, 'x', seq(0.3, 0.7)).blurred, true, t);
    }
});

test('B1jL-10 placeName 是空白時不帶那個鍵（不是帶空字串）', () => {
    const r = locationForSubmit('hall', TAIPEI, '   ', seq(0.3, 0.7));
    assert.ok(!('placeName' in r.approxLocation), JSON.stringify(r.approxLocation));
});
