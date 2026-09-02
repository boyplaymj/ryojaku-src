#!/usr/bin/env node
// voice_tai_funnel_browser_e2e.mjs — D4-g 漏斗埋點的**真瀏覽器**端到端（線上 stg）
//
// 用法：node infra/voice_tai_funnel_browser_e2e.mjs
// 退出碼：0 = 宣稱成立；1 = 斷言失敗；2 = 前置/設備失敗（＝沒量到，別讀成通過）
//
// ── 這支在補的是哪一塊 ────────────────────────────────────────────
//
// D4-g 的既有 e2e（`frontend/e2e/d4g-funnel-e2e.mjs`）打的是**假後端**，
// D6 的 `verify_review_live.ts` 打真後端但**沒有瀏覽器**（它自己送資料）。
// 中間那一段從來沒有任何一次量測碰過：**真的有人打開那一頁時，事件會不會出現**。
// 那一段跨了 CloudFront 上的產物、React 的 useEffect、apiService 的 header、
// API Gateway 的 authorizer、Lambda 的 kind 分支 —— 每一環都可能斷，
// 而斷掉的樣子全部都是「後台那一格是 0」。
//
// 🔴 **反控先行**：先停在首頁，確認 0 筆。少了它，「進頁才送一筆」與
//    「每次載入都送」在資料上逐字相同（都是「有一筆」）。
//    這條沿用 §11.11 那份假後端 e2e 的第一關 —— 判準不變，只是換成真的。
//
// 🔴 判準之一是**畫面真的畫出來了**（頁面上找得到「語音判台」）。
//    只驗「有一筆 open」的話，「React 掛了但 useEffect 先跑完」也會過。
//
// ⚠️ 會對 stg 寫入：註冊一個測試帳號並產生幾列 VoiceCorrections，收尾自己清掉
//    （列 + Users/AuthIdentities/AuthTokens），並回頭確認清回基線。
// ⚠️ 用掉 1 次 app-register（每 IP 每小時 10 次）。

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const SITE = process.env.E2E_SITE || 'https://ryojaku-stg.boyplaymj.com';
const API = process.env.E2E_API || 'https://ryojaku-api.boyplaymj.com';
const REGION = 'ap-southeast-1';
const PREFIX = 'MahjongClubStg_';
const TABLE = PREFIX + 'VoiceCorrections';
const MARK = 'D4GE2E-DELETEME';
const SHOT_DIR = '/tmp/ryojaku-d4g-e2e';

// 抄自 frontend/constants.ts。刻意寫死不 import（這支跑在 repo 根，前端是另一個 build 體系）。
// ⚠️ 代價是會跟 constants.ts 漂掉 —— 但 P2「畫面畫得出來」會在鑰匙改名時紅，不會靜靜漏掉。
const KEYS = { JWT: 'mahjongclub_jwt_token', USER: 'mahjongclub_user_session', AUTH_TYPE: 'mahjongclub_auth_type' };

let fails = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const no = (m) => { fails++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`\n🔴 [設備] ${m}`); process.exit(2); };

function ddb(args) {
  try { return { rc: 0, out: execFileSync('aws', ['dynamodb', ...args, '--region', REGION], { encoding: 'utf8' }) }; }
  catch (e) { return { rc: 1, out: String(e.stderr ?? e) }; }
}

/** 撈這個 userId 的列。分頁沒完就當設備問題 —— 「這一頁的筆數」不代表全部。 */
function rowsOf(userId) {
  const r = ddb(['query', '--table-name', TABLE, '--key-condition-expression', 'pk = :p',
    '--expression-attribute-values', JSON.stringify({ ':p': { S: `USER#${userId}` } }), '--output', 'json']);
  if (r.rc !== 0) die(`query ${TABLE} 失敗：${r.out.slice(0, 200)}`);
  const d = JSON.parse(r.out);
  if (d.LastEvaluatedKey) die(`${TABLE} 未分頁完 —— 這一頁的筆數不代表全部`);
  return d.Items ?? [];
}

const kindsOf = (items) => items.map((i) => i.kind?.S ?? '(缺欄)').sort();

