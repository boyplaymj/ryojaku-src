// e2e/createGroupWizard.e2e.cjs — 發團表單兩步驟精靈的瀏覽器實跑驗收（[A3-c]）
//
// 跑法：`npm run e2e`（＝ `bash e2e/run.sh`，它負責起 dev server 與收尾）。
// 這支不自己起 server —— 單獨跑要先有一個 dev server 在 E2E_PORT 上。
//
// 🔴 這支存在的理由：A3-c 改的**全部是 UI 行為**，而 `tsc` 只證明型別接得上、
//    `vite build` 連型別都不驗、`run-tests.mjs` 咬的是純函式。三道閘對
//    「按下去會發生什麼」零鑑別力。
//
// 🔴 rc 的意思（三種，不可互相讀錯）：
//    0 = 全部通過   1 = 有測試沒過   2 = 腳本自己爆了   3 = 量不到（測試中途頁面被重載）
//    ⚠️ 3 不是「失敗」也不是「通過」。dev server 做完 dep optimization 會送一次
//       full reload，元件跟著重新掛載成一張空表單 —— 那會讓 T4 出現「按鈕永遠 disabled」
//       這種看起來很像產品缺陷的假紅（2026-09-06 真的發生過一次）。所以偵測到就拒絕給結論。

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.E2E_PORT || '5199';
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/e2e/_generated.harness.html`;
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(os.tmpdir(), 'a3c-shots');

// 只放行本機與 index.html 本來就會抓的兩個 CDN；其餘一律 abort。
// 🔴 這是硬防線不是省流量：確保這份驗收**結構上碰不到任何正式後端**。
const ALLOW = /(^http:\/\/127\.0\.0\.1:)|(cdn\.tailwindcss\.com)|(unpkg\.com)|(^data:)|(^blob:)/;

const TOTAL_TESTS = 7;
const results = [];
/** 一條測試紅了就**停在那裡**。 */
class Failed extends Error {}
const ok = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`);
    // 🔴 為什麼失敗就中止：這七條是一條接一條推進同一個表單狀態的。
    //    T4 紅（例如 stakes 檢查被拿掉）代表畫面已經跑到第 2 步，
    //    接下來 T5 去 fill 那個**已經卸載**的籌碼欄位必然拋 locator timeout ——
    //    那個例外會讓整支變成 rc=2「腳本自己爆了」，把一次**真的抓到回歸**
    //    講成設備故障。實測過：突變 A 第一版就是這樣收場的。
    if (!pass) throw new Failed(name);
};

