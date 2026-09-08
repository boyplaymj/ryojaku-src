// e2e/editGroupExtras.e2e.cjs — 「編輯補充設定」頁（`/edit-group/:id`）的瀏覽器實跑驗收（[A3-p]/E5）
//
// 跑法：`E2E_HARNESS=e2e/editGroupExtras.harness.tsx E2E_SPEC=editGroupExtras.e2e.cjs npm run e2e`
// （run.sh 負責起 dev server、生 harness 頁與收尾；這支不自己起 server。）
//
// 🔴 這支存在的理由，一句話：**`update-game` 是整欄覆寫**。
//    編輯頁若沒把既有宣告還原回 UI，主揪按一次「儲存」就會把
//    「無菸／有電梯／電動桌／照片」整批洗掉 —— 而畫面上只是存檔成功。
//    單元層的 `A3p-02`／`A3p-03` 咬的是 `parseVenueFeatures`／`buildVenueFeatures`
//    這兩支純函式的往返；**它們對「那一頁有沒有真的呼叫它們」零鑑別力**
//    （少一行 `resetToUrls(game.images)` 純函式照樣全綠）。這一層才咬得住。
//
// 🔴 E3 與 E5 是**一對**，缺一不可：
//    - E3（不修改就儲存）單獨看，一個「送出時直接把載入到的 `game.venueFeatures`
//      原樣回送」的實作**照樣全綠** —— 那種實作根本沒接 UI，使用者改了什麼都不算數。
//    - E5（改一個選項＋刪一張照片再儲存）就是那個誘餌的反面：它要求送出的內容
//      跟著畫面走。兩條一起才把「還原了」與「送的是畫面當下的值」都釘住。
//
// 🔴 rc 的意思（沿用建局那支的約定，五種不可互相讀錯）：
//    0 = 全部通過   1 = 有測試沒過   2 = 腳本自己爆了
//    3 = 量不到（測試中途頁面被重載）  4 = 沒有儀器（由 run.sh 判）

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.E2E_PORT || '5199';
const BASE = `http://127.0.0.1:${PORT}`;
const API_BASE = process.env.E2E_API_BASE || `${BASE}/__e2e_no_backend`;
// harness 頁的檔名由 run.sh 現生並傳進來（它跟著 `E2E_HARNESS` 走）。
// 單獨跑時退回 run.sh 用同一條規則會產生的那個名字。
const URL_HARNESS = `${BASE}${process.env.E2E_HARNESS_URL || '/e2e/_generated.editGroupExtras.harness.html'}`;
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(os.tmpdir(), 'a3p-shots');

// 只放行本機與 index.html 本來就會抓的兩個 CDN；其餘一律 abort。
// 🔴 硬防線不是省流量：確保這份驗收**結構上碰不到任何正式後端**。
// 🔴 比對解析後的 hostname，不是整條 URL 的 regex（後者會被 query string 命中）。
const ALLOW_HOSTS = new Set(['127.0.0.1', 'localhost', 'cdn.tailwindcss.com', 'unpkg.com']);
const isAllowed = (raw) => {
    try {
        const u = new URL(raw);
        if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
        return ALLOW_HOSTS.has(u.hostname);
    } catch {
        return false; // 解析不了就不放行
    }
};

// 既有照片刻意指向**本機**（會 404，但那不影響斷言 —— 我們看的是 <img src>）。
// 🔴 不可以用真實的 https 圖床網址：那會被上面那道白名單擋下來，
//    於是 E10「沒有非白名單請求」會紅，而紅的原因是我自己的假件，不是產品。
const IMG_A = `${BASE}/__e2e_img/existing-a.png`;
const IMG_B = `${BASE}/__e2e_img/existing-b.png`;

const HOST = 'e2e-harness-user';   // 與 harness 裡那個 fakeUser.userId 同一個值

