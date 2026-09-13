#!/usr/bin/env node
// 上架必要網頁的單一來源（A1）。
//
// 商店的擋門項：Apple 要隱私權政策 URL；Google Play 對「可註冊帳號」的 App 另外要求
// **不必登入就能到達**的帳號刪除網頁。三頁都必須是公開、靜態、不依賴登入狀態的網址。
//
// 為什麼是獨立 HTML 而不是 SPA 的路由：
//   1. 前端走 HashRouter（App.tsx:2）⇒ 網址長成 https://…/#/privacy，而 `#` 後面那段
//      **不會送到伺服器**。審核員貼上網址時只要 JS 沒跑起來就是一片白，
//      而「白頁」與「頁面不存在」在審核員眼裡逐字相同。
//   2. ~~進 SPA 等於燒進 binary，而這三頁本來就歸 Web~~
//      🔴 **2026-09-13 訂正（Codex 覆驗推翻）：這條理由是假的，對本方案零鑑別力。**
//      Vite 會把 public/ 原樣複製進 dist，而 capacitor.config.ts 的 webDir 正是 dist
//      ⇒ **放 public/ 一樣會燒進 binary**。走 SPA 路由或走 public/，在這一點上完全相同。
//      真正成立的只有 1. 與 3.（兩者都是「審核員貼上網址會看到什麼」的問題）。
//      進 binary 的實際代價：約 35 KB 死重（App 內顯示條款走 TermsOfServiceModal，
//      不讀這兩個 html），可接受 ⇒ 本次不改架構，只訂正這句話。
//      留下刪節線是刻意的：我在 commit 8950f98 的訊息裡把它當成設計理由講過，
//      而那顆 commit 改不了（共用工作樹禁止 amend）。
//   3. CloudFront 設了 403/404 → /index.html 的 SPA fallback（provision-stg-cdn.sh:67-69）
//      ⇒ **無副檔名的 /privacy 會被 fallback 吃掉變成 SPA**。所以輸出一律帶 .html，
//      那是實體物件，S3 直接給，不經過 fallback。
//
// 為什麼要有這支（而不是手寫三個 HTML）：
//   條款內文有**兩個載體** —— App 內的 TermsOfServiceModal 與這個公開網頁。
//   複製一份就會漂，而漂掉零徵兆（沒有人會把兩邊拿來對照）。
//   ⇒ 這裡從 modal 的 termsContent **抽取**，modal 永遠是唯一來源。
//
// 兩種模式共用同一個 render()：
//   node scripts/gen-legal.mjs           產生 public/*.html
//   node scripts/gen-legal.mjs --check   只比對、**一個位元組都不寫**，不一致回 rc=1
//
// exit code 三態（照 infra/scan_verifier_exit_codes.py 的約定，三者不可共用）：
//   0 = 一致／已產生
//   1 = 被測物不一致（產物過期，跑一次不帶 --check 即可修）
//   2 = **儀器或前提壞了**（來源檔不見、抓不到字串、字串含插值）—— 不可讀成通過

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** frontend/ 的絕對路徑。刻意不吃 process.cwd() —— prebuild、測試、CI 的 cwd 不保證相同。 */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_INSTRUMENT = 2;

/** 儀器/前提問題。與「產物過期」刻意分開 —— 後者跑一次就好，前者要去看基礎設施。 */
export class InstrumentError extends Error {}

const TERMS_SOURCE = join(ROOT, 'components', 'TermsOfServiceModal.tsx');
const TERMS_ANCHOR = 'const termsContent = `';

/**
 * 從 App 內的 modal 抽出條款全文。
 *
 * 刻意不用正則一把抓 —— 三種壞法要分開回報，因為處置不同：
 *   找不到檔／找不到錨點  ⇒ modal 被改名或重構了，要人去看
 *   找不到結尾反引號      ⇒ 字串結構變了
 *   含 ${ }               ⇒ 它不再是靜態字串，抽出來的東西會少一段而**看起來完全正常**
 */
