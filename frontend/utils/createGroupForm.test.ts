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
    isStartTimeInPast,
    refreshStaleStartTime,
    toDateTimeLocalString,
    toStage1Payload,
    validateCreateGame,
    validateCreateGameStage1,
    validateCreateGameStage2,
    type BuildCreateGamePayloadInput,
    type ValidateCreateGameInput,
    type ValidateCreateGameStage1Input,
    type ValidateCreateGameStage2Input,
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

// ─────────────── A3-i：使用者沒碰過的開局時間要自己保持新鮮 ───────────────
//
// 🔴 這一組的全部重點是 `touched`。少了它，「預設值餿掉」與「使用者**故意**填一個
//    過去的時間」在程式眼裡逐字相同 —— 上面 A3a-15/17、A3c-09 那幾條釘的是後者，
//    它們必須維持綠燈。所以本組**沒有一條**去改 `validateCreateGame` 的行為。

test('A3i-01 touched=true 且已過期 → null（使用者自己填的過去時間，不准動）', () => {
    assert.equal(
        refreshStaleStartTime({ startTime: new Date(NOW - 10 * MIN).toISOString(), touched: true, now: NOW }),
        null,
    );
});

test('A3i-02 touched=false 且已過期 → 回「現在」（截到分的 datetime-local 字串）', () => {
    const got = refreshStaleStartTime({ startTime: new Date(NOW - 10 * MIN).toISOString(), touched: false, now: NOW });
    assert.equal(got, toDateTimeLocalString(NOW));
    assert.match(String(got), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('A3i-03 touched=false 但沒過期 → null（不做無謂的覆蓋）', () => {
    assert.equal(
        refreshStaleStartTime({ startTime: new Date(NOW + 10 * MIN).toISOString(), touched: false, now: NOW }),
        null,
    );
});

test('A3i-04 秒歸零邊界與檢核①一致：同一分鐘但秒數較早 → 不算過期 → null', () => {
    const now = NOW + 45_000;
    assert.equal(refreshStaleStartTime({ startTime: new Date(NOW).toISOString(), touched: false, now }), null);
});

test('A3i-05 🔴 一致性反控：touched=false 時「要不要推進」必須與檢核①「擋不擋」逐格相同', () => {
    // 兩個判準各寫一次比較式的話，只要差一個 </<=，就會出現
    // 「自動推進了但驗證仍然擋下來」這種從畫面上完全看不出原因的死結。
    // ⚠️ 樣本刻意跨過秒歸零邊界（-61s ~ +61s），否則這條對那個差別零鑑別力。
    const now = NOW + 45_000;
    for (let deltaS = -125; deltaS <= 125; deltaS += 1) {
        const startTime = new Date(NOW + deltaS * 1000).toISOString();
        const refreshed = refreshStaleStartTime({ startTime, touched: false, now }) !== null;
        const blocked = validateCreateGame(validateInput({ now, formData: { ...validateInput().formData, startTime } }))
            === '開局時間不能早於目前時間';
        assert.equal(refreshed, blocked, `deltaS=${deltaS} 推進=${refreshed} 擋下=${blocked}`);
        assert.equal(blocked, isStartTimeInPast({ startTime, now }), `deltaS=${deltaS} 檢核①沒有走 isStartTimeInPast`);
    }
});

test('A3i-06 🔴 閉環：推進之後 validateCreateGame 必須放行（否則等於沒修）', () => {
    const now = NOW + 45_000;
    const stale = new Date(NOW - 10 * MIN).toISOString();
    const fresh = refreshStaleStartTime({ startTime: stale, touched: false, now });
    assert.notEqual(fresh, null);
    // 正控：推進之前它真的是被擋的（少了這句，fresh 沒生效也會讓下一句綠）
    assert.equal(
        validateCreateGame(validateInput({ now, formData: { ...validateInput().formData, startTime: stale } })),
        '開局時間不能早於目前時間',
    );
    assert.equal(
        validateCreateGame(validateInput({ now, formData: { ...validateInput().formData, startTime: String(fresh) } })),
        null,
    );
});

test('A3i-07 toDateTimeLocalString 產出的是**本地**時間、截到分（parse 回來同一分鐘）', () => {
    const s = toDateTimeLocalString(NOW + 37_000); // 帶 37 秒
    const back = new Date(s);                      // datetime-local 字串被當本地時間解析
    assert.equal(back.getFullYear(), new Date(NOW).getFullYear());
    assert.equal(back.getMinutes(), new Date(NOW).getMinutes());
    assert.equal(back.getSeconds(), 0, '秒必須被截掉');
    assert.equal(s.length, 16);
});

test('A3i-08 startTime 解析不出來（空字串）→ 不算過期、不推進 —— 行為照搬檢核①，不是「應該的行為」', () => {
    // new Date('') 是 NaN，NaN < now 為 false ⇒ 檢核①放行。這裡刻意與它保持一致：
    // 若哪天決定要擋空值，兩支要一起改，這條會紅並逼人做那個決定。
    assert.equal(isStartTimeInPast({ startTime: '', now: NOW }), false);
    assert.equal(refreshStaleStartTime({ startTime: '', touched: false, now: NOW }), null);
});

// ── [A3-j] 第 2 步的三個 `(必填)` 環境選項 ────────────────────────────────
//
// 🔴 這一組釘的是一個**已經在線上發生**的缺陷：三個標籤寫著 `(必填)` 而沒有任何
//    檢核，因為它們的初始值非空 ⇒ 永遠「已填」。修法有兩半（初始值改 ''、本檢核），
//    而**只有一半**時外觀完全正常。下面 A3j-05 就是專門釘那個「只做一半」的。

const stage2Input = (over: Partial<ValidateCreateGameStage2Input['options']> = {}): ValidateCreateGameStage2Input => ({
    options: { smoking: '無菸', elevator: '有電梯', mahjongTable: '電動桌', ...over },
});

test('A3j-01 三項都選了 → 放行', () => {
    assert.equal(validateCreateGameStage2(stage2Input()), null);
});

test('A3j-02 菸選項沒選 → 擋下，且訊息指名是哪一欄', () => {
    assert.equal(validateCreateGameStage2(stage2Input({ smoking: '' })), '請選擇菸選項');
});

test('A3j-03 電梯沒選 → 擋下', () => {
    assert.equal(validateCreateGameStage2(stage2Input({ elevator: '' })), '請選擇電梯');
});

test('A3j-04 麻將桌沒選 → 擋下', () => {
    assert.equal(validateCreateGameStage2(stage2Input({ mahjongTable: '電動' })), null); // 非空即算已宣告
    assert.equal(validateCreateGameStage2(stage2Input({ mahjongTable: '' })), '請選擇麻將桌');
});

test('A3j-05 🔴 純空白不算宣告 —— 少了 trim，「  」會被當成使用者選過', () => {
    assert.equal(validateCreateGameStage2(stage2Input({ smoking: '   ' })), '請選擇菸選項');
    assert.equal(validateCreateGameStage2(stage2Input({ elevator: '\t' })), '請選擇電梯');
    assert.equal(validateCreateGameStage2(stage2Input({ mahjongTable: ' ' })), '請選擇麻將桌');
});

test('A3j-06 順序固定：菸 → 電梯 → 麻將桌（與畫面由上而下一致）', () => {
    // 三項同時空著時，回的必須是**第一個**。少了這條，把順序寫反不會有任何測試紅。
    assert.equal(
        validateCreateGameStage2(stage2Input({ smoking: '', elevator: '', mahjongTable: '' })),
        '請選擇菸選項',
    );
    // 正控：菸填好之後才輪到電梯 —— 少了它，上一行對「永遠回菸那句」零鑑別力。
    assert.equal(
        validateCreateGameStage2(stage2Input({ elevator: '', mahjongTable: '' })),
        '請選擇電梯',
    );
});

test('A3j-07 🔴 反控：這三項若被 buildCreateGamePayload 送出去，必須是使用者選的那個值', () => {
    // 缺陷的形狀是「沒選也送」。這條從**另一端**釘：沒選（空字串）時
    // features 裡不可以出現任何一個預設值 —— 少了它，初始值那一半被改回去也不會紅。
    const payload = buildCreateGamePayload(buildInput({
        options: { ...baseOptions(), smoking: '', elevator: '', mahjongTable: '', tableModel: '' },
    }));
    for (const ghost of ['無菸', '有電梯', '電動桌']) {
        assert.equal(payload.features.includes(ghost), false, `沒選卻送出了「${ghost}」`);
    }
});

// ───────────────────────── toStage1Payload（[A3-m]）─────────────────────────

test('A3m-01 第一段的 payload 不帶第二段的 extras（rules／features／restrictions 清空、images 拿掉）', () => {
    // 🔴 輸入刻意**三個都非空**。若寫成空的，這條與「函式整個是 identity」逐字相同。
    const full = buildCreateGamePayload(buildInput({
        formData: { ...baseForm(), rules: ['不准抽菸'], features: ['有冷氣'], restrictions: ['新手勿入'] },
        imageItems: [{ url: 'https://x/1.jpg', status: 'done' }],
    }));
    // 正控：先確認那份「完整的」真的帶著東西 —— 少了它，下面的空可能只是輸入本來就空。
    assert.equal(full.rules.length > 0 && full.features.length > 0 && full.restrictions.length > 0, true);
    assert.equal(Array.isArray(full.images) && full.images.length > 0, true);

    const stage1 = toStage1Payload(full);
    assert.deepEqual(stage1.rules, []);
    assert.deepEqual(stage1.features, []);
    assert.deepEqual(stage1.restrictions, []);
    assert.equal(stage1.images, undefined);
});

test('A3m-02 第一段真的問過的四件事一個都不能被清掉（反控）', () => {
    // 這條問的是「它有沒有清過頭」。少了它，`() => ({} as any)` 也會讓 A3m-01 全綠。
    const full = buildCreateGamePayload(buildInput({
        formData: { ...baseForm(), rules: ['不准抽菸'], features: ['有冷氣'], restrictions: ['新手勿入'] },
    }));
    const stage1 = toStage1Payload(full);
    assert.equal(stage1.startTime, full.startTime);
    assert.equal(stage1.placeName, full.placeName);
    assert.equal(stage1.location, full.location);
    assert.equal(stage1.stakes, full.stakes);
    assert.equal(stage1.needPlayers, full.needPlayers);
    assert.equal(stage1.gameType, full.gameType);
    assert.equal(stage1.latitude, full.latitude);
    assert.equal(stage1.longitude, full.longitude);
});

test('A3m-03 不就地改寫傳進來的那份 —— 呼叫端還要拿它送第二段', () => {
    // 🔴 這條不是潔癖：`submitStage2` 用的是同一組 state 重算出來的 payload，
    //    若本函式就地清空，第二段會送出一份**空的** extras，而畫面上完全正常。
    const full = buildCreateGamePayload(buildInput({
        formData: { ...baseForm(), rules: ['不准抽菸'], features: ['有冷氣'], restrictions: ['新手勿入'] },
    }));
    toStage1Payload(full);
    assert.deepEqual(full.rules, ['不准抽菸']);
    assert.equal(full.features.includes('有冷氣'), true);
    assert.deepEqual(full.restrictions, ['新手勿入']);
});