/** 有完整宣告的團局：七個選項全中、手填兩項、規則兩條、限制一條、照片兩張。 */
const FEATURES_FULL = [
    '無菸', '汽車停車位', '有電梯', '電動桌:商密特 E500', '麻將館', '快手',
    '近捷運', '有冷氣',
];
const RULES_FULL = ['不打請提前告知場主', '禁止代打'];
const RESTRICTIONS_FULL = ['牌品不佳者勿入'];

const baseGame = (over) => ({
    gameId: 'e2e-game-0001',
    hostUserId: HOST,
    status: 'recruiting',
    title: 'E2E 測試團局',
    placeName: '測試場地',
    venueFeatures: [...FEATURES_FULL],
    gameInfo: { rules: [...RULES_FULL] },
    restrictions: [...RESTRICTIONS_FULL],
    images: [IMG_A, IMG_B],
    ...over,
});

/** gameId → 這一次 `/game-detail` 要回什麼。`null` ＝ 回 `success:false`（找不到）。 */
const FIXTURES = {
    'e2e-game-0001': baseGame({}),
    'e2e-game-edit': baseGame({ gameId: 'e2e-game-edit' }),
    // 舊局：跳過過第二段，一項都沒宣告過 ⇒ 打開是空的，三個 (必填) 都要先選。
    'e2e-game-blank': baseGame({
        gameId: 'e2e-game-blank', venueFeatures: [], gameInfo: { rules: [] },
        restrictions: [], images: [],
    }),
    'e2e-game-other': baseGame({ gameId: 'e2e-game-other', hostUserId: 'somebody-else' }),
    'e2e-game-cancelled': baseGame({ gameId: 'e2e-game-cancelled', status: 'cancelled' }),
    'e2e-game-missing': null,
};