export function extractTerms(source) {
    const start = source.indexOf(TERMS_ANCHOR);
    if (start < 0) {
        throw new InstrumentError(`在 ${TERMS_SOURCE} 找不到錨點 ${TERMS_ANCHOR}`);
    }
    const bodyStart = start + TERMS_ANCHOR.length;
    const end = source.indexOf('`', bodyStart);
    if (end < 0) {
        throw new InstrumentError('找到開頭反引號但找不到結尾 —— 字串結構變了');
    }
    const body = source.slice(bodyStart, end);
    if (body.includes('${')) {
        throw new InstrumentError(
            'termsContent 含 ${ } 插值 ⇒ 它不是靜態字串，抽出來的內容會與 App 內顯示的不同'
        );
    }
    if (body.trim().length === 0) {
        throw new InstrumentError('termsContent 抽出來是空的');
    }
    return body.trim();
}

/**
 * 尚未定案的空格。刻意用 `<<NAME>>` 這種**不可能出現在法律文書裡**的形狀，
 * 而且渲染時原樣留在頁面上 —— 看得見的佔位比看不見的預設值安全得多。
 *
 * 🔴 為什麼不給預設值：這兩格分別是「聯絡信箱」與「刪除頁網址」。
 *    repo 裡現有的兩個信箱（no-reply@jiomj.com、support@mahjongclub.com）**都是他方的**，
 *    填上去等於在法律文件上叫使用者寄信到別人家。一個指向錯地方的預設值，
 *    比沒有預設值危險得多：後者出貨前會被擋下，前者要等真實使用者寄丟才發現。
 */
export function findPlaceholders(text) {
    return [...new Set((text.match(/<<[A-Z_]+>>/g) || []))];
}

const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 把純文字法律文書排成 HTML。
 * 章（第N章）與條（第N條）各自成標題，其餘為段落；空行分段。
 */
function renderBody(text) {
    const out = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const esc = escapeHtml(line);
        if (/^第[一二三四五六七八九十百]+章/.test(line)) {
            out.push(`      <h2>${esc}</h2>`);
        } else if (/^第[一二三四五六七八九十百]+條/.test(line)) {
            out.push(`      <h3>${esc}</h3>`);
        } else {
            out.push(`      <p>${esc}</p>`);
        }
    }
    return out.join('\n');
}

/**
 * 版面沿用 frontend/index.css 的既有 token（Minimal Lux）—— 刻意**不新增視覺語言**，
 * 也刻意不 import index.css：這三頁要在 JS/CSS 全掛的情況下依然讀得完。
 */
function renderPage({ title, subtitle, body }) {
    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} — 両雀</title>
<meta name="description" content="${escapeHtml(subtitle)}">
<style>
  :root {
    --bg-main: #f9f9f7; --bg-card: #ffffff; --bg-accent: #c5a059;
    --text-primary: #1a1a1a; --text-secondary: #717171; --border-lux: rgba(0,0,0,.08);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1rem 5rem;
    background: var(--bg-main); color: var(--text-primary);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
    line-height: 1.85; letter-spacing: -0.01em; -webkit-font-smoothing: antialiased;
  }
  main { max-width: 44rem; margin: 0 auto; background: var(--bg-card);
         border: 1px solid var(--border-lux); border-radius: 1.5rem; padding: 2.5rem 2rem; }
  header { max-width: 44rem; margin: 0 auto 1.5rem; }
  .brand { font-weight: 800; letter-spacing: .02em; color: var(--bg-accent); font-size: .875rem; }
  h1 { font-size: 1.6rem; font-weight: 800; margin: .25rem 0 .5rem; letter-spacing: -.02em; }
  .sub { color: var(--text-secondary); font-size: .9rem; margin: 0; }
  h2 { font-size: 1.1rem; font-weight: 800; margin: 2.25rem 0 .75rem;
       padding-top: 1.25rem; border-top: 1px solid var(--border-lux); }
  h2:first-of-type { border-top: 0; padding-top: 0; margin-top: 1.5rem; }
  h3 { font-size: .975rem; font-weight: 700; margin: 1.5rem 0 .4rem; color: var(--bg-accent); }
  p { margin: .4rem 0; font-size: .9375rem; }
  a { color: var(--bg-accent); }
  footer { max-width: 44rem; margin: 1.5rem auto 0; color: var(--text-secondary); font-size: .8125rem; }
  footer a { margin-right: 1rem; }
  @media (max-width: 32rem) { main { padding: 1.75rem 1.25rem; border-radius: 1rem; } }
</style>
</head>
<body>
  <header>
    <div class="brand">両雀</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">${escapeHtml(subtitle)}</p>
  </header>
  <main>
