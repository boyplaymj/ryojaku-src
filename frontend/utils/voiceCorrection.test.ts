// utils/voiceCorrection.test.ts — 訂正飛輪 payload（D4-c）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 守三件事：
//   ① 每次送出都記一筆（§4.4），不是只記有差異的（§4.1 那句是錯的，見被測檔檔頭）
//   ② 差異走引擎的 recordCorrection，不自己算差集
//   ③ ENGINE_VERSION 不是一個會腐爛的手寫常數 —— 它必須等於現在的 SYNC.sha256

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ENGINE_VERSION,
  buildCorrection,
  nowTs,
  shouldUpload,
} from './voiceCorrection.ts';
import type { Heard } from './voiceTaiAsr.ts';

const heardOf = (over: Partial<Heard> = {}): Heard => ({
  raw: '大三元',
  normalized: '大三元',
  leftover: '',
  ignored: [],
  sel: { dasanyuan: 1 },
  ids: ['dasanyuan'],
  ...over,
});

test('D4c-1 判對時 hadDiff=false，而且**照樣要送**（那是準確度的分母）', () => {
  const p = buildCorrection({
    heard: heardOf(),
    sel: { dasanyuan: 1 },
    ts: 1756800000,
    rulesetVersion: '0.1.0',
  });
  assert.equal(p.hadDiff, false);
  assert.deepEqual(p.added, []);
  assert.deepEqual(p.removed, []);
  // 🔴 這一行是本檔的核心。只記有差異的話，「訂正筆數 0」同時代表
  //    「判得很準」與「根本沒人用」—— 而兩者的處置完全相反。
  assert.equal(shouldUpload(p), true, '沒有差異也要送，否則準確率沒有分母');
});

test('D4c-2 使用者補上一個台種 → added，hadDiff=true', () => {
  const p = buildCorrection({
    heard: heardOf(),
    sel: { dasanyuan: 1, menqing: 1 },
    ts: 1756800000,
    rulesetVersion: '0.1.0',
  });
  assert.deepEqual(p.added, ['menqing']);
  assert.deepEqual(p.removed, []);
  assert.equal(p.hadDiff, true);
});

test('D4c-3 使用者刪掉系統判的台種 → removed', () => {
  const p = buildCorrection({
    heard: heardOf(),
    sel: {},
    ts: 1756800000,
    rulesetVersion: '0.1.0',
  });
  assert.deepEqual(p.added, []);
  assert.deepEqual(p.removed, ['dasanyuan']);
  assert.equal(p.hadDiff, true);
});

test('D4c-4 同時有增有刪', () => {
  const p = buildCorrection({
    heard: heardOf(),
    sel: { xiaosanyuan: 1 },
    ts: 1756800000,
    rulesetVersion: '0.1.0',
  });
  assert.deepEqual(p.added, ['xiaosanyuan']);
  assert.deepEqual(p.removed, ['dasanyuan']);
  assert.equal(p.hadDiff, true);
});

test('D4c-5 payload 逐欄對齊後端 CorrectionRequest', () => {
  const p = buildCorrection({
    heard: heardOf({ raw: '拉三元', normalized: '大三元', leftover: 'san' }),
    sel: { dasanyuan: 1 },
    ts: 1756800000,
    rulesetVersion: '0.1.0',
  });
  // 後端 main.go:46-58 的欄位全集。少一欄後端不會報錯（Go 的 zero value），
  // 只會靜靜地存進一個空值 ⇒ 這裡逐欄釘住。
  assert.deepEqual(Object.keys(p).sort(), [
    'added', 'corrected', 'engineVersion', 'hadDiff', 'normalizedText',
    'parsed', 'removed', 'rulesetVersion', 'text', 'ts', 'unmatched',
  ]);
  assert.equal(p.text, '拉三元', 'text 是 ASR 原文，不是校正後的');
  assert.equal(p.normalizedText, '大三元', 'normalizedText 才是校正後的');
  assert.equal(p.unmatched, 'san');
  assert.equal(p.rulesetVersion, '0.1.0');
});

test('D4c-6 🔴 ts 是秒不是毫秒（sk 用它排序，毫秒會靜靜把順序弄壞）', () => {
  const ms = 1756800000123;
  assert.equal(nowTs(ms), 1756800000);
  // 後端已不用 ts 算 expiresAt（D3-b 修過），所以毫秒誤送**不會有任何錯誤**，
  // 只會讓 sk 的字串排序與正常紀錄錯開。這條是唯一會擋住它的東西。
  assert.ok(String(nowTs(ms)).length === 10, '秒級時間戳是 10 位數');
});

test('D4c-7 🔴 ENGINE_VERSION 必須等於現在的 SYNC.sha256，不是手寫的死值', () => {
  // 引擎同步過之後這條會紅 —— 那正是要的：一個永遠不變的版本號
  // 會讓後台以為「這些訂正都是同一版引擎判的」，而那是假的。
  const raw = readFileSync(
    new URL('../engine/mahjong-tai/SYNC.sha256', import.meta.url),
  );
  const want = 'sync:' + createHash('sha256').update(raw).digest('hex').slice(0, 12);
  assert.equal(
    ENGINE_VERSION,
    want,
    `引擎變了就要更新 ENGINE_VERSION（應為 ${want}）——` +
      '不要把這條測試改掉，它就是提醒你的東西',
  );
});

test('D4c-8 差異一律走引擎的 recordCorrection，順序穩定', () => {
  // parsed／corrected 都要排序過，否則同一組台種會因為順序不同
  // 在後台被當成兩種不同的訂正模式。
  const p = buildCorrection({
    heard: heardOf({ ids: ['menqing', 'dasanyuan'] }),
    sel: { zimo: 1, dasanyuan: 1 },
    ts: 1756800000,
    rulesetVersion: '0.1.0',
  });
  assert.deepEqual(p.parsed, ['dasanyuan', 'menqing'], 'parsed 要排序');
  assert.deepEqual(p.corrected, ['dasanyuan', 'zimo'], 'corrected 要排序');
  assert.deepEqual(p.added, ['zimo']);
  assert.deepEqual(p.removed, ['menqing']);
});
