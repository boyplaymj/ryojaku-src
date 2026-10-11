// 跑法：node --test utils/installGate.test.ts（需 Node >= 22.18）或 npm test。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { shouldRenderApp } from './installGate.ts';

test('原生殼：不是 standalone、沒按 bypass，也必須畫 App 本體', () => {
    assert.equal(shouldRenderApp({ isNative: true, isStandalone: false, devBypass: false }), true);
});

test('網頁、未安裝、沒按 bypass ⇒ 畫安裝引導（原本的行為不可以被放寬掉）', () => {
    assert.equal(shouldRenderApp({ isNative: false, isStandalone: false, devBypass: false }), false);
});

test('已安裝成 PWA ⇒ 畫 App 本體', () => {
    assert.equal(shouldRenderApp({ isNative: false, isStandalone: true, devBypass: false }), true);
});

test('DEV BYPASS ⇒ 畫 App 本體', () => {
    assert.equal(shouldRenderApp({ isNative: false, isStandalone: false, devBypass: true }), true);
});

// 判準有尺不等於接線有尺：PWAInstallPrompt 若沒有真的呼叫它、或沒把原生殼這個訊號傳進去，
// 上面四條照樣全綠。這條讀元件原文，釘住那兩件事。
test('接線：PWAInstallPrompt 用 shouldRenderApp，且 isNative 來自 Capacitor.isNativePlatform()', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'components', 'PWAInstallPrompt.tsx'), 'utf8');
    assert.match(src, /shouldRenderApp\(\{[^}]*isNative:\s*Capacitor\.isNativePlatform\(\)[^}]*\}\)/);
    assert.doesNotMatch(src, /if \(isStandalone \|\| devBypass\)/, '舊判準還留著 ⇒ 原生殼仍會被擋');
});
