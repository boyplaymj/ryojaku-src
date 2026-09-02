// utils/voiceTaiAsr.test.ts — 語音管線測試（D4-b）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts
//    （scripts/run-tests.mjs 的 DEFAULT_TARGETS）。放別處＝從沒被跑過，
//    而那與「跑過全過」在輸出上逐字相同。
//
// 台數定錨（與 engine/mahjong-tai.test.ts 同一組，實測）：
//   「拉三元」→ 校正成「大三元」→ 純 8 台、含底 9（base_di = 1）
//   「連三拉三」→ lianzhuang ×3 → 純 7 台、含底 8（2×3 + tai_base 1）
//
// 🔴 本檔的核心不是「有沒有回傳台數」——那條對本功能最可能的故障
//    （音近索引沒建起來）**零鑑別力**：索引空掉時字面正確的輸入照樣全中。
//    真正有鑑別力的是 D4b-5：把全域 INDEX 真的清成 0 之後，音近的輸入還中不中。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MahjongPhonetic } from '../engine/mahjong-tai/index.mjs';
import { grandTotal, totalTai, type FanTable } from './voiceTai.ts';
import {
  currentIndexSize,
  ensureIndex,
  micErrorMessage,
  recognize,
  resetIndex,
  type AsrFanTable,
} from './voiceTaiAsr.ts';

const TABLE: AsrFanTable = JSON.parse(
  readFileSync(new URL('../engine/mahjong-tai/fan_table.json', import.meta.url), 'utf8'),
);

test('D4b-1 字面正確的輸入判得出台種與份數', () => {
  const h = recognize(TABLE, '大三元');
  assert.deepEqual(h.ids, ['dasanyuan']);
  assert.equal(h.sel.dasanyuan, 1);
  assert.equal(h.raw, '大三元', 'raw 要保留原文，飛輪與畫面都靠它');
});

test('D4b-2 per_unit 台種的份數走 parse 的數量詞，不是被當成 1', () => {
  const h = recognize(TABLE, '連三拉三');
  assert.deepEqual(h.ids, ['lianzhuang']);
  assert.equal(h.sel.lianzhuang, 3, '連三拉三＝連莊 3 份');
  // 台數定錨：2×3 + tai_base 1 = 7（純），含底 9-1... 見下一條
  assert.equal(totalTai(TABLE as FanTable, h.sel), 7);
  assert.equal(grandTotal(TABLE as FanTable, h.sel), 8);
});

test('D4b-3 recognize 的結果接得上修正盤的台數（兩個模組真的串起來）', () => {
  // 🔴 這條是跨模組接線的錨。D4b-1/2 只證明 id 對，
  //    但畫面上那個數字是 voiceTai.ts 算的 —— 沒有這條的話，
  //    「語音判出 dasanyuan」與「畫面顯示 8 台」之間沒有任何東西在比。
  const h = recognize(TABLE, '拉三元');
  assert.equal(totalTai(TABLE as FanTable, h.sel), 8, '大三元純 8 台');
  assert.equal(grandTotal(TABLE as FanTable, h.sel), 9, '含底 9');
});

test('D4b-4 音近校正生效：ASR 誤聽的「拉三元」要被拉回大三元', () => {
  const h = recognize(TABLE, '拉三元');
  assert.equal(h.normalized, '大三元', 'normalized 要是正規台種名，不是原文');
  assert.deepEqual(h.ids, ['dasanyuan']);
  assert.notEqual(h.raw, h.normalized, '這條的前提就是原文與正規名不同');
});

