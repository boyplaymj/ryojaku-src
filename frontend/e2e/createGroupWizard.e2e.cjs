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
// 🔴 由 run.sh 傳進來，與 dev server 的 `VITE_API_BASE_URL` **是同一個值**（見 run.sh 的 API_BASE）。
//    T10 要 stub 的那個 `user-info` 就掛在它底下。單獨跑時退回預設值。
const API_BASE = process.env.E2E_API_BASE || `${BASE}/__e2e_no_backend`;
const PROFILE_STUB = new URL(`${API_BASE}/user-info`);
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

// 🔴 這是「應該跑幾條」的宣告，不是計數器 —— 少跑了才看得出來（中途 abort 會少）。
//    加測試時要一起改；漏改會印出 `13/12` 這種一眼看得出不對的分數，那是刻意的。
const TOTAL_TESTS = 14;
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
    // 🔴 `fakeProfile` 這條分支刻意寫在**同一支** handler 裡（見下方「只註冊一個」那段）。
    //    它讓 T10 走得完 `confirmCreate` 的個資檢查閘 —— 那個閘會打
    //    `${VITE_API_BASE_URL}/user-info`（本機死路，404）⇒ 不回一份完整 profile
    //    就永遠到不了 `onCreate`。
    //    ⚠️ 這是**假件**，它只證明「個資完整時走得下去」，不證明個資檢查本身對不對。
    const FAKE_PROFILE = {
        userId: 'e2e-harness-user', displayName: '實跑測試', gender: '男',
        ageRange: '26-35', mahjongExperience: '中級', lineId: 'e2e-line',
        hasClaimedPushBonus: true,   // 避開推播引導那條岔路（那不在本套件涵蓋範圍）
    };
    /**
     * 🔴 **精確比對，不准用 `u.includes('/user-info')`**（覆驗抓到的，而且是同一類的第二次犯）：
     *    子字串比對之下 `https://evil.example/?x=/user-info` 也會被 fulfill ⇒
     *    它不進 `blocked`，**T8 那條安全斷言就變成假綠**。
     *    ⇒ 解析後比 origin ＋ pathname，再釘 GET。反控是 T11。
     *    ⚠️ 這與白名單那邊踩過的坑同源（整條 URL 的 regex 會被 query string 命中）。
     */
    const isProfileStub = (r) => {
        if (r.request().method() !== 'GET') return false;
        try {
            const u = new URL(r.request().url());
            return u.origin === PROFILE_STUB.origin && u.pathname === PROFILE_STUB.pathname;
        } catch {
            return false;   // 解析不了就不是它（不敢判就不敢放）
        }
    };
    const guard = (p, opts = {}) => p.route('**/*', (r) => {
        const u = r.request().url();
        const sink = opts.sink || blocked;
        if (opts.fakeProfile && isProfileStub(r)) {
            return r.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ success: true, data: FAKE_PROFILE }),
            });
        }
        if (isAllowed(u)) return r.continue();
        sink.push(u);
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

    // ── T12：[A3-j] 三個標著 `(必填)` 的環境選項沒選 ⇒ 擋下，彈窗不出現
    //
    // 🔴 這條要排在 T7 **之前**，因為它量的是「還沒選」那個狀態，而 T7 會把它們選掉。
    //    T6 只點過「手動桌」⇒ 走到這裡時 菸／電梯 仍是空的（A3-j 之後初始值是 ''）。
    const termsHeading = page.getByRole('heading', { name: '服務條款確認' });
    const smokeToast = page.locator('text=請選擇菸選項');
    ok('T12a 送出前：服務條款彈窗本來就不在（正控 —— 少了它，T12b 的「不出現」可能只是恆真）',
        (await termsHeading.count()) === 0, `送出前彈窗數=${await termsHeading.count()}`);
    await submit().click();
    const blockedToast = await appears(smokeToast, 5000);
    const termsAfterBlock = await termsHeading.count();
    ok('T12b 菸選項／電梯沒選 → 跳 toast 指名欄位，且**沒有**跳出服務條款彈窗',
        blockedToast === true && termsAfterBlock === 0,
        `toast出現=${blockedToast} 彈窗數=${termsAfterBlock}`);
    await shot('06a-stage2-required.png');

    // ── T7：三項都選了之後送出 ⇒ 服務條款彈窗（API 不會被呼叫，那是彈窗確認之後的事）
    //
    // 🔴 定位器**不可以**用 `text=/服務條款|同意/`：`isLocalhost` 的除錯面板上有一顆
    //    按鈕叫「測試：服務條款確認彈窗」，那串字永遠在頁面上 ⇒ 那樣寫的話，
    //    **彈窗根本沒開也會綠**。A3-j 的閘門一接上就抓到了這件事：舊寫法回報
    //    「彈窗出現=true 命中字串數=1」，而那個 1 就是那顆除錯按鈕。
    //    ⇒ 改用 role=heading（除錯面板那顆是 button，角色天然分得開）。
    await page.getByRole('button', { name: '無菸' }).click();
    await page.getByRole('button', { name: '有電梯' }).click();
    await submit().click();
    const termsShown = await appears(termsHeading);
    ok('T7 三項必填都選了 → 「確認發起團局」跳出服務條款確認彈窗',
        termsShown === true, `彈窗出現=${termsShown} heading數=${await termsHeading.count()}`);
    await shot('06-terms.png');
    } catch (e) {
        aborted = e;
    }

    // ── T9：草稿帶著**過期**的開局時間回來時，使用者一個字都沒改也要能過 Stage1（[A3-i]）。
    //    🔴 這條也在 try 之外，理由不同於 T8：它有**自己的 context**，不吃前面七條
    //       推進出來的表單狀態 ⇒ 前面紅了它照樣量得到，不該被連坐標成「未跑」。
    //    🔴 為什麼要新開 context：草稿住在 localStorage。沿用正式頁那個 context 的話，
    //       裡面已經有一份 startTime = 現在（＝**不過期**）的草稿，
    //       T9 想造的場景會被它蓋掉 —— 而那樣 T9 會綠，且綠得毫無理由。
    //    ⚠️ 執行順序與編號不同：T9／T10／T11 跑在 T8 前面，好讓 T8 的 `blocked` 也涵蓋它們的頁面
    //       （T11 例外：它刻意用自己的 sink，理由見該條）。
    //       編號是斷言的身分，不是執行順序。
    const t9ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
    let t9pass = false;
    let t9detail = '';
    let t10pass = false;
    let t10detail = '';
    try {
        // ① 舊分鐘的那一頁：把時鐘往前撥 10 分鐘，按「填入測試資料」讓它寫一份草稿。
        const stalePage = await t9ctx.newPage();
        await guard(stalePage);
        const STALE_NOW = new Date(FIXED_NOW.getTime() - 10 * 60 * 1000);
        if (FIX_CLOCK) await stalePage.clock.setFixedTime(STALE_NOW);
        await stalePage.goto(URL_HARNESS, { waitUntil: 'domcontentloaded' });
        await stalePage.waitForSelector('text=團局種類', { timeout: 60000 });
        await stalePage.getByRole('button', { name: /填入測試資料/ }).click();
        await stalePage.waitForTimeout(1200);   // 自動存草稿是 500ms debounce
        const staleDraft = await stalePage.evaluate(() => localStorage.getItem('mahjongclub_create_game_draft'));
        const staleStart = staleDraft ? JSON.parse(staleDraft).formData.startTime : null;
        await stalePage.close();

        // ② 十分鐘後回來的那一頁：草稿一還原，startTime 必然是過去的。
        const freshPage = await t9ctx.newPage();
        await guard(freshPage, { fakeProfile: true });
        if (FIX_CLOCK) await freshPage.clock.setFixedTime(FIXED_NOW);
        await freshPage.goto(URL_HARNESS, { waitUntil: 'domcontentloaded' });
        await freshPage.waitForSelector('text=團局種類', { timeout: 60000 });
        // 正控：草稿真的被還原了（否則本條測到的是「一張全新的空表單」，那毫無意義）
        const restored = await freshPage.getByPlaceholder('例如：台北信義 / 自家場').inputValue();

        await freshPage.evaluate(() => {
            const w = window;
            w.__t9seen = false;
            const check = () => { if (document.body.innerText.includes('開局時間不能早於目前時間')) w.__t9seen = true; };
            check();
            new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
        });
        await freshPage.getByRole('button', { name: '下一步' }).click();
        const wentOn = await freshPage.locator('text=環境設施設定').first()
            .waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
        const t9toast = await freshPage.evaluate(() => !!window.__t9seen);
        await freshPage.screenshot({ path: path.join(SHOT_DIR, '07-draft-stale-starttime.png') });

        t9pass = restored === '測試場地' && wentOn === true && t9toast === false;
        t9detail = `草稿還原=${restored === '測試場地' ? '是' : `否(${restored})`} 草稿裡的開局時間=${staleStart} `
            + `進到第 2 步=${wentOn} 時間toast出現過=${t9toast}`;

        // ── T10：**送出去的 payload** 帶的必須是刷新後的時間（[A3-i]，覆驗者提的）
        //    🔴 這條補的是一發**存活過的突變**：`confirmCreate` 組 payload 時用回 state
        //       裡的 `formData`（而不是 `withFreshStartTime()` 的回傳值）——
        //       驗證照樣放行、畫面照樣往下走，只有送出去的那份帶著舊時間。
        //    🔴 我一度把這件事寫成「沒有尺、要等整合測試」。**那是錯的**：
        //       harness 的 `onCreate` 本來就是可觀測的送出邊界，我只是沒往那裡看。
        //       ⇒ 宣告盲區之前要先把現有的縫都找過一遍。
        if (wentOn) {
            // 🔴 **在第 2 步之後才讓時間過期** —— 這一步是 T10 有沒有鑑別力的全部關鍵。
            //    第一版沒有它：Stage1 閘門那一次 `withFreshStartTime()` 已經把 state
            //    刷新過了，所以走到 `confirmCreate` 時 `formData` 本來就是新的 ⇒
            //    「用 state」與「用回傳值」量出來**逐字相同**，突變照樣存活而 T10 全綠。
            //    ⇒ 把時鐘往前撥 10 分鐘，state 裡那個值就餿了，兩者才分得開。
            //    ⚠️ 這同時是一個真實情境：使用者在第 2 步慢慢填環境選項超過一分鐘。
            if (FIX_CLOCK) await freshPage.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 10 * 60 * 1000));
            // [A3-j] 三個 `(必填)` 環境選項要先選，否則卡在 Stage2 閘門到不了 onCreate。
            // ⚠️ 這幾行是**前置條件**不是斷言 —— 擋不擋得住由 T12 負責量。
            for (const opt of ['無菸', '有電梯', '手動桌']) {
                await freshPage.getByRole('button', { name: opt }).click();
            }
            await freshPage.getByRole('button', { name: /確認發起團局/ }).click();
            await freshPage.getByRole('button', { name: '確認同意' })
                .waitFor({ state: 'visible', timeout: 20000 });
            await freshPage.getByRole('button', { name: '確認同意' }).click();
            const captured = await freshPage.waitForFunction(() => window.__created || null, null, { timeout: 20000 })
                .then((h) => h.jsonValue(), () => null);
            // 判準在頁內算，避免 node 端與瀏覽器端時區不一致
            //    判準：payload 的那一分鐘必須等於**送出當下**的那一分鐘。
            //    用「相等」不用「>=」的理由：`>=` 對「早了 10 分鐘」有鑑別力，
            //    但對「晚了 10 分鐘」沒有 —— 而兩者都是錯的。
            const verdict = captured ? await freshPage.evaluate((payload) => {
                const floor = (t) => { const d = new Date(t); d.setSeconds(0); d.setMilliseconds(0); return d.getTime(); };
                return {
                    startTime: payload.startTime,
                    payloadMinute: new Date(floor(payload.startTime)).toISOString(),
                    nowMinute: new Date(floor(Date.now())).toISOString(),
                    same: floor(payload.startTime) === floor(Date.now()),
                };
            }, captured) : null;
            t10pass = !!verdict && verdict.same;
            t10detail = verdict
                ? `payload.startTime=${verdict.startTime}（=${verdict.payloadMinute}）送出當下=${verdict.nowMinute} 同一分鐘=${verdict.same}；草稿原本是 ${staleStart}`
                : '沒有捕捉到 onCreate 的 payload（送出流程沒走完）';
        } else {
            t10detail = 'T9 沒進到第 2 步 ⇒ 這條沒有前提可跑';
        }
    } catch (e) {
        const msg = `例外：${e && e.message ? e.message.split('\n')[0] : e}`;
        if (!t9detail) t9detail = msg; else if (!t10detail) t10detail = msg;
    }
    await t9ctx.close();

    // ── T13：[A3-j] **舊草稿**的三個必填環境選項要被丟掉（分不出「他選的」與「舊預設值」）
    //
    // 🔴 這條是 J3 那半個修法的**唯一**一把尺。少了它，`envOptionsDeclared` 的判斷
    //    寫反、或整段被刪掉，其餘 12 條**一條都不會紅** —— 因為它們用的都是
    //    新格式的草稿（或根本沒有草稿）。
    // 🔴 兩臂缺一不可：只有「舊草稿被擋」的話，那個綠燈與「這個閘門對誰都擋」
    //    逐字相同。新草稿那一臂才問得出「它擋的是舊格式」。
    const t13ctx = await browser.newContext();
    try {
        const armResult = {};
        for (const arm of ['old', 'new']) {
            const pg = await t13ctx.newPage();
            await guard(pg, { fakeProfile: true });
            if (FIX_CLOCK) await pg.clock.setFixedTime(FIXED_NOW);
            await pg.goto(URL_HARNESS, { waitUntil: 'domcontentloaded' });
            await pg.waitForSelector('text=團局種類', { timeout: 60000 });
            await pg.getByRole('button', { name: /填入測試資料/ }).click();
            await pg.waitForTimeout(1200);   // 自動存草稿是 500ms debounce

            // 把草稿改成「A3-j 之前」的樣子：三個必填欄帶著舊預設值。
            // old 臂**拿掉** envOptionsDeclared（＝舊格式）；new 臂留著 true（＝新格式）。
            await pg.evaluate((keepFlag) => {
                const K = 'mahjongclub_create_game_draft';
                const d = JSON.parse(localStorage.getItem(K));
                d.envOptions = { ...(d.envOptions || {}), smoking: '無菸', elevator: '有電梯', mahjongTable: '電動桌', parking: [], tableModel: '' };
                if (keepFlag) { d.envOptionsDeclared = true; } else { delete d.envOptionsDeclared; }
                localStorage.setItem(K, JSON.stringify(d));
            }, arm === 'new');

            await pg.reload({ waitUntil: 'domcontentloaded' });
            await pg.waitForSelector('text=團局種類', { timeout: 60000 });
            await pg.getByRole('button', { name: '下一步' }).click();
            await pg.locator('text=環境設施設定').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
            await pg.getByRole('button', { name: /確認發起團局/ }).click();
            armResult[arm] = {
                blocked: await appears(pg.locator('text=請選擇菸選項'), 5000),
                terms: await pg.getByRole('heading', { name: '服務條款確認' }).count(),
            };
            await pg.close();
        }
        ok('T13 舊草稿（無 envOptionsDeclared）的必填環境選項被丟掉 ⇒ 擋下；新草稿照樣放行',
            armResult.old.blocked === true && armResult.old.terms === 0
            && armResult.new.blocked === false && armResult.new.terms === 1,
            `舊草稿 擋下=${armResult.old.blocked} 彈窗=${armResult.old.terms}`
            + ` ／ 新草稿 擋下=${armResult.new.blocked} 彈窗=${armResult.new.terms}`);
    } catch (e) {
        ok('T13 舊草稿的必填環境選項被丟掉', false, `例外：${e.message}`);
    }
    await t13ctx.close();
    record('T9 草稿帶回過期的開局時間 ⇒ 沒碰過就自動推進，使用者一字未改也能過 Stage1', t9pass, t9detail);
    record('T10 送出的 payload 帶的是刷新後的開局時間（不是草稿那個舊的）', t10pass, t10detail);

    // ── T11：**四顆誘餌**，每顆只變一個維度，釘住 `isProfileStub` 的
    //    `origin ∧ pathname ∧ GET` 三個條件**每一個都不可少**。
    //    🔴 第一版只有一顆誘餌，而它同時「不同 origin、不同 pathname」——
    //       那種誘餌只殺得掉 `includes`，對「只比 origin」「只比 pathname」
    //       「漏掉 GET」三種錯誤**零鑑別力**（覆驗抓到的）。
    //       ⇒ 反控要一次只動一個維度，否則殺掉的是哪一條無法歸因。
    //    🔴 判準**分兩種，不能混**：
    //       本機 origin 在白名單內 ⇒ 那兩顆會被 `continue`（回 dev server 的 404），
    //       **不會進 sink**。對它們唯一有意義的問題是「有沒有拿到假 profile」。
    //       非白名單那兩顆才該被 abort ＋ 記錄。
    //       把「一律要被記錄」套到四顆上，就會用一個假的判準去驗一件真的事。
    const decoy = [];
    let t11pass = false;
    let t11detail = '';
    const PROBES = [
        // 名稱                      url                                              method  該被記錄
        ['錯origin＋路徑含user-info', 'https://evil.example/x/user-info?userId=e2e',   'GET',  true],
        ['同origin＋錯pathname',      `${API_BASE}/user-info-not-really`,              'GET',  false],
        ['錯origin＋同pathname',      `https://evil.example${PROFILE_STUB.pathname}`,  'GET',  true],
        ['同origin＋同pathname＋POST', `${API_BASE}/user-info`,                        'POST', false],
    ];
    try {
        const t11ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
        const dp = await t11ctx.newPage();
        await guard(dp, { fakeProfile: true, sink: decoy });
        await dp.goto(URL_HARNESS, { waitUntil: 'domcontentloaded' });
        await dp.waitForSelector('text=團局種類', { timeout: 60000 });
        const got = await dp.evaluate(async (probes) => {
            const out = [];
            for (const [name, url, method] of probes) {
                try {
                    const r = await fetch(url, { method });
                    const body = (await r.text()).slice(0, 200);
                    // 「拿到假 profile」的唯一判準：200 且 body 裡有那個假 userId。
                    out.push({ name, url, threw: false, status: r.status, fake: r.ok && body.includes('e2e-harness-user') });
                } catch (e) {
                    out.push({ name, url, threw: true, fake: false, err: String((e && e.message) || e).slice(0, 40) });
                }
            }
            return out;
        }, PROBES);
        await t11ctx.close();

        const lines = got.map((g, i) => {
            const wantRecorded = PROBES[i][3];
            const recorded = decoy.includes(g.url);
            const okOne = g.fake === false && recorded === wantRecorded;
            return { okOne, text: `${okOne ? '·' : '✗'}${g.name}[拿到假profile=${g.fake} `
                + `${g.threw ? `abort(${g.err})` : `HTTP ${g.status}`} 被記錄=${recorded}(該=${wantRecorded})]` };
        });
        t11pass = got.length === PROBES.length && lines.every((l) => l.okOne);
        t11detail = lines.map((l) => l.text).join(' ');
    } catch (e) {
        t11detail = `例外：${e && e.message ? e.message.split('\n')[0] : e}`;
    }
    record('T11 四顆誘餌：origin／pathname／GET 三個條件每一個都不可少（每顆只變一維）', t11pass, t11detail);

    // ── T8：暖機頁＋正式頁都不准發出**非白名單**請求。
    //    🔴 這條**一定要跑**（放在 try 外面）：它是安全性質，不是流程的一步。
    //    🔴 而且它必須影響 rc —— 更早的版本只把清單印出來、不影響成敗，
    //       等於 README 寫的「硬防線」沒有任何執行力（覆驗抓到的）。
    //    ⚠️ 這裡的「兩頁」自 T9 加入後其實是**四頁**（暖機／正式／T9 的兩頁）——
    //       訊息維持講「暖機頁與正式頁」會漏掉 T9 那兩頁，所以下面改成講「全部頁面」。
    //    ⚠️ **措辭要精確**：白名單裡有 `cdn.tailwindcss.com` 與 `unpkg.com`
    //       （`index.html` 本來就會抓），所以這條**不是**「完全沒有對外連線」，
    //       而是「沒有白名單以外的連線，特別是沒有任何正式後端」。
    const external = [...new Set(blocked)];
    record(`T8 全部頁面都沒有非白名單請求（白名單＝本機＋${[...ALLOW_HOSTS].filter((h) => !/^(127\.0\.0\.1|localhost)$/.test(h)).join('／')}；正式後端不在其中）`,
        external.length === 0,
        external.length === 0 ? '非白名單請求 0 筆（暖機頁＋正式頁＋T9 兩頁合計）' : `被擋 ${external.length} 個：${external.slice(0, 5).join(' , ')}`);

    const reloaded = loads > loadsAfterGoto;

    console.log('\n--- 頁面錯誤 ---');
    console.log(errs.length ? errs.join('\n') : '(無)');
    console.log(`\n截圖：${SHOT_DIR}`);
    console.log('⚠️ 涵蓋範圍：只有 CreateGroup 這個元件。/create 路由與登入閘不在內；'
        + '送出邊界（交給 onCreate 的 payload）在內，onCreate 之後（真的建團／推播／跳轉）不在內。');

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