// 🔴 「應該跑幾條」的宣告，不是計數器 —— 少跑了才看得出來（中途 abort 會少）。
const TOTAL_TESTS = 10;
const results = [];
class Failed extends Error {}
const record = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`);
};
const ok = (name, pass, detail) => {
    record(name, pass, detail);
    // 失敗就中止：E1～E5 是一條接一條推進同一個頁面狀態的，
    // 前面紅了之後的 locator 會 timeout，而那個例外會把「抓到回歸」講成「設備故障」。
    if (!pass) throw new Failed(name);
};

/** 集合相等（順序不算）—— `buildVenueFeatures` 釘的就是集合，不是逐位。 */
const sameSet = (a, b) => {
    const A = new Set(a || []), B = new Set(b || []);
    if (A.size !== B.size) return false;
    for (const x of A) if (!B.has(x)) return false;
    return true;
};
const sameList = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });

    // 🔴 `blocked` 由**全部**頁面共用（E10 宣稱的是「全部頁面」，不是「最後那一頁」）。
    const blocked = [];
    const errs = [];

    const isGameDetail = (u) => /\/game-detail(\?|$)/.test(u);
    const isUpdateGame = (u) => /\/update-game(\?|$)/.test(u);

    /**
     * 🔴 只註冊**一個** route handler：Playwright 多個 handler 是後註冊者先跑，
     *    而沒有 continue/abort/fulfill 的那個會讓請求整個掛住。
     * 🔴 `/game-detail` 的回應**照請求 body 裡的 gameId 查表**，不是回固定一份 ——
     *    這樣「頁面有沒有把網址上的 id 傳下去」才是可觀測的（回固定一份的話，
     *    傳錯 id 也照樣拿到資料，E7／E8／E9 三條會一起變成恆綠）。
     */
    const guard = (p, opts = {}) => p.route('**/*', (r) => {
        const u = r.request().url();
        if (isGameDetail(u)) {
            let reqId = null;
            try { reqId = (JSON.parse(r.request().postData() || '{}') || {}).gameId; } catch (_) {}
            if (opts.detailIds) opts.detailIds.push(reqId);
            const game = Object.prototype.hasOwnProperty.call(FIXTURES, reqId) ? FIXTURES[reqId] : null;
            if (!game) {
                return r.fulfill({
                    status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: false, error: 'game not found' }),
                });
            }
            return r.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { game, registrations: [] } }),
            });
        }
        if (isUpdateGame(u)) {
            let body = null;
            try { body = JSON.parse(r.request().postData() || 'null'); } catch (_) { body = r.request().postData(); }
            const entry = { url: u, body };
            // 🔴 每頁自己一份：拿整趟共用的累加器當「這一頁送了幾次」會隨測試順序漂掉。
            if (opts.updates) opts.updates.push(entry);
            return r.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { message: 'ok' } }),
            });
        }
        if (isAllowed(u)) return r.continue();
        blocked.push(u);
        return r.abort();
    });

    /** 開一頁 harness，指定要編輯哪個團局。回傳 page 與它自己的兩個累加器。 */
    const openPage = async (gameId) => {
        const updates = [];
        const detailIds = [];
        const p = await ctx.newPage();
        p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
        p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
        await guard(p, { updates, detailIds });
        await p.goto(`${URL_HARNESS}?gameId=${encodeURIComponent(gameId)}`, { waitUntil: 'domcontentloaded' });
        return { p, updates, detailIds };
    };

    const appears = (loc, timeout = 20000) =>
        loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
    /**
     * 🔴 閂住式觀察：toast 3 秒後自己消失 ⇒ 它是**瞬態**訊號，
     *    「輪詢時剛好沒看到」與「根本沒出現」在結果上逐字相同。
     *    ⇒ 在點下去之前先掛 MutationObserver，出現過就閂住。
     */
    const watchText = (p, text) => p.evaluate((t) => {
        const w = window;
        w.__seen = w.__seen || {};
        if (w.__obs && w.__obs[t]) w.__obs[t].disconnect();
        w.__obs = w.__obs || {};
        w.__seen[t] = false;
        const check = () => { if (document.body.innerText.includes(t)) w.__seen[t] = true; };
        check();
        const obs = new MutationObserver(check);
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        w.__obs[t] = obs;
    }, text);
    const sawText = (p, text) => p.evaluate((t) => !!(window.__seen && window.__seen[t]), text);

    /**
     * 某顆選項按鈕現在是不是「選中」（選中態＝深底 `bg-neutral-900`）。
     * 🔴 找不到那顆按鈕時回字串 `'無此按鈕'` 而**不是** `false`：
     *    兩者都會讓斷言紅，但紅的原因完全不同（選擇器打錯 vs 沒有還原），
     *    而 `false` 會把前者講成後者 —— 第一版就是這樣，害我差點以為
     *    parking 沒還原，其實只是按鈕上寫的是「汽車」不是「汽車停車位」。
     */
    const picked = async (p, name) => {
        const btn = p.getByRole('button', { name, exact: true }).first();
        if (await btn.count() === 0) return '無此按鈕';
        return /bg-neutral-900/.test(await btn.evaluate((el) => el.className));
    };
    /** 某個清單欄位現在的每一格文字（依 placeholder 定位）。 */
    const listValues = (p, placeholder) =>
        p.getByPlaceholder(placeholder).evaluateAll((els) => els.map((e) => e.value));
    /**
     * 型號輸入框的值。
     * 🔴 它**只在麻將桌選了「電動桌」時才掛出來** ⇒ 直接 `inputValue()` 在
     *    「選項沒還原」的情況下會 timeout 拋例外，而那個例外會讓整支變成
     *    rc=2「腳本自己爆了」—— **把一次真的抓到的回歸講成設備故障**。
     *    突變 M2（`parseVenueFeatures([])`，＝七個選項一個都沒還原）第一版就是這樣收場的：
     *    rc=2、一條紅的都沒有，看起來像我的腳本壞了。
     *    ⇒ 沒掛出來時回 `'無此欄位'`，讓 E1 正常地紅。
     */
    const modelValue = async (p) => {
        const inp = p.getByPlaceholder('手動輸入型號 (例如：商密特 E500)');
        if (await inp.count() === 0) return '無此欄位';
        return inp.inputValue();
    };
    const saveBtn = (p) => p.getByRole('button', { name: '儲存補充設定' });
    const photoSrcs = (p) =>
        p.locator('img[alt="Preview"]').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
    const shot = (p, n) => p.screenshot({ path: path.join(SHOT_DIR, n) });

    let aborted = null;
    let reloadedNote = '';
    try {
    // ── E1（承重）：載入既有團局 ⇒ 七個選項、手填清單、規則、限制、照片全部還原回 UI
    const { p: page, updates, detailIds } = await openPage('e2e-game-0001');
    let loads = 0;
    page.on('load', () => { loads += 1; });
    await page.waitForSelector('text=環境設施設定', { timeout: 60000 });
    const loadsAfterGoto = loads;

    const e1 = {
        smoking: await picked(page, '無菸'),
        // ⚠️ 按鈕上印的是「汽車」，存進 `venueFeatures` 的是「汽車停車位」——
        //    畫面文字與資料值不同的只有車位這一組（見 CreateGroupStage2 的 fullOpt）。
        parking: await picked(page, '汽車'),
        elevator: await picked(page, '有電梯'),
        table: await picked(page, '電動桌'),
        venueType: await picked(page, '麻將館'),
        skill: await picked(page, '快手'),
        model: await modelValue(page),
        features: await listValues(page, '例如：提供飲料、有冷氣'),
        rules: await listValues(page, '例如：不打請提前告知場主'),
        restrictions: await listValues(page, '例如：牌品不佳者勿入'),
        photos: await photoSrcs(page),
    };
    ok('E1 載入既有團局 ⇒ 七個選項／手填特色／規則／限制／照片全部還原回 UI（不還原＝按一次儲存就整批洗掉）',
        e1.smoking === true && e1.parking === true && e1.elevator === true
        && e1.table === true && e1.venueType === true && e1.skill === true
        && e1.model === '商密特 E500'
        && sameList(e1.features, ['近捷運', '有冷氣'])
        && sameList(e1.rules, RULES_FULL)
        && sameList(e1.restrictions, RESTRICTIONS_FULL)
        && sameList(e1.photos, [IMG_A, IMG_B]),
        `無菸=${e1.smoking} 汽車停車位=${e1.parking} 有電梯=${e1.elevator} 電動桌=${e1.table}`
        + ` 麻將館=${e1.venueType} 快手=${e1.skill} 型號="${e1.model}"`
        + ` 特色=${JSON.stringify(e1.features)} 規則=${JSON.stringify(e1.rules)}`
        + ` 限制=${JSON.stringify(e1.restrictions)} 照片=${e1.photos.length}`);
    await shot(page, '01-loaded.png');

    // ── E2（正控）：送出之前一次 update 都還沒送。
    //    少了它，E3 的「恰好一次」有可能只是「載入時就送過了」的巧合。
    ok('E2 送出前：一次 update 都還沒送（正控 —— 少了它，E3 的「恰好一次」可能是載入時送的）',
        updates.length === 0 && sameList(detailIds, ['e2e-game-0001']),
        `送出前 update 次數=${updates.length} 這一頁要過的 game-detail=${JSON.stringify(detailIds)}`);

    // ── E3（承重）：一個字都不改就按儲存 ⇒ 恰好一次 update-game，
    //    而且四個欄位的內容與 DB 那一列**相同**（沒有被洗掉）。
    await saveBtn(page).click();
    await appears(page.locator('text=補充設定已更新'), 20000);
    const e3 = updates[0] && updates[0].body;
    ok('E3 不改任何東西直接儲存 ⇒ 恰好一次 update-game，四個欄位與既有宣告相同（＝沒有被整欄覆寫洗掉）',
        updates.length === 1 && e3 && e3.gameId === 'e2e-game-0001'
        && sameSet(e3.features, FEATURES_FULL)
        && sameList(e3.rules, RULES_FULL)
        && sameList(e3.restrictions, RESTRICTIONS_FULL)
        && sameList(e3.images, [IMG_A, IMG_B]),
        `update 次數=${updates.length}（應為 1） gameId=${e3 && e3.gameId}`
        + ` features=${JSON.stringify(e3 && e3.features)}`
        + ` rules=${JSON.stringify(e3 && e3.rules)}`
        + ` restrictions=${JSON.stringify(e3 && e3.restrictions)}`
        + ` images=${JSON.stringify(e3 && e3.images)}`);

    // ── E4：存完真的離開這一頁（導向 `/event/:id`）。
    //    harness 有一條 `/event/:id` 路由當儀器 —— 少了它，「導對了」與「頁面炸了」
    //    在畫面上都是一片空白。
    const e4 = await appears(page.locator('[data-testid="event-page"]'), 8000);
    const e4nowhere = await page.locator('[data-testid="nowhere"]').count();
    ok('E4 儲存成功後導向 /event/:id（不是留在原地、也不是掉進沒有的路由）',
        e4 === true && e4nowhere === 0,
        `event 頁出現=${e4} 掉進 catch-all=${e4nowhere}`);
    await shot(page, '02-saved.png');

    // ── E5（E3 的反面誘餌）：改一個選項＋刪一張照片再儲存 ⇒ 送出的是**畫面當下的值**。
    //    🔴 少了這條，一個「把載入到的 venueFeatures 原樣回送」的實作能通過 E3。
    const { p: p2, updates: up2 } = await openPage('e2e-game-edit');
    await p2.waitForSelector('text=環境設施設定', { timeout: 60000 });
    await p2.getByRole('button', { name: '雀菸', exact: true }).first().click();
    await p2.locator('img[alt="Preview"]').first()
        .locator('xpath=../button').click();          // 第一張照片的移除鈕
    const afterRemove = await photoSrcs(p2);
    await saveBtn(p2).click();
    await appears(p2.locator('text=補充設定已更新'), 20000);
    const e5 = up2[0] && up2[0].body;
    ok('E5 改了選項／刪了照片再儲存 ⇒ 送出的是畫面當下的值（新的在、舊的不在），不是把載入到的那份原樣回送',
        up2.length === 1 && e5
        && sameSet(e5.features, ['雀菸', '汽車停車位', '有電梯', '電動桌:商密特 E500', '麻將館', '快手', '近捷運', '有冷氣'])
        && sameList(e5.images, [IMG_B]),
        `update 次數=${up2.length}（應為 1） 刪完畫面上剩=${JSON.stringify(afterRemove)}`
        + ` features=${JSON.stringify(e5 && e5.features)}（應含雀菸、不含無菸）`
        + ` images=${JSON.stringify(e5 && e5.images)}`);
    await shot(p2, '03-edited.png');

    // ── E6：舊局一項都沒宣告過 ⇒ 三個 (必填) 擋下來，而且**一次 update 都不送**。
    //    🔴 不可以拿預設值替主揪宣告（那正是 A3-j 修掉的缺陷）。
    const { p: p3, updates: up3 } = await openPage('e2e-game-blank');
    await p3.waitForSelector('text=環境設施設定', { timeout: 60000 });
    const e6blank = await picked(p3, '無菸');
    await watchText(p3, '請選擇菸選項');
    await saveBtn(p3).click();
    const e6toast = await (async () => {
        for (let i = 0; i < 30; i++) {
            if (await sawText(p3, '請選擇菸選項')) return true;
            await p3.waitForTimeout(100);
        }
        return false;
    })();
    await p3.waitForTimeout(1500);   // 有界的觀察窗，寫進 detail 不含糊
    ok('E6 舊局一項都沒宣告過 ⇒ 打開是空的（沒有替他選預設值），按儲存被擋下且不送 update',
        e6blank === false && e6toast === true && up3.length === 0,
        `打開時「無菸」已選中=${e6blank}（應為 false） 提示出現過=${e6toast}`
        + ` update 次數=${up3.length}（觀察窗 1.5s）`);
    await shot(p3, '04-blank-blocked.png');

    // ── E7：不是主揪 ⇒ 早一步講明，而且**表單根本不掛出來**（不要讓人白填一頁）。
    //    ⚠️ 這一層只是 UX，真正擋得住的是後端 —— 這條測的是前者。
    const { p: p4 } = await openPage('e2e-game-other');
    const e7msg = await appears(p4.locator('text=只有主揪可以修改團局'), 20000);
    const e7form = await saveBtn(p4).count();
    ok('E7 不是主揪 ⇒ 顯示「只有主揪可以修改團局」且不掛出表單（前端這層只是 UX，擋得住的是後端）',
        e7msg === true && e7form === 0,
        `訊息出現=${e7msg} 儲存鈕=${e7form}（應為 0）`);

    // ── E8：已取消的團局不能再改。
    const { p: p5 } = await openPage('e2e-game-cancelled');
    const e8msg = await appears(p5.locator('text=此團局已取消'), 20000);
    const e8form = await saveBtn(p5).count();
    ok('E8 已取消的團局 ⇒ 顯示「此團局已取消，不能再修改」且不掛出表單',
        e8msg === true && e8form === 0,
        `訊息出現=${e8msg} 儲存鈕=${e8form}（應為 0）`);

    // ── E9：載入失敗 ⇒ 講出來，不是一片空白（那正是這一頁被做出來之前的症狀）。
    const { p: p6, detailIds: d6 } = await openPage('e2e-game-missing');
    const e9msg = await appears(p6.locator('text=找不到這個團局'), 20000);
    ok('E9 載入不到團局 ⇒ 明講「找不到這個團局，或是載入失敗」（不是一片空白、不報錯）',
        e9msg === true && sameList(d6, ['e2e-game-missing']),
        `訊息出現=${e9msg} 這一頁要過的 game-detail=${JSON.stringify(d6)}`);

    if (loads > loadsAfterGoto) reloadedNote = `主頁面被重載 ${loads - loadsAfterGoto} 次`;
    } catch (e) {
        aborted = e;
    }

    // ── E10：全部頁面都不准發出非白名單請求。
    //    🔴 放在 try 外面**一定要跑**：它是安全性質，不是流程的一步。
    //    ⚠️ 措辭要精確：白名單含兩個 CDN（`index.html` 本來就會抓），
    //       所以這不是「完全沒有對外連線」，是「沒有白名單以外的，特別是沒有正式後端」。
    const external = [...new Set(blocked)];
    record(`E10 全部頁面都沒有非白名單請求（白名單＝本機＋${[...ALLOW_HOSTS].filter((h) => !/^(127\.0\.0\.1|localhost)$/.test(h)).join('／')}；正式後端不在其中）`,
        external.length === 0,
        external.length === 0 ? '非白名單請求 0 筆（E1～E9 各自的頁面合計）' : `被擋 ${external.length} 個：${external.slice(0, 5).join(' , ')}`);

    console.log('\n--- 頁面錯誤 ---');
    console.log(errs.length ? errs.join('\n') : '(無)');
    console.log(`\n截圖：${SHOT_DIR}`);
    console.log('⚠️ 涵蓋範圍：只有 EditGroupExtras 這個元件。`App.tsx` 的路由接線與登入閘不在內'
        + '（那由 appRoutes 的單元測試撐著）；後端的權限／狀態檢查不在內（這裡一律回成功）。');

    await browser.close();

    if (reloadedNote) {
        console.log(`\n🔴 rc=3 量不到：${reloadedNote}（dev server 送的 full reload）。上面的紅綠都不可信，請重跑。`);
        return 3;
    }

    const failed = results.filter((r) => !r.pass).length;
    const notRun = TOTAL_TESTS - results.length;

    // 🔴 例外的歸屬：已經有一條紅了 ⇒ 這個例外是**後果**，算 rc=1；
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
