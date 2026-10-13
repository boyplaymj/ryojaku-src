// 跑法：node --test utils/deepLink.test.ts（需 Node >= 22.18）或 npm test。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deepLinkToHashRoute, hostOfOrigin } from './deepLink.ts';

const HOSTS = ['ryojaku-stg.boyplaymj.com'];
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('hostOfOrigin：只收 https 的網域', () => {
    assert.equal(hostOfOrigin('https://ryojaku-stg.boyplaymj.com'), 'ryojaku-stg.boyplaymj.com');
    assert.equal(hostOfOrigin(' https://ryojaku-stg.boyplaymj.com/ '), 'ryojaku-stg.boyplaymj.com');
    for (const bad of ['http://x.com', 'x.com', '', null, undefined, 3]) assert.equal(hostOfOrigin(bad), null, JSON.stringify(bad));
});

test('分享出去的三種連結都進得去對應的頁面', () => {
    assert.equal(deepLinkToHashRoute('https://ryojaku-stg.boyplaymj.com/#/event/GAME_1', HOSTS), '#/event/GAME_1');
    assert.equal(deepLinkToHashRoute('https://ryojaku-stg.boyplaymj.com/#/post/POST%23abc', HOSTS), '#/post/POST%23abc');
    assert.equal(deepLinkToHashRoute('https://ryojaku-stg.boyplaymj.com/#/ledger?userId=APP_x', HOSTS), '#/ledger?userId=APP_x');
    assert.equal(deepLinkToHashRoute('https://ryojaku-stg.boyplaymj.com/index.html#/event/GAME_1', HOSTS), '#/event/GAME_1');
});

test('只有網域、沒有 # 後面那段 ⇒ 回首頁', () => {
    for (const u of ['https://ryojaku-stg.boyplaymj.com', 'https://ryojaku-stg.boyplaymj.com/', 'https://ryojaku-stg.boyplaymj.com/#', 'https://ryojaku-stg.boyplaymj.com/#/']) {
        assert.equal(deepLinkToHashRoute(u, HOSTS), '#/', u);
    }
});

test('別人的網域、非 https、帶帳密的一律不收', () => {
    for (const u of [
        'https://evil.example/#/event/1',
        'https://ryojaku-stg.boyplaymj.com.evil.example/#/event/1',
        'https://evil.example@ryojaku-stg.boyplaymj.com/#/event/1',
        'http://ryojaku-stg.boyplaymj.com/#/event/1',
        'com.boyplaymj.ryojaku://event/1',
        'javascript:alert(1)',
        'not a url', '', null, undefined, 7,
    ]) {
        assert.equal(deepLinkToHashRoute(u, HOSTS), null, JSON.stringify(u));
    }
});

test('沒有設定公開網域（或設成空值）⇒ 什麼都不收', () => {
    for (const hosts of [[], [null], ['']]) {
        assert.equal(deepLinkToHashRoute('https://ryojaku-stg.boyplaymj.com/#/event/1', hosts), null, JSON.stringify(hosts));
    }
});

test('不是站台根目錄的路徑（公開網頁、OAuth 回呼）不當成 App 的頁面', () => {
    for (const u of ['https://ryojaku-stg.boyplaymj.com/privacy.html', 'https://ryojaku-stg.boyplaymj.com/delete-account.html#/event/1',
        'https://ryojaku-stg.boyplaymj.com/auth/line/callback?code=x']) {
        assert.equal(deepLinkToHashRoute(u, HOSTS), null, u);
    }
});

test('不是「會被分享出去」的頁面不能從外部連結直接進去', () => {
    for (const r of ['#/profile', '#/create', '#/reset?token=abc', '#/verify?token=abc', '#/chat/room1', '#/event/', '#/eventx/1',
        '#/ledgerx', '#/event/../profile', '#/event//1', '#event/1', '#/post/a\\b']) {
        assert.equal(deepLinkToHashRoute('https://ryojaku-stg.boyplaymj.com/' + r, HOSTS), null, r);
    }
});

// 判準有尺不等於接線有尺。
test('接線：App.tsx 在原生殼裡同時處理「已開著被連結叫到前景」與「被連結冷啟動」', () => {
    const wiring = read('../services/deepLinkListener.ts');
    assert.match(wiring, /addListener\('appUrlOpen'/);
    assert.match(wiring, /getLaunchUrl\(\)/);
    assert.match(wiring, /deepLinkToHashRoute\(/);
    assert.match(wiring, /VITE_PUBLIC_WEB_ORIGIN/);
    assert.match(wiring, /Capacitor\.isNativePlatform\(\)/);
    assert.match(read('../App.tsx'), /startDeepLinkListener\(\)/);
});

test('可以直接進去的三種頁面，與分享卡實際產生的連結是同一組', () => {
    const made = [read('../components/share/ShareActionSheet.tsx'), read('../components/share/ShareCard.tsx'), read('../components/ledger/LedgerShareCard.tsx')].join('\n');
    const routes = [...made.matchAll(/currentShareOrigin\(\)\}\/#(\/[a-z]+)/g)].map(m => m[1]);
    assert.deepEqual([...new Set(routes)].sort(), ['/event', '/ledger', '/post']);
    for (const r of new Set(routes)) {
        const sample = r === '/ledger' ? '#/ledger?userId=u' : `#${r}/x1`;
        assert.equal(deepLinkToHashRoute('https://ryojaku-stg.boyplaymj.com/' + sample, HOSTS), sample, r);
    }
});
