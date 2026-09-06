// utils/createGroupForm.test.ts — 發團表單純函式的回歸網（[A3-a]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這些測試釘的是「從 pages/CreateGroup.tsx 的 confirmCreate 搬出來時的行為」，
// 不是「應該有的行為」。抽出來才看得見的怪處寫在各條註解裡，本塊不修。
// 🔴 `now` 全部是固定數字，這裡沒有任何一行讀真時鐘。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCreateGamePayload,
    validateCreateGame,
    validateCreateGameStage1,
    type BuildCreateGamePayloadInput,
    type ValidateCreateGameInput,
    type ValidateCreateGameStage1Input,
    type VenueOptions,
} from './createGroupForm.ts';
import type { CreateMahjongGamePayload } from '../types';

/** 固定的「現在」：2026-09-03T12:00:00Z */
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const MIN = 60_000;

const baseForm = (): CreateMahjongGamePayload => ({
    type: 'one-time',
    gameType: '台麻',
    placeName: '老王家',
    location: '台北市大安區',
    latitude: 0,
    longitude: 0,
    needPlayers: 2,
    stakes: '100/20',
    startTime: '2026-09-03T20:30',
    rules: [],
    features: [],
    restrictions: [],
});

const baseOptions = (): VenueOptions => ({
    smoking: '無菸',
    parking: [],
    elevator: '有電梯',
    mahjongTable: '電動桌',
    tableModel: '',
    venueType: '',
    skillLevel: '',
});

const buildInput = (over: Partial<BuildCreateGamePayloadInput> = {}): BuildCreateGamePayloadInput => ({
    formData: baseForm(),
    coordinates: { latitude: 25.03, longitude: 121.56 },
    options: baseOptions(),
    imageItems: [],
    ...over,
});

const validateInput = (over: Partial<ValidateCreateGameInput> = {}): ValidateCreateGameInput => ({
    formData: { startTime: new Date(NOW + 60 * MIN).toISOString(), placeName: '老王家', location: '台北市' },
    coordinates: { latitude: 25.03, longitude: 121.56 },
    now: NOW,
    ...over,
});

// ───────────────────────── buildCreateGamePayload ─────────────────────────

test('A3a-1 features 的順序：smoking → parking… → elevator → 桌 → venueType → skillLevel → 手填', () => {
    const out = buildCreateGamePayload(buildInput({
        options: {
            smoking: '可吸菸', parking: ['路邊停車', '停車場'], elevator: '無電梯',
            mahjongTable: '手動桌', tableModel: '', venueType: '住家', skillLevel: '休閒',
        },
        formData: { ...baseForm(), features: ['有冷氣', '供餐'] },
    }));
    assert.deepEqual(out.features, [
        '可吸菸', '路邊停車', '停車場', '無電梯', '手動桌', '住家', '休閒', '有冷氣', '供餐',
    ]);
});

test('A3a-2 電動桌 + 型號 → 「電動桌:型號」（型號兩側空白會被 trim）', () => {
    const out = buildCreateGamePayload(buildInput({
        options: { ...baseOptions(), mahjongTable: '電動桌', tableModel: '  雀友 A1  ' },
    }));
    assert.deepEqual(out.features, ['無菸', '有電梯', '電動桌:雀友 A1']);
});

test('A3a-3 電動桌但型號只有空白 → 只寫「電動桌」，不出現冒號', () => {
    const out = buildCreateGamePayload(buildInput({
        options: { ...baseOptions(), mahjongTable: '電動桌', tableModel: '   ' },
    }));
    assert.deepEqual(out.features, ['無菸', '有電梯', '電動桌']);
});

test('A3a-4 不是電動桌時即使 tableModel 有值也不帶型號', () => {
    const out = buildCreateGamePayload(buildInput({
        options: { ...baseOptions(), mahjongTable: '手動桌', tableModel: '雀友 A1' },
    }));
    assert.deepEqual(out.features, ['無菸', '有電梯', '手動桌']);
    assert.ok(!out.features.some((f) => f.includes(':')));
});

test('A3a-5 venueType／skillLevel 空字串會被濾掉（搬出來時的行為：空的選項不進 features）', () => {
    const out = buildCreateGamePayload(buildInput());
    assert.deepEqual(out.features, ['無菸', '有電梯', '電動桌']);
});

