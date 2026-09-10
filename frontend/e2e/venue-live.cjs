#!/usr/bin/env node
// [B5-R3] 玩家端 venue 三頁的**線上**實跑（真站台、真後端、真 DDB）。
//
// 用法：node e2e/venue-live.cjs        （SITE 可覆寫，預設 stg）
// rc：0 全過／1 有斷言沒過／2 腳本自己爆了／4 沒有儀器（找不到 playwright）
//     🔴 4 與 1 必須分開 —— 「量不到」不可以讀成「量到失敗」。
//
// ── 為什麼要有這支 ─────────────────────────────────────────────
//
// `[B1-j]` 三頁在 2026-09-09 17:04 才**第一次**上線（被 `[B5-d]` 那班前端車載上去的）。
// 在那之前它們只有：單元層 38 條、突變 33 發、以及一次**本機 harness**的瀏覽器實跑
// （`venue.e2e.cjs`，餵的是假後端）。⇒ 「線上那包 bundle 跑起來長什麼樣」沒有人看過。
//
// 🔴 `venue.e2e.cjs` 結構上補不了這一格：它載的是本機生成的 harness html、
//    攔截所有 API 回自己編的資料，而且白名單明講「正式後端不在其中」。
//    ⇒ 這支不是它的複製，是它照不到的那一面。
//
// 🔴 **斷言全部打在「看得見的文字」上**，不是 DOM 存不存在 ——
//    十條全綠而畫面上看不到字，這個專案實際發生過（§15 `[B1-j6]`）。
//    另外每一步存截圖：綠燈與截圖不一致時，信截圖。
//
// ⚠️ 寫入面積：Users 一列、Venues 兩列，全部 `B5RPROBE-DELETEME` 開頭，跑完刪掉並 read-back。

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SITE = (process.env.SITE || 'https://ryojaku-stg.boyplaymj.com').replace(/\/$/, '');
// 🔴 **這個 App 用的是 HashRouter**（App.tsx:2 `HashRouter as Router`）⇒ 路由在 fragment 裡。
//    第一版我打 `${SITE}/venues`，`location.pathname` 讀回來**確實是 `/venues`**、頁面也不是白的
//    —— 但畫面上是「揪咖」首頁：hash 是空的，router 走了預設路由。
//    ⇒ 三條斷言紅了，而紅的是**我的尺**，不是被測物。判別法是看截圖，不是看 pathname。
const url = (p) => `${SITE}/#${p}`;
const REGION = 'ap-southeast-1';
const USERS = 'MahjongClubStg_Users';
const VENUES = 'MahjongClubStg_Venues';
const MARK = 'B5RPROBE-DELETEME';
const SHOTS = '/tmp/b5r-shots';

let TOTAL = 0, FAIL = 0;
let residueRc2 = false;   // 清理沒歸零 ⇒ 這一輪不可信（rc=2），見收尾那段
const ok = (m) => { TOTAL++; console.log(`  ✅ ${m}`); };
const bad = (m) => { TOTAL++; FAIL++; console.log(`  ❌ ${m}`); };
const check = (desc, cond) => (cond ? ok(desc) : bad(desc));
const die = (m) => { console.log(`\n🔴 [設備] 本輪什麼都沒驗到：${m}`); process.exit(4); };

