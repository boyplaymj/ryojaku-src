#!/usr/bin/env node
// kill switch（維護模式）的**真瀏覽器**端到端探針。
//
// 用法：node infra/maintenance_browser_e2e.mjs
// 退出碼：0 = 宣稱成立；1 = 斷言失敗（宣稱不成立）；2 = 前置/設備失敗（＝沒量到，別讀成通過）
//
// ── 這支在補的是哪一塊 ──────────────────────────────────────────────────
//
// maintenance.go 檔頭自陳：「真瀏覽器端到端是目前最大的一塊未驗 —— 整條修法的目的
// 就是『不要清掉使用者的 session』，而『session 沒被清掉』這件事本身，從頭到尾沒有
// 任何一次量測直接碰到過。」前五輪全是 curl：curl 不執行 CORS、不跑 apiService.ts，
// 所以「瀏覽器收到 403 且不清 session」是推論，不是量測。
//
// 🔴 判準落在 localStorage，不落在狀態碼。狀態碼前五輪已經量爛了；這支要量的是
//    **狀態碼被前端翻譯之後**發生什麼事。載體是 constants.ts 的 STORAGE_KEYS：
//    mahjongclub_jwt_token / mahjongclub_user_session / mahjongclub_auth_type。
//
// 🔴 反控（P6）不是裝飾，是這支腳本的鑑別力本身。少了它，「403 沒清 session」與
//    「這支腳本根本偵測不到清 session」逐字相同 —— 兩者都是「三把鑰匙還在」。
//    P6 對**同一份線上產物**注入 401，必須看到鑰匙被清光；清不掉就代表尺是壞的，
//    上面每一格的綠燈都不算數（故 P6 失敗回 1，不是 warning）。
//
// 🔴 為什麼打 /ledger 而不是首頁：實查線上 API Gateway，`/user-info`（首頁 fetchData
//    打的那條）的 authorizationType 是 **NONE** —— 沒掛 authorizer，kill switch 擋不到它。
//    只有 41 條 CUSTOM route 會吐 403，`GET /ledger` 是其中之一。拿首頁當觸發器的話
//    整支腳本會「全綠而什麼都沒驗到」。
//
// 🔴 導航一律用 hash（location.hash = ...），不用 page.goto。因為「有沒有被強制 reload」
//    是本測的斷言之一（401 分支會 window.location.reload()），而 goto 自己會產生 load
//    事件 ⇒ 用 goto 的話那個斷言的目擊者會被我自己污染。
//
// ⚠️ PWA 閘：站台要求 display-mode standalone／navigator.standalone（PWAInstallPrompt.tsx）。
//    這裡用 iPhone 13 裝置模擬 ＋ navigator.standalone = true，等同「已加入主畫面的 iOS
//    使用者」。不是走 DEV BYPASS 鈕 —— 那顆鈕真實使用者不會按。
//
// ⚠️ 會對 stg 寫入：翻 MahjongClubStg_AdminConfigs 的 maintenanceMode 旗標。
//    收尾一律 delete-item 還原成「item 不存在」（＝原始狀態，不是寫 false）。
//    需要一組 stg 測試帳號，由環境變數帶入（不註冊新帳號，app-register 限流 10/hr/IP）：
//      E2E_EMAIL=... E2E_PASSWORD=... node infra/maintenance_browser_e2e.mjs

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const SITE = process.env.E2E_SITE || 'https://ryojaku-stg.boyplaymj.com';
const API = process.env.E2E_API || 'https://ryojaku-api.boyplaymj.com';
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const TABLE = process.env.E2E_TABLE || 'MahjongClubStg_AdminConfigs';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOT_DIR = process.env.E2E_SHOT_DIR || '/tmp/ryojaku-e2e';

// STORAGE_KEYS 的值抄自 frontend/constants.ts。刻意寫死而不 import：這支跑在 repo 根，
// 而前端是另一個 build 體系（node>=22 + vite）。⚠️ 代價是它會跟 constants.ts 漂掉 ——
// P1 會斷言「登入後這三把鑰匙真的存在」，鑰匙改名時那格會紅，不會靜靜漏掉。
const KEYS = {
  JWT: 'mahjongclub_jwt_token',
  USER: 'mahjongclub_user_session',
  AUTH_TYPE: 'mahjongclub_auth_type',
};