test('A3a-6 手填 features 的空字串／純空白被濾掉，但非空的保留原樣（不 trim）', () => {
    const out = buildCreateGamePayload(buildInput({
        formData: { ...baseForm(), features: ['', '   ', ' 有冷氣 ', '供餐'] },
    }));
    assert.deepEqual(out.features, ['無菸', '有電梯', '電動桌', ' 有冷氣 ', '供餐']);
});

test('A3a-7 rules／restrictions 各自濾掉空字串與純空白，保留順序', () => {
    const out = buildCreateGamePayload(buildInput({
        formData: {
            ...baseForm(),
            rules: ['', '不可遲到', '  ', '自摸雙倍'],
            restrictions: ['   ', '限 18+', ''],
        },
    }));
    assert.deepEqual(out.rules, ['不可遲到', '自摸雙倍']);
    assert.deepEqual(out.restrictions, ['限 18+']);
});

test('A3a-8 images：一張都沒有 → undefined（不是 []），而且鍵仍然存在', () => {
    const out = buildCreateGamePayload(buildInput({ imageItems: [] }));
    assert.equal(out.images, undefined);
    assert.ok('images' in out);
    assert.notDeepEqual(out.images, []);
});

test('A3a-9 images：全部是 uploading／error 或缺 url → 一樣是 undefined', () => {
    const out = buildCreateGamePayload(buildInput({
        imageItems: [
            { status: 'uploading', url: 'https://x/1.jpg' },
            { status: 'error', url: 'https://x/2.jpg' },
            { status: 'done' },              // 缺 url
            { status: 'done', url: '' },     // 空 url 也算缺
        ],
    }));
    assert.equal(out.images, undefined);
});

test('A3a-10 images：只收 status=done 且有 url 的，順序照 imageItems', () => {
    const out = buildCreateGamePayload(buildInput({
        imageItems: [
            { status: 'done', url: 'https://x/1.jpg' },
            { status: 'error', url: 'https://x/2.jpg' },
            { status: 'done', url: 'https://x/3.jpg' },
            { status: 'uploading' },
        ],
    }));
    assert.deepEqual(out.images, ['https://x/1.jpg', 'https://x/3.jpg']);
});

test('A3a-11 latitude／longitude 取自 coordinates，不是 formData 裡那兩個 0', () => {
    const out = buildCreateGamePayload(buildInput({
        formData: { ...baseForm(), latitude: 0, longitude: 0 },
        coordinates: { latitude: 24.15, longitude: 120.67 },
    }));
    assert.equal(out.latitude, 24.15);
    assert.equal(out.longitude, 120.67);
});

test('A3a-12 startTime 轉成 ISO 8601（以 Z 結尾），其餘欄位原樣透傳', () => {
    const out = buildCreateGamePayload(buildInput({
        formData: { ...baseForm(), startTime: '2026-09-03T20:30', stakes: '300/50', needPlayers: 3 },
    }));
    assert.equal(out.startTime, new Date('2026-09-03T20:30').toISOString());
    assert.match(out.startTime, /Z$/);
    assert.equal(out.stakes, '300/50');
    assert.equal(out.needPlayers, 3);
    assert.equal(out.gameType, '台麻');
});

test('A3a-13 純函式：不改動傳入的 formData／options／imageItems', () => {
    const input = buildInput({
        formData: { ...baseForm(), features: ['', 'x'], rules: [''] },
        imageItems: [{ status: 'done', url: 'https://x/1.jpg' }],
    });
    const snapshot = JSON.stringify(input);
    buildCreateGamePayload(input);
    assert.equal(JSON.stringify(input), snapshot);
});

// ───────────────────────── validateCreateGame ─────────────────────────

test('A3a-14 全部通過 → null', () => {
    assert.equal(validateCreateGame(validateInput()), null);
});

test('A3a-15 ① 開局時間早於現在 → 開局時間不能早於目前時間', () => {
    assert.equal(
        validateCreateGame(validateInput({ formData: { ...validateInput().formData, startTime: new Date(NOW - MIN).toISOString() } })),
        '開局時間不能早於目前時間',
    );
});