${body}
  </main>
  <footer>
    <a href="/terms.html">服務條款</a>
    <a href="/privacy.html">隱私權政策</a>
    <a href="/delete-account.html">刪除帳號</a>
  </footer>
</body>
</html>
`;
}

/**
 * 純計算，回傳 { 相對路徑 -> 內容 }。**不碰檔案系統的寫入端** ——
 * --check 的「一個位元組都不寫」是靠這個結構保證的，不是靠註解。
 */
export function render() {
    if (!existsSync(TERMS_SOURCE)) {
        throw new InstrumentError(`來源不存在：${TERMS_SOURCE}`);
    }
    const terms = extractTerms(readFileSync(TERMS_SOURCE, 'utf8'));

    const privacySrc = join(ROOT, 'legal', 'privacy.txt');
    if (!existsSync(privacySrc)) {
        throw new InstrumentError(`來源不存在：${privacySrc}`);
    }
    const privacy = readFileSync(privacySrc, 'utf8').trim();
    if (!privacy) throw new InstrumentError('legal/privacy.txt 是空的');

    return {
      raw: `${terms}\n${privacy}`,
      files: {
        'public/terms.html': renderPage({
            title: '服務條款',
            subtitle: '本頁內容與 App 內顯示的條款由同一份原始碼產生。',
            body: renderBody(terms),
        }),
        'public/privacy.html': renderPage({
            title: '隱私權政策',
            subtitle: '我們蒐集哪些資料、為什麼蒐集、存在哪裡，以及你可以要求我們做什麼。',
            body: renderBody(privacy),
        }),
      },
    };
}

export function main(argv) {
    const gate = argv.includes('--gate');
    // 🔴 --gate 蘊含 --check：一道會改動工作樹的閘不是閘。
    //    （第一版把兩者寫成獨立旗標 ⇒ 只帶 --gate 時走的是寫入分支，
    //     它會「順手把漂掉的產物修好」然後回報一切正常 —— 那正是它該擋下的狀態。）
    const check = argv.includes('--check') || gate;
    let plan;
    try {
        plan = render();
    } catch (e) {
        if (e instanceof InstrumentError) {
            console.error(`✗ [rc=2 儀器/前提] ${e.message}`);
            console.error('  ⚠️ 這不是「產物過期」，跑一次 gen-legal.mjs 修不好，要去看來源檔。');
            return EXIT_INSTRUMENT;
        }
        throw e;
    }

    let drift = 0;
    for (const [rel, want] of Object.entries(plan.files)) {
        const abs = join(ROOT, rel);
        const got = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
        if (got === want) { console.log(`  = ${rel}`); continue; }
        drift += 1;
        if (check) {
            console.error(`✗ ${rel} ${got === null ? '不存在' : '與來源不一致'}`);
        } else {
            writeFileSync(abs, want);
            console.log(`  ${got === null ? '+' : '~'} ${rel}`);
        }
    }

    if (check && drift > 0) {
        console.error(`\n✗ [rc=1] ${drift} 個產物過期。跑 \`npm run gen-legal\` 後一起提交。`);
        return EXIT_DRIFT;
    }
    const pending = findPlaceholders(plan.raw);
    if (gate && pending.length > 0 && process.env.LEGAL_GATE_OFF === '1') {
        console.warn(`  ⚠️ LEGAL_GATE_OFF=1 ⇒ 放行 ${pending.length} 個佔位。這一包不可出貨。`);
        return EXIT_OK;
    }
    if (pending.length > 0) {
        const msg = `尚有 ${pending.length} 個未定案的佔位：${pending.join(' ')}`;
        if (gate) {
            console.error(`\n\u2717 [rc=1 \u51fa\u8ca8\u9598] ${msg}`);
            console.error('  \u9019\u4e09\u9801\u662f\u5546\u5e97\u7684\u64cb\u9580\u9805\uff0c\u5e36\u8457\u4f54\u4f4d\u4e0a\u7dda\u7b49\u65bc\u6c92\u505a\u3002');
            return EXIT_DRIFT;
        }
        console.warn(`  \u26a0\ufe0f ${msg}（\u672c\u5730\u5efa\u7f6e\u653e\u884c\uff1b\u51fa\u8ca8\u524d\u8dd1 --gate \u6703\u64cb\uff09`);
    }
    console.log(check ? '✓ 上架必要網頁與來源一致' : '✓ 上架必要網頁已產生');
    return EXIT_OK;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main(process.argv.slice(2)));
}
