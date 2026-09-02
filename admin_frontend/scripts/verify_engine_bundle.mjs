#!/usr/bin/env node
// verify_engine_bundle.mjs — 判台引擎在 admin_frontend 真實 production bundle 裡「會動」嗎
//
// 🔴 為什麼不能用 `vite build` rc=0 當判準：同 repo 的 frontend 實測過
//    （DESIGN_APP.md §11.5）：未補 build.commonjsOptions 時 `vite build` **rc=0**、
//    指紋也看得到引擎進了包（壞的那次數字還比較大），而**執行產物直接 throw**。
//    ⇒「有進包」與「會動」是兩件事，唯一分得出來的量測是**把產物 import 起來跑**。
//
// 本支做的事：
//   正控：用**專案真正的 vite.config.ts** 建一支探針 → import 產物 → 必須算得出建議
//   反控：同一份 config **只拿掉 build.commonjsOptions** → 必須失敗
//         🔴 反控若也通過，代表那段設定是 no-op —— 那要當成失敗回報（rc=1），
//            不可以留一段「看起來在保護什麼、其實沒有」的設定。
//
// rc: 0=正控通過且反控確實失敗  1=判準失敗  2=設備問題（建不起來/跑不動，不是「量到通過」）

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const WORK = join(ROOT, '.engine-probe');

function die(msg) {
  // 「量不到」不可以跟「量到通過」同號，更不可以跟失敗混在一起。
  console.error(`\n🔴 [設備] ${msg}`);
  process.exit(2);
}

// ── 探針：跟審核頁**用同一條 import 路徑**。
//    寫成別的路徑就變成「我另外找到一種載法可以動」，那不回答本支的問題。
const PROBE = `
import { MahjongFeedback } from '../src/engine/mahjong-tai/index.mjs';
import fanTable from '../src/engine/mahjong-tai/fan_table.json';

// 🔴 結果走 globalThis 副作用，不走 export。
//    app 模式（真 index.html entry）的 entry chunk 不保證保留 exports
//    （Vite 預設 preserveEntrySignatures:false）⇒ 用 export 取結果會量到
//    「拿不到 probe 函式」，而那跟「引擎沒載到」在版面上逐字相同。
globalThis.__ENGINE_PROBE__ = (() => { try { return probe(); } catch (e) { return { error: String(e && e.message || e) }; } })();

function probe() {
  const t = typeof MahjongFeedback?.extractSuggestions;
  if (t !== 'function') throw new Error('extractSuggestions 不是函式，實得 ' + t);
  // 兩筆同形狀的殘字糾正、兩個不同使用者 ⇒ 預設 minCount=2 必須升級成一則建議。
  //
  // 🔴 殘字**必須是 fan_table 裡沒有的詞**：extractSuggestions 會把已知詞
  //    （台種名／aliases／asr_confusions，共 159 個）排除掉，那正是它該做的事。
  //    第一版用「槓上開花」⇒ count=0，而那個 0 看起來跟「引擎沒載到」一模一樣
  //    （兩者都只是 count:0）。⇒ fixture 選詞要先確認它不在表裡。
  //    這裡刻意用一個**不可能被收錄**的字串，而不是挑一個現在剛好不在表裡的真詞
  //    ——後者哪天被回灌進 asr_confusions，這支就會無緣無故轉紅。
  const rec = (userId) => MahjongFeedback.recordCorrection({
    text: 'ZZ測試殘字', parsed: [], corrected: [fanTable.fans[0].id],
    unmatched: 'ZZ測試殘字', userId, ts: 1,
  });
  const out = MahjongFeedback.extractSuggestions([rec('u1'), rec('u2')], fanTable, { minCount: 2 });
  return { count: out.length, type: out[0]?.type, fans: fanTable?.fans?.length ?? 0 };
}
`;

// 🔴 **app 模式（真 index.html entry），不是 lib 模式。**
//    第一版用 build.lib 量，正控過、反控**也**過 ⇒ 讀起來像「commonjsOptions 是 no-op」。
//    但 lib 模式與產品實際跑的 app 模式，rollup 的 commonjs 處理不見得一樣 ——
//    那個讀數答的是別的問題。⇒ 這裡改用 html entry，跟 `npm run build` 同一條路。
const HTML = `<!doctype html><html><body><script type="module" src="./probe.ts"></script></body></html>`;

