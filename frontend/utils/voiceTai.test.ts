// utils/voiceTai.test.ts — 修正盤純邏輯測試（D4-a）
//
// 🔴 本檔必須放在 utils/ 這一層：runner 的 glob 只收 utils/*.test.ts 與
//    engine/*.test.ts（scripts/run-tests.mjs:53-55）。放在 pages/ 旁邊的話
//    **不會有任何 runner 跑到它**，而「從沒跑過」與「跑過全過」的輸出逐字相同。
//
// 台數定錨（實測，engine/mahjong-tai.test.ts 檔頭同一組）：
//   parse().total 含底（base_di = 1）；設計冊的台數表是純台數。
//   本檔一律分開驗 totalTai（純）與 grandTotal（含底），
//   只驗其中一個的話，「底被算兩次」與「某台種少一台」在數字上會互相抵銷。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPad,
  fanById,
  fromHits,
  grandTotal,
  selectedIds,
  step,
  taiOf,
  toggle,
  totalTai,
  type FanTable,
  type Selection,
} from './voiceTai.ts';

const TABLE: FanTable = JSON.parse(
  readFileSync(new URL('../engine/mahjong-tai/fan_table.json', import.meta.url), 'utf8'),
);

test('修正盤涵蓋表裡每一個台種，一個都不漏', () => {
  const pad = buildPad(TABLE);
  const flat = pad.flatMap((s) => s.fans.map((f) => f.id));
  assert.equal(flat.length, TABLE.fans.length, '格子數必須等於台種數');
  assert.equal(new Set(flat).size, flat.length, '不可重複出現');
  const missing = TABLE.fans.map((f) => f.id).filter((id) => !flat.includes(id));
  assert.deepEqual(missing, [], `漏掉的台種：${missing.join(',')}`);
});

test('分組順序照 categories 宣告，不是照 fans 出現順序', () => {
  const pad = buildPad(TABLE);
  const got = pad.map((s) => s.category);
  const want = (TABLE.categories || []).filter((c) =>
    TABLE.fans.some((f) => f.category === c),
  );
  assert.deepEqual(got, want);
});

test('沒被 categories 涵蓋的台種落到「其他」，不靜靜消失', () => {
  // 🔴 反控：造一個 category 不在清單裡的台種。少了 OTHER 那條分支時，
  //    它會從修正盤上消失 —— 不報錯、不少一支函式，只是永遠補不上那一台。
  const weird: FanTable = {
    ...TABLE,
    fans: [...TABLE.fans, { id: 'zz_test', name: '測試台', tai: 1, category: '不存在的分類' }],
  };
  const flat = buildPad(weird).flatMap((s) => s.fans.map((f) => f.id));
  assert.equal(flat.length, weird.fans.length);
  assert.ok(flat.includes('zz_test'), 'category 不在清單裡的台種必須仍出現');
});

test('🔴 台數走引擎 fanTai：連莊 2N+1，不是 tai×units', () => {
  // 連莊 tai=2 / tai_base=1 / per_unit。自己乘會得到 2/4/6，正確是 3/5/7。
  assert.equal(taiOf(TABLE, 'lianzhuang', 1), 3, '連一拉一');
  assert.equal(taiOf(TABLE, 'lianzhuang', 2), 5, '連二拉二');
  assert.equal(taiOf(TABLE, 'lianzhuang', 3), 7, '連三拉三');
  // 對照：非 per_unit 的台種份數無關
  assert.equal(taiOf(TABLE, 'menqing_zimo', 1), 3);
});

test('🔴 反控：若改用 tai×units，連莊會少 1 台而且看起來合理', () => {
  const fan = fanById(TABLE, 'lianzhuang')!;
  const naive = fan.tai * 2; // 這就是那個「看起來很對」的寫法
  assert.equal(naive, 4);
  assert.notEqual(naive, taiOf(TABLE, 'lianzhuang', 2));
  assert.equal(taiOf(TABLE, 'lianzhuang', 2) - naive, fan.tai_base, '差的正好是 tai_base');
});

test('純台數不含底，含底的是 grandTotal', () => {
  const sel: Selection = { lianzhuang: 1, menqing_zimo: 1 };
  assert.equal(totalTai(TABLE, sel), 6, '連莊 3 ＋ 門清自摸 3');
  assert.equal(grandTotal(TABLE, sel), 7, '再加底 1');
  assert.equal(grandTotal(TABLE, sel) - totalTai(TABLE, sel), TABLE.config?.base_di);
});

test('空盤：純台數 0，含底 = 底本身', () => {
  assert.equal(totalTai(TABLE, {}), 0);
  assert.equal(grandTotal(TABLE, {}), TABLE.config?.base_di);
});

