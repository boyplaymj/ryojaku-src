#!/usr/bin/env node
// 產生 Android App Links 要的 /.well-known/assetlinks.json。
//
// 它是什麼：Android 看到 App 的 Manifest 宣告「我要接 https://<網域>/ 的連結」時，
// 會去那個網域抓這個檔，確認網域的主人真的認這個 App（套件名＋簽章憑證指紋都要對）。
// 對不上的話連結照樣開瀏覽器，不會交給 App。
//
// 來源：frontend/app-links.json（套件名、每個環境的網域與允許的簽章指紋）。
//
// 🔴 為什麼按環境分、不放一份靜態檔進 public/：
//    stg 列的是**提交在 repo 裡的測試簽章**（android/app/debug-stg.keystore，密碼是公開的預設值）。
//    那把簽章任何人都拿得到；它只可以讓 stg 網域的連結通過驗證，絕不可以出現在正式網域的檔裡 ——
//    否則任何人用它簽一個同套件名的 App，就能接走正式網域的連結。
//    正式環境的指紋是 Google Play 的 App 簽署金鑰，要等有 Play 帳號才拿得到。
//
// 用法：node scripts/gen-assetlinks.mjs --env stg --out dist/.well-known/assetlinks.json
// exit code：0 已產生／2 設定有問題（不可讀成「這個環境不需要」）

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export class ConfigError extends Error {}

/** 純計算：config＋環境名 → assetlinks.json 的內容（字串）。 */
export function renderAssetLinks(config, env) {
    if (!config || typeof config.packageName !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(config.packageName)) {
        throw new ConfigError('app-links.json 的 packageName 不是合法的套件名');
    }
    const e = config.environments && Object.hasOwn(config.environments, env) ? config.environments[env] : null;
    if (!e) throw new ConfigError(`app-links.json 沒有環境 "${env}"`);
    const fps = e.sha256CertFingerprints;
    // 空清單會產出一份「誰都不認」的檔 —— 看起來部署成功，而連結永遠不會交給 App。
    if (!Array.isArray(fps) || fps.length === 0) throw new ConfigError(`環境 "${env}" 沒有任何簽章指紋`);
    for (const fp of fps) {
        if (typeof fp !== 'string' || !FINGERPRINT.test(fp)) throw new ConfigError(`環境 "${env}" 的指紋格式不對：${String(fp)}`);
    }
    if (new Set(fps).size !== fps.length) throw new ConfigError(`環境 "${env}" 的指紋有重複`);
    return JSON.stringify([{
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: config.packageName, sha256_cert_fingerprints: fps },
    }], null, 2) + '\n';
}

export function main(argv) {
    const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const env = arg('--env'), out = arg('--out');
    if (!env || !out) {
        console.error('用法：gen-assetlinks.mjs --env <stg|…> --out <路徑>');
        return 2;
    }
    try {
        const config = JSON.parse(readFileSync(join(ROOT, 'app-links.json'), 'utf8'));
        const body = renderAssetLinks(config, env);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, body);
        console.log(`✓ assetlinks.json（${env}，${config.environments[env].sha256CertFingerprints.length} 個指紋）→ ${out}`);
        return 0;
    } catch (err) {
        console.error(`✗ [rc=2] ${err instanceof Error ? err.message : String(err)}`);
        return 2;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main(process.argv.slice(2)));
}
