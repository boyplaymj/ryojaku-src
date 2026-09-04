// utils/rulesetSource.test.ts — App 端選表與快取（D5-d）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這一組守的是四件「錯了不會有東西轉紅」的事：
//   ① 版本用字串比大小（"0.10.0" < "0.9.0" 是真的）—— 方向是把落後說成領先＝放行
//   ② 同版異容時取遠端（那是錯誤狀態，bundle 才是出貨前被守衛檢查過的）
//   ③ 遠端比 bundle 舊時吃遠端（主動降級，而畫面完全正常）
//   ④ 快取讀回來不重驗（localStorage 是別人也寫得進去的地方）
//
// 每一條的失敗都不會有任何錯誤訊息 —— 台數表壞掉的樣子是「判得比較不準」。

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFetch,
  CACHE_KEY,
  classifyRulesetResponse,
  clearCache,
  compareVersion,
  parseRemote,
  parseVersion,
  pickRuleset,
  readCache,
  toTable,
  writeCache,
  type RemoteRuleset,
  type StorageLike,
} from './rulesetSource.ts';
import type { AsrFanTable } from './voiceTaiAsr.ts';

/** 最小可用的 bundle 表。categories 刻意只列兩個，用來驗「分組借 bundle 的」。 */
function bundleTable(version = '0.2.0'): AsrFanTable {
  return {
    meta: { version },
    categories: ['莊家', '牌型'],
    fans: [
      { id: 'zhuang', name: '莊家', tai: 1, category: '莊家' },
      { id: 'pinghu', name: '平胡', tai: 2, category: '牌型' },
    ],
    combos: [{ surfaces: ['門清自摸'], expand: [{ id: 'menqing', count: 1 }] }],
    ignores: ['自摸'],
    config: { base_di: 1 },
  } as AsrFanTable;
}

function remote(version: string, extra: Partial<RemoteRuleset> = {}): RemoteRuleset {
  return {
    version,
    fans: [{ id: 'zhuang', name: '莊家', tai: 2, category: '莊家' } as any],
    combos: [],
    ignores: [],
    config: { base_di: 2 },
    ...extra,
  };
}

/** 假 storage。刻意用 Map 而不是共用的模組層物件 —— 每條測試各自 fresh。 */
function fakeStorage(seed?: Record<string, string>): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed || {}));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

// ── 版本比較 ────────────────────────────────────────────────────────

test('RS-1 【反控】字串比大小是錯的 —— 這條先證明尺有鑑別力', () => {
  // 🔴 沒有這一條的話，下一條「0.10.0 > 0.9.0」可能是隨便寫都會過的同義反覆。
  //    先釘住「天真的寫法在這組輸入上是錯的」，後面那條才有意義。
  assert.equal('0.10.0' < '0.9.0', true, '字串比法：0.10.0 竟然「小於」0.9.0');
});

test('RS-2 版本用數字元組比：0.10.0 比 0.9.0 新', () => {
  assert.equal(compareVersion(parseVersion('0.10.0')!, parseVersion('0.9.0')!), 1);
  assert.equal(compareVersion(parseVersion('0.9.0')!, parseVersion('0.10.0')!), -1);
  assert.equal(compareVersion(parseVersion('1.2.3')!, parseVersion('1.2.3')!), 0);
});

test('RS-3 段數不同時較短的較小（與 check_ruleset_seeded.py 的元組比較同語意）', () => {
  // Python 的 (0,2) < (0,2,0) 是真的。兩端對「誰比較新」意見不同的話，
  // 會出現「守衛放行、App 卻退回 bundle」這種沒有人看得懂的狀態。
  assert.equal(compareVersion(parseVersion('0.2')!, parseVersion('0.2.0')!), -1);
  assert.equal(compareVersion(parseVersion('0.3')!, parseVersion('0.2.9')!), 1);
});

test('RS-4 排不出先後的版本回 null，不猜', () => {
  for (const bad of ['', '0.2.0-rc1', 'v0.2.0', '0..2', '0.2.', ' 0.2.0 x', '２.０', null, 3, undefined]) {
    assert.equal(parseVersion(bad as unknown), null, `${JSON.stringify(bad)} 不該被當成版本`);
  }
  // ⚠️ Number('') 是 0、Number(' 1 ') 是 1 —— 用 Number 判會讓這些變成合法版本。
  assert.deepEqual(parseVersion(' 0.2.0 '), [0, 2, 0], '前後空白是可以 trim 的');
});

