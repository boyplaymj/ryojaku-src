// 跑法：node --test utils/shareUrl.test.ts（需 Node >= 22.18）或 npm test。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { normalizePublicOrigin, resolveShareOrigin } from './shareUrl.ts';

const PUBLIC = 'https://ryojaku-stg.boyplaymj.com';

test('normalizePublicOrigin：收 https 網域，尾斜線與前後空白會被收掉', () => {
    assert.equal(normalizePublicOrigin(PUBLIC), PUBLIC);
    assert.equal(normalizePublicOrigin(`  ${PUBLIC}/  `), PUBLIC);
    assert.equal(normalizePublicOrigin('https://example.com:8443'), 'https://example.com:8443');
});

test('normalizePublicOrigin：拒絕非 https、localhost、帶路徑／query／fragment／帳密、空的與不成形的', () => {
    for (const bad of [
        'http://example.com', 'capacitor://localhost', 'https://localhost', 'https://127.0.0.1',
        'https://example.com/app', 'https://example.com/?a=1', 'https://example.com/#/event/1',
        'https://user:pw@example.com', 'example.com', '', '   ', null, undefined, 42, {},
    ]) {
        assert.equal(normalizePublicOrigin(bad), null, JSON.stringify(bad));
    }
});

test('網頁：用頁面自己的 origin，就算有設公開網域也一樣（原本的行為）', () => {
    assert.equal(
        resolveShareOrigin({ isNative: false, locationOrigin: 'https://ryojaku-preview.boyplaymj.com', publicOrigin: PUBLIC }),
        'https://ryojaku-preview.boyplaymj.com',
    );
});

test('原生殼：用公開網域，不用殼自己的 localhost', () => {
    assert.equal(resolveShareOrigin({ isNative: true, locationOrigin: 'https://localhost', publicOrigin: PUBLIC }), PUBLIC);
    assert.equal(resolveShareOrigin({ isNative: true, locationOrigin: 'capacitor://localhost', publicOrigin: PUBLIC }), PUBLIC);
});

test('原生殼＋沒有合格的公開網域 ⇒ 退回 locationOrigin，不拋例外（擋它的是建置端的檢查）', () => {
    for (const publicOrigin of [undefined, '', 'https://localhost', 'http://example.com']) {
        assert.equal(resolveShareOrigin({ isNative: true, locationOrigin: 'https://localhost', publicOrigin }), 'https://localhost');
    }
});

// 接線：元件裡不可以再直接拿 window.location.origin 組「要給別人點」的連結。
// 掃 components／pages 全部的 .tsx，而不是只看今天已知的那三個檔 —— 下一張分享卡也要被照到。
test('接線：components／pages 裡沒有用 window.location.origin 直接組 /#/ 連結', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    // 例外要寫理由。LineCallback 是把**自己這個分頁**導回首頁，不是給別人的連結。
    const ALLOW = new Set(['pages/LineCallback.tsx']);
    const hits: string[] = [];
    let scanned = 0;
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const abs = join(dir, name);
            if (statSync(abs).isDirectory()) { walk(abs); continue; }
            if (!name.endsWith('.tsx')) continue;
            scanned += 1;
            const rel = relative(root, abs).split('\\').join('/');
            if (ALLOW.has(rel)) continue;
            if (/window\.location\.origin\}\/#\//.test(readFileSync(abs, 'utf8'))) hits.push(rel);
        }
    };
    walk(join(root, 'components'));
    walk(join(root, 'pages'));
    assert.ok(scanned > 40, `只掃到 ${scanned} 個 .tsx ⇒ 掃描範圍不對，下面的「0 處」不算數`);
    assert.deepEqual(hits, []);
});

test('接線：三張分享卡都經過 currentShareOrigin()，而它讀的是 VITE_PUBLIC_WEB_ORIGIN', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const rel of ['components/share/ShareActionSheet.tsx', 'components/share/ShareCard.tsx', 'components/ledger/LedgerShareCard.tsx']) {
        assert.match(readFileSync(join(root, rel), 'utf8'), /\$\{currentShareOrigin\(\)\}\/#\//, rel);
    }
    const wiring = readFileSync(join(root, 'services', 'shareOrigin.ts'), 'utf8');
    assert.match(wiring, /isNative:\s*Capacitor\.isNativePlatform\(\)/);
    assert.match(wiring, /publicOrigin:.*VITE_PUBLIC_WEB_ORIGIN/);
});