let rc = 0;
const fail = (m) => { console.log(`  ❌ ${m}`); rc = 1; };
const ok = (m) => console.log(`  ✅ ${m}`);
const die = (m) => { console.log(`\n❌ 前置失敗（沒量到，不是通過）：${m}`); process.exit(2); };

if (!EMAIL || !PASSWORD) die('缺 E2E_EMAIL / E2E_PASSWORD');

// ── 旗標控制 ────────────────────────────────────────────────────────────
const aws = (args) => execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf8' });

function flagSet(v) {
  aws(['dynamodb', 'put-item', '--table-name', TABLE, '--item',
    JSON.stringify({ info_key: { S: 'maintenanceMode' }, info_value: { S: String(v) } })]);
}
function flagDelete() {
  aws(['dynamodb', 'delete-item', '--table-name', TABLE, '--key',
    JSON.stringify({ info_key: { S: 'maintenanceMode' } })]);
}
function flagRead() {
  const out = aws(['dynamodb', 'get-item', '--table-name', TABLE, '--key',
    JSON.stringify({ info_key: { S: 'maintenanceMode' } }), '--consistent-read']);
  if (!out.trim()) return null;
  return JSON.parse(out).Item?.info_value?.S ?? null;
}

const require = createRequire(import.meta.url);
let chromium, devices;
try {
  ({ chromium, devices } = require(process.env.E2E_PW ||
    '/home/smlbot/.npm/_npx/361ceb562f3b3235/node_modules/playwright-core'));
} catch (e) {
  die(`載不到 playwright-core（試 E2E_PW=<路徑>）：${e.message}`);
}

// ── 前置 ────────────────────────────────────────────────────────────────
console.log('══ P0 前置 ══');
let before;
try { before = flagRead(); } catch (e) { die(`讀不到旗標（AWS 憑證？）：${e.message}`); }
if (before !== null && before.toLowerCase() === 'true') {
  die(`開跑前旗標就是 true（前一輪沒還原？）—— 拒跑，否則量到的「被擋」不是我造成的`);
}
console.log(`  旗標起始值 = ${before === null ? '(item 不存在)' : before} → 視為 OFF`);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript(() => {
  Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
});
const page = await ctx.newPage();

let loadCount = 0;
page.on('load', () => { loadCount++; });
const authWarns = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[AUTH]')) authWarns.push(t.slice(0, 120));
});

const snapshot = () => page.evaluate((k) => ({
  jwt: localStorage.getItem(k.JWT),
  user: localStorage.getItem(k.USER),
  authType: localStorage.getItem(k.AUTH_TYPE),
}), KEYS);

// 觸發一次受保護 route 的呼叫：離開再回到 #/ledger 讓元件重新掛載。
// 回傳實際觀察到的 response（不是我以為它會打的那條）。
async function triggerLedger(label) {
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForTimeout(700);
  const waiter = page.waitForResponse(
    (r) => r.url().startsWith(`${API}/ledger?`), { timeout: 25000 });
  await page.evaluate(() => { window.location.hash = '#/ledger'; });
  const resp = await waiter.catch(() => null);
  await page.waitForTimeout(1200);
  if (!resp) die(`${label}：25 秒內沒觀察到 GET /ledger —— 觸發器失效，本輪什麼都沒量到`);
  return resp;
}

async function cleanup() {
  try { flagDelete(); } catch { /* 收尾盡力而為 */ }
  try { await browser.close(); } catch { /* 同上 */ }
}
process.on('uncaughtException', async (e) => {
  console.log('\n❌ 未預期例外：', e && e.stack ? e.stack.slice(0, 600) : String(e));
  await cleanup(); process.exit(2);
});