// ── 遠端驗證 ────────────────────────────────────────────────────────

test('RS-5 合法的五鍵通過', () => {
  const p = parseRemote(remote('0.3.0'));
  assert.equal(p.kind, 'ok');
  if (p.kind === 'ok') assert.equal(p.value.version, '0.3.0');
});

test('RS-6 fans 空陣列不收 —— 空表會讓每句話判 0 台，而那與「表還沒建」讀數逐字相同', () => {
  const p = parseRemote(remote('0.3.0', { fans: [] }));
  assert.equal(p.kind, 'bad');
  if (p.kind === 'bad') assert.match(p.why, /fans/);
});

test('RS-7 每一種缺損都要說得出來，而且不回半份表', () => {
  const cases: Array<[string, unknown]> = [
    ['不是物件', ['a']],
    ['不是物件', null],
    ['version 缺席', { ...remote('0.3.0'), version: undefined }],
    ['version 空字串', { ...remote('0.3.0'), version: '  ' }],
    ['version 不是點分數字', { ...remote('0.3.0'), version: '2026-09-04' }],
    ['fans 不是陣列', { ...remote('0.3.0'), fans: {} }],
    ['fans 項目沒 id', { ...remote('0.3.0'), fans: [{ name: '莊家' }] }],
    ['combos 不是陣列', { ...remote('0.3.0'), combos: null }],
    ['ignores 不是陣列', { ...remote('0.3.0'), ignores: 'none' }],
    ['config 不是物件', { ...remote('0.3.0'), config: [] }],
  ];
  for (const [label, raw] of cases) {
    const p = parseRemote(raw);
    assert.equal(p.kind, 'bad', `${label} 應該不收`);
    if (p.kind === 'bad') assert.ok(p.why.length > 0, `${label} 要說得出原因`);
  }
});

test('RS-8 config: {} 是合法的 —— base_di 缺席＝這家沒有底，不是遺失', () => {
  // scoring.js:165 `if (cfg.base_di)` 讓「缺席」與「0」逐值相同。
  // 要求 config 有內容等於發明一條引擎沒有的約束。
  assert.equal(parseRemote(remote('0.3.0', { config: {} })).kind, 'ok');
  assert.equal(parseRemote(remote('0.3.0', { ignores: [] })).kind, 'ok');
});

// ── 選表 ────────────────────────────────────────────────────────────

test('RS-9 遠端比較新 ⇒ 用遠端，version 誠實回報遠端那一版', () => {
  const p = pickRuleset({ bundle: bundleTable('0.2.0'), remote: remote('0.3.0') });
  assert.equal(p.source, 'remote');
  assert.equal(p.version, '0.3.0');
  assert.equal(p.table.meta?.version, '0.3.0', 'meta.version 也要跟著換，否則下游拿到的是舊號');
  assert.equal(p.table.config?.base_di, 2, '計分欄位要真的換成遠端那份');
});

test('RS-10 遠端比 bundle 舊 ⇒ 用 bundle（忘了播種，不是拿它降級）', () => {
  const p = pickRuleset({ bundle: bundleTable('0.2.0'), remote: remote('0.1.0') });
  assert.equal(p.source, 'bundle');
  assert.equal(p.version, '0.2.0');
  assert.match(p.reason, /播種/);
});

test('RS-11 同版 ⇒ 用 bundle（同版異容是錯誤狀態，bundle 才是被守衛檢查過的）', () => {
  // 遠端這份的 base_di 是 2、bundle 是 1，內容真的不同。
  // 取遠端的話，一個 check_ruleset_seeded.py 會判 same-version-diff（rc=1）的
  // 錯誤狀態就會靜靜地在玩家手上生效。
  const p = pickRuleset({ bundle: bundleTable('0.2.0'), remote: remote('0.2.0') });
  assert.equal(p.source, 'bundle');
  assert.equal(p.table.config?.base_di, 1);
});

test('RS-12 沒有遠端也沒有快取 ⇒ bundle', () => {
  const p = pickRuleset({ bundle: bundleTable('0.2.0') });
  assert.equal(p.source, 'bundle');
  assert.equal(p.version, '0.2.0');
});

test('RS-13 這次沒拿到遠端、但快取比 bundle 新 ⇒ 用快取', () => {
  const p = pickRuleset({ bundle: bundleTable('0.2.0'), remote: null, cached: remote('0.4.0') });
  assert.equal(p.source, 'cache');
  assert.equal(p.version, '0.4.0');
});

