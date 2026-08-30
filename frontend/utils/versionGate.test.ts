// 跑法：node --test utils/versionGate.test.ts（需 Node >= 22.18，靠內建 type stripping，零額外依賴）
// 或 npm test（見 package.json）。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    evaluateVersionGate,
    isOutdated,
    normalizeUpdateUrl,
    resolveUpdateAction,
} from './versionGate.ts';

test('isOutdated：基本大小比較', () => {
    assert.equal(isOutdated('2.0.3', '2.0.4'), true);
    assert.equal(isOutdated('2.0.4', '2.0.4'), false);
    assert.equal(isOutdated('2.0.5', '2.0.4'), false);
    assert.equal(isOutdated('1.9.9', '2.0.0'), true);
    assert.equal(isOutdated('10.0.0', '9.9.9'), false, '要按數值比不是按字典序');
});

test('isOutdated：段數不同時缺的段當 0', () => {
    assert.equal(isOutdated('2', '2.0.0'), false);
    assert.equal(isOutdated('2.0', '2.0.1'), true);
    assert.equal(isOutdated('2.0.1', '2.0'), false);
});

test('isOutdated：解析不出來一律不擋（刻意的 fail-open 方向）', () => {
    // 擋錯 = 使用者完全無法使用；放行錯 = 舊版多跑一陣子。兩者代價不對稱。
    assert.equal(isOutdated('2.0.4-beta', '3.0.0'), false);
    assert.equal(isOutdated('2.0.4', 'latest'), false);
    assert.equal(isOutdated('', '1.0.0'), false);
    assert.equal(isOutdated('2..4', '3.0.0'), false, '空段落不可以被當成 0 混過去');
    assert.equal(isOutdated(undefined, '1.0.0'), false);
    assert.equal(isOutdated('1.0.0', null), false);
});

test('normalizeUpdateUrl：接受商店會用到的 scheme', () => {
    assert.equal(normalizeUpdateUrl('https://apps.apple.com/app/id123'), 'https://apps.apple.com/app/id123');
    assert.equal(normalizeUpdateUrl('  https://jiomj.com  '), 'https://jiomj.com/', '前後空白要吃掉');
    assert.equal(normalizeUpdateUrl('market://details?id=com.boyplaymj.ryojaku'), 'market://details?id=com.boyplaymj.ryojaku');
    assert.equal(normalizeUpdateUrl('itms-apps://itunes.apple.com/app/id123'), 'itms-apps://itunes.apple.com/app/id123');
});

test('normalizeUpdateUrl：拒絕會變成 XSS 出口或降級的 scheme', () => {
    assert.equal(normalizeUpdateUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUpdateUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(normalizeUpdateUrl('http://apps.apple.com/app/id123'), null, '商店連結沒有理由用 http');
});

test('normalizeUpdateUrl：拒絕空的與不成形的', () => {
    assert.equal(normalizeUpdateUrl(''), null);
    assert.equal(normalizeUpdateUrl('   '), null);
    assert.equal(normalizeUpdateUrl('apps.apple.com/app/id123'), null, '沒有 scheme 不算 URL');
    assert.equal(normalizeUpdateUrl(undefined), null);
    assert.equal(normalizeUpdateUrl(null), null);
    assert.equal(normalizeUpdateUrl(123), null);
});

test('resolveUpdateAction：網頁一律 reload（reload 在網頁上真的會換到新 bundle）', () => {
    assert.deepEqual(resolveUpdateAction({ isNative: false, updateUrl: '' }), { kind: 'reload' });
    assert.deepEqual(resolveUpdateAction({ isNative: false, updateUrl: 'https://x.test/' }), { kind: 'reload' });
});

test('resolveUpdateAction：原生 App 有合法連結才給出路', () => {
    assert.deepEqual(
        resolveUpdateAction({ isNative: true, updateUrl: 'https://apps.apple.com/app/id123' }),
        { kind: 'store', url: 'https://apps.apple.com/app/id123' },
    );
    assert.deepEqual(resolveUpdateAction({ isNative: true, updateUrl: '' }), { kind: 'none' });
    assert.deepEqual(resolveUpdateAction({ isNative: true, updateUrl: 'javascript:alert(1)' }), { kind: 'none' });
});

test('原生 App 絕不會 reload —— 這正是原本會把使用者變磚的那條路', () => {
    for (const updateUrl of ['https://store.test/app', 'market://details?id=x', '', null, 'javascript:alert(1)']) {
        const gate = evaluateVersionGate({ currentVersion: '1.0.0', minVersion: '9.9.9', isNative: true, updateUrl });
        assert.notEqual(gate.action.kind, 'reload', `updateUrl=${String(updateUrl)} 時不該回 reload`);
    }
});

test('不變式：擋下來的時候一定有出路', () => {
    const versions = ['1.0.0', '2.0.4', '9.9.9', 'bad', ''];
    const urls: unknown[] = ['https://store.test/app', 'market://details?id=x', '', '   ', null, undefined, 'javascript:alert(1)', 'http://store.test/app', 42];

    for (const isNative of [true, false]) {
        for (const currentVersion of versions) {
            for (const minVersion of versions) {
                for (const updateUrl of urls) {
                    const gate = evaluateVersionGate({ currentVersion, minVersion, isNative, updateUrl });
                    if (gate.blocked) {
                        assert.notEqual(
                            gate.action.kind,
                            'none',
                            `blocked 卻沒有出路：native=${isNative} ${currentVersion}→${minVersion} url=${String(updateUrl)}`,
                        );
                    }
                }
            }
        }
    }
});

test('回歸：原生 + 舊版 + 沒設定 updateUrl ⇒ 不擋，並回報原因', () => {
    const gate = evaluateVersionGate({ currentVersion: '2.0.4', minVersion: '3.0.0', isNative: true, updateUrl: '' });
    assert.equal(gate.blocked, false);
    assert.equal(gate.suppressedReason, 'no-exit');
    assert.equal(gate.action.kind, 'none');
});

test('原生 + 舊版 + 有商店連結 ⇒ 擋，且按鈕開商店', () => {
    const gate = evaluateVersionGate({
        currentVersion: '2.0.4',
        minVersion: '3.0.0',
        isNative: true,
        updateUrl: 'https://apps.apple.com/app/id123',
    });
    assert.equal(gate.blocked, true);
    assert.equal(gate.suppressedReason, null);
    assert.deepEqual(gate.action, { kind: 'store', url: 'https://apps.apple.com/app/id123' });
});

test('版本沒過舊時不擋，且 suppressedReason 為 null（不可跟 no-exit 混為一談）', () => {
    const gate = evaluateVersionGate({ currentVersion: '2.0.4', minVersion: '2.0.4', isNative: true, updateUrl: '' });
    assert.equal(gate.blocked, false);
    assert.equal(gate.suppressedReason, null, '沒過舊跟「過舊但沒出路」要分得出來');
});
