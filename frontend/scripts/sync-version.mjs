#!/usr/bin/env node
// 版本單一來源（P0-c）。
//
// 唯一的來源是 frontend/package.json 的 "version"。其餘四個載體全部由它推導：
//   constants.ts   APP_VERSION              ← 給 App 自己回報／X-App-Version／版本閘門用
//   build.gradle   versionName / versionCode ← Google Play 認的那兩個
//   project.pbxproj MARKETING_VERSION / CURRENT_PROJECT_VERSION ← App Store 認的那兩個
//                   （Info.plist 本身寫的是 $(MARKETING_VERSION)，所以不必也不可以改它）
//
// 為什麼要有這支：這四處原本各寫各的，實測 package.json=0.0.0、constants.ts=2.0.4、
// Android=1.0、iOS=1.0 —— 四個載體三個值。而且「不一致」在任何既有檢查裡都零徵兆：
// 網頁看到的是 constants.ts，商店看到的是 gradle/pbxproj，兩邊永遠不會互相對照。
//
// 兩種模式共用同一個 plan()：
//   node scripts/sync-version.mjs           把推導結果寫回四個載體
//   node scripts/sync-version.mjs --check   只比對、**一個位元組都不寫**，不一致回 rc=1
//
// ⚠️ --check 的「不寫」是結構保證，不是註解保證：plan() 純計算、回傳字串，
//    只有 main() 的非 check 分支才呼叫 writeFileSync。測試會直接驗這件事
//    （改壞載體 → 跑 --check → 檔案 mtime 與內容都必須沒變）。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** frontend/ 的絕對路徑。刻意不吃 process.cwd() —— prebuild、測試、CI 的 cwd 不保證相同。 */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * 來源版本必須是**剛好三段**的純數字 semver。
 *
 * 比 versionGate.ts 的 VERSION_PATTERN（接受 1 / 1.2 / 1.2.3）更嚴，這是刻意的：
 * 那支要盡量寬容地「不擋人」，這支要能推導出唯一的整數 build number，少一段就沒有唯一解。
 */
