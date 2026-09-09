// e2e/venue.e2e.cjs — 場地頁／場地列表的瀏覽器實跑驗收（[B1-j6]）
//
// 跑法：`E2E_HARNESS=e2e/venue.harness.tsx E2E_SPEC=venue.e2e.cjs npm run e2e`
//
// 🔴 這支存在的理由，一句話：**純函式的測試對「頁面有沒有用它們」零鑑別力。**
//    `utils/venueView.ts` 有 33 條測試 ＋ 25 發突變，它們證明 `readAddressState`
//    把五種情況分得開；但 `VenueDetail.tsx` 大可自己寫一行 `if (!v.exactAddress)`，
//    那 33 條照樣全綠，而使用者看到的是五態塌成兩態 —— 正是這一塊的賣點失效。
//    ⇒ V2／V3 這一對是本支的承重：同樣是「沒有地址可看」，兩者必須說不同的話。
//
// 🔴 rc 的意思（沿用既有兩支的約定）：
//    0 = 全部通過   1 = 有測試沒過   2 = 腳本自己爆了
//    3 = 量不到（測試中途頁面被重載）  4 = 沒有儀器（由 run.sh 判）

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.E2E_PORT || '5199';
const BASE = `http://127.0.0.1:${PORT}`;
const API_BASE = process.env.E2E_API_BASE || `${BASE}/__e2e_no_backend`;
const HARNESS_URL = `${BASE}${process.env.E2E_HARNESS_URL || '/e2e/_generated.venue.harness.html'}`;
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(os.tmpdir(), 'b1j-shots');

const ALLOW_HOSTS = new Set(['127.0.0.1', 'localhost', 'cdn.tailwindcss.com', 'unpkg.com']);
const isAllowed = (raw) => {
    try {
        const u = new URL(raw);
        if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
        return ALLOW_HOSTS.has(u.hostname);
    } catch { return false; }
};

const HALL_ADDR = '台北市大安區實跑路 1 號 5 樓';
const HOME_PHONE = '0912-000-111';
const HALL_PHONE = '02-1234-5678';

/**
 * venueId → `POST /venue-detail` 要回的 `data`。
 *
 * 🔴 **照請求 body 裡的 venueId 查表**，不是回固定一份 —— 回固定一份的話，
 *    「頁面有沒有把網址上的 id 傳下去」就不可觀測，而 V1～V4 會一起變成恆綠。
 * 🔴 `V_E2E_HOME_DENY` 那一筆**整個沒有 `exactAddress` 這個鍵**（不是空字串），
 *    因為後端的合約就是「鍵不存在＝沒授權」。寫成 `exactAddress: undefined`
 *    會被 JSON.stringify 丟掉，剛好也對，但那是巧合不是宣告 ⇒ 明確地不寫。
 */
const DETAIL_FIXTURES = {
    V_E2E_HALL: {
        venueId: 'V_E2E_HALL', type: 'hall', name: '實跑麻將館',
        phone: HALL_PHONE, businessHours: '每日 12:00–02:00',
        approxLocation: { latitude: 25.03, longitude: 121.56, placeName: '大安區' },
        features: ['電動桌', '有電梯'], ownerId: 'U_HALL', certifiedRefereeCount: 0,
        isDojo: false, ratingPositive: 9, ratingCount: 10,
        createdAt: 1, updatedAt: 1, status: 'active',
        exactAddress: HALL_ADDR,
    },
    // 自建場・沒授權：沒有 exactAddress 鍵。
    // 🔴 **phone／ownerId 有值是刻意的手寫假件，不是現況**（訂正於 [B5-b]）：
    //    2026-09-09 上午後端真的會回它們，同日下午改成白名單型別
    //    `shared.VenueDetailView` 之後**不再回**（phone 只對 hall/event，
    //    ownerId 整個換成 isOwner）。⇒ V4 現在驗的是**縱深**：
    //    「就算有一天又送來了，畫面也不畫」。
    // ⚠️ 這個區別要寫出來 —— 否則下一個人會把這份假件讀成「後端目前的回應長這樣」。
    V_E2E_HOME_DENY: {
        venueId: 'V_E2E_HOME_DENY', type: 'home', name: '小明家',
        phone: HOME_PHONE,
        approxLocation: { latitude: 25.04, longitude: 121.55 },
        ownerId: 'U_HOME', certifiedRefereeCount: 0, isDojo: false,
        ratingPositive: 0, ratingCount: 0,
        createdAt: 1, updatedAt: 1, status: 'active',
    },
    // 自建場・**授權了但地址是空字串**。鍵在、值空 ⇒ 「主揪還沒填」，不是「被擋」。
    V_E2E_HOME_EMPTY: {
        venueId: 'V_E2E_HOME_EMPTY', type: 'home', name: '阿華家',
        approxLocation: { latitude: 25.05, longitude: 121.53 },
        ownerId: 'U_HOME2', certifiedRefereeCount: 0, isDojo: false,
        ratingPositive: 0, ratingCount: 0,
        createdAt: 1, updatedAt: 1, status: 'active',
        exactAddress: '',
    },
};