test('RS-14 快取比新 bundle 舊 ⇒ 用 bundle（App 發版比播種快的那一側）', () => {
  // 不處理這一側的話，App 更新後還在用舊快取 ——
  // 而那與「遠端本來就是舊的」在畫面上逐字相同。
  const p = pickRuleset({ bundle: bundleTable('0.5.0'), cached: remote('0.4.0') });
  assert.equal(p.source, 'bundle');
  assert.equal(p.version, '0.5.0');
});

test('RS-15 remote 與 cache 同為最新 ⇒ 取 remote（比較新鮮）', () => {
  const p = pickRuleset({
    bundle: bundleTable('0.2.0'),
    remote: remote('0.4.0', { config: { base_di: 7 } }),
    cached: remote('0.4.0', { config: { base_di: 9 } }),
  });
  assert.equal(p.source, 'remote');
  assert.equal(p.table.config?.base_di, 7);
});

test('RS-16 快取比這次的遠端新 ⇒ 取快取（遠端被回退了，不要跟著退）', () => {
  const p = pickRuleset({ bundle: bundleTable('0.2.0'), remote: remote('0.3.0'), cached: remote('0.4.0') });
  assert.equal(p.source, 'cache');
  assert.equal(p.version, '0.4.0');
});

test('RS-17 bundle 自己的版本排不出先後 ⇒ 不採用遠端（量不了的維度上不放行）', () => {
  const b = bundleTable('unknown');
  const p = pickRuleset({ bundle: b, remote: remote('9.9.9') });
  assert.equal(p.source, 'bundle');
  assert.equal(p.version, 'unknown');
  assert.match(p.reason, /排不出先後/);
});

// ── 混合表 ──────────────────────────────────────────────────────────

test('RS-18 分組借 bundle 的，計分五鍵來自遠端', () => {
  const b = bundleTable('0.2.0');
  const t = toTable(remote('0.3.0'), b);
  assert.deepEqual(t.categories, ['莊家', '牌型'], 'categories 不在下發契約裡，要借 bundle 的');
  assert.equal(t.fans.length, 1, 'fans 是遠端那份');
  assert.equal(t.meta?.version, '0.3.0');
});

test('RS-19 meta 只帶 version —— 不可以把 bundle 的說明文字搬過來', () => {
  // bundle 的 meta 有 title／notes／usage。搬過來的話畫面上會出現
  // 「這一版根本沒有的說明」，而它看起來完全正常。
  const b = bundleTable('0.2.0');
  (b.meta as any).notes = ['這是 0.2.0 的說明'];
  const t = toTable(remote('0.3.0'), b);
  assert.deepEqual(Object.keys(t.meta as object), ['version']);
});

// ── 快取 ────────────────────────────────────────────────────────────

test('RS-20 寫進去讀得回來', () => {
  const s = fakeStorage();
  assert.equal(writeCache(s, remote('0.3.0')), true);
  assert.equal(s.map.has(CACHE_KEY), true);
  assert.equal(readCache(s)?.version, '0.3.0');
});

test('RS-21 快取讀回來要重跑驗證 —— localStorage 是別人也寫得進去的地方', () => {
  // 🔴 這條就是本檔的核心。「存進去時驗過了」不涵蓋「讀出來的還是那個形狀」。
  for (const poison of ['{ 壞掉的 json', 'null', '{}', JSON.stringify({ ...remote('0.3.0'), fans: [] })]) {
    const s = fakeStorage({ [CACHE_KEY]: poison });
    assert.equal(readCache(s), null, `${poison.slice(0, 20)} 應該讀不出東西`);
  }
});

test('RS-22 沒有 storage／讀寫拋錯時不炸（Safari 無痕）', () => {
  assert.equal(readCache(null), null);
  assert.equal(writeCache(null, remote('0.3.0')), false);
  const throwing: StorageLike = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceeded'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  assert.equal(readCache(throwing), null);
  assert.equal(writeCache(throwing, remote('0.3.0')), false);
  assert.doesNotThrow(() => clearCache(throwing));
});

test('RS-23 clearCache 只清自己那一把鑰匙', () => {
  const s = fakeStorage({ [CACHE_KEY]: JSON.stringify(remote('0.3.0')), mahjongclub_jwt_token: 'keep-me' });
  clearCache(s);
  assert.equal(s.map.has(CACHE_KEY), false);
  assert.equal(s.map.get('mahjongclub_jwt_token'), 'keep-me', '不可以順手清掉別人的東西');
});