export function parseSemver(value) {
    if (typeof value !== 'string') {
        throw new TypeError(`版本必須是字串，收到 ${typeof value}`);
    }
    const m = SEMVER_PATTERN.exec(value.trim());
    if (!m) {
        throw new Error(`版本 "${value}" 不是 X.Y.Z 形式的純數字 semver`);
    }
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * 整數 build number（Android versionCode／iOS CURRENT_PROJECT_VERSION）。
 *
 * 2.0.4 → 20004。
 *
 * 🔴 minor／patch 一旦 ≥100 這個式子就同時失去單調性與唯一性
 * （2.0.100 與 2.1.0 都會算成 20100 —— 商店會拒收「沒有變大」的 build number，
 * 而兩個不同版本撞號的話連拒收都不會，只會靜靜蓋掉）。所以這裡直接擲錯，
 * 不是印警告：一個算錯的 build number 送進商店就收不回來了。
 */
export function deriveBuildNumber({ major, minor, patch }) {
    if (minor > 99 || patch > 99) {
        throw new RangeError(
            `minor/patch 必須 <100（收到 ${major}.${minor}.${patch}）。` +
            `超過的話 versionCode 會撞號且不再單調遞增，必須先改推導式再發版。`
        );
    }
    return major * 10000 + minor * 100 + patch;
}

/**
 * 每個載體一條規則。
 *
 * `expect` 是**匹配次數**的斷言，不是排版偏好：
 *   'one'      少一個或多一個都代表檔案結構變了（例如有人多加一個 defaultConfig），
 *              這時候「只同步到其中一處」比整個沒同步更危險 —— 所以擲錯不放行。
 *   'at-least-one'  pbxproj 天生有 Debug／Release 兩份 buildSettings，
 *              日後 Xcode 再多長出一份也應該一起改 ⇒ 全部取代，但至少要有一份。
 *
 * ⚠️ 不寫死「pbxproj 剛好兩處」是有理由的：那會變成一份手挑清單，
 *    Xcode 自己加一個 configuration 就得有人記得回來改這裡。
 */
export const RULES = [
    {
        file: 'constants.ts',
        label: 'APP_VERSION',
        expect: 'one',
        pattern: /^(export const APP_VERSION = ')([^']*)(';)$/gm,
        value: (ctx) => ctx.version,
    },
    {
        file: 'android/app/build.gradle',
        label: 'versionName',
        expect: 'one',
        pattern: /^(\s*versionName ")([^"]*)(")$/gm,
        value: (ctx) => ctx.version,
    },
    {
        file: 'android/app/build.gradle',
        label: 'versionCode',
        expect: 'one',
        pattern: /^(\s*versionCode )(\d+)()$/gm,
        value: (ctx) => String(ctx.buildNumber),
    },
    {
        file: 'ios/App/App.xcodeproj/project.pbxproj',
        label: 'MARKETING_VERSION',
        expect: 'at-least-one',
        // pbxproj 的裸字串允許數字與點，Xcode 自己就寫 `MARKETING_VERSION = 1.0;`
        // ⇒ 2.0.4 不需要也不應該加引號（加了會與 Xcode 重寫後的格式打架）。
        pattern: /^(\s*MARKETING_VERSION = )([^;]*)(;)$/gm,
        value: (ctx) => ctx.version,
    },
    {
        file: 'ios/App/App.xcodeproj/project.pbxproj',
        label: 'CURRENT_PROJECT_VERSION',
        expect: 'at-least-one',
        pattern: /^(\s*CURRENT_PROJECT_VERSION = )([^;]*)(;)$/gm,
        value: (ctx) => String(ctx.buildNumber),
    },
];

/** 讀 package.json 的 version —— 這是整套的唯一來源。 */
export function readSourceVersion(root = ROOT) {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return pkg.version;
}

/**
 * 純計算：讀四個載體、算出它們**應該**長什麼樣，回傳結果。
 *
 * 不寫任何檔案。--check 與實際同步都走這一支 ⇒ 推導只有一份，
 * 不可能出現「檢查用一套算法、寫入用另一套」這種兩邊各自都對卻不一致的情況。
 */
export function plan(root = ROOT) {
    const version = readSourceVersion(root);
    const semver = parseSemver(version);
    const buildNumber = deriveBuildNumber(semver);
    const ctx = { version, semver, buildNumber };

    const contents = new Map();
    const changes = [];

    for (const rule of RULES) {
        if (!contents.has(rule.file)) {
            contents.set(rule.file, readFileSync(join(root, rule.file), 'utf8'));
        }
        const before = contents.get(rule.file);
        const want = rule.value(ctx);

        let hits = 0;
        const found = [];
        const after = before.replace(rule.pattern, (_m, pre, cur, post) => {
            hits++;
            found.push(cur);
            return `${pre}${want}${post}`;
        });

        if (rule.expect === 'one' && hits !== 1) {
            throw new Error(
                `${rule.file} 的 ${rule.label} 匹配到 ${hits} 處，預期剛好 1 處。` +
                `檔案結構變了 —— 只同步一部分比完全不同步更危險，所以停下來。`
            );
        }
        if (rule.expect === 'at-least-one' && hits < 1) {
            throw new Error(`${rule.file} 完全找不到 ${rule.label}，無法同步。`);
        }

        contents.set(rule.file, after);
        changes.push({
            file: rule.file,
            label: rule.label,
            hits,
            want,
            found,
            // 「所有找到的值都已經等於目標值」才算同步。用 every 而不是比第一個 ——
            // pbxproj 兩份 buildSettings 只有一份對的話，那是最容易漏掉的狀態。
            inSync: found.every((v) => v === want),
        });
    }

    return { version, semver, buildNumber, changes, contents };
}

function main(argv) {
    const check = argv.includes('--check');
    const asJson = argv.includes('--json');
    const unknown = argv.filter((a) => a !== '--check' && a !== '--json');
    if (unknown.length > 0) {
        // 沒被解析到的旗標一律擲錯，不要靜靜忽略。
        // （靜靜忽略的話，`--dry-run` 這種打錯的參數會直接變成「真的寫下去」。）
        console.error(`❌ 不認得的參數：${unknown.join(' ')}`);
        console.error(`用法：node scripts/sync-version.mjs [--check] [--json]`);
        return 2;
    }

    let result;
    try {
        result = plan();
    } catch (err) {
        console.error(`❌ ${err.message}`);
        return 1;
    }

    const { version, buildNumber, changes, contents } = result;

    // --json 只吐推導結果，給 CI 拿去跟「真的燒進 APK 的那個值」比對。
    // 存在的理由是不要有第二個推導來源：CI 如果自己在 YAML 裡寫一次
    // `major*10000+minor*100+patch`，那條式子改了之後沒有人會記得回來改這裡，
    // 而且兩邊各自都「對」，只是對的不是同一件事。
    if (asJson) {
        console.log(JSON.stringify({ version, buildNumber }));
        return 0;
    }
    console.log(`來源 package.json version = ${version} → build number = ${buildNumber}`);

    // 不管同步與否都把每條規則的實測值印出來（含匹配處數）。
    // 只印「不一致的那些」的話，一條規則悄悄變成 0 處匹配會長得跟「全部一致」一樣。
    for (const c of changes) {
        const mark = c.inSync ? '✔' : '✗';
        console.log(
            `  ${mark} ${c.file} :: ${c.label}  ${c.hits} 處  ` +
            `現值 [${c.found.join(', ')}] → 應為 [${c.want}]`
        );
    }

    const drifted = changes.filter((c) => !c.inSync);

    if (check) {
        if (drifted.length === 0) {
            console.log('✔ 版本四處一致');
            return 0;
        }
        console.error(
            `\n❌ ${drifted.length} 處與 package.json 不一致：` +
            drifted.map((c) => `${c.file}::${c.label}`).join('、')
        );
        console.error('   執行 `npm run sync-version` 修正後再提交。');
        return 1;
    }

    if (drifted.length === 0) {
        console.log('✔ 已經一致，沒有檔案需要改寫');
        return 0;
    }
    // 只改真的需要改的檔，避免在共用工作樹上把無關檔案標成 modified。
    const touched = new Set(drifted.map((c) => c.file));
    for (const file of touched) {
        writeFileSync(join(ROOT, file), contents.get(file));
        console.log(`  ✍ 已更新 ${file}`);
    }
    console.log(`✔ 同步完成（${touched.size} 個檔案）`);
    return 0;
}

// 只有被直接執行時才動手；被 import（測試）時純粹提供函式。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exit(main(process.argv.slice(2)));
}