test('A3a-16 ① 的秒歸零邊界：同一分鐘但秒數比 now 早 → 通過', () => {
    // now = 12:00:45，startTime = 12:00:00 —— 差 45 秒，但秒歸零後相等，不算早
    const now = NOW + 45_000;
    const startTime = new Date(NOW).toISOString();
    assert.equal(validateCreateGame(validateInput({ now, formData: { ...validateInput().formData, startTime } })), null);
});

test('A3a-17 ① 的秒歸零邊界：前一分鐘的 59 秒 → 仍然擋', () => {
    // now = 12:00:45（歸零 → 12:00:00），startTime = 11:59:59 → 早
    const now = NOW + 45_000;
    const startTime = new Date(NOW - 1_000).toISOString();
    assert.equal(
        validateCreateGame(validateInput({ now, formData: { ...validateInput().formData, startTime } })),
        '開局時間不能早於目前時間',
    );
});

test('A3a-18 ① 的秒歸零邊界：startTime 帶秒且比歸零後的 now 晚 1 秒 → 通過', () => {
    const now = NOW + 45_000; // 歸零 → NOW
    const startTime = new Date(NOW + 1_000).toISOString();
    assert.equal(validateCreateGame(validateInput({ now, formData: { ...validateInput().formData, startTime } })), null);
});

test('A3a-19 ② 座標 (0,0) → 請完成地址定位；只有一軸是 0 不算', () => {
    assert.equal(validateCreateGame(validateInput({ coordinates: { latitude: 0, longitude: 0 } })), '請完成地址定位');
    assert.equal(validateCreateGame(validateInput({ coordinates: { latitude: 0, longitude: 121 } })), null);
    assert.equal(validateCreateGame(validateInput({ coordinates: { latitude: 25, longitude: 0 } })), null);
});

test('A3a-20 ③ placeName 空／純空白 → 請輸入場地名稱', () => {
    assert.equal(validateCreateGame(validateInput({ formData: { ...validateInput().formData, placeName: '' } })), '請輸入場地名稱');
    assert.equal(validateCreateGame(validateInput({ formData: { ...validateInput().formData, placeName: '   ' } })), '請輸入場地名稱');
});

test('A3a-21 ④ location 空／純空白 → 請輸入完整地址', () => {
    assert.equal(validateCreateGame(validateInput({ formData: { ...validateInput().formData, location: '' } })), '請輸入完整地址');
    assert.equal(validateCreateGame(validateInput({ formData: { ...validateInput().formData, location: '\t' } })), '請輸入完整地址');
});

test('A3a-22 順序 ①>②：時間早 且 座標 (0,0) → 回時間那條', () => {
    assert.equal(
        validateCreateGame(validateInput({
            formData: { ...validateInput().formData, startTime: new Date(NOW - MIN).toISOString() },
            coordinates: { latitude: 0, longitude: 0 },
        })),
        '開局時間不能早於目前時間',
    );
});

test('A3a-23 順序 ②>③：座標 (0,0) 且 placeName 空 → 回定位那條', () => {
    assert.equal(
        validateCreateGame(validateInput({
            formData: { ...validateInput().formData, placeName: '' },
            coordinates: { latitude: 0, longitude: 0 },
        })),
        '請完成地址定位',
    );
});

test('A3a-24 順序 ③>④：placeName 與 location 都空 → 回場地名稱那條', () => {
    assert.equal(
        validateCreateGame(validateInput({ formData: { ...validateInput().formData, placeName: '', location: '' } })),
        '請輸入場地名稱',
    );
});

test('A3a-25 四條同時不成立 → 仍是 ①（整條鏈的第一個）', () => {
    assert.equal(
        validateCreateGame(validateInput({
            formData: { startTime: new Date(NOW - MIN).toISOString(), placeName: '', location: '' },
            coordinates: { latitude: 0, longitude: 0 },
        })),
        '開局時間不能早於目前時間',
    );
});

test('A3a-26 搬出來時的行為：startTime 是壞字串 → NaN < now 為 false ⇒ 檢核①放行（不在本塊修）', () => {
    // 這條釘的是缺陷本身：datetime-local 不會給壞字串，但一給就會漏過 ①。
    assert.equal(validateCreateGame(validateInput({ formData: { ...validateInput().formData, startTime: 'not-a-date' } })), null);
});