/** 1×1 以外的最小 PNG（16×16），用來驗「照片項目活過 Stage2 卸載」。 */
const PROBE_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAKklEQVR4nGP8//8/AzbAhFVUEg0wYqrDYQymFhYcxmDXgtVWnA4bkZoAvGkKD6zsSFcAAAAASUVORK5CYII=';

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const probe = path.join(SHOT_DIR, 'probe.png');
    fs.writeFileSync(probe, Buffer.from(PROBE_PNG_B64, 'base64'));

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
    const route = (p) => p.route('**/*', (r) => (ALLOW.test(r.request().url()) ? r.continue() : r.abort()));

    // ── 暖機：讓 vite 在這裡把 dep optimization 做完（它做完會送一次 full reload）。
    //    正式那頁才不會在測試中途被重載。暖機頁的結果**不列入任何斷言**。
    const warm = await ctx.newPage();
    await route(warm);
    await warm.goto(URL, { waitUntil: 'domcontentloaded' });
    await warm.waitForSelector('text=團局種類', { timeout: 60000 });
    await warm.waitForTimeout(2500);
    await warm.close();

    const page = await ctx.newPage();
    const errs = [];
    const blocked = [];
    let loads = 0;
    page.on('load', () => { loads += 1; });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    // 🔴 只註冊**一個** route handler：Playwright 的多個 handler 是後註冊者先跑，
    //    而沒有呼叫 continue/abort/fallback 的那個會讓請求**整個掛住**。
    //    記錄與放行/攔截必須寫在同一支裡。
    await page.route('**/*', (r) => {
        const u = r.request().url();
        if (ALLOW.test(u)) return r.continue();
        blocked.push(u);
        return r.abort();
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=團局種類', { timeout: 60000 });
    const loadsAfterGoto = loads;

    const stepText = () => page.locator('text=/步驟 \\d \\/ 2/').first().innerText();
    const next = () => page.getByRole('button', { name: '下一步' });
    const back = () => page.getByRole('button', { name: '上一步' });
    const submit = () => page.getByRole('button', { name: /確認發起團局/ });
    const stakes = () => page.getByPlaceholder('100/20');
    const placeName = () => page.getByPlaceholder('例如：台北信義 / 自家場');
    const stage1 = () => page.locator('text=團局種類');
    const stage2 = () => page.locator('text=環境設施設定');
    const toast = () => page.locator('text=請輸入籌碼');
    const shot = (n) => page.screenshot({ path: path.join(SHOT_DIR, n) });

    let aborted = null;
    try {
    // ── T1：未定位 ⇒「下一步」禁用，且畫面上只有第一段
    const t1dis = await next().isDisabled();
    const t1s1 = await stage1().count();
    const t1s2 = await stage2().count();
    ok('T1 未定位時「下一步」禁用，且只掛第一段',
        t1dis === true && t1s1 > 0 && t1s2 === 0,
        `disabled=${t1dis} 第一段=${t1s1} 第二段=${t1s2} ${await stepText()}`);
    await shot('01-step1-disabled.png');

    // ── T2：填入測試資料（DEBUG 鈕會寫 coordinates）⇒ 按鈕解禁
    //    T1/T2 是同一顆按鈕的**反向**斷言 —— 少了 T2，T1 對「按鈕永遠 disabled」零鑑別力。
    await page.getByRole('button', { name: /填入測試資料/ }).click();
    await page.waitForTimeout(300);
    const t2en = await next().isEnabled();
    ok('T2 定位之後「下一步」變成可按', t2en === true,
        `enabled=${t2en} 籌碼=${await stakes().inputValue()}`);

    // ── T3：籌碼空字串 ⇒ **瀏覽器原生 required** 擋下（不是程式閘）
    await stakes().fill('');
    const vEmpty = await stakes().evaluate((el) => ({ valid: el.validity.valid, missing: el.validity.valueMissing }));
    await next().click();
    await page.waitForTimeout(500);
    const t3step = await stepText();
    const t3toast = await toast().count();
    ok('T3 籌碼空字串 → 原生 required 擋下（沒有 toast）',
        vEmpty.missing === true && /步驟 1/.test(t3step) && t3toast === 0,
        `valueMissing=${vEmpty.missing} ${t3step} toast筆數=${t3toast}`);
    await shot('02-step1-native-required.png');

    // ── T4：籌碼純空白 ⇒ 原生**放行**，改由 validateCreateGameStage1 跳 toast
    //    🔴 T3/T4 必須成對看。原生 required 只擋真正的空值，'   ' 它會放行；
    //       只有這一對的**對比**才分得出「原生擋的」與「程式閘擋的」。
    //       T3 自己對「按鈕根本沒作用」零鑑別力（實測：把下一步改成 type="button"，T3 照樣綠）。
    await stakes().fill('   ');
    const vSpace = await stakes().evaluate((el) => ({ valid: el.validity.valid }));
    await next().click();
    await page.waitForTimeout(600);
    const t4toast = await toast().count();
    const t4step = await stepText();
    ok('T4 籌碼純空白 → 原生放行，改由 validateCreateGameStage1 跳 toast',
        vSpace.valid === true && t4toast > 0 && /步驟 1/.test(t4step),
        `原生valid=${vSpace.valid} toast筆數=${t4toast} ${t4step}`);
    await shot('03-step1-toast.png');

    // ── T5：合格 ⇒ 進第 2 步，第一段卸載、第二段掛上
    await stakes().fill('300/50');
    await next().click();
    await page.waitForTimeout(700);
    const t5s1 = await stage1().count();
    const t5s2 = await stage2().count();
    const t5step = await stepText();
    ok('T5 合格後進第 2 步：第一段卸載、第二段掛上',
        t5s1 === 0 && t5s2 > 0 && /步驟 2/.test(t5step),
        `第一段=${t5s1} 第二段=${t5s2} ${t5step}`);
    await shot('04-step2.png');

    // ── T6：往返。第二段改一個選項＋塞一張照片，回第一段再前進，看三種狀態都還在。
    //    ⚠️ 照片一定會上傳失敗（本機沒有後端，這是刻意的）—— 要驗的不是上傳成功，
    //       而是 `imageItems` 這筆**活過了 Stage2 的卸載與重掛**。
    await page.getByRole('button', { name: '手動桌' }).click();
    await page.waitForTimeout(200);
    await page.locator('input[type=file]').setInputFiles(probe);
    await page.waitForTimeout(1200);
    const imgBefore = await page.locator('img[src^="blob:"], img[src^="data:"]').count();

    await back().click();
    await page.waitForTimeout(600);
    const t6backStep = await stepText();
    const t6place = await placeName().inputValue();
    const t6stakes = await stakes().inputValue();
    await next().click();
    await page.waitForTimeout(700);
    const manualCls = await page.getByRole('button', { name: '手動桌' }).evaluate((el) => el.className);
    const imgAfter = await page.locator('img[src^="blob:"], img[src^="data:"]').count();
    ok('T6 上一步→下一步 往返：第一段欄位、第二段選項與照片都還在',
        /步驟 1/.test(t6backStep) && t6place === '測試場地' && t6stakes === '300/50'
        && imgBefore > 0 && imgAfter === imgBefore && /bg-neutral-900/.test(manualCls),
        `回程=${t6backStep} 場地名稱="${t6place}" 籌碼="${t6stakes}" 照片 ${imgBefore}→${imgAfter} 手動桌選中=${/bg-neutral-900/.test(manualCls)}`);
    await shot('05-step2-roundtrip.png');

    // ── T7：第 2 步送出 ⇒ 服務條款彈窗（API 不會被呼叫，那是彈窗確認之後的事）
    await submit().click();
    await page.waitForTimeout(700);
    const terms = await page.locator('text=/服務條款|同意/').count();
    ok('T7 第 2 步「確認發起團局」→ 跳出服務條款確認彈窗', terms > 0, `彈窗命中字串數=${terms}`);
    await shot('06-terms.png');

    } catch (e) {
        aborted = e;
    }

    const reloaded = loads > loadsAfterGoto;

    console.log('\n--- 被擋掉的外部請求（應為空；非空代表有東西想連外） ---');
    console.log(blocked.length ? [...new Set(blocked)].join('\n') : '(無)');
    console.log('\n--- 頁面錯誤 ---');
    console.log(errs.length ? errs.join('\n') : '(無)');
    console.log(`\n截圖：${SHOT_DIR}`);
    console.log('⚠️ 涵蓋範圍：只有 CreateGroup 這個元件。/create 路由、登入閘、送出之後的流程都不在內。');

    await browser.close();

    if (reloaded) {
        console.log(`\n🔴 rc=3 量不到：測試中途頁面被重載了 ${loads - loadsAfterGoto} 次（dev server 送的 full reload）。`);
        console.log('   上面的紅綠**都不可信** —— 元件被重新掛載成空表單。請重跑。');
        return 3;
    }

    const failed = results.filter((r) => !r.pass).length;
    const notRun = TOTAL_TESTS - results.length;

    // 🔴 例外的歸屬：已經有一條紅了 ⇒ 這個例外是**後果**（狀態已不可信），算 rc=1；
    //    一條都沒紅卻爆掉 ⇒ 才是設備問題 rc=2。混在一起會讓真回歸被讀成設備故障。
    if (aborted && !(aborted instanceof Failed) && failed === 0) {
        console.error('\nSCRIPT ERROR:', aborted);
        return 2;
    }
    console.log(`\n=== ${results.length - failed}/${TOTAL_TESTS} 通過${notRun ? `（${notRun} 條未跑：前面已經紅了，再往下的狀態不可信）` : ''} ===`);
    if (aborted && !(aborted instanceof Failed)) {
        console.log(`   （中止時的例外：${String(aborted).slice(0, 120)}）`);
    }
    return failed ? 1 : 0;
}

main().then((rc) => process.exit(rc)).catch((e) => {
    console.error('SCRIPT ERROR:', e);
    process.exit(2);
});