test('點一下加入、再點一下移除', () => {
  let sel: Selection = {};
  sel = toggle(TABLE, sel, 'menqing');
  assert.deepEqual(sel, { menqing: 1 });
  sel = toggle(TABLE, sel, 'menqing');
  assert.deepEqual(sel, {});
});

test('點不存在的 id 不改變狀態（不無中生有一格）', () => {
  const sel: Selection = { menqing: 1 };
  assert.deepEqual(toggle(TABLE, sel, 'no_such_fan'), sel);
});

test('🔴 加入時移除互斥項（表裡寫的方向）', () => {
  // lianzhuang excludes zhuang
  let sel: Selection = { zhuang: 1 };
  sel = toggle(TABLE, sel, 'lianzhuang');
  assert.deepEqual(sel, { lianzhuang: 1 }, '連莊會吃掉莊家（2N+1 的 +1 已含莊家台）');
});

test('🔴 加入時移除互斥項（表裡沒寫的反方向也要擋）', () => {
  // dasanyuan excludes xiaosanyuan，但 xiaosanyuan 沒有寫 excludes。
  // 只查單向的話，先選大三元再選小三元就會兩個並存 ⇒ 多算 4 台。
  const xiao = fanById(TABLE, 'xiaosanyuan')!;
  assert.equal(xiao.excludes, undefined, '前提：小三元自己沒有寫 excludes');
  let sel: Selection = { dasanyuan: 1 };
  sel = toggle(TABLE, sel, 'xiaosanyuan');
  assert.deepEqual(sel, { xiaosanyuan: 1 }, '反方向也必須互斥');
});

test('互斥不會誤傷無關的台種', () => {
  let sel: Selection = { menqing_zimo: 1, wumenqi: 1 };
  sel = toggle(TABLE, sel, 'dandiao');
  assert.deepEqual(selectedIds(sel), ['dandiao', 'menqing_zimo', 'wumenqi']);
});

test('per_unit 步進：＋ 加份數、台數跟著走', () => {
  let sel: Selection = toggle(TABLE, {}, 'zhenghua');
  assert.equal(totalTai(TABLE, sel), 1, '正花 ×1');
  sel = step(TABLE, sel, 'zhenghua', 1);
  assert.equal(sel.zhenghua, 2);
  assert.equal(totalTai(TABLE, sel), 2, '正花 ×2');
});

test('per_unit 步進：− 到 0 就移除', () => {
  let sel: Selection = toggle(TABLE, {}, 'zhenghua');
  sel = step(TABLE, sel, 'zhenghua', -1);
  assert.deepEqual(sel, {}, 'demo.html:205-207 同一條規則');
});

test('🔴 非 per_unit 的台種不可以被步進', () => {
  // 允許的話會算出「門清 ×3 = 3 台」這種引擎永遠不會產出的狀態。
  const sel: Selection = toggle(TABLE, {}, 'menqing');
  assert.deepEqual(step(TABLE, sel, 'menqing', 1), sel);
  assert.equal(totalTai(TABLE, sel), 1);
});

test('沒選中的台種步進是 no-op（不會憑空加入）', () => {
  assert.deepEqual(step(TABLE, {}, 'zhenghua', 1), {});
});

test('fromHits 只取 id 與 units，台數在這裡重算', () => {
  // 🔴 刻意餵一個「引擎說 999 台」的 hit：畫面上的台數必須來自 taiOf，
  //    不是來自 hits.tai —— 否則同一個台種有兩個台數來源。
  const sel = fromHits([
    { id: 'lianzhuang', units: 2 },
    { id: 'menqing_zimo' },
  ] as Array<{ id: string; units?: number; tai?: number }>);
  assert.deepEqual(sel, { lianzhuang: 2, menqing_zimo: 1 });
  assert.equal(totalTai(TABLE, sel), 8, '連二拉二 5 ＋ 門清自摸 3');
});

test('selectedIds 排序穩定（飛輪要拿它比對差異）', () => {
  const a = selectedIds({ zhenghua: 1, lianzhuang: 1, menqing: 1 });
  const b = selectedIds({ menqing: 1, zhenghua: 1, lianzhuang: 1 });
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['lianzhuang', 'menqing', 'zhenghua']);
});

test('toggle／step 不改動傳入的物件（React state 要靠這個）', () => {
  const orig: Selection = { menqing: 1 };
  const frozen = Object.freeze({ ...orig });
  toggle(TABLE, frozen, 'zimo');
  toggle(TABLE, frozen, 'menqing');
  step(TABLE, frozen, 'menqing', 1);
  assert.deepEqual(frozen, orig, '原物件必須沒被改到');
});