function aws(args) {
  return execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf8', maxBuffer: 8 << 20 });
}
function ssm(name) {
  return aws(['ssm', 'get-parameter', '--name', name, '--with-decryption',
    '--query', 'Parameter.Value', '--output', 'text']).trim();
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload, secret) {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64(mac)}`;
}
function venueItem(id, status, name, phone) {
  return {
    venueId: { S: id }, type: { S: 'hall' }, status: { S: status }, name: { S: name },
    phone: { S: phone }, businessHours: { S: '12:00-02:00' }, ownerId: { S: `${MARK}-someone` },
    approxLocation: { M: { latitude: { N: '25.04' }, longitude: { N: '121.56' } } },
    dojoPaidUntil: { N: '0' }, certifiedRefereeCount: { N: '0' },
    ratingPositive: { N: '0' }, ratingCount: { N: '0' },
    createdAt: { N: String(Math.floor(Date.now() / 1e3)) },
    updatedAt: { N: String(Math.floor(Date.now() / 1e3)) },
  };
}

// playwright 住在 npx 快取裡（同 e2e/run.sh 的找法）。
function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* 往下找 */ }
  const base = path.join(process.env.HOME, '.npm', '_npx');
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch (_) { die('找不到 npx 快取目錄'); }
  for (const d of dirs) {
    const p = path.join(base, d, 'node_modules', 'playwright');
    if (fs.existsSync(p)) { try { return require(p); } catch (_) { /* 換下一個 */ } }
  }
  die('找不到 playwright（裝法：npx playwright install chromium）');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { chromium, devices } = loadPlaywright();
  const tag = Date.now();
  const uid = `${MARK}-U-${tag}`;
  const actId = `${MARK}-ACT-${tag}`;
  const pendId = `${MARK}-PEND-${tag}`;
  const actName = `${MARK} 已審麻將館 ${tag}`;
  const pendName = `${MARK} 待審麻將館 ${tag}`;
  const ACT_PHONE = '0900-111-222';
  const cleanup = [];

  let secret;
  try { secret = ssm('/ryojaku/stg/JWT_SECRET'); } catch (e) { die(`讀不到 JWT_SECRET：${e.message}`); }

  try {
    aws(['dynamodb', 'put-item', '--table-name', USERS, '--item',
      JSON.stringify({ userId: { S: uid }, displayName: { S: MARK }, email: { S: 'probe@example.com' } })]);
    cleanup.push(['users', uid]);
    aws(['dynamodb', 'put-item', '--table-name', VENUES, '--item',
      JSON.stringify(venueItem(actId, 'active', actName, ACT_PHONE))]);
    cleanup.push(['venues', actId]);
    aws(['dynamodb', 'put-item', '--table-name', VENUES, '--item',
      JSON.stringify(venueItem(pendId, 'pending', pendName, '0900-333-444'))]);
    cleanup.push(['venues', pendId]);
  } catch (e) { die(`建不出探針資料：${e.message}`); }

  const token = sign({ userId: uid, email: 'probe@example.com', exp: Math.floor(Date.now() / 1e3) + 3600 }, secret);
  const user = { userId: uid, id: uid, displayName: MARK, name: MARK, email: 'probe@example.com' };

  let browser;
  const consoleErrors = [];
  const failedReqs = [];
  try {
    browser = await chromium.launch({ headless: true });
    // 🔴 **必須模擬「已安裝的 PWA ＋ 手機」，否則站台根本不給看**（第一輪就撞到）：
    //    `PWAInstallPrompt` 只有 `isStandalone || devBypass` 才渲染 children，
    //    而 `[DEV MODE] BYPASS CHECK` 那顆按鈕包在 `import.meta.env.DEV` 裡
    //    ⇒ **正式 bundle 裡不存在**。桌機 UA 看到的是「MOBILE ACCESS ONLY」那張卡。
    //    ⚠️ 這是**刻意的模擬**，不是繞過安全檢查：真實使用者就是用手機開已安裝的 App。
    //    ⚠️ 但也因此，本支**沒有**驗證「桌機看到的擋板」那條路徑。
    const ctx = await browser.newContext({
      ...(devices['iPhone 13'] || { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
    });
    // navigator.standalone 是 checkStandalone() 三個判準之一（iOS 那條）。
    await ctx.addInitScript(() => {
      Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true });
    });
    // 🔴 session **必須用 addInitScript 注入，不可以 goto 之後再 evaluate**。
    //    App.tsx 只在啟動那一個 useEffect 讀 localStorage ⇒ 先載入再寫，畫面已經是登入頁了，
    //    而之後換 hash 是 same-document navigation、React 不會重新讀。
    //    實測：第二輪就是這樣紅的（截圖是登入頁），而「沒登入」與「列表是空的」
    //    在「有字、不是擋板、不是預設頁」三個判準上分不出來。
    await ctx.addInitScript(([t, u]) => {
      localStorage.setItem('mahjongclub_jwt_token', t);
      localStorage.setItem('mahjongclub_user_session', u);
      localStorage.setItem('mahjongclub_auth_type', 'app');
    }, [token, JSON.stringify(user)]);
    // 🔴 **每條路由開一張新分頁**，不用 `reload()`：換 hash 是 same-document navigation，
    //    App 不會重新啟動；而用 reload 補救會**中止上一次載入發出的請求**，
    //    那些 abort 會被 `requestfailed` 記成「失敗」—— 是我的儀器自己造出來的紅。
    //    （上一輪 `GET /venue-list`／`POST /venue-detail` 出現在失敗清單裡，
    //      而畫面上資料明明畫出來了 —— 兩件事同時成立就是儀器在說謊。）
    const freshPage = async (u) => {
      const pg = await ctx.newPage();
      pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
      pg.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url().slice(0, 120)}`));
      await pg.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return pg;
    };
    let page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url().slice(0, 120)}`));

    console.log(`══ 站台 ${SITE} ══`);
    await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/1-boot.png` });
    let text = await page.evaluate(() => document.body.innerText || '');
    // 🔴 這條問的是「畫面上有沒有字」，不是「DOM 有沒有東西」。
    check(`L1 首頁不是白畫面（可見文字 ${text.length} 字）`, text.trim().length > 40);
    // 🔴🔴 **L1b 是這支最重要的反控，而它是被一次假綠逼出來的。**
    //    第一輪跑（桌機 UA）L1／L2 都綠，91 字 —— 那 91 字是「MOBILE ACCESS ONLY」
    //    那張擋板。「有字」這個判準對「app 有沒有渲染」**零鑑別力**，
    //    而它與「venue 列表正常顯示」在讀數上長得一模一樣。
    check('L1b【反控】不是「MOBILE ACCESS ONLY」擋板（模擬 standalone 生效了）',
      !text.includes('MOBILE ACCESS ONLY'));

    page = await freshPage(url('/venues'));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}/2-venues.png`, fullPage: true });
    text = await page.evaluate(() => document.body.innerText || '');
    check(`L2 /#/venues 進得去且不是白畫面（可見文字 ${text.length} 字）`,
      text.trim().length > 40 && !text.includes('MOBILE ACCESS ONLY'));
    // 🔴 L2b：hash 沒吃到時 router 會退回預設路由（揪咖首頁），而那與「venue 列表是空的」
    //    在「有字、不是擋板」這兩個判準上**完全一樣**。這一條就是分開它們的那把尺。
    check('L2b【反控】畫面不是「揪咖」預設頁（＝hash 路由真的生效了）',
      !text.includes('活動紀錄總覽'));
    // 🔴 L2c：**不是登入頁**。第二輪紅在這裡而我一開始看的是 L3 ——
    //    「沒登入」與「列表是空的」在前面每一條判準上都長得一樣。
    check('L2c【反控】不是登入頁（＝注入的 session 真的生效了）',
      !text.includes('通行證核准') && !text.includes('ELITE COMMUNITY'));
    check('L3 公開列表看得到那筆 active 麻將館的名字', text.includes(actName));
    // 🔴 L3 的反控：待審的**不該**出現在公開列表（IsPubliclyListable）。
    //    少了它，「列表把每一筆都畫出來」也會讓 L3 綠。
    check('L4【反控】待審那筆**不**出現在公開列表', !text.includes(pendName));

    page = await freshPage(url(`/venue/${actId}`));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}/3-detail-active.png`, fullPage: true });
    text = await page.evaluate(() => document.body.innerText || '');
    check('L5 詳情頁看得到店名', text.includes(actName));
    check(`L6 active 的麻將館：畫面上看得到電話（${ACT_PHONE}）`, text.includes(ACT_PHONE));

    page = await freshPage(url(`/venue/${pendId}`));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}/4-detail-pending.png`, fullPage: true });
    text = await page.evaluate(() => document.body.innerText || '');
    check('L7 待審麻將館的詳情頁進得去（看得到店名）', text.includes(pendName));
    // ⚠️ 界線寫在這裡而不是註解最上面：這一條驗的是**整疊起來**的行為。
    //    後端 [B5-b2] 之後根本不送 phone 過來 ⇒ 它證明不了「前端那層自己擋得住」。
    check('L8 pending 的麻將館：畫面上看不到電話（整疊起來的行為，不是前端那層單獨）',
      !text.includes('0900-333-444'));

    // 🔴 L9／L10 **只問 venue 那三支**。理由不是「其他的不重要」，是**範圍要等於宣稱範圍**：
    //    本支宣稱的是「[B1-j] 三頁線上跑得起來」，拿全站的 error 當判準會讓一個無關的
    //    既有問題永遠把它判紅 ⇒ 那條斷言會被手動忽略，等於沒有。
    const venueRe = /venue-list|venue-detail|create-venue/;
    const venueErrs = consoleErrors.filter((e) => venueRe.test(e));
    check(`L9 沒有 venue 相關的主控台 error（${venueErrs.length} 筆）`, venueErrs.length === 0);
    venueErrs.slice(0, 5).forEach((e) => console.log(`      · ${e}`));
    const venueFails = failedReqs.filter((u) => venueRe.test(u));
    check(`L10 venue 的三支 API 都沒有失敗的請求（${venueFails.length} 筆）`, venueFails.length === 0);
    venueFails.slice(0, 5).forEach((e) => console.log(`      · ${e}`));

    // ⚠️ 範圍外但**一定要印出來**（不判紅，也不假裝沒看到）：
    const other = failedReqs.filter((u) => !venueRe.test(u) && !/unpkg\.com|tailwindcss\.com|fonts\./.test(u));
    if (other.length) {
      console.log(`\n  ⚠️ 範圍外的失敗請求 ${other.length} 筆（不判紅，但這是真的）：`);
      [...new Set(other.map((u) => u.split('?')[0]))].slice(0, 5).forEach((e) => console.log(`      · ${e}`));
      console.log('      ↑ 實查：/daily-bonus 帶 Bearer JWT 打自訂網域回 **403**，訊息是 SigV4 解析器的');
      console.log('        （"Invalid key=value pair … Authorization header"）⇒ 那條路由的 auth 設定與其他支不同。');
      console.log('        它每次開 App 都會噴，與 [B1-j] 無關 —— 另立問題，不在本支的判準內。');
    }
  } catch (e) {
    console.log(`\n🔴 腳本執行中爆了：${e && e.message}`);
    FAIL++; TOTAL++;
    process.exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    console.log('\n══ 清理（寫入面積必須歸零）══');
    // 🔴🔴 **這一段 2026-09-10 整個重寫，收 Codex 覆驗的三條，而第三條是承重的那條：**
    //  ① 原本寫了 1 筆 Users ＋ 2 筆 Venues，read-back **只掃 Venues**
    //     ⇒ 漏掉的那張表上的殘留，與「沒有殘留」逐字相同。
    //  ② 原本宣稱「掃過整張表」。⚠️ **這條我實測後判定不成立**：aws cli 對 scan
    //     會自動翻頁（`--page-size 1` 強制 7 次 API 呼叫，仍回全部 7 筆，與 `--select COUNT`
    //     的 7 一致）。但仍然改掉 —— GetItem 不依賴「CLI 預設會翻頁」這個**工具的性質**
    //     （`~/.aws/config` 的 `max_items` 就能靜靜改掉它）。
    //  ③ **承重**：原本刪除失敗／read-back 失敗／發現殘留都只印 ⚠️，**不動 FAIL 也不動 rc**
    //     ⇒ 可以印出 13/13、rc=0 而東西還躺在表上。現在任何一種都 **rc=2**。
    //     為什麼是 2 不是 1：斷言本身沒有失敗，是**這一輪的前提**（跑完不留東西）破了
    //     ⇒ 屬於「這次的結果不可信」，與「量到失敗」不同號。
    const SKIP = process.env.PROBE_SKIP_CLEANUP === '1';
    if (SKIP) console.log('  ⚠️ PROBE_SKIP_CLEANUP=1：**故意不刪**（這是 read-back 自己的反控）');
    const problems = [];
    const keyOf = (tbl, id) => (tbl === 'users' ? { userId: { S: id } } : { venueId: { S: id } });
    const tableOf = (tbl) => (tbl === 'users' ? USERS : VENUES);
    for (const [tbl, id] of cleanup) {
      if (SKIP) break;
      try { aws(['dynamodb', 'delete-item', '--table-name', tableOf(tbl), '--key', JSON.stringify(keyOf(tbl, id))]); }
      catch (e) { problems.push(`刪不掉 ${tbl}/${id}：${e.message.slice(0, 80)}`); }
    }
    // 🔴 逐個 ID 做 GetItem（含 Users）——「刪除指令回 0」與「東西還在」不可以同形。
    for (const [tbl, id] of cleanup) {
      try {
        // 🔴 `|| '{}'`：**查無資料時 aws cli 回的是空字串，不是 `{}`**（rc 仍是 0）。
        //    第一版少了它 ⇒ `JSON.parse('')` 丟例外 ⇒ 落進下面的 catch，被算成
        //    「read-back 失敗」而 rc=2。方向是**假紅**：東西明明刪乾淨了卻報殘留。
        //    ⚠️ 抓到它的不是任何測試，是**真的跑一次**（2026-09-10，3/3 全誤報）——
        //    而 Python 姊妹檔早就寫著 `json.loads(out or "{}")`，我改 Node 這支時
        //    只搬了結構、沒搬這個細節。⇒ 「兩支對齊」不等於「兩支都對」。
        const raw = aws(['dynamodb', 'get-item', '--table-name', tableOf(tbl),
          '--key', JSON.stringify(keyOf(tbl, id)), '--consistent-read',
          '--projection-expression', tbl === 'users' ? 'userId' : 'venueId', '--output', 'json']);
        const out = JSON.parse(raw.trim() || '{}');
        if (out.Item) problems.push(`${tbl}/${id} 仍在表上`);
      } catch (e) {
        // 讀不回來 ⇒ 不知道還在不在 ⇒ 一樣不可以宣稱清乾淨了。
        problems.push(`read-back 失敗 ${tbl}/${id}：${e.message.slice(0, 80)}`);
      }
    }
    if (problems.length) {
      console.log(`  ❌ 清理沒有歸零（${problems.length} 項）：`);
      problems.slice(0, 6).forEach((m) => console.log(`      · ${m}`));
      console.log('  ⇒ rc=2：斷言本身沒失敗，但這一輪留下了東西 ⇒ 結果不可信。');
      residueRc2 = true;
    } else {
      console.log(`  ✅ ${cleanup.length} 個 ID 逐個 GetItem 讀回，全部不存在（含 Users）`);
    }
  }

  console.log(`\n══ 結果：${TOTAL - FAIL}/${TOTAL} ══  截圖：${SHOTS}/`);
  if (process.exitCode === 2) { console.log('rc=2：腳本自己爆了，不可讀成通過。'); return; }
  // 🔴 順序：殘留優先於斷言結果 —— 13/13 而東西還在表上，那個 13/13 不可以被讀成「乾淨跑完」。
  if (residueRc2) {
    console.log('rc=2：**清理沒有歸零**，本輪結果不可讀成通過（斷言另計，見上）。');
    process.exitCode = 2;
    return;
  }
  if (FAIL) { console.log('❌ 有斷言沒過。'); process.exitCode = 1; return; }
  console.log('✅ 全部通過。⚠️ 界線：注入 session 繞過了登入流程；CreateVenue 那頁沒驗（它會抓圖磚）。');
})();
