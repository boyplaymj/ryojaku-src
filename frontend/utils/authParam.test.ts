// utils/authParam.test.ts — 身分參數的分流判準
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這一組守的是一個**間歇性**的錯：加密後的 LINE ID 是 URL-safe base64，
// 約 1/64 會以 `U` 開頭，而舊判準 `startsWith('U')` 會把它送成 `userId=<密文>`
// ⇒ 後端查不到 ⇒ 那一次登入失敗、下一次又好了。
// 「偶爾失敗」這種形狀不會有人回報成 bug，只會被當成網路不穩。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authParamFor, isPlainUserId } from './authParam.ts';

/**
 * 一個真實形狀的密文：URL-safe base64、長 84、**刻意以 `U` 開頭**。
 *
 * 長度來自實際結構：GCM nonce 12 + LINE id 33 + tag 16 = 61 bytes → 84 字元。
 * 樣本是**機器產的**（`base64.urlsafe_b64encode(61 bytes)`），不是手打的 ——
 * 第一版手打的樣本長度 81，被 F2-5 當場擋下來，那正是它存在的理由。
 */
const CIPHERTEXT_STARTING_WITH_U =
  'UZPBEWnclyg-uLZT0dQE5rRGODsYKOS8v-Cwp6CSPooNQWIOb7vpAtIKbiJtCPJUp2gStvX5v6yzuXOv2g==';
/** 同上，但不是 `U` 開頭 —— 另外 63/64 的情形。 */
const CIPHERTEXT_STARTING_WITH_OTHER =
  'ACV2Tgl6g0LJ5tMa5G7RpdfDmrmYhvcoJTi8JfEO-QWP-F2yEXvzsOEe3AWQM9jdI2Umw00OarS2V-9gYA==';
/** LINE 明文 user id：`U` + 32 = 33 字元。 */
const LINE_PLAINTEXT_ID = 'U0123456789abcdef0123456789abcdef';

test('F2-1 APP 帳號走 userId=', () => {
  assert.equal(authParamFor('APP_1a2b3c4d5e6f7g8h'), 'userId=APP_1a2b3c4d5e6f7g8h');
  assert.equal(isPlainUserId('APP_1a2b3c4d5e6f7g8h'), true);
});

test('F2-2 LINE 明文 user id（U + 32，長 33）走 userId=', () => {
  // 後端對 LINE Bot 帳號就是拿這個值當 Users 表主鍵。
  assert.equal(authParamFor(LINE_PLAINTEXT_ID), `userId=${LINE_PLAINTEXT_ID}`);
  assert.equal(LINE_PLAINTEXT_ID.length, 33);
});

test('F2-3 🔴 以 U 開頭的密文必須走 lineID=（修之前這條是紅的）', () => {
  // 這就是那 1/64。舊判準 startsWith('U') 會把它送成 userId=<密文>。
  assert.equal(isPlainUserId(CIPHERTEXT_STARTING_WITH_U), false);
  assert.ok(authParamFor(CIPHERTEXT_STARTING_WITH_U).startsWith('lineID='));
});

test('F2-4 不以 U 開頭的密文一樣走 lineID=（另外的 63/64，本來就是對的）', () => {
  // 控制：少了這條，把函式改成「永遠回 lineID=」也會讓 F2-3 變綠。
  assert.ok(authParamFor(CIPHERTEXT_STARTING_WITH_OTHER).startsWith('lineID='));
});

test('F2-5 密文長度必為 4 的倍數 —— 這是「長度 33」能當分界的理由', () => {
  // 判準的安全性靠的是這個結構性事實，不是經驗值：
  // Go 的 base64.URLEncoding 帶 padding ⇒ 長度必為 4 的倍數，而 33 不是。
  for (const c of [CIPHERTEXT_STARTING_WITH_U, CIPHERTEXT_STARTING_WITH_OTHER]) {
    assert.equal(c.length % 4, 0, '測試用的密文樣本本身就不是合法 base64 長度');
    assert.notEqual(c.length, 33);
  }
});

test('F2-6 U 開頭但長度不對的一律當密文（不猜、不放寬）', () => {
  assert.equal(isPlainUserId('U'), false);
  assert.equal(isPlainUserId('U0123456789abcdef'), false); // 太短
  assert.equal(isPlainUserId(LINE_PLAINTEXT_ID + 'x'), false); // 太長
});

test('F2-7 值有經過 encodeURIComponent', () => {
  // 密文的 `=` padding 若不編碼會在 query string 裡被切錯。
  assert.ok(authParamFor(CIPHERTEXT_STARTING_WITH_U).endsWith('%3D%3D'));
  assert.equal(authParamFor(''), 'lineID=');
});