function cleanup(userId) {
  for (const it of rowsOf(userId)) {
    const r = ddb(['delete-item', '--table-name', TABLE, '--key', JSON.stringify({ pk: it.pk, sk: it.sk })]);
    if (r.rc !== 0) no(`刪列失敗：${r.out.slice(0, 160)}`);
  }
  for (const tbl of ['Users', 'AuthIdentities', 'AuthTokens']) {
    const sc = ddb(['scan', '--table-name', PREFIX + tbl, '--output', 'json']);
    if (sc.rc !== 0) { no(`清帳號時掃 ${tbl} 失敗`); continue; }
    const sd = JSON.parse(sc.out);
    if (sd.LastEvaluatedKey) { no(`${tbl} 未分頁完 —— 不宣稱已清乾淨`); continue; }
    const ks = ddb(['describe-table', '--table-name', PREFIX + tbl,
      '--query', 'Table.KeySchema[].AttributeName', '--output', 'json']);
    const keys = ks.rc === 0 ? JSON.parse(ks.out) : [];
    for (const it of sd.Items ?? []) {
      if (!JSON.stringify(it).includes(userId)) continue;
      if (!keys.length || !keys.every((k) => k in it)) continue;
      const r = ddb(['delete-item', '--table-name', PREFIX + tbl,
        '--key', JSON.stringify(Object.fromEntries(keys.map((k) => [k, it[k]])))]);
      if (r.rc !== 0) no(`刪 ${tbl} 失敗：${r.out.slice(0, 160)}`);
    }
  }
}

const require_ = createRequire(import.meta.url);
// playwright 不在本 repo 的相依裡（前端與 infra 是不同 build 體系）。
// 依序試：E2E_PW 指定的路徑 → 一般解析 → 本機既有的 runner。
// 🔴 找不到時 **rc=2 不是 rc=1**：沒有瀏覽器＝沒量到，不是「量到失敗」。
let chromium, devices;
{
  const cands = [process.env.E2E_PW, 'playwright', '/opt/sml/.buildtmp/pw-runner/node_modules/playwright'].filter(Boolean);
  const errs = [];
  for (const c of cands) {
    try { ({ chromium, devices } = require_(c)); break; } catch (e) { errs.push(`${c}: ${e.message.split('\n')[0]}`); }
  }
  if (!chromium) die(`載不到 playwright，試過：\n    ${errs.join('\n    ')}\n  可用 E2E_PW=/path/to/playwright 指定`);
}