const CONFIG = `
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

export default defineConfig(async (env) => {
  const b = typeof base === 'function' ? await base(env) : base;
  const cfg = mergeConfig(b, {
    build: {
      rollupOptions: {
        input: new URL('./index.html', import.meta.url).pathname,
        output: { entryFileNames: 'probe.js' },
      },
      outDir: new URL('./out/', import.meta.url).pathname,
      emptyOutDir: true,
      minify: false,
      // 🔴 這是**探針的遷就**，不是受測項：app 模式會在 entry chunk 前面塞
      //    modulepreload polyfill，它一開頭就摸 document ⇒ 在 node 裡 import
      //    會炸「document is not defined」。那個紅跟 UMD 一點關係都沒有，
      //    而它出現的位置與真正的失敗一模一樣（§11.5 那個「紅了要看紅的是哪一條」）。
      //    關掉它不碰 commonjs 那條路，正控反控兩邊一起關 ⇒ 對比仍然成立。
      modulePreload: { polyfill: false },
    },
    logLevel: 'error',
  });
  // 反控：只拿掉這一項，其餘（plugins/define/target 解析）全部沿用真實設定。
  if (process.env.PROBE_NO_CJS === '1') delete cfg.build.commonjsOptions;
  return cfg;
});
`;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, 'probe.ts'), PROBE);
writeFileSync(join(WORK, 'index.html'), HTML);
writeFileSync(join(WORK, 'vite.probe.config.ts'), CONFIG);

function buildAndRun(noCjs) {
  const label = noCjs ? '反控（拿掉 commonjsOptions）' : '正控（專案真實 config）';
  const r = spawnSync('npx', ['vite', 'build', '--config', join(WORK, 'vite.probe.config.ts')], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, PROBE_NO_CJS: noCjs ? '1' : '0' },
  });
  if (r.status !== 0) {
    // build 失敗也算「不會動」，但要講清楚是哪一段失敗的 —— 紅了要看紅的是哪一條。
    return { label, ok: false, stage: 'build', detail: (r.stderr || r.stdout || '').trim().slice(-600) };
  }
  const out = join(WORK, 'out', 'probe.js');
  if (!existsSync(out)) return { label, ok: false, stage: 'build', detail: `產物不存在: ${out}` };
  return { label, ok: null, stage: 'run', out };
}

async function main() {
  const results = [];
  for (const noCjs of [false, true]) {
    const r = buildAndRun(noCjs);
    if (r.ok === false) { results.push(r); continue; }
    try {
      // cache buster：兩次 import 同一個路徑會拿到同一份模組快取，
      // 那會讓反控靜靜地重用正控的結果（而兩者在輸出上完全相同）。
      delete globalThis.__ENGINE_PROBE__;   // 不刪的話，反控會靜靜地讀到正控留下的結果
      await import(pathToFileURL(r.out).href + `?v=${Date.now()}-${noCjs}`);
      const got = globalThis.__ENGINE_PROBE__;
      if (!got) throw new Error('產物載入了，但沒有寫下 __ENGINE_PROBE__（entry chunk 沒執行到？）');
      if (got.error) throw new Error(got.error);
      if (got.count !== 1 || got.type !== 'add_confusion') {
        results.push({ ...r, ok: false, stage: 'assert', detail: `算出來的建議不對：${JSON.stringify(got)}` });
      } else {
        results.push({ ...r, ok: true, detail: JSON.stringify(got) });
      }
    } catch (e) {
      results.push({ ...r, ok: false, stage: 'run', detail: String(e.message || e).slice(0, 400) });
    }
  }

  const [pos, neg] = results;
  let fails = 0;
  console.log(`\n── ${pos.label}`);
  if (pos.ok) console.log(`  ✅ 產物 import 起來會動：${pos.detail}`);
  else { console.log(`  ❌ 產物不會動（${pos.stage}）：${pos.detail}`); fails++; }

  console.log(`\n── ${neg.label}`);
  if (neg.ok === false) {
    console.log(`  ✅ 如預期失敗（${neg.stage}）：${String(neg.detail).split('\n').pop().slice(0, 200)}`);
  } else {
    console.log('  ❌ 反控也通過了 ⇒ build.commonjsOptions 對這個專案是 no-op。');
    console.log('     不要留著一段「看起來在保護什麼、其實沒有」的設定 ——');
    console.log('     要嘛拿掉它，要嘛找出真正需要它的那條 import 路徑。');
    console.log(`     實得：${neg.detail}`);
    fails++;
  }

  rmSync(WORK, { recursive: true, force: true });
  console.log(fails === 0
    ? '\n== rc=0：正控會動、反控確實失敗 ⇒ commonjsOptions 是必要且有效的 =='
    : `\n== rc=1：${fails} 項判準失敗 ==`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => die(`探針自己炸了：${e && e.stack ? e.stack : e}`));