const card = (id, over) => ({
    venueId: id, type: 'hall', name: id,
    approxLocation: { latitude: 25, longitude: 121, placeName: '測試區' },
    isDojo: false, ratingPositive: 0, ratingCount: 0, ...over,
});

/**
 * 列表情境。`pages` 是「第 N 次呼叫回什麼」。
 *
 * 🔴 `emptyFirstPage` 的第一頁是 **0 筆但有 nextToken** —— 那正是 §5.3 點名的坑
 *    （DDB 的 Limit 限制掃描筆數不是回傳筆數，一整頁被 IsPubliclyListable 篩掉
 *    是常態）。頁面若用 `venues.length === 0` 當終止條件就會停在這裡，
 *    畫面顯示「目前還沒有公開的場地」—— 完全合理的樣子。
 */
const LIST_SCENARIOS = {
    emptyFirstPage: [
        { venues: [], nextToken: 'tok-1' },
        { venues: [card('V_PAGE2_A'), card('V_PAGE2_B')] },
    ],
    trulyEmpty: [{ venues: [] }],
    rated: [{ venues: [card('V_RATED', { ratingPositive: 9, ratingCount: 10 }), card('V_NEW')] }],
};

// 🔴 宣告「應該跑幾條」，不是計數器 —— 少跑了才看得出來（中途 abort 會少）。
// ⚠️ 第一次跑時這裡寫 8 而實際 record 了 10（V7a／V4a 是後來補的反控），
//    輸出是「10/8 通過（-2 條未跑）」而 rc=1 ⇒ **多跑也要紅**，不是只有少跑。
//    留著這句是因為「數字寫死在宣告裡」本來就會過期，而它至少要吵。
const TOTAL_TESTS = 10;
const results = [];
class Failed extends Error {}
const record = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`);
};
const ok = (name, pass, detail) => {
    record(name, pass, detail);
    if (!pass) throw new Failed(name);
};

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });

    const blocked = [];
    const errs = [];
    let reloadedNote = '';
    let listCalls = 0;
    let listScenario = 'trulyEmpty';
    let sentVenueIds = [];

    const isDetail = (u) => /\/venue-detail(\?|$)/.test(u);
    const isList = (u) => /\/venue-list(\?|$)/.test(u);

    // 🔴 只註冊**一個** route handler：Playwright 多個 handler 是後註冊者先跑，
    //    而沒有 continue/abort/fulfill 的那個會讓請求整個掛住。
    const guard = (p) => p.route('**/*', (r) => {
        const u = r.request().url();
        if (isDetail(u)) {
            let body = {};
            try { body = JSON.parse(r.request().postData() || '{}'); } catch { /* 保持 {} */ }
            sentVenueIds.push(body.venueId);
            const data = DETAIL_FIXTURES[body.venueId];
            return r.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify(data ? { success: true, data } : { success: false, error: '找不到這個場地' }),
            });
        }
        if (isList(u)) {
            const pages = LIST_SCENARIOS[listScenario];
            const page = pages[Math.min(listCalls, pages.length - 1)];
            listCalls += 1;
            return r.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ success: true, ...page }),
            });
        }
        if (isAllowed(u)) return r.continue();
        blocked.push(u);
        return r.abort();
    });

    const openPage = async (query) => {
        const p = await ctx.newPage();
        p.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
        p.on('console', (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text()}`); });
        p.on('framenavigated', (f) => {
            if (f === p.mainFrame() && !f.url().startsWith(HARNESS_URL.split('?')[0])) {
                reloadedNote = `頁面被導到 ${f.url()}`;
            }
        });
        await guard(p);
        await p.goto(`${HARNESS_URL}?${query}`, { waitUntil: 'domcontentloaded' });
        return p;
    };

    const bodyText = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

    let aborted = null;
    try {
        // ── V1 麻將館：地址畫得出來（這是「有授權」那一格的正控）
        const p1 = await openPage('page=detail&venueId=V_E2E_HALL');
        await p1.getByText('實跑麻將館').waitFor({ timeout: 10000 });
        const t1 = await bodyText(p1);
        await p1.screenshot({ path: path.join(SHOT_DIR, 'v1-hall.png'), fullPage: true });
        ok('V1 麻將館的精確地址畫得出來，且送出的 venueId 就是網址上那個',
            t1.includes(HALL_ADDR) && sentVenueIds[0] === 'V_E2E_HALL',
            `地址在畫面上=${t1.includes(HALL_ADDR)}／送出的 id=${sentVenueIds[0]}`);

        // ── V7a 評價：9/10 要畫成 90% ・ 10 則（§7 比例與則數一起）
        ok('V7a 有評價時比例與則數一起顯示（§7）',
            t1.includes('90%') && t1.includes('10 則'),
            `畫面片段：${(t1.match(/\d+% ・ \d+ 則/) || ['(找不到)'])[0]}`);

        // ── V4a 麻將館的電話**要**顯示（V4 的反控：不是一律不顯示電話）
        ok('V4a 麻將館的電話有畫出來（V4 的反控）',
            t1.includes(HALL_PHONE), `畫面含 ${HALL_PHONE}=${t1.includes(HALL_PHONE)}`);

        // ── V2 自建場・沒授權
        const p2 = await openPage('page=detail&venueId=V_E2E_HOME_DENY');
        await p2.getByText('小明家').waitFor({ timeout: 10000 });
        const t2 = await bodyText(p2);
        await p2.screenshot({ path: path.join(SHOT_DIR, 'v2-home-deny.png'), fullPage: true });
        const saysWaitApproval = t2.includes('核准你的報名後才會顯示');
        ok('V2 自建場沒授權時說「核准報名後才顯示」，而且沒有「尚未填寫」那句',
            saysWaitApproval && !t2.includes('還沒有填寫詳細地址'),
            `等核准=${saysWaitApproval}／誤說沒填=${t2.includes('還沒有填寫詳細地址')}`);

        // ── V4 自建場的電話**不**顯示（後端會回，畫面不畫）
        ok('V4 自建場的電話沒有畫出來（縱深：後端 [B5-b] 之後已不回它，這條驗「就算送來也不畫」）',
            !t2.includes(HOME_PHONE), `畫面含 ${HOME_PHONE}=${t2.includes(HOME_PHONE)}`);

        // ── V7b 零則評價：畫「尚無評價」，畫面上不可以有 0%
        ok('V7b 零則評價畫「尚無評價」，畫面上沒有 0%（§7：0% 與差評滿貫逐字相同）',
            t2.includes('尚無評價') && !/(^|[^0-9])0%/.test(t2),
            `尚無評價=${t2.includes('尚無評價')}／出現 0%=${/(^|[^0-9])0%/.test(t2)}`);

        // ── V3 🔴 本支的承重：授權了但地址是空字串 ⇒ 說的是**另一句話**
        const p3 = await openPage('page=detail&venueId=V_E2E_HOME_EMPTY');
        await p3.getByText('阿華家').waitFor({ timeout: 10000 });
        const t3 = await bodyText(p3);
        await p3.screenshot({ path: path.join(SHOT_DIR, 'v3-home-empty.png'), fullPage: true });
        ok('V3 🔴 授權了但地址空 ⇒ 說「還沒有填寫詳細地址」，**不是** V2 那句',
            t3.includes('還沒有填寫詳細地址') && !t3.includes('核准你的報名後才會顯示'),
            `說沒填=${t3.includes('還沒有填寫詳細地址')}／誤說等核准=${t3.includes('核准你的報名後才會顯示')}`);

        // ── V5 🔴 第一頁 0 筆但有 nextToken ⇒ 要繼續翻，不是停在「沒有場地」
        listCalls = 0; listScenario = 'emptyFirstPage';
        const p5 = await openPage('page=list');
        await p5.getByText('V_PAGE2_A').waitFor({ timeout: 10000 });
        const t5 = await bodyText(p5);
        await p5.screenshot({ path: path.join(SHOT_DIR, 'v5-list-page2.png'), fullPage: true });
        ok('V5 🔴 第一頁 0 筆但有 nextToken ⇒ 繼續翻並畫出第二頁（§5.3 點名的坑）',
            t5.includes('V_PAGE2_A') && t5.includes('V_PAGE2_B') && listCalls >= 2
            && !t5.includes('目前還沒有公開的場地'),
            `打了 ${listCalls} 次／誤報空狀態=${t5.includes('目前還沒有公開的場地')}`);

        // ── V6 真的沒有東西時才說空（V5 的反控）
        listCalls = 0; listScenario = 'trulyEmpty';
        const p6 = await openPage('page=list');
        await p6.getByText('目前還沒有公開的場地').waitFor({ timeout: 10000 });
        const t6 = await bodyText(p6);
        await p6.screenshot({ path: path.join(SHOT_DIR, 'v6-list-empty.png'), fullPage: true });
        ok('V6 沒有 nextToken 且 0 筆 ⇒ 才說「目前還沒有公開的場地」，而且只打一次',
            t6.includes('目前還沒有公開的場地') && listCalls === 1,
            `打了 ${listCalls} 次`);
    } catch (e) {
        aborted = e;
    }

    // ── V8 白名單
    const external = [...new Set(blocked)];
    record(`V8 全部頁面都沒有非白名單請求（白名單＝本機＋${[...ALLOW_HOSTS].filter((h) => !/^(127\.0\.0\.1|localhost)$/.test(h)).join('／')}；正式後端不在其中）`,
        external.length === 0,
        external.length === 0 ? '非白名單請求 0 筆' : `被擋 ${external.length} 個：${external.slice(0, 5).join(' , ')}`);

    console.log('\n--- 頁面錯誤 ---');
    console.log(errs.length ? errs.join('\n') : '(無)');
    console.log(`\n截圖：${SHOT_DIR}`);
    console.log('⚠️ 涵蓋範圍：只有 VenueDetail／VenueList 兩個元件。App.tsx 的路由接線與登入閘不在內'
        + '（由 appRoutes.test.ts 撐著）；**後端的授權判斷完全不在內** —— 這裡回什麼是我編的，'
        + '後端那半由線上矩陣 8/8 撐著（設計冊 §5.3）。兩層不可互相冒充。'
        + ' CreateVenue 不在內（它要開 MapPicker，會真的抓圖磚）。');

    await browser.close();

    if (reloadedNote) {
        console.log(`\n🔴 rc=3 量不到：${reloadedNote}。上面的紅綠都不可信，請重跑。`);
        return 3;
    }
    const failed = results.filter((r) => !r.pass).length;
    const notRun = TOTAL_TESTS - results.length;
    if (notRun < 0) {
        console.log(`\n🔴 跑了 ${results.length} 條，而宣告是 ${TOTAL_TESTS} 條 —— 宣告過期了，請更新 TOTAL_TESTS。`);
    }
    if (aborted && !(aborted instanceof Failed) && failed === 0) {
        console.error('\nSCRIPT ERROR:', aborted);
        return 2;
    }
    console.log(`\n=== ${results.length - failed}/${TOTAL_TESTS} 通過${notRun ? `（${notRun} 條未跑：前面已經紅了，再往下的狀態不可信）` : ''} ===`);
    if (aborted && !(aborted instanceof Failed)) {
        console.log(`   （中止時的例外：${String(aborted).slice(0, 200)}）`);
    }
    return failed || notRun !== 0 ? 1 : 0;
}

main().then((rc) => process.exit(rc)).catch((e) => {
    console.error('SCRIPT ERROR:', e);
    process.exit(2);
});