// ───────────────────────── validateCreateGameStage1（[A3-c1]） ─────────────────────────
//
// 精靈第 1 步 → 第 2 步的閘門。它的四道檢核是**委派**給 validateCreateGame 的，
// 所以下面 A3c-02..05 一律用「兩個函式的回傳相等」比對，不把訊息字串再抄一份 ——
// 改了 validateCreateGame 的訊息時，這裡不會變成第二份會漂掉的真理。

const stage1Input = (over: Partial<ValidateCreateGameStage1Input> = {}): ValidateCreateGameStage1Input => ({
    formData: { ...validateInput().formData, stakes: baseForm().stakes },
    coordinates: { latitude: 25.03, longitude: 121.56 },
    now: NOW,
    ...over,
});

test('A3c-01 全部合格（含 stakes 有值）→ null', () => {
    assert.equal(validateCreateGameStage1(stage1Input()), null);
});

test('A3c-02 委派 ①：開局時間早於現在 → 與 validateCreateGame 回同一句（不另抄字串）', () => {
    const x = stage1Input({ formData: { ...stage1Input().formData, startTime: new Date(NOW - MIN).toISOString() } });
    assert.notEqual(validateCreateGame(x), null); // 正控：這份輸入確實會被 ① 擋
    assert.equal(validateCreateGameStage1(x), validateCreateGame(x));
});

test('A3c-03 委派 ②：座標 (0,0) → 與 validateCreateGame 回同一句', () => {
    const x = stage1Input({ coordinates: { latitude: 0, longitude: 0 } });
    assert.notEqual(validateCreateGame(x), null);
    assert.equal(validateCreateGameStage1(x), validateCreateGame(x));
});

test('A3c-04 委派 ③：placeName 空白 → 與 validateCreateGame 回同一句', () => {
    const x = stage1Input({ formData: { ...stage1Input().formData, placeName: '  ' } });
    assert.notEqual(validateCreateGame(x), null);
    assert.equal(validateCreateGameStage1(x), validateCreateGame(x));
});

test('A3c-05 委派 ④：location 空白 → 與 validateCreateGame 回同一句', () => {
    const x = stage1Input({ formData: { ...stage1Input().formData, location: '' } });
    assert.notEqual(validateCreateGame(x), null);
    assert.equal(validateCreateGameStage1(x), validateCreateGame(x));
});

test('A3c-06 ⑤ stakes 空字串 → 請輸入籌碼（這一道只有 Stage1 閘門在擋）', () => {
    assert.equal(
        validateCreateGameStage1(stage1Input({ formData: { ...stage1Input().formData, stakes: '' } })),
        '請輸入籌碼',
    );
});

test('A3c-07 ⑤ stakes 純空白 → 請輸入籌碼（釘 .trim()）', () => {
    assert.equal(
        validateCreateGameStage1(stage1Input({ formData: { ...stage1Input().formData, stakes: '   ' } })),
        '請輸入籌碼',
    );
});

test('A3c-08 順序 ③>⑤：stakes 空 且 placeName 空 → 回場地名稱那條（四道在前，stakes 不插隊）', () => {
    assert.equal(
        validateCreateGameStage1(stage1Input({ formData: { ...stage1Input().formData, stakes: '', placeName: '' } })),
        '請輸入場地名稱',
    );
});

test('A3c-09 順序 ①>⑤：stakes 空 且 startTime 在過去 → 回時間那條（整條鏈的第一個）', () => {
    assert.equal(
        validateCreateGameStage1(stage1Input({
            formData: { ...stage1Input().formData, stakes: '', startTime: new Date(NOW - MIN).toISOString() },
        })),
        '開局時間不能早於目前時間',
    );
});

test('A3c-10 邊界反控：validateCreateGame 自己**不**檢查 stakes —— 這個責任刻意留在 Stage1 閘門、不下放；有人把 stakes 搬進去時這條會紅，逼他做一次決定', () => {
    // 同一份「stakes 空、其餘全合格」的輸入：validateCreateGame 放行、Stage1 閘門擋下。
    // 兩個斷言缺一不可 —— 只有前者的話，「validateCreateGame 沒檢查」與「輸入其實合格」分不出來。
    const x = stage1Input({ formData: { ...stage1Input().formData, stakes: '' } });
    assert.equal(validateCreateGame(x), null);
    assert.equal(validateCreateGameStage1(x), '請輸入籌碼');
});