const main = async () => {
  mkdirSync(SHOT_DIR, { recursive: true });

  console.log('══ 前置：註冊一個真使用者 ══');
  const tag = Date.now();
  const reg = await fetch(`${API}/app-register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `d4ge2e+${tag}@example.com`, password: 'D4gE2e12345!', displayName: MARK }),
  });
  const rb = await reg.json().catch(() => ({}));
  if (reg.status !== 200 || !rb.token) {
    die(`註冊失敗（最常見原因：app-register 每 IP 每小時 10 次的限流）。${reg.status}：${JSON.stringify(rb).slice(0, 200)}`);
  }
  const user = rb.data ?? rb.user ?? {};
  const userId = user.userId;
  if (!userId) die(`註冊成功但取不到 userId：${JSON.stringify(rb).slice(0, 200)}`);
  console.log(`  測試帳號 ${userId}`);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  // 🔴 **一定要用行動裝置模擬。** 桌面 viewport 會撞到 App 自己的
  //    「MOBILE ACCESS ONLY」閘門 —— 判台頁根本不會被渲染，於是
  //    「埋點沒掛上」與「頁面沒被顯示」在所有讀數上逐字相同（都是 0 筆 open）。
  //    第一版就是這樣紅了四項，而紅的是探針不是產品。
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  // 在任何頁面腳本之前把登入態墊好（形狀抄自 services/authService.ts:13-19）。
  await ctx.addInitScript(([k, tok, u]) => {
    localStorage.setItem(k.JWT, tok);
    localStorage.setItem(k.AUTH_TYPE, 'app');
    localStorage.setItem(k.USER, JSON.stringify(u));
    // 🔴 PWA 安裝閘門（components/PWAInstallPrompt.tsx:47-53）:
    //    standalone 判準是 matchMedia('(display-mode: standalone)') ||
    //    navigator.standalone || referrer 含 android-app://。
    //    真實使用者是把它加到主畫面後開的 ⇒ 這裡**模擬那個情境**，
    //    閘門本身不是受測物。少了這行,畫面停在「需安裝 APP」,
    //    而「埋點沒掛上」與「頁面沒被顯示」在所有讀數上逐字相同(都是 0 筆 open)。
    Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true });
  }, [KEYS, rb.token, user]);
  const page = await ctx.newPage();
  // matchMedia 那一條只有 CDP 改得動（navigator.standalone 是 iOS 專屬,兩條都墊才穩）。
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/voice-corrections')) posts.push(r.url()); });

  try {
    console.log('\n══ 反控：停在首頁，不進判台頁 ══');
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOT_DIR}/1-home.png` });
    const before = rowsOf(userId);
    if (before.length === 0) ok('首頁停留 3 秒後 0 筆（沒有「每次載入都送」）');
    else no(`首頁就寫了 ${before.length} 筆：${JSON.stringify(kindsOf(before))}`);

    console.log('\n══ 正控：進判台頁 ══');
    await page.evaluate(() => { window.location.hash = '#/training/voice-tai'; });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${SHOT_DIR}/2-voice-tai.png`, fullPage: true });

    // 🔴 畫面真的畫出來了嗎。只驗「有一筆 open」的話，
    //    「React 掛了但 useEffect 先跑完」也會過。
    //    ⚠️ 判準字串取自 `frontend/pages/TrainingVoiceTai.tsx:268` 的 h1，是「語音**報**台」。
    //    第一版寫「語音**判**台」而紅 —— 那四個字只出現在**記帳頁的入口卡**
    //    （Ledger.tsx:596）與文件裡，頁面本身從來沒有它。整份文件與檢查點都寫「判台」，
    //    所以這個錯很自然：**產品裡兩個名字並存，而只有一個會出現在這一頁上。**
    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes('語音報台')) ok('畫面上找得到「語音報台」（React 真的畫出來了，不是只有 bundle 載進來）');
    else no(`畫面上沒有「語音報台」。前 200 字：${JSON.stringify(body.slice(0, 200))}`);

    const after = rowsOf(userId);
    const opens = after.filter((i) => i.kind?.S === 'open');
    if (opens.length === 1) ok('進頁後恰好 1 筆 kind=open');
    else no(`kind=open 筆數是 ${opens.length}（期望 1）。全部：${JSON.stringify(kindsOf(after))}`);
    if (posts.length >= 1) ok(`瀏覽器確實對 /voice-corrections 發了 ${posts.length} 次 POST`);
    else no('瀏覽器沒有發出任何 /voice-corrections 的 POST —— 埋點沒被掛上');

    // 事件列**不可以**帶 added/removed（寫入端第二道防線，§11.11）。
    const spill = ['added', 'removed', 'parsed', 'corrected'].filter((f) => opens[0] && f in opens[0]);
    if (opens[0]) {
      if (spill.length === 0) ok('事件列不含 added/removed/parsed/corrected（第二道防線在線上成立）');
      else no(`事件列帶著 ${spill} 進表 —— 假的訂正建議會被回灌`);
    }

    console.log('\n══ 後台那一端看得到嗎 ══');
    const secret = execFileSync('aws', ['ssm', 'get-parameter', '--region', REGION,
      '--name', '/ryojaku/stg/ADMIN_JWT_SECRET', '--with-decryption',
      '--query', 'Parameter.Value', '--output', 'text'], { encoding: 'utf8' }).trim();
    const b64 = (b) => Buffer.from(b).toString('base64url');
    const { createHmac } = await import('node:crypto');
    const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const p = b64(JSON.stringify({ sub: 's2admin', role: 'super_admin', exp: Math.floor(Date.now() / 1000) + 600 }));
    const adminTok = `${h}.${p}.${b64(createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
    const ar = await fetch('https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg/admin/voice-corrections',
      { headers: { Authorization: `Bearer ${adminTok}` } });
    if (ar.status !== 200) die(`後台端點回 ${ar.status}`);
    const ab = await ar.json();
    if (ab.pageEvents?.open >= 1) ok(`後台 pageEvents.open = ${ab.pageEvents.open}（漏斗第二步有載體了）`);
    else no(`後台 pageEvents.open = ${ab.pageEvents?.open} —— 寫進去了但後台看不到`);
    const mine = (ab.data ?? []).filter((r) => r.userId === userId);
    if (mine.length === 0) ok('事件列沒有混進 data（後台第一道過濾在線上成立）');
    else no(`事件列混進了 data ${mine.length} 筆 —— 未訂正率會往「判很準」灌水`);
  } finally {
    await page.screenshot({ path: `${SHOT_DIR}/3-final.png` }).catch(() => {});
    await browser.close();
    console.log('\n── 清理（不管上面成敗都要跑）');
    cleanup(userId);
    const left = rowsOf(userId);
    if (left.length === 0) ok(`測試資料已清乾淨（截圖留在 ${SHOT_DIR}）`);
    else no(`仍有 ${left.length} 筆殘留`);
  }

  console.log(`\n${fails === 0 ? '== rc=0：真瀏覽器 → 後端 → 後台，整條漏斗成立 ==' : `== rc=1：${fails} 項失敗 ==`}`);
  process.exit(fails === 0 ? 0 : 1);
};

main().catch((e) => die(`探針自己炸了：${e?.stack ?? e}`));