// ── 這一次連線的結果 ────────────────────────────────────────────────

test('RS-24 200 帶合法五鍵 ⇒ ok', () => {
  const f = classifyRulesetResponse({ success: true, ...remote('0.3.0') });
  assert.equal(f.kind, 'ok');
  if (f.kind === 'ok') assert.equal(f.value.version, '0.3.0');
});

test('RS-25 404 ⇒ not-found（後端權威地說沒有）', () => {
  const f = classifyRulesetResponse({ success: false, status: 404, error: 'ruleset not found' });
  assert.equal(f.kind, 'not-found');
});

test('RS-26 502／斷線／401／403 ⇒ unavailable，不可以說成 not-found', () => {
  // 🔴 這條就是本檔第二個核心。合成同一種的話，一次後端故障就會把所有人
  //    手上的下發表清光 —— 而台數表換回 bundle 不會有任何錯誤訊息。
  for (const res of [
    { success: false, status: 502, error: 'ruleset malformed' },
    { success: false, error: 'Failed to fetch' },            // 網路層，連 status 都沒有
    { success: false, error: '連線已過期，請重新登入' },      // 401 分支不帶 status
    { success: false, error: '服務維護中，請稍後再試' },      // 403 維護模式
  ]) {
    const f = classifyRulesetResponse(res);
    assert.equal(f.kind, 'unavailable', JSON.stringify(res));
    if (f.kind === 'unavailable') assert.ok(f.why.length > 0, '要說得出這次為什麼沒問到');
  }
});

test('RS-27 200 但內容不收 ⇒ unavailable，不是 not-found', () => {
  // 「拿到但不收」不是「後端說沒有」。拿它去清快取，
  // 是把自己的懷疑當成後端的結論。
  const f = classifyRulesetResponse({ success: true, ...remote('0.3.0'), fans: [] });
  assert.equal(f.kind, 'unavailable');
  if (f.kind === 'unavailable') assert.match(f.why, /200 但內容不收/);
});

test('RS-28 回應根本不是物件 ⇒ unavailable', () => {
  for (const bad of [null, undefined, 'oops', 42]) {
    assert.equal(classifyRulesetResponse(bad).kind, 'unavailable');
  }
});

// ── 拿到結果之後該做什麼 ────────────────────────────────────────────

test('RS-29 拿到表 ⇒ 寫快取、換表，不丟快取', () => {
  const o = applyFetch({ kind: 'ok', value: remote('0.3.0') });
  assert.equal(o.store, true);
  assert.equal(o.dropCache, false);
  assert.equal(o.remote?.version, '0.3.0');
});

test('RS-30 404 ⇒ 丟快取，不寫、不換', () => {
  const o = applyFetch({ kind: 'not-found' });
  assert.equal(o.dropCache, true);
  assert.equal(o.store, false);
  assert.equal(o.remote, null);
  assert.ok(o.note.includes('404'), '要在 console 講一句，否則退回 bundle 完全沒有徵兆');
});

test('RS-31 🔴 沒問到 ⇒ 什麼都不改（尤其**不可以**丟快取）', () => {
  // 這條是 D5-d 最容易寫反的一行：把 unavailable 也拿去清快取的話，
  // 一次後端故障就會把所有人手上的下發表清光，而畫面上完全看不出來。
  const o = applyFetch({ kind: 'unavailable', why: 'HTTP 502' });
  assert.equal(o.dropCache, false, '502 不是「後端說沒有」，是「這次沒問到」');
  assert.equal(o.store, false);
  assert.equal(o.remote, null);
  assert.ok(o.note.length > 0);
});

// ── 端到端（四種回應走完整條鏈：classify → applyFetch → 快取 → pick）──
//
// ⚠️ 界線：這是**純邏輯**那一層的端到端，走的是真的模組、真的快取讀寫。
//    它涵蓋不到 hooks/useRuleset.ts 的 React 接線（本專案沒有 DOM runner，
//    hooks/ 也不在 run-tests.mjs 的 glob 裡）—— 那一層由下面 RS-36 的
//    原始碼守衛頂著，而那是比測試弱的一種證據，不要讀成同一件事。

