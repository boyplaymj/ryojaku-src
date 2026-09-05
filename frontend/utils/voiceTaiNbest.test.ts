// utils/voiceTaiNbest.test.ts — N-best 候選挑選（§3.5）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 🔴 這裡的候選字串**不是我編的**，是拿真引擎跑過、確認過覆蓋數字的：
//      「大三元」  → covered 3/3、ids [dasanyuan]
//      「大聲援」  → covered 0/3、ids []            ← ASR 誤聽的典型形狀
//      「全部人」  → covered 0/3、ids []
//      「全求人」  → covered 3/3、ids [quanqiuren]
//      「打三塊」  → covered 2/3、ids [dasanyuan]   ← 判得出來但解釋不完整
//      「我胡了大三元」→ covered 3/6、ids [dasanyuan]
//      「喔」      → covered 0/1、ids []
//    編出來的話，這些測試只會求值我自己寫進 fixture 的那幾條假設
//    （見記憶 reference_fake_backend_only_evaluates_what_i_wrote）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recognize, type AsrFanTable } from './voiceTaiAsr.ts';
import {
  MAX_CANDIDATES,
  normalizeCandidates,
  recognizeBest,
} from './voiceTaiNbest.ts';

const TABLE: AsrFanTable = JSON.parse(
  readFileSync(new URL('../engine/mahjong-tai/fan_table.json', import.meta.url), 'utf8'),
);

test('N2-0 前提：這組 fixture 的覆蓋數字真的是我宣稱的那樣', () => {
  // 🔴 下面每一條測試的結論都靠這些數字。前提沒被驗過的話，
  //    測試通過只代表「排序函式對我給的數字排得對」，不代表它對真輸入有效。
  assert.equal(recognize(TABLE, '大三元').covered, 3);
  assert.equal(recognize(TABLE, '大聲援').covered, 0);
  assert.deepEqual(recognize(TABLE, '大聲援').ids, []);
  assert.equal(recognize(TABLE, '打三塊').covered, 2);
  assert.equal(recognize(TABLE, '我胡了大三元').covered, 3);
  assert.equal(recognize(TABLE, '我胡了大三元').syllables, 6);
  assert.equal(recognize(TABLE, '喔').covered, 0);
});

test('N2-1 首選判不出來、第二條判得出來 ⇒ 換掉首選', () => {
  // 這就是這一層存在的唯一理由。改這支之前，系統只會看第 0 條。
  const r = recognizeBest(TABLE, ['大聲援', '大三元', '大生源']);
  assert.equal(r.chosen, 1);
  assert.deepEqual(r.heard.ids, ['dasanyuan']);
  assert.equal(r.heard.raw, '大三元', 'raw 要是被選中那條，不是 ASR 首選');
});

test('N2-2 解釋得比較完整的勝出，即使首選也判得出台種', () => {
  // 「打三塊」判得出 dasanyuan（covered 2），但「大三元」把三個音都解釋掉了。
  // 只看「有沒有命中台種」的話這兩條無法區分 ⇒ 判準必須是覆蓋。
  const r = recognizeBest(TABLE, ['打三塊', '大三元']);
  assert.equal(r.chosen, 1);
  assert.equal(r.heard.leftover, '', '選中的那條不該有沒解釋掉的音');
});

test('N2-3 🔴 完全平手時**不換掉** ASR 首選', () => {
  // 「大三元」與「打三元」判台結果逐字相同（covered 3、同一個 id）。
  // 沒有這條 tie-break 的話，這一層會製造與準確度無關的變動 ——
  // 而那種變動查起來像 bug，卻沒有任何東西會轉紅。
  const r = recognizeBest(TABLE, ['大三元', '打三元']);
  assert.equal(r.chosen, 0);
  assert.equal(r.heard.raw, '大三元');
});

