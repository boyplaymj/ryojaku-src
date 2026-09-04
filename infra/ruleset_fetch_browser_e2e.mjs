#!/usr/bin/env node
// ruleset_fetch_browser_e2e.mjs — D5-d 取表的**真瀏覽器**端到端（線上 stg）
//
// 用法：node infra/ruleset_fetch_browser_e2e.mjs
// 退出碼：0 = 宣稱成立；1 = 斷言失敗；2 = 前置/設備失敗（＝沒量到，別讀成通過）
//
// ── 這支在補的是哪一塊 ────────────────────────────────────────────
//
// D5-d 的單元測試（frontend/utils/rulesetSource.test.ts）打的是純邏輯，
// verify_ruleset_live.py 打的是真端點但**沒有瀏覽器**（它自己送 HTTP）。
// 中間那一段從來沒有任何一次量測碰過：**真的有人打開那一頁時，
// hooks/useRuleset.ts 會不會去抓、抓到之後會不會真的換表**。
// 設計冊 §D5-d 自己把它列成缺口（「hooks/ 的 React 接線沒有行為測試」）——
// 這支就是那一條。
//
// 🔴 **B7 是全套裡最強的一條**：攔截 /ruleset 回一份「平胡 7 台」的表，
//    然後在畫面上點「平胡」，看它顯示 7 台。
//    在那之前所有證據都停在「程式碼在」「端點通」；只有這一條回答
//    **「後台改家規，玩家看到的台數會不會跟著變」** —— 那是整個 D5 的目的。
//
// 🔴 **反控先行**：先停在首頁，確認沒有任何 /ruleset 請求。少了它，
//    「進頁才抓」與「每次載入都抓」在資料上逐字相同（都是「有請求」）。
//
// 🔴 404 與 502 兩條**處置相反**的判準，在這裡用 route 攔截真的走一遍。
//    那是 D5-d 最容易寫反的一行，而寫反了畫面上完全沒有徵兆。
//    攔截是**瀏覽器端**的，不碰後端、不產生任何線上資料。
//
// ⚠️ 對 stg 的唯一寫入：Users 表一列合成 userId（跑完刪，read-back 確認）。
//    不走 app-register ⇒ 不吃「每 IP 每小時 10 次」那個額度。

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

const SITE = process.env.E2E_SITE || 'https://ryojaku-stg.boyplaymj.com';
const REGION = 'ap-southeast-1';
const PREFIX = 'MahjongClubStg_';
const USERS = PREFIX + 'Users';
const SHIP_TABLE = process.env.SHIP_TABLE
  || '/opt/sml/ryojaku-src/frontend/engine/mahjong-tai/fan_table.json';
const SHOT_DIR = '/tmp/ryojaku-d5d-e2e';
const CACHE_KEY = 'mahjongclub_voice_tai_ruleset_v1';
// 抄自 frontend/constants.ts（這支跑在 infra，與前端是不同 build 體系）。
const KEYS = { JWT: 'mahjongclub_jwt_token', USER: 'mahjongclub_user_session', AUTH_TYPE: 'mahjongclub_auth_type' };

let fails = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const no = (m) => { fails++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`\n🔴 [設備] ${m}`); process.exit(2); };

