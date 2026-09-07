// e2e/createGroupWizard.e2e.cjs — 發團表單兩步驟精靈的瀏覽器實跑驗收（[A3-c]）
//
// 跑法：`npm run e2e`（＝ `bash e2e/run.sh`，它負責起 dev server 與收尾）。
// 這支不自己起 server —— 單獨跑要先有一個 dev server 在 E2E_PORT 上。
//
// 🔴 這支存在的理由：A3-c 改的**全部是 UI 行為**，而 `tsc` 只證明型別接得上、
//    `vite build` 連型別都不驗、`run-tests.mjs` 咬的是純函式。三道閘對
//    「按下去會發生什麼」零鑑別力。
//
// 🔴🔴 **T4／T5 曾經每 4～5 次假紅一次；根因已查明＝跳出來的是「另一句」toast。**
//    表單的 `startTime` 預設 = **開頁那一刻**截到分的時間，而檢核① 拿它跟
//    「現在（秒歸零）」比 ⇒ 只要跑過一個分鐘邊界，先擋下來的是
//    「開局時間不能早於目前時間」，`stakes` 那道永遠輪不到。
//    修法：`page.clock.setFixedTime()`（見下方 FIX_CLOCK）。
//    反控：`E2E_NO_CLOCK_FIX=1` 關掉它，假紅會回來。
//
//    ⚠️ 排除過程留著，因為前兩個假說**都是錯的**，而它們看起來都很合理：
//      ① 固定 sleep 取樣 —— toast `duration` 預設 3000ms **會自己消失**，
//         舊版在 click 後固定等 600ms 取一次樣，窗**兩端都是封閉的**。
//         改成閂住式 MutationObserver ＋ 上限 20s 之後 —— **照樣紅**。
//      ② dev server 中途重載 —— rc=3 那道會抓，而它沒有觸發（vite log 沒有 reloading）。
//    ⇒ 真正問出答案的是 `__submits` 這個儀器：它讓
//      `submit有派送=false`（這一下根本沒送出表單）與
//      `submit有派送=true` 而 `toast出現過=false`（送出了但沒跳**那一句**）分得開。
//      **在能分辨之前不要再猜** —— 我猜錯了兩次，其中一次還先寫進註解才去驗。
//
// 🔴 一律等「可觀測的結果」，不准用固定 sleep 當判準：
//    正面斷言用 `appears()`／`until()`（等到為止）；負面斷言用**有界的**觀察窗，
//    並把那個界限寫進 detail，不要用「取樣一次剛好沒看到」冒充。
//
// 🔴 rc 的意思（五種，不可互相讀錯）：
//    0 = 全部通過   1 = 有測試沒過   2 = 腳本自己爆了
//    3 = 量不到（測試中途頁面被重載）  4 = 沒有儀器（由 run.sh 判）

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.E2E_PORT || '5199';
const BASE = `http://127.0.0.1:${PORT}`;
const URL_HARNESS = `${BASE}/e2e/_generated.harness.html`;
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(os.tmpdir(), 'a3c-shots');

// 只放行本機與 index.html 本來就會抓的兩個 CDN；其餘一律 abort。
// 🔴 這是硬防線不是省流量：確保這份驗收**結構上碰不到任何正式後端**。
// 🔴 比對的是**解析後的 hostname**，不是整條 URL 的 regex ——
//    後者會被 query string 命中（`https://evil.example/?x=cdn.tailwindcss.com` 也算通過）。
const ALLOW_HOSTS = new Set(['127.0.0.1', 'localhost', 'cdn.tailwindcss.com', 'unpkg.com']);
const isAllowed = (raw) => {
    try {
        const u = new URL(raw);
        if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
        return ALLOW_HOSTS.has(u.hostname);
    } catch {
        return false; // 解析不了就不放行（不敢判就不敢放）
    }
};