try {
  // ── P1 真・UI 登入 ────────────────────────────────────────────────────
  console.log('\n══ P1 真・UI 登入（不塞 localStorage）══');
  await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  const emailBox = page.locator('input[type=email][placeholder="your@email.com"]');
  if (await emailBox.count() === 0) die('找不到登入表單（PWA 閘沒過？站台改版？）');
  await emailBox.first().fill(EMAIL);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.getByText('通行證核准', { exact: false }).first().click();
  await page.waitForTimeout(6000);

  const s0 = await snapshot();
  // 🔴 三把都要求，不是兩把。少了 authType 這格，它從頭到尾是 null 時 P3 的
  // 「逐字未變」會拿 null === null 比出 true，而 P6 也不會察覺它沒被清 ⇒
  // 「三把鑰匙」這個宣稱只有兩把有人守。(Codex 覆驗抓到，2026-09-02)
  if (!s0.jwt || !s0.user || !s0.authType) {
    die(`登入沒成功（jwt=${!!s0.jwt} user=${!!s0.user} authType=${JSON.stringify(s0.authType)}）` +
        ` —— 帳密錯、站台壞了，或 STORAGE_KEYS 改名了`);
  }
  ok(`登入成功，三把鑰匙就位（authType=${s0.authType}）`);
  console.log(`     jwt 長度=${s0.jwt.length}  user 長度=${s0.user.length}`);

  // ── P2 正控 ───────────────────────────────────────────────────────────
  console.log('\n══ P2 正控：旗標 OFF，受保護 route 應為 200 ══');
  const r2 = await triggerLedger('P2');
  console.log(`  GET /ledger → ${r2.status()}`);
  if (r2.status() !== 200) {
    die(`正控壞了：旗標 OFF 時 /ledger 回 ${r2.status()}（期望 200）。` +
        `少了這格，後面的 403 與「沒被擋」分不出來`);
  }
  ok('旗標 OFF 時使用者本來就用得了（正控成立）');
  const loadsAfterP2 = loadCount;

  // ── P3 主判 ───────────────────────────────────────────────────────────
  console.log('\n══ P3 主判：旗標 ON —— 403 且 session 不可被清 ══');
  flagSet(true);
  const nowFlag = flagRead();
  if (String(nowFlag).toLowerCase() !== 'true') die(`旗標沒寫進去（讀回 ${nowFlag}）`);
  console.log('  旗標已翻成 true（連線與分頁全程沒動過）');

  const r3 = await triggerLedger('P3');
  console.log(`  GET /ledger → ${r3.status()}`);
  if (r3.status() === 403) ok('瀏覽器**真的**收到 403（不只是 curl 收到）');
  else fail(`期望 403，實得 ${r3.status()} —— kill switch 沒擋到這條路`);

  // 403 讀得到，前提是它帶 CORS header；沒帶的話瀏覽器只會看到 CORS 失敗。
  const acao = (await r3.allHeaders())['access-control-allow-origin'];
  if (acao) ok(`403 帶 CORS header（access-control-allow-origin: ${acao}）⇒ 前端讀得到狀態碼`);
  else fail('403 沒帶 CORS header —— 前端根本看不到 403，403 分支形同不存在');

  const s3 = await snapshot();
  if (s3.jwt === s0.jwt && s3.user === s0.user && s3.authType === s0.authType) {
    ok('🔴 三把鑰匙逐字未變 —— session 沒被清掉（這就是整條修法的目的）');
  } else {
    fail(`session 被動到了：jwt ${s0.jwt === s3.jwt ? '同' : '變/沒了'}、` +
         `user ${s0.user === s3.user ? '同' : '變/沒了'}、authType ${s0.authType === s3.authType ? '同' : '變/沒了'}`);
  }

  if (loadCount === loadsAfterP2) ok('沒有發生強制 reload（load 事件數未增）');
  else fail(`頁面被 reload 了 ${loadCount - loadsAfterP2} 次 —— 401 分支的行為`);

  if (page.url().includes('expired=true')) fail('被導去 ?expired=true（401 分支的行為）');
  else ok('沒有被導去「連線已過期」');

  // 🔴 這一格量的是**使用者真的讀到的字串**，不是 apiService 回傳物件裡的字串。
  // 兩者差一層：apiService 把 403 翻成「服務維護中」，但呼叫端要把它畫出來才算數。
  await page.screenshot({ path: SHOT_DIR + '/p3-maintenance-on.png', fullPage: true });
  // 這格 2026-09-02 之前是一句 console.log 警告，因為當時畫面上**真的沒有**任何提示
  // （計帳頁渲染成一本正常的空帳本）。修法上線後（frontend/utils/maintenanceSignal.ts
  // ＋ components/MaintenanceNotice.tsx）升成斷言。
  // 反控是現成的：修法上線前，線上 bundle 對「系統維護中」的命中數是 0。
  const body3 = await page.evaluate(() => document.body.innerText);
  if (body3.includes('服務維護中')) {
    ok('🔴 使用者讀到的字串真的是「服務維護中」—— 被擋住這件事看得見了');
  } else {
    fail('畫面沒出現「服務維護中」—— 提示沒送到使用者眼前。' +
         `使用者實際讀到：${JSON.stringify(body3.replace(/\s+/g, ' ').trim().slice(0, 120))}`);
  }

  // ── P4 維護中重新整理 ─────────────────────────────────────────────────
  console.log('\n══ P4 維護中按重新整理 —— 還登入著嗎 ══');
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  const s4 = await snapshot();
  // user 這把只驗「還在」不驗「逐字相同」：/user-info 是公開 route（見檔頭），
  // 維護中重新整理它照樣回 200，fetchData 會把 user_session 覆寫成最新 profile。
  // 要求逐字相同的話這格會因為一件與 session 無關的事而紅。
  if (s4.jwt === s0.jwt && s4.user && s4.authType === s0.authType) {
    ok('重新整理後三把鑰匙仍在（jwt/authType 逐字相同）—— 使用者沒有被登出');
  } else {
    fail(`重新整理後 session 掉了（jwt=${s4.jwt === s0.jwt ? '同' : '變/沒了'}` +
         ` user=${!!s4.user} authType=${s4.authType === s0.authType ? '同' : '變/沒了'}）` +
         ` —— 維護一結束他得重新登入`);
  }

  // ── P5 可逆 ───────────────────────────────────────────────────────────
  console.log('\n══ P5 還原旗標 —— 不必重新登入就能繼續用 ══');
  flagDelete();
  await page.waitForTimeout(1500);
  const r5 = await triggerLedger('P5');
  console.log(`  GET /ledger → ${r5.status()}`);
  if (r5.status() === 200) ok('回到 200 —— 200→403→200 的閉環，這次是在瀏覽器裡');
  else fail(`還原後仍是 ${r5.status()}`);
  const s5 = await snapshot();
  if (s5.jwt === s0.jwt) ok('全程用的是同一把 JWT，沒有重新登入過');
  else fail('JWT 變了 —— 中間發生過重新登入/換發');

  // 🔴 解除訊號那一半。少了這格，「提示會出現」有人守而「提示會消失」沒人守 ——
  //    而一個維護結束後還掛著「服務維護中」的 App，比沒有提示更糟（它在說謊）。
  //    這格能成立的前提是 noteOk 只認**曾被擋過的那條路**：/ledger 剛剛回了 200。
  const body5 = await page.evaluate(() => document.body.innerText);
  if (!body5.includes('服務維護中')) ok('維護結束後提示自動消失了（解除訊號有送達）');
  else fail('維護已還原但提示還掛著 —— 解除訊號沒送到，App 在對使用者說謊');

  // ── P6 反控 ───────────────────────────────────────────────────────────
  console.log('\n══ P6 反控：同一份線上產物注入 401，鑰匙必須被清光 ══');
  console.log('  （少了這格，「403 沒清 session」與「這支腳本偵測不到清 session」長得一樣）');
  const loadsBefore6 = loadCount;
  await page.route(`${API}/ledger?**`, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"injected"}' }));

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.location.hash = '#/ledger'; });
  await page.waitForTimeout(6000);

  const s6 = await snapshot();
  // 🔴 三把都要求被清。反控的職責就是鑑別力本身 —— 它只檢查兩把的話，
  // authType 這把的「有沒有被清」從頭到尾沒有任何一格在守。
  if (!s6.jwt && !s6.user && !s6.authType) {
    ok('🔴 注入 401 後三把鑰匙全被清光 ⇒ 本腳本偵測得到「session 被清」，P3 的綠燈有鑑別力');
  } else {
    fail(`注入 401 後鑰匙還在（jwt=${!!s6.jwt} user=${!!s6.user} authType=${JSON.stringify(s6.authType)}）—— ` +
         `尺是壞的：它偵測不到 session 被清，上面每一格的綠燈都不算數`);
  }
  if (loadCount > loadsBefore6) ok(`401 分支有強制 reload（+${loadCount - loadsBefore6}）⇒ 與 403 分支行為確實不同`);
  else fail('401 分支沒有 reload —— 兩條分支在這個維度上沒有差異，差分不乾淨');
  if (authWarns.length) console.log(`  旁證 console：${authWarns[authWarns.length - 1]}`);

  // ── P7 維護中從零登入 ─────────────────────────────────────────────────
  // 「API 端點通不通」與「產品用不用得了」是兩件事，本格量的是後者。
  //
  // 🔴 我原本預測這裡會失敗，理由是 authService.adoptSession 拿到 token 後會再打
  //    **受保護的** GET /user-profile ⇒ 403 ⇒ throw 並清掉半套 session。實測打臉：
  //    `adoptSession` 只服務 **Google／LINE** 登入；email/密碼走的是 loginWithEmail，
  //    它直接用 /app-login **回應裡自帶的 profile**（authService.ts:60「response.user
  //    || response.data」），**不打第二支 API**。⇒ 整條路都在公開 route 上。
  //    教訓：我讀了 adoptSession 就假設它在登入路徑上，沒去讀 login 的定義。
  //
  // ⇒ 所以檔頭「登入照常可用」比它自己寫的還要成立：不只端點回 200，
  //   **使用者可以在維護中完整登入並拿到 session**。
  console.log('\n══ P7 維護中從零登入 —— 端點通了，然後呢 ══');
  await page.unroute(`${API}/ledger?**`);
  flagSet(true);
  if (String(flagRead()).toLowerCase() !== 'true') die('P7：旗標沒寫進去');

  const seen = [];
  const tap = (r) => {
    const u = r.url();
    if (u.startsWith(`${API}/app-login`) || u.startsWith(`${API}/user-profile`)) {
      seen.push(`${r.status()} ${r.request().method()} ${u.replace(API, '').split('?')[0]}`);
    }
  };
  page.on('response', tap);
  await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  const box7 = page.locator('input[type=email][placeholder="your@email.com"]');
  if (await box7.count() === 0) die('P7：登入頁沒出現（P6 之後應該是登出狀態）');
  await box7.first().fill(EMAIL);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.getByText('通行證核准', { exact: false }).first().click();
  await page.waitForTimeout(8000);
  page.off('response', tap);

  console.log(`  觀察到的呼叫：${seen.join(' / ') || '(無)'}`);
  const gotLogin200 = seen.some((x) => x.startsWith('200 POST /app-login'));
  const gotProfile403 = seen.some((x) => x.startsWith('403 GET /user-profile'));
  if (gotLogin200) ok('端點層：POST /app-login 在維護中回 200（公開 route 擋不到，宣稱成立）');
  else fail(`端點層：沒觀察到 200 的 /app-login（${seen.join(' / ')}）`);
  // 🔴 下面兩格是**斷言**不是警告：maintenance.go 第七輪把這個行為寫成了紀錄，
  //    紀錄就得有人守。紅掉的意思是「文件的描述過期了，回去改它」，不是「產品壞了」。
  if (!gotProfile403) {
    ok('email/密碼登入全程沒打受保護的 /user-profile（profile 由 /app-login 自帶）');
  } else {
    fail('登入途中出現 /user-profile 403 —— 登入流程改成走 adoptSession 了，' +
         'maintenance.go 第七輪的描述要重寫');
  }

  const s7 = await snapshot();
  await page.screenshot({ path: SHOT_DIR + '/p7-login-during-maintenance.png', fullPage: true });
  const body7 = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim();
  if (s7.jwt && s7.user && s7.authType) {
    ok('🔴 結果：維護中**可以完整登入**（三把鑰匙都拿到）—— 不只端點通，session 真的建立了');
  } else {
    fail(`維護中登不進去（jwt=${!!s7.jwt} user=${!!s7.user} authType=${JSON.stringify(s7.authType)}）` +
         ` —— 與量到的行為相反，maintenance.go 第七輪的描述要重寫`);
  }
  console.log(`     使用者讀到：${JSON.stringify(body7.slice(0, 140))}`);

} finally {
  console.log('\n══ 收尾 ══');
  try {
    flagDelete();
    const after = flagRead();
    console.log(`  旗標還原後讀回 = ${after === null ? '(item 不存在) ✅ 回到原始狀態' : after}`);
    if (after !== null) { console.log('  ❌ 旗標沒還原乾淨'); rc = 1; }
  } catch (e) {
    console.log(`  ❌ 還原失敗，請手動檢查 ${TABLE} 的 maintenanceMode：${e.message}`);
    rc = 2;
  }
  await browser.close().catch(() => {});
}

console.log(`\n${rc === 0 ? '✅ 全部斷言通過' : '❌ 有斷言失敗'}  rc=${rc}`);
console.log('=== END-OF-RUN ===');
process.exit(rc);