test('N2-4 🔴 短雜訊候選不得勝出（leftover 少不等於解釋得好）', () => {
  // 反控：若判準寫成「leftover 少者勝」，這裡會選中「喔」（leftover 1 < 3）
  // 而丟掉一個判得出大三元的候選 —— 使用者會看到「沒有對到任何台種」。
  const r = recognizeBest(TABLE, ['我胡了大三元', '喔']);
  assert.equal(r.chosen, 0);
  assert.deepEqual(r.heard.ids, ['dasanyuan']);
});

test('N2-5 全部候選都判不出來 ⇒ 回首選，行為與這一層不存在時相同', () => {
  const r = recognizeBest(TABLE, ['全部人', '跟他說', '電視劇']);
  assert.equal(r.chosen, 0, '沒有一條比較好時，不可以隨便換一條');
  assert.deepEqual(r.heard.ids, []);
  assert.equal(r.heard.raw, '全部人');
});

test('N2-6 真實形狀：ASR 首選錯字、次選才對（全求人）', () => {
  const r = recognizeBest(TABLE, ['全部人', '全球人']);
  assert.equal(r.chosen, 1);
  assert.deepEqual(r.heard.ids, ['quanqiuren']);
});

test('N2-7 candidates 保留全部候選與原順序（「它贏了誰」要有載體）', () => {
  const r = recognizeBest(TABLE, ['大聲援', '大三元']);
  assert.equal(r.candidates.length, 2);
  assert.deepEqual(r.candidates.map((c) => c.text), ['大聲援', '大三元']);
  assert.deepEqual(r.candidates.map((c) => c.index), [0, 1]);
  assert.equal(r.candidates[r.chosen].heard, r.heard, 'heard 必須就是候選清單裡那一份');
});

test('N2-8 normalizeCandidates：去空白、丟空字串、去重、截到 MAX_CANDIDATES', () => {
  assert.deepEqual(normalizeCandidates([' 大三元 ', '', '大三元', null, undefined, '小三元']), [
    '大三元',
    '小三元',
  ]);
  assert.equal(MAX_CANDIDATES, 5);
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(normalizeCandidates(many), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(normalizeCandidates([]), []);
  assert.deepEqual(normalizeCandidates(undefined), []);
  assert.deepEqual(normalizeCandidates(['  ', '\n']), [], '只有空白的候選不算候選');
});

test('N2-9 沒有任何可用候選 ⇒ chosen 是 -1，不是 0', () => {
  // 🔴 -1 與 0 的差別是「沒東西可選」與「選了第一條」。混在一起的話，
  //    「ASR 一條都沒回」會被記成「用了 ASR 的首選」——而那兩件事的處置相反。
  const r = recognizeBest(TABLE, ['  ', '']);
  assert.equal(r.chosen, -1);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.heard.raw, '');
  assert.deepEqual(r.heard.ids, []);
});

test('N2-10 覆蓋恆等式：covered + leftover 音節 = syllables', () => {
  // 這是 compareCandidates 的算術前提（它用 syllables − covered 當 leftover 數）。
  for (const s of ['大三元', '我胡了大三元', '打三塊', '全部人', '門清自摸大三元']) {
    const h = recognize(TABLE, s);
    const leftoverSyl = h.leftover ? h.leftover.split(' ').filter(Boolean).length : 0;
    assert.equal(h.covered + leftoverSyl, h.syllables, `恆等式在「${s}」上不成立`);
    assert.ok(h.covered >= 0 && h.covered <= h.syllables);
  }
});

test('N2-11 判台一律走 recognize：被選中那條的結果與單獨判它逐字相同', () => {
  // 反控「在這支裡另寫一條精簡判台路徑」。兩條路徑分岔時不會有東西轉紅，
  // 只會讓畫面上的台數與飛輪送出的 ids 慢慢對不起來。
  const r = recognizeBest(TABLE, ['大聲援', '門清自摸']);
  const direct = recognize(TABLE, '門清自摸');
  assert.deepEqual(r.heard.ids, direct.ids);
  assert.equal(r.heard.normalized, direct.normalized);
  assert.equal(r.heard.covered, direct.covered);
});