const TOTAL_TESTS = 8;
const results = [];
/** 一條測試紅了就**停在那裡**。 */
class Failed extends Error {}
const record = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`);
};
const ok = (name, pass, detail) => {
    record(name, pass, detail);
    // 🔴 為什麼失敗就中止：這幾條是一條接一條推進同一個表單狀態的。
    //    T4 紅（例如 stakes 檢查被拿掉）代表畫面已經跑到第 2 步，
    //    接下來 T5 去 fill 那個**已經卸載**的籌碼欄位必然拋 locator timeout ——
    //    那個例外會讓整支變成 rc=2「腳本自己爆了」，把一次**真的抓到回歸**
    //    講成設備故障。實測過：突變 A 第一版就是這樣收場的。
    if (!pass) throw new Failed(name);
};

/** 16×16 PNG，用來驗「照片項目活過 Stage2 卸載」。 */
const PROBE_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAKklEQVR4nGP8//8/AzbAhFVUEg0wYqrDYQymFhYcxmDXgtVWnA4bkZoAvGkKD6zsSFcAAAAASUVORK5CYII=';

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const probe = path.join(SHOT_DIR, 'probe.png');
    fs.writeFileSync(probe, Buffer.from(PROBE_PNG_B64, 'base64'));

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });

    // ── 暖機：讓 vite 在這裡把 dep optimization 做完（它做完會送一次 full reload）。
    //    正式那頁才不會在測試中途被重載。暖機頁的結果**不列入任何斷言**。
    // 🔴 固定 `Date.now()`／`new Date()`（timer 照常跑，只釘住「現在」）。
    //    理由是量出來的：表單的 `startTime` 預設 = **開頁那一刻**截到分的時間，
    //    而檢核① 拿它跟「現在（秒歸零）」比 ⇒ **只要跑過一個分鐘邊界，
    //    第一個跳出來的就是「開局時間不能早於目前時間」，不是「請輸入籌碼」**。
    //    那正是 T4／T5 間歇假紅的來源（機率 ≈ 開頁到該步驟的秒數 / 60）。
    //    ⚠️ 這是把**與待驗行為無關的**時間漂移排除掉，不是把產品缺陷藏起來 ——
    //       那個缺陷是真的，見 README「順手量到的產品問題」。
    //    反控：`E2E_NO_CLOCK_FIX=1` 關掉它，假紅就會回來。
    //
    // 🔴🔴 **一頁一個固定時間是不夠的 —— 兩頁必須固定在同一個瞬間**（2026-09-07 量到）。
    //    第一版對暖機頁與正式頁各呼叫一次 `setFixedTime(new Date())`，兩者相隔約 4 秒。
    //    而 `CreateGroup` **每次掛載都會把草稿寫進 localStorage**（載入草稿那支 effect
    //    宣告在自動存檔那支前面，它把 `isInitialMount` 設成 false ⇒ 自動存檔照跑），
    //    暖機頁與正式頁又共用同一個 browser context ⇒ 正式頁讀回的
    //    `startTime` 是**暖機頁那一分鐘**的。跨過分鐘邊界就紅。
    //    ⇒ 假紅的窗只是從「開頁到 T4」縮成「暖機到正式頁」，沒有被消掉：
    //      實測 20 輪紅 1 輪（≈5%，與 4 秒 / 60 秒相符）。
    //    ⚠️ 這件事教的是：**修完要用「窗變小之後的機率」去設重跑次數**。
    //      連跑 8 次全綠在 5% 之下有 66% 的機會發生 ⇒ 那 8 次不構成「修好了」的證據。
    const FIX_CLOCK = process.env.E2E_NO_CLOCK_FIX !== '1';
    // 兩頁共用這一個瞬間。反控 `E2E_WARM_CLOCK_SKEW_S=60`：故意把暖機頁往前撥，
    // 讓草稿帶著上一分鐘的 startTime 回來 —— 那會**每次**都紅，不必靠機率重現。
    const FIXED_NOW = new Date();
    const WARM_SKEW_S = Number(process.env.E2E_WARM_CLOCK_SKEW_S || 0);
    const WARM_NOW = new Date(FIXED_NOW.getTime() - WARM_SKEW_S * 1000);
    // 🔴 `blocked` 由暖機頁與正式頁**共用**。第一版只有正式頁在記 ⇒ 暖機頁被擋的
    //    請求不會進清單，而 T8 卻宣稱「整趟」。攔截在兩頁都有效（安全性沒破口），
    //    但**宣稱的範圍**比量到的大 —— 那正是「量了 A 卻說成 B」。
    const blocked = [];
    const guard = (p) => p.route('**/*', (r) => {
        const u = r.request().url();
        if (isAllowed(u)) return r.continue();
        blocked.push(u);
        return r.abort();
    });

    const warm = await ctx.newPage();
    if (FIX_CLOCK) await warm.clock.setFixedTime(WARM_NOW);
    await guard(warm);
    await warm.goto(URL_HARNESS, { waitUntil: 'domcontentloaded' });
    await warm.waitForSelector('text=團局種類', { timeout: 60000 });
    await warm.waitForTimeout(2500);
    await warm.close();

    const page = await ctx.newPage();
    if (FIX_CLOCK) await page.clock.setFixedTime(FIXED_NOW);
    const errs = [];
    let loads = 0;
    page.on('load', () => { loads += 1; });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    // 🔴 只註冊**一個** route handler：Playwright 的多個 handler 是後註冊者先跑，
    //    而沒有呼叫 continue/abort/fallback 的那個會讓請求**整個掛住**。
    //    記錄與放行/攔截必須寫在同一支裡（`guard()` 就是那一支）。
    await guard(page);

    await page.goto(URL_HARNESS, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=團局種類', { timeout: 60000 });
    const loadsAfterGoto = loads;

    // 🔴 儀器：數 <form> 真的收到幾次 submit 事件。
    //    沒有它的話，「程式閘擋住了但 toast 沒顯示」與「這一下點擊根本沒送出表單」
    //    在畫面上**逐字相同**（都是停在步驟 1、第二段 0）——
    //    而後者正是突變 B（type="button"）的徵兆。分不出來就沒辦法歸因。
    //    ⚠️ 原生驗證失敗時瀏覽器**不會**派送 submit 事件，所以這個計數器本身
    //       就是 T3／T4 的分水嶺：T3 不該加、T4 該加 1。
    await page.evaluate(() => {
        const f = document.querySelector('form');
        window.__submits = 0;
        if (f) f.addEventListener('submit', () => { window.__submits += 1; }, true);
    });
    const submits = () => page.evaluate(() => window.__submits || 0);

    const stepText = () => page.locator('text=/步驟 \\d \\/ 2/').first().innerText();
    const next = () => page.getByRole('button', { name: '下一步' });
    const back = () => page.getByRole('button', { name: '上一步' });
    const submit = () => page.getByRole('button', { name: /確認發起團局/ });
    const stakes = () => page.getByPlaceholder('100/20');
    const placeName = () => page.getByPlaceholder('例如：台北信義 / 自家場');
    const stage1 = () => page.locator('text=團局種類');
    const stage2 = () => page.locator('text=環境設施設定');
    const toast = () => page.locator('text=請輸入籌碼');
    const photos = () => page.locator('img[src^="blob:"], img[src^="data:"]');
    const shot = (n) => page.screenshot({ path: path.join(SHOT_DIR, n) });

    /** 等到「出現」為止；等不到回 false（不丟例外 ⇒ 由斷言決定紅綠，不會變成 rc=2）。 */
    const appears = (loc, timeout = 20000) =>
        loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
    /** 等到「從 DOM 消失」為止。 */
    const disappears = (loc, timeout = 20000) =>
        loc.first().waitFor({ state: 'detached', timeout }).then(() => true, () => false);
    /**
     * 🔴 **閂住式觀察**：toast 3 秒後會自己消失 ⇒ 它是個**瞬態**訊號。
     *    `appears()` 從 click 之後才開始輪詢，已經比定點取樣好很多，但只要行程被
     *    節流卡住超過那 3 秒，它仍然會漏看 —— 而「漏看」與「根本沒出現」在結果上逐字相同。
     *    ⇒ 改成在**點下去之前**就掛一個 MutationObserver，出現過就把旗標閂住。
     *      這樣「出現過又消失了」也算數，瞬態就變成可觀測的事實。
     */
    const watchText = (text) => page.evaluate((t) => {
        const w = window;
        w.__seen = w.__seen || {};
        w.__obs = w.__obs || {};
        if (w.__obs[t]) w.__obs[t].disconnect();
        w.__seen[t] = false;
        const check = () => { if (document.body.innerText.includes(t)) w.__seen[t] = true; };
        check();
        const obs = new MutationObserver(check);
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        w.__obs[t] = obs;
    }, text);
    const sawText = (text) => page.evaluate((t) => !!(window.__seen && window.__seen[t]), text);

    /** 輪詢一個布林條件（給 disabled 這種沒有 waitFor 狀態可用的）。 */
    const until = async (fn, timeout = 20000) => {
        const t0 = Date.now();
        for (;;) {
            if (await fn().catch(() => false)) return true;
            if (Date.now() - t0 > timeout) return false;
            await page.waitForTimeout(100);
        }
    };

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
    const t2en = await until(() => next().isEnabled());
    ok('T2 定位之後「下一步」變成可按', t2en === true,
        `enabled=${t2en}（等到為止，上限 8s） 籌碼=${await stakes().inputValue()}`);

    // ── T3：籌碼空字串 ⇒ **瀏覽器原生 required** 擋下（不是程式閘）
    //    🔴 這是負面斷言（「不該有 toast」），所以必須**有界**：等 2.5 秒確認它沒出現，
    //       而不是取樣一次剛好沒看到。界限寫進 detail，讀的人才知道這句話有多強。
    //    🔴 正控是 activeElement：原生驗證失敗時瀏覽器會把焦點移到那個欄位上 ——
    //       少了它，「原生擋住了」與「這顆按鈕根本沒接上」在本條眼裡逐字相同。
    await stakes().fill('');
    const vEmpty = await stakes().evaluate((el) => ({ valid: el.validity.valid, missing: el.validity.valueMissing }));
    await watchText('請輸入籌碼');
    await watchText('開局時間不能早於目前時間');
    await next().click();
    const focusedStakes = await until(() =>
        page.evaluate(() => document.activeElement instanceof HTMLInputElement
            && document.activeElement.placeholder === '100/20'), 3000);
    await page.waitForTimeout(2500);   // 有界的觀察窗（閂住式：這段期間出現過就會被記下）
    const t3toastSeen = await sawText('請輸入籌碼');
    const t3submits = await submits();
    const t3step = await stepText();
    ok('T3 籌碼空字串 → 原生 required 擋下（submit 事件沒派送、2.5 秒窗內沒有 toast）',
        vEmpty.missing === true && focusedStakes === true && t3submits === 0
        && t3toastSeen === false && /步驟 1/.test(t3step),
        `valueMissing=${vEmpty.missing} 焦點回到籌碼欄=${focusedStakes} submit次數=${t3submits} 2.5s窗內toast出現過=${t3toastSeen} ${t3step}`);
    await shot('02-step1-native-required.png');

    // ── T4：籌碼純空白 ⇒ 原生**放行**，改由 validateCreateGameStage1 跳 toast
    //    🔴 T3/T4 必須成對看。原生 required 只擋真正的空值，'   ' 它會放行；
    //       只有這一對的**對比**才分得出「原生擋的」與「程式閘擋的」。
    //       T3 自己對「按鈕根本沒作用」零鑑別力（實測：把下一步改成 type="button"，T3 照樣綠）。
    // 收掉 T3 留下的原生驗證氣泡再點（Escape + blur）。
    // ⚠️ **這是一個未證實的預防措施，不是根因的修法。** 假說是「氣泡開著時
    //    下一次點擊會被拿去關掉它，那一下就不送出表單」；但把這三行拿掉之後
    //    連跑 5 次**沒有重現**假紅 ⇒ 假說沒有被證實（也沒被推翻，5 次太少）。
    //    留著是因為它無害且便宜。
    //    🔴 **已查明的根因是分鐘邊界跳出另一句 toast（見檔頭），修法是 FIX_CLOCK。**
    //       這三行與那個根因無關，不要把它讀成「還在找原因」。
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(300);

    await stakes().fill('   ');
    const vSpace = await stakes().evaluate((el) => ({ valid: el.validity.valid }));
    await watchText('請輸入籌碼');
    await watchText('開局時間不能早於目前時間');
    const submitsBefore = await submits();
    await next().click();
    const t4submitted = await until(async () => (await submits()) > submitsBefore, 5000);
    const t4toastSeen = await until(() => sawText('請輸入籌碼'));
    const t4timeToast = await sawText('開局時間不能早於目前時間');
    const t4step = await stepText();
    // 🔴 兩個證據刻意都要：toast 是**瞬態**的（給人看的訊息），
    //    「沒有前進到第 2 步」是**耐久**的（閘門真的擋住了）。
    //    只留瞬態那個 ⇒ 漏看就變假紅；只留耐久那個 ⇒ 「靜靜擋掉不給訊息」也會過。
    ok('T4 籌碼純空白 → 原生放行、submit 有派送，改由 validateCreateGameStage1 跳 toast 且沒有前進',
        vSpace.valid === true && t4submitted === true && t4toastSeen === true
        && /步驟 1/.test(t4step) && (await stage2().count()) === 0,
        `原生valid=${vSpace.valid} submit有派送=${t4submitted} toast出現過=${t4toastSeen}（閂住式）`
        + `${t4timeToast ? ' 🔴跳的是「開局時間不能早於目前時間」＝時鐘漂移,不是產品回歸' : ''} ${t4step} 第二段=${await stage2().count()}`);
    await shot('03-step1-toast.png');

    // ── T5：合格 ⇒ 進第 2 步，第一段卸載、第二段掛上
    await stakes().fill('300/50');
    const t5submitsBefore = await submits();
    await next().click();
    // 同一個儀器：分得出「送出了但沒換頁」與「這一下根本沒送出」。
    const t5submitted = await until(async () => (await submits()) > t5submitsBefore, 10000);
    const t5s2Shown = await appears(stage2());
    const t5s1Gone = await disappears(stage1());
    const t5step = await stepText();
    ok('T5 合格後進第 2 步：submit 有派送、第一段卸載、第二段掛上',
        t5submitted === true && t5s2Shown === true && t5s1Gone === true && /步驟 2/.test(t5step),
        `submit有派送=${t5submitted} 第二段出現=${t5s2Shown} 第一段卸載=${t5s1Gone} ${t5step}`);
    await shot('04-step2.png');

    // ── T6：往返。第二段改一個選項＋塞一張照片，回第一段再前進，看三種狀態都還在。
    //    ⚠️ 照片一定會上傳失敗（本機沒有後端，這是刻意的）—— 要驗的不是上傳成功，
    //       而是 `imageItems` 這筆**活過了 Stage2 的卸載與重掛**。
    await page.getByRole('button', { name: '手動桌' }).click();
    await page.locator('input[type=file]').setInputFiles(probe);
    const photoShown = await appears(photos());
    const imgBefore = await photos().count();

    await back().click();
    const backOk = await appears(stage1());
    const t6backStep = await stepText();
    const t6place = await placeName().inputValue();
    const t6stakes = await stakes().inputValue();
    await next().click();
    const fwdOk = await appears(stage2());
    const manualCls = await page.getByRole('button', { name: '手動桌' }).evaluate((el) => el.className);
    const imgAfter = await photos().count();
    ok('T6 上一步→下一步 往返：第一段欄位、第二段選項與照片都還在',
        backOk && fwdOk && /步驟 1/.test(t6backStep) && t6place === '測試場地' && t6stakes === '300/50'
        && photoShown && imgBefore > 0 && imgAfter === imgBefore && /bg-neutral-900/.test(manualCls),
        `回程=${t6backStep} 場地名稱="${t6place}" 籌碼="${t6stakes}" 照片 ${imgBefore}→${imgAfter} 手動桌選中=${/bg-neutral-900/.test(manualCls)}`);
    await shot('05-step2-roundtrip.png');

    // ── T7：第 2 步送出 ⇒ 服務條款彈窗（API 不會被呼叫，那是彈窗確認之後的事）
    const terms = page.locator('text=/服務條款|同意/');
    await submit().click();
    const termsShown = await appears(terms);
    ok('T7 第 2 步「確認發起團局」→ 跳出服務條款確認彈窗',
        termsShown === true, `彈窗出現=${termsShown} 命中字串數=${await terms.count()}`);
    await shot('06-terms.png');
    } catch (e) {
        aborted = e;
    }

    // ── T8：暖機頁＋正式頁都不准發出**非白名單**請求。
    //    🔴 這條**一定要跑**（放在 try 外面）：它是安全性質，不是流程的一步。
    //    🔴 而且它必須影響 rc —— 更早的版本只把清單印出來、不影響成敗，
    //       等於 README 寫的「硬防線」沒有任何執行力（覆驗抓到的）。
    //    ⚠️ **措辭要精確**：白名單裡有 `cdn.tailwindcss.com` 與 `unpkg.com`
    //       （`index.html` 本來就會抓），所以這條**不是**「完全沒有對外連線」，
    //       而是「沒有白名單以外的連線，特別是沒有任何正式後端」。
    const external = [...new Set(blocked)];
    record(`T8 兩頁都沒有非白名單請求（白名單＝本機＋${[...ALLOW_HOSTS].filter((h) => !/^(127\.0\.0\.1|localhost)$/.test(h)).join('／')}；正式後端不在其中）`,
        external.length === 0,
        external.length === 0 ? '非白名單請求 0 筆（暖機頁與正式頁合計）' : `被擋 ${external.length} 個：${external.slice(0, 5).join(' , ')}`);

    const reloaded = loads > loadsAfterGoto;

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