function chain(res: unknown, storage: StorageLike, bundle: AsrFanTable) {
  const out = applyFetch(classifyRulesetResponse(res));
  if (out.store && out.remote) writeCache(storage, out.remote);
  if (out.dropCache) clearCache(storage);
  return pickRuleset({ bundle, remote: out.remote, cached: out.dropCache ? null : readCache(storage) });
}

test('RS-32 【E2E】200 帶比 bundle 新的表 ⇒ 用它，而且下一次進頁（只有快取）還在', () => {
  const s = fakeStorage();
  const b = bundleTable('0.2.0');
  const first = chain({ success: true, ...remote('0.3.0') }, s, b);
  assert.equal(first.source, 'remote');
  assert.equal(first.version, '0.3.0');
  // 下一次進頁：還沒抓到遠端之前，快取就該讓它是 0.3.0
  const nextVisit = pickRuleset({ bundle: b, remote: null, cached: readCache(s) });
  assert.equal(nextVisit.source, 'cache');
  assert.equal(nextVisit.version, '0.3.0');
});

test('RS-33 【E2E】200 但與 bundle 同版 ⇒ 用 bundle（穩態零行為差異）', () => {
  // 🔴 這條同時是本功能的**現況**：stg DDB 與 bundle 都是 0.2.0
  //    ⇒ D5-d 上線後，在有人 bump 版本之前，玩家看到的表與現在逐字相同。
  const s = fakeStorage();
  const p = chain({ success: true, ...remote('0.2.0') }, s, bundleTable('0.2.0'));
  assert.equal(p.source, 'bundle');
  assert.equal(p.table.config?.base_di, 1, '用的是 bundle 的底，不是遠端那份的 2');
});

test('RS-34 【E2E】404 ⇒ 快取被丟掉，退回 bundle', () => {
  const s = fakeStorage({ [CACHE_KEY]: JSON.stringify(remote('0.9.0')) });
  const p = chain({ success: false, status: 404, error: 'ruleset not found' }, s, bundleTable('0.2.0'));
  assert.equal(p.source, 'bundle');
  assert.equal(s.map.has(CACHE_KEY), false, '404 之後那份複本沒有來源了');
});

test('RS-35 【E2E】502 ⇒ 快取原封不動，繼續用快取那份', () => {
  const s = fakeStorage({ [CACHE_KEY]: JSON.stringify(remote('0.9.0')) });
  const p = chain({ success: false, status: 502, error: 'ruleset malformed' }, s, bundleTable('0.2.0'));
  assert.equal(p.source, 'cache');
  assert.equal(p.version, '0.9.0');
  assert.equal(s.map.has(CACHE_KEY), true, '沒問到不可以丟掉手上那份');
});

// ── 接線（掃原始碼，因為這個專案沒有別的載體）────────────────────────

test('RS-36 判台頁真的接上了 useRuleset，而且 rulesetVersion 不是取自 bundle', () => {
  // 🔴 這條守的是「模組寫好卻沒人叫」與「叫了但版本號還是報 bundle 那個」。
  //    兩者都零徵兆：所有測試都會綠，畫面也完全正常，
  //    只有後台收到的 rulesetVersion 是假的（§12 那格的失效模式）。
  const page = readFileSync(new URL('../pages/TrainingVoiceTai.tsx', import.meta.url), 'utf8');
  assert.match(page, /useRuleset\(/, '判台頁沒有呼叫 useRuleset');
  assert.match(page, /rulesetVersion:\s*ruleset\.version/, 'rulesetVersion 應該取自實際用的那份表');
  const bundleVersionUses = page.match(/BUNDLE\.meta/g) || [];
  assert.deepEqual(bundleVersionUses, [], 'rulesetVersion 不可以取自 BUNDLE —— 那會回報「我打算用的」而不是「我實際用的」');
});

test('RS-37 hook 沒有自己再寫一份「404 該不該清快取」的判準', () => {
  // applyFetch 是那條判準的唯一來源。hook 裡出現 kind === 'not-found'
  // 這種比對，代表判準又長出第二份 —— 而那一份在 glob 之外，沒有測試看得到。
  const hook = readFileSync(new URL('../hooks/useRuleset.ts', import.meta.url), 'utf8');
  assert.match(hook, /applyFetch\(/, 'hook 應該走 applyFetch');
  const code = hook.split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n');
  assert.doesNotMatch(code, /'not-found'|'unavailable'/, 'hook 不可以自己判 kind —— 判準只留一份，在 utils 那層');
});
