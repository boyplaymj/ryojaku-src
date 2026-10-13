// 跑法：node --test utils/appLinks.test.ts（需 Node >= 22.18）或 npm test。
//
// App Links 要四個地方講同一件事才會通：Manifest（要接哪個網域）、gradle（那個網域的值、用哪把簽章）、
// app-links.json（網站認哪個套件名與哪些簽章指紋）、建置前端時的公開網域。
// 任何一處對不上，結果都一樣：APK 建得出來、網站也正常，而連結照樣開瀏覽器，沒有任何錯誤訊息。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { renderAssetLinks, ConfigError } from '../scripts/gen-assetlinks.mjs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const config = JSON.parse(read('../app-links.json'));
const FP = 'AA:'.repeat(31) + 'AA';

test('renderAssetLinks：產出 Android 要的形狀', () => {
    const out = JSON.parse(renderAssetLinks({ packageName: 'com.example.app', environments: { stg: { sha256CertFingerprints: [FP] } } }, 'stg'));
    assert.deepEqual(out, [{
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.example.app', sha256_cert_fingerprints: [FP] },
    }]);
});

test('renderAssetLinks：設定有問題一律拋錯，不產出一份「誰都不認」的檔', () => {
    const base = { packageName: 'com.example.app', environments: { stg: { sha256CertFingerprints: [FP] } } };
    const bad: [unknown, string][] = [
        [base, 'prod'],                                                                    // 沒有這個環境
        [base, 'constructor'],                                                             // 原型鏈上的名字不算環境
        [{ ...base, environments: { stg: { sha256CertFingerprints: [] } } }, 'stg'],       // 空清單
        [{ ...base, environments: { stg: {} } }, 'stg'],
        [{ ...base, environments: { stg: { sha256CertFingerprints: ['aa:bb'] } } }, 'stg'],            // 格式不對
        [{ ...base, environments: { stg: { sha256CertFingerprints: [FP.toLowerCase()] } } }, 'stg'],   // 小寫
        [{ ...base, environments: { stg: { sha256CertFingerprints: [FP, FP] } } }, 'stg'],             // 重複
        [{ ...base, packageName: 'not a package' }, 'stg'],
        [null, 'stg'],
    ];
    for (const [cfg, env] of bad) assert.throws(() => renderAssetLinks(cfg, env), ConfigError, JSON.stringify([cfg, env]).slice(0, 80));
});

test('套件名：app-links.json 與 capacitor.config.ts、build.gradle 是同一個', () => {
    assert.match(read('../capacitor.config.ts'), new RegExp(`appId: '${config.packageName.replaceAll('.', '\\.')}'`));
    assert.match(read('../android/app/build.gradle'), new RegExp(`applicationId "${config.packageName.replaceAll('.', '\\.')}"`));
});

test('網域：Manifest 用佔位、gradle 的預設值、app-links.json 的 stg、CI 建前端用的公開網域，四處一致', () => {
    const manifest = read('../android/app/src/main/AndroidManifest.xml');
    assert.match(manifest, /<intent-filter android:autoVerify="true">[\s\S]*?android:scheme="https" android:host="\$\{appLinkHost\}" android:path="\/"/);
    const gradle = read('../android/app/build.gradle');
    const m = gradle.match(/manifestPlaceholders = \[appLinkHost: \(project\.findProperty\('appLinkHost'\) \?: '([^']+)'\)\]/);
    assert.ok(m, 'build.gradle 沒有定義 appLinkHost（Manifest 的佔位沒人填 ⇒ 建置會失敗）');
    assert.equal(m[1], config.environments.stg.host);
    const wf = read('../../.github/workflows/android-debug.yml');
    assert.match(wf, new RegExp(`VITE_PUBLIC_WEB_ORIGIN: https://${config.environments.stg.host.replaceAll('.', '\\.')}\\s`));
});

test('簽章：debug 版用 repo 裡那把固定簽章，而它的指紋就是 app-links.json stg 列的那一個', t => {
    const gradle = read('../android/app/build.gradle');
    assert.match(gradle, /signingConfigs \{\s*debug \{\s*storeFile file\('debug-stg\.keystore'\)/);
    assert.match(gradle, /buildTypes \{\s*debug \{\s*signingConfig signingConfigs\.debug/);
    const ks = fileURLToPath(new URL('../android/app/debug-stg.keystore', import.meta.url));
    const r = spawnSync('keytool', ['-list', '-v', '-keystore', ks, '-storepass', 'android', '-alias', 'androiddebugkey'], { encoding: 'utf8' });
    if (r.error) {
        // 沒有 keytool 的機器量不到這一格 —— 講清楚是沒量到，不是通過。
        t.skip(`這台機器沒有 keytool（${r.error.message}）⇒ 指紋沒有被比對`);
        return;
    }
    assert.equal(r.status, 0, r.stderr);
    const fp = (r.stdout.match(/SHA256:\s*([0-9A-F:]+)/) || [])[1];
    assert.ok(fp, 'keytool 的輸出裡找不到 SHA256 指紋');
    assert.deepEqual(config.environments.stg.sha256CertFingerprints, [fp]);
});

// 那把測試簽章是公開的。它的指紋只准出現在 stg。
test('公開的測試簽章指紋不可以出現在 stg 以外的環境', () => {
    const stg = new Set(config.environments.stg.sha256CertFingerprints);
    for (const [env, e] of Object.entries(config.environments) as [string, { sha256CertFingerprints?: string[] }][]) {
        if (env === 'stg') continue;
        for (const fp of e.sha256CertFingerprints ?? []) assert.ok(!stg.has(fp), `${env} 列了 stg 的測試簽章指紋`);
    }
});

test('部署腳本會產生 assetlinks.json，而且是在上傳之前', () => {
    const sh = read('../deploy-stg.sh');
    const gen = sh.indexOf('gen-assetlinks.mjs');
    const sync = sh.indexOf('aws s3 sync dist/ ');
    assert.ok(gen > 0, 'deploy-stg.sh 沒有呼叫 gen-assetlinks.mjs');
    assert.ok(sync > gen, 'assetlinks.json 要在上傳之前產生');
});