test('D4b-5 🔴 反控：全域 INDEX 被清成 0 之後，recognize 仍須自己把它建回來', () => {
  // 這條測的是「呼叫順序不可以交給呼叫端記得」。
  //
  // ⚠️ 只呼叫 resetIndex() 是不夠的 —— 那只清掉本模組的快取，
  //    phonetic.js 的 INDEX 仍是前面幾條測試建好的那份，於是
  //    「recognize 有沒有 ensureIndex」兩種情形都會通過，這條就零鑑別力。
  //    要真的重現，得繞過本模組、直接把全域 INDEX 打成空的。
  const wiped = MahjongPhonetic.buildIndex({ fans: [] }, [], []);
  assert.equal(wiped, 0, '前提：這一步真的把 INDEX 清成 0 了（不成立的話下面驗的是別的東西）');
  resetIndex();
  assert.equal(currentIndexSize(), 0);

  // 拿掉 recognize 裡的 ensureIndex，這一行就會落空（normalized 為空 ⇒ 退回原文
  // ⇒ parse('拉三元') 找不到任何台種 ⇒ ids 是 []）。
  const h = recognize(TABLE, '拉三元');
  assert.deepEqual(h.ids, ['dasanyuan'], 'recognize 必須自己保證索引建好');
  assert.ok(currentIndexSize() > 0, '建完要記錄下來');
});

test('D4b-6 🔴 fail-closed：索引建不出東西時當場拋，不默默退化成只認字面', () => {
  resetIndex();
  assert.throws(
    () => ensureIndex({ fans: [] } as AsrFanTable),
    /音近索引是空的/,
    '空表必須拋 —— 這個故障在畫面上與正常完全一樣，只能靠這裡擋',
  );
  // 拋完不可以把壞狀態記成「已建好」，否則下一次呼叫會直接跳過重建。
  assert.equal(currentIndexSize(), 0);
  ensureIndex(TABLE); // 復原，不影響後面的測試
});

test('D4b-7 認不得的話回空結果，不亂命中也不拋', () => {
  const h = recognize(TABLE, '今天天氣不錯');
  assert.deepEqual(h.ids, [], '整句聽不懂時不可以硬湊出台種');
  assert.equal(h.normalized, '');
  assert.ok(h.leftover.length > 0, 'leftover 要留著，讓使用者看得到哪一段沒聽懂');
});

test('D4b-8 空輸入回空結果（放開麥克風但沒講話）', () => {
  for (const s of ['', '   ', '\n']) {
    const h = recognize(TABLE, s);
    assert.deepEqual(h.ids, []);
    assert.equal(h.raw, '');
    assert.deepEqual(h.sel, {});
  }
});

test('D4b-9 sel 裝的是份數不是台數（兩者在 units=1 時同值，會互相偽裝）', () => {
  // 🔴 lianzhuang ×3：份數 3、台數 7。若誤把 hits[].tai 填進 sel，
  //    這裡會讀到 7，而 units=1 的台種永遠分不出這兩者。
  const h = recognize(TABLE, '連三拉三');
  assert.equal(h.sel.lianzhuang, 3, '必須是份數');
  assert.notEqual(h.sel.lianzhuang, 7, '不可以是台數');
});

test('D4b-10 ensureIndex 對同一張表會快取，換表會重建', () => {
  resetIndex();
  const a = ensureIndex(TABLE);
  const b = ensureIndex(TABLE);
  assert.equal(a, b);
  assert.ok(a > 0);
  // 換一份「內容相同但是不同物件」的表：參照變了就該重建（家規表由後台下發）
  const copy: AsrFanTable = JSON.parse(JSON.stringify(TABLE));
  const c = ensureIndex(copy);
  assert.equal(c, a, '同內容的表條目數應相同');
  ensureIndex(TABLE); // 把索引指回正本，不留狀態給後面的測試
});

test('D4b-11 麥克風錯誤訊息：認得的講人話，認不得的照實印代碼', () => {
  assert.match(micErrorMessage('not-allowed'), /權限/);
  assert.match(micErrorMessage('no-speech'), /沒聽到/);
  assert.match(micErrorMessage('audio-capture'), /找不到麥克風/);
  assert.match(micErrorMessage('network'), /網路/);
  // 🔴 未知代碼不可以被吞成一句萬用的「請再試一次」——
  //    那會把「不給權限」和「沒聲音」講成同一句，而兩者的處置相反。
  assert.match(micErrorMessage('some-new-code'), /some-new-code/);
  assert.match(micErrorMessage(''), /沒有錯誤代碼/);
});
