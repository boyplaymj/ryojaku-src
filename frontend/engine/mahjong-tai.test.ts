// engine/mahjong-tai.test.ts — 判台引擎「包裝層」測試（D2-2a）
//
// 測的是 ./mahjong-tai/index.mjs 這層 ESM 包裝（D2-1 出事的正是這層），
// 不是引擎本身 —— 引擎的 52 條 CJS 測試留在正典 repo
// （/opt/sml/repo/tools/mahjong-tai/*.test.js）用 node xxx.test.js 跑，不搬。
//
// 🔴 本檔必須放在 engine/ 這一層、且 runner glob 只收 engine/*.test.ts ——
//    絕不可讓 glob 掃到 engine/mahjong-tai/*.js：那三支是 UMD/CJS，
//    在 "type":"module" 下會當場 `require is not defined`（DESIGN_APP.md §11.3a）。
//    也不可把本檔放進 engine/mahjong-tai/ 裡：那個目錄是 sync_manifest.txt
//    管的同步副本，多一個檔就要動 manifest 與 verify_sync.sh 的下限。
//
// ⚠️ 台數定錨（實測 2026-09-02，node-22 直接跑副本）：
//    parse().total **含底**（fan_table.config.base_di = 1）；
//    設計冊的台數表是「純台數」= sum(hits.tai) = total - base_di。
//      連三拉三: 純 7 台 / total 8
//      拉三元:   純 8 台 / total 9
//    拿設計冊數字直接斷言 total 會整排差 1，看起來就像引擎少算一台（§11.2）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MahjongPhonetic, MahjongTai, MahjongFeedback } from './mahjong-tai/index.mjs';

const TABLE = JSON.parse(
  readFileSync(new URL('./mahjong-tai/fan_table.json', import.meta.url), 'utf8'),
);

// 與 demo.html／正典 phonetic.test.js 的 demoPipeline 同一條管線
function pipeline(rawText: string) {
  MahjongPhonetic.buildIndex(TABLE, TABLE.combos || [], TABLE.ignores || []);
  const norm = MahjongPhonetic.normalize(rawText);
  const res = MahjongTai.parse(norm.normalizedText || rawText, TABLE);
  const pure = res.hits.reduce((s: number, h: { tai: number }) => s + h.tai, 0);
  return { res, pure };
}

test('包裝層：三個具名匯出都載到了，而且是可用的物件', () => {
  assert.equal(typeof MahjongPhonetic.buildIndex, 'function', 'MahjongPhonetic.buildIndex');
  assert.equal(typeof MahjongPhonetic.normalize, 'function', 'MahjongPhonetic.normalize');
  assert.equal(typeof MahjongTai.parse, 'function', 'MahjongTai.parse');
  assert.ok(MahjongFeedback && typeof MahjongFeedback === 'object', 'MahjongFeedback 沒載到');
});

test('定錨前提：base_di 仍是 1（變了的話下面兩條的 total 期望值要跟著動）', () => {
  assert.equal(TABLE.config?.base_di, 1);
});

test('定錨①「連三拉三」：純 7 台，total 8（含底）', () => {
  const { res, pure } = pipeline('連三拉三');
  assert.equal(pure, 7, `純台數 hits=${JSON.stringify(res.hits)}`);
  assert.equal(res.total, 8, 'total 應為 純台數 + base_di');
});

test('定錨②「拉三元」：純 8 台，total 9（含底），且不可誤判成別的牌型組合', () => {
  const { res, pure } = pipeline('拉三元');
  assert.equal(pure, 8, `純台數 hits=${JSON.stringify(res.hits)}`);
  assert.equal(res.total, 9, 'total 應為 純台數 + base_di');
});