function aws(args) {
  try { return { rc: 0, out: execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf8' }) }; }
  catch (e) { return { rc: 1, out: String(e.stderr ?? e) }; }
}

const b64 = (b) => Buffer.from(b).toString('base64url');
function signJwt(payload, secret) {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64(mac)}`;
}

const require_ = createRequire(import.meta.url);
// 🔴 找不到 playwright 時 rc=2 不是 rc=1：沒有瀏覽器＝沒量到，不是「量到失敗」。
let chromium, devices;
{
  const cands = [process.env.E2E_PW, 'playwright', '/opt/sml/.buildtmp/pw-runner/node_modules/playwright'].filter(Boolean);
  const errs = [];
  for (const c of cands) {
    try { ({ chromium, devices } = require_(c)); break; } catch (e) { errs.push(`${c}: ${e.message.split('\n')[0]}`); }
  }
  if (!chromium) die(`載不到 playwright，試過：\n    ${errs.join('\n    ')}`);
}

const main = async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const tag = Date.now();
  const uid = `D5DE2E-DELETEME-${tag}`;

  console.log('══ 前置 ══');
  const sec = aws(['ssm', 'get-parameter', '--name', '/ryojaku/stg/JWT_SECRET',
    '--with-decryption', '--query', 'Parameter.Value', '--output', 'text']);
  if (sec.rc !== 0) die(`讀不到 JWT_SECRET：${sec.out.slice(0, 200)}`);
  const secret = sec.out.trim();

  let ship;
  try { ship = JSON.parse(readFileSync(SHIP_TABLE, 'utf8')); }
  catch (e) { die(`讀不到出貨那份台數表：${e.message}`); }
  const shipVersion = ship?.meta?.version;
  // 定錨：B7 要靠「平胡本來是 2 台」。它變了的話期望值要跟著動，
  // 而**不是**把測試改綠 —— 所以在這裡先驗前提。
  const pinghu = (ship.fans || []).find((f) => f.id === 'pinghu');
  if (!pinghu) die('出貨那份表裡沒有 pinghu —— B7 的定錨消失了');
  if (pinghu.tai !== 2) die(`定錨前提不成立：平胡現在是 ${pinghu.tai} 台，不是 2 台`);
  console.log(`  出貨那份 version=${shipVersion}，平胡 ${pinghu.tai} 台`);

  const put = aws(['dynamodb', 'put-item', '--table-name', USERS, '--item',
    JSON.stringify({ userId: { S: uid }, displayName: { S: 'D5DE2E-DELETEME' } })]);
  if (put.rc !== 0) die(`建不出測試使用者：${put.out.slice(0, 200)}`);
  const token = signJwt({ userId: uid, email: 'd5de2e@example.com', exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
  console.log(`  測試使用者 ${uid}`);

  // 假的下發表：版本比 bundle 新、而且平胡改成 7 台。
  // 🔴 兩處都要改。只改版本的話「有沒有換表」在畫面上看不出來；
  //    只改台數的話「同版取 bundle」那條規則會（正確地）不換，於是這條會誤報失敗。
  const fakeFans = JSON.parse(JSON.stringify(ship.fans)).map(
    (f) => (f.id === 'pinghu' ? { ...f, tai: 7 } : f));
  const fakeWith = (version) => JSON.stringify({
    success: true, version,
    fans: fakeFans, combos: ship.combos ?? [], ignores: ship.ignores ?? [], config: ship.config ?? {},
  });
  const fakeBody = fakeWith('9.9.9');
  // B9 用：**同一份內容、同一個版本號**。它與 fakeBody 只差 version 一個欄位。
  const sameVersionBody = fakeWith(shipVersion);
  // B10 用：比 bundle 新、但比快取裡那份（9.9.9）舊，而且平胡是**第三個**值。
  // 三個值互不相同，畫面上就分得出「用快取」「用遠端」「用 bundle」。
  const midFans = JSON.parse(JSON.stringify(ship.fans)).map(
    (f) => (f.id === 'pinghu' ? { ...f, tai: 5 } : f));
  const midBody = JSON.stringify({
    success: true, version: '0.3.0',
    fans: midFans, combos: ship.combos ?? [], ignores: ship.ignores ?? [], config: ship.config ?? {},
  });

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  // 🔴 行動裝置模擬＋PWA standalone 兩個閘門都要墊，否則判台頁根本不會被渲染，
  //    而「沒去抓表」與「頁面沒被顯示」在所有讀數上逐字相同。
  //    （兩個坑都由 voice_tai_funnel_browser_e2e.mjs 先踩過，判準沿用。）
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(([k, tok, u]) => {
    localStorage.setItem(k.JWT, tok);
    localStorage.setItem(k.AUTH_TYPE, 'app');
    localStorage.setItem(k.USER, JSON.stringify(u));
    Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true });
  }, [KEYS, token, { userId: uid, displayName: 'D5DE2E' }]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });

  const gets = [];
  page.on('response', (r) => {
    if (r.request().method() === 'GET' && r.url().includes('/ruleset')) gets.push(r.status());
  });

  const readCache = () => page.evaluate((k) => localStorage.getItem(k), CACHE_KEY);
  const gotoTai = async () => {
    await page.evaluate(() => { window.location.hash = '#/training/voice-tai'; });
    await page.waitForTimeout(6000);
  };
  const readTotal = () => page.evaluate(() => {
    const big = [...document.querySelectorAll('div')].find(
      (d) => typeof d.className === 'string' && d.className.includes('text-[2.75rem]'));
    return big ? big.textContent.trim() : null;
  });

  try {
    console.log('\n══ B1 反控：停在首頁，不進判台頁 ══');
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOT_DIR}/1-home.png` });
    if (gets.length === 0) ok('首頁停留 3 秒：0 次 GET /ruleset（沒有「每次載入都抓」）');
    else no(`首頁就發了 ${gets.length} 次 GET /ruleset`);
    if ((await readCache()) === null) ok('首頁時快取那把鑰匙不存在（B4 的起點是乾淨的）');
    else no('首頁時快取就已經有東西 —— B4 會失去鑑別力');

    console.log('\n══ B2／B3／B4 正控：進判台頁（真的下發表）══');
    await gotoTai();
    await page.screenshot({ path: `${SHOT_DIR}/2-voice-tai.png`, fullPage: true });
    const body = await page.evaluate(() => document.body.innerText);
    // 🔴 判準字串是「語音**報**台」（TrainingVoiceTai.tsx 的 h1）。
    //    「語音判台」只出現在入口卡與文件裡 —— 產品裡兩個名字並存，
    //    而只有一個會出現在這一頁上（姊妹探針踩過）。
    if (body.includes('語音報台')) ok('B2 畫面畫得出來（React 真的跑了，不是只有 bundle 載進來）');
    else no(`B2 畫面上沒有「語音報台」。前 200 字：${JSON.stringify(body.slice(0, 200))}`);

    if (gets.length >= 1) ok(`B3 瀏覽器確實發了 ${gets.length} 次 GET /ruleset，狀態 ${JSON.stringify(gets)}`);
    else no('B3 瀏覽器沒有發出任何 GET /ruleset —— hooks/useRuleset.ts 沒有被掛上');
    if (gets.length && gets.every((s) => s === 200)) ok('B3b 每一次都是 200');
    else if (gets.length) no(`B3b 有非 200 的回應：${JSON.stringify(gets)}`);

    const cached = await readCache();
    if (!cached) {
      no('B4 快取沒被寫進去 —— applyFetch 的 store 那條沒接上');
    } else {
      let c = null;
      try { c = JSON.parse(cached); } catch { /* 下面會報 */ }
      if (!c) no('B4 快取寫進去了但 parse 不出來');
      else {
        const missing = ['version', 'fans', 'combos', 'ignores', 'config'].filter((k) => !(k in c));
        if (missing.length === 0) ok('B4 快取五鍵齊全');
        else no(`B4 快取缺鍵：${missing}`);
        if (c.version === shipVersion) ok(`B4b 快取的 version＝${c.version}（與出貨那份相同）`);
        else no(`B4b 快取的 version 是 ${c.version}，出貨那份是 ${shipVersion}`);
      }
    }

    const emptyTotal = await readTotal();
    if (emptyTotal === null) die('量不到畫面上的大數字 —— 選擇器過期了，這不是產品缺陷');
    if (emptyTotal === '0台') ok('B5 空白狀態仍是 0 台（換表這條路沒有把頁面弄壞）');
    else no(`B5 空白狀態顯示「${emptyTotal}」而不是「0台」`);

    console.log('\n══ B6 攔截：/ruleset 回 502 ⇒ 快取要保留（「沒問到」不是「沒有」）══');
    await ctx.route('**/ruleset', (route) => route.fulfill({
      status: 502, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'ruleset store unavailable' }),
    }));
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await gotoTai();
    const after502 = await readCache();
    if (after502) ok('B6 502 之後快取原封不動（沒有把一次後端故障讀成「後台撤掉了」）');
    else no('B6 502 之後快取被清掉了 —— 一次後端故障就會把所有人手上的下發表清光');
    const t502 = await readTotal();
    if (t502 === '0台') ok('B6b 502 之後頁面照常可用（退回手上那份，不是白畫面）');
    else no(`B6b 502 之後大數字是「${t502}」`);

    console.log('\n══ B7 攔截：回一份「平胡 7 台」的新表 ⇒ 畫面上的台數要跟著變 ══');
    await ctx.unroute('**/ruleset');
    await ctx.route('**/ruleset', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: fakeBody,
    }));
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await gotoTai();
    await page.screenshot({ path: `${SHOT_DIR}/3-fake-table.png`, fullPage: true });
    try {
      await page.locator('text=平胡').first().click({ timeout: 15000 });
      await page.waitForTimeout(1500);
      const t = await readTotal();
      // 🔴 這一條就是整個 D5 的目的。2 台＝還在用 bundle（沒換），7 台＝真的吃了下發的表。
      if (t === '7台') ok('B7 點「平胡」顯示 7 台 ⇒ 下發的表真的驅動了玩家看到的台數');
      else if (t === '2台') no('B7 顯示 2 台 —— 還在用 bundle 那份，下發沒有生效');
      else no(`B7 顯示「${t}」，既不是 7 台也不是 2 台`);
    } catch (e) {
      die(`點不到「平胡」那一格（${String(e.message).slice(0, 80)}）—— 設備問題，不是產品缺陷`);
    }
    await page.screenshot({ path: `${SHOT_DIR}/4-pinghu-7.png`, fullPage: true });

    console.log('\n══ B9 反控：同版但內容不同 ⇒ 必須**還是** 2 台（同版取 bundle）══');
    // 🔴 少了這一條，B7 可能是同義反覆：「攔截有生效」與「版本比較有生效」
    //    在 B7 的讀數上逐字相同（兩者都給 7 台）。
    //    B9 送的內容與 B7 **一模一樣**，只差 version 這一個欄位 ——
    //    所以它紅了就代表版本比較沒作用，綠了就代表 B7 量到的是版本比較而不是攔截。
    // 🔴 同時這也是「同版異容是錯誤狀態、bundle 才是被守衛檢查過的那份」
    //    這條規則在真瀏覽器上的唯一一次驗證。
    // 🔴 **先清快取。** B7 已經把 9.9.9 那份假表寫進去了，而「快取比 bundle 新就勝出」
    //    是設計行為（RS-13／RS-16）⇒ 不清的話 B9 量到的是**快取**，不是版本比較。
    //    第一版就是這樣紅的，而**紅的是探針不是產品**：讀數 7 台，快取裡是 9.9.9。
    //    ⇒ 這裡把那份殘留先「確認存在」再清掉 —— 觀察到並命名它，
    //      而不是靜靜把它移走然後宣稱綠了。
    const before9 = await readCache();
    let before9v = null;
    try { before9v = before9 ? (JSON.parse(before9).version ?? '(無 version)') : null; } catch { before9v = '(parse 不出來)'; }
    if (before9v === '9.9.9') ok('B9 前置：B7 那份假表確實留在快取裡（9.9.9）—— 這就是要先清掉的殘留');
    else no(`B9 前置：預期快取是 9.9.9，實際是 ${before9v} —— B7 的寫入路徑可能變了`);
    await page.evaluate((k) => localStorage.removeItem(k), CACHE_KEY);

    await ctx.unroute('**/ruleset');
    await ctx.route('**/ruleset', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: sameVersionBody,
    }));
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await gotoTai();
    try {
      await page.locator('text=平胡').first().click({ timeout: 15000 });
      await page.waitForTimeout(1500);
      const t9 = await readTotal();
      if (t9 === '2台') ok('B9 同版時顯示 2 台 ⇒ 用的是 bundle，B7 量到的是版本比較不是攔截');
      else if (t9 === '7台') no('B9 同版時顯示 7 台 —— 同版異容被吃下去了，「同版取 bundle」沒生效');
      else no(`B9 顯示「${t9}」，既不是 2 台也不是 7 台`);
    } catch (e) {
      die(`B9 點不到「平胡」（${String(e.message).slice(0, 80)}）—— 設備問題`);
    }
    await page.screenshot({ path: `${SHOT_DIR}/5-same-version-2tai.png`, fullPage: true });

    console.log('\n══ B10 快取比這次的遠端新 ⇒ 用快取（RS-16 那條規則的線上樣子）══');
    // 這一條不是「應該長這樣」的主張，是把**現行設計**釘住並讓它可見：
    // 先讓快取變成 9.9.9（平胡 7 台），再讓遠端回 0.3.0（平胡 5 台，仍比 bundle 新）。
    // 三個候選的平胡台數互不相同（bundle 2／遠端 5／快取 7），畫面上分得出用了哪一份。
    //
    // 🔴 這條同時暴露一個**運維上的後果**，設計冊要寫下來：
    //    快取沒有 TTL，而「快取比遠端新就用快取」⇒ **把 DDB 那一列回退到較舊的版本，
    //    傳不到已經快取過新版的裝置上**。唯一的出口是刪掉那一列（404）
    //    或發一個更高的版本。這是刻意的（RS-16：遠端被回退了不要跟著退），
    //    但它是不是對的取捨要人拍板，不是我單方面決定的。
    await ctx.unroute('**/ruleset');
    await ctx.route('**/ruleset', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: fakeBody,
    }));
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await gotoTai();  // 這一趟把 9.9.9 種進快取
    await ctx.unroute('**/ruleset');
    await ctx.route('**/ruleset', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: midBody,
    }));
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await gotoTai();
    try {
      await page.locator('text=平胡').first().click({ timeout: 15000 });
      await page.waitForTimeout(1500);
      const t10 = await readTotal();
      if (t10 === '7台') ok('B10 顯示 7 台 ⇒ 用快取（RS-16 的現行設計；遠端的回退傳不過去）');
      else if (t10 === '5台') no('B10 顯示 5 台 ⇒ 用了遠端 —— 與 RS-16 相反，設計與實作對不上');
      else if (t10 === '2台') no('B10 顯示 2 台 ⇒ 退回 bundle —— 兩個比 bundle 新的候選都沒被採用');
      else no(`B10 顯示「${t10}」，三個候選（2／5／7）都不是`);
    } catch (e) {
      die(`B10 點不到「平胡」（${String(e.message).slice(0, 80)}）—— 設備問題`);
    }

    console.log('\n══ B8 攔截：/ruleset 回 404 ⇒ 快取要被清掉（後端權威地說「沒有」）══');
    await ctx.unroute('**/ruleset');
    await ctx.route('**/ruleset', (route) => route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'ruleset not found' }),
    }));
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await gotoTai();
    const after404 = await readCache();
    if (after404 === null) ok('B8 404 之後快取被清掉（退回 bundle，不留一份沒有來源的複本）');
    else no(`B8 404 之後快取還在：${String(after404).slice(0, 60)}`);
    const t404 = await readTotal();
    if (t404 === '0台') ok('B8b 404 之後頁面照常可用（退回 bundle）');
    else no(`B8b 404 之後大數字是「${t404}」`);
  } finally {
    await browser.close().catch(() => {});
    console.log('\n── 清理 ──');
    const del = aws(['dynamodb', 'delete-item', '--table-name', USERS, '--key',
      JSON.stringify({ userId: { S: uid } })]);
    if (del.rc !== 0) no(`刪不掉測試使用者 ${uid}：${del.out.slice(0, 160)}`);
    else {
      // 🔴 read-back 才算清掉。「delete 回 0」與「真的不在了」是兩件事。
      const rb = aws(['dynamodb', 'get-item', '--table-name', USERS, '--key',
        JSON.stringify({ userId: { S: uid } }), '--consistent-read', '--output', 'json']);
      if (rb.rc === 0 && !JSON.parse(rb.out || '{}').Item) ok(`測試使用者 ${uid} 已清（read-back 確認）`);
      else no(`測試使用者 ${uid} 可能仍在 —— 請人工確認`);
    }
  }

  console.log(`\n══ 失敗 ${fails} 項 ══  截圖：${SHOT_DIR}`);
  process.exit(fails ? 1 : 0);
};

main().catch((e) => die(`未預期的例外：${e?.stack || e}`));
