// utils/voiceTaiMetrics.test.ts — 漏斗埋點 payload（D4-g）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 守四件事：
//   ① 事件列**不得夾帶辨識文字**（隱私 §4.5 ＋ 不讓回灌飛輪吃到事件列）
//   ② 失敗的 ASR 一定分得出「為什麼失敗」——「不知道為什麼」也要有載體
//   ③ 壞掉的 ts 在這裡就擋下來（後端會 400，而呼叫端是 fail-open ⇒ 會安靜地少一筆）
//   ④ 訂正列自己也要說自己是 correction，不靠後端的預設值

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_KINDS, buildEvent } from './voiceTaiMetrics.ts';
import { buildCorrection } from './voiceCorrection.ts';
import type { Heard } from './voiceTaiAsr.ts';

const heard: Heard = {
  raw: '大三元',
  normalized: '大三元',
  leftover: '',
  ignored: [],
  sel: { dasanyuan: 1 },
  ids: ['dasanyuan'],
};

test('D4g-1 open 事件的欄位集合被釘死 —— 不得出現任何辨識文字', () => {
  const p = buildEvent({ kind: 'open', ts: 1756800000, rulesetVersion: '0.1.0' });
  assert.deepEqual(Object.keys(p).sort(), ['engineVersion', 'kind', 'rulesetVersion', 'ts']);
  // 🔴 這條不是「重複斷言欄位集合」。上面那條在**加**欄位時會紅，
  //    這條是把「絕對不可以出現的名字」逐一點名 —— 兩者少了誰都會留下缺口：
  //    只有集合斷言時，把 text 換名叫 raw 仍然過不了；但只有點名時，加一個新名字不會紅。
  for (const forbidden of ['text', 'normalizedText', 'parsed', 'corrected', 'added', 'removed', 'unmatched', 'raw']) {
    assert.equal(forbidden in p, false, `事件列不可以帶 ${forbidden}`);
  }
});

test('D4g-2 asr 成功：帶軌別、不帶錯誤碼', () => {
  const p = buildEvent({
    kind: 'asr', ts: 1756800000, rulesetVersion: '0.1.0',
    asr: { ok: true, track: 'web' },
  });
  assert.equal(p.asrOk, true);
  assert.equal(p.asrTrack, 'web');
  assert.equal('asrError' in p, false);
});

test('D4g-3 asr 失敗一定帶得出原因 —— 沒代碼時是 unknown，不是缺欄', () => {
  const withCode = buildEvent({
    kind: 'asr', ts: 1756800000, rulesetVersion: '0.1.0',
    asr: { ok: false, track: 'native', errorCode: 'not-allowed' },
  });
  assert.equal(withCode.asrError, 'not-allowed');

  // 🔴 沒有代碼時若讓 asrError 缺欄，「失敗但不知道原因」與「成功」在欄位上
  //    又會變成同一種形狀 —— 那正是本功能要消滅的東西。
  const noCode = buildEvent({
    kind: 'asr', ts: 1756800000, rulesetVersion: '0.1.0',
    asr: { ok: false, track: 'none' },
  });
  assert.equal(noCode.asrError, 'unknown');
  assert.equal(noCode.asrOk, false);
});

test("D4g-4 kind:'asr' 沒帶結果要當場拋 —— 送出去的話那一筆分不出成敗", () => {
  assert.throws(() => buildEvent({ kind: 'asr', ts: 1756800000, rulesetVersion: '0.1.0' }), /分不出成敗/);
});

test('D4g-5 壞掉的 ts 在這裡擋，不丟給後端擋（呼叫端 fail-open ⇒ 會安靜地少一筆）', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => buildEvent({ kind: 'open', ts: bad, rulesetVersion: '0.1.0' }),
      /正整數秒/,
      `ts=${bad} 應該被擋下`,
    );
  }
  // 毫秒不會被擋（它是正整數）—— 這裡順手釘住那個已知的坑：
  // 擋得住的是「壞形狀」，擋不住「單位錯」。單位由 nowTs() 那一個位置負責。
  assert.equal(buildEvent({ kind: 'open', ts: 1756800000000, rulesetVersion: '0.1.0' }).ts, 1756800000000);
});

test('D4g-6 訂正列自己說自己是 correction，不靠後端預設值', () => {
  const p = buildCorrection({ heard, sel: { dasanyuan: 1 }, ts: 1756800000, rulesetVersion: '0.1.0' });
  assert.equal(p.kind, 'correction');
});

test('D4g-7 三種 kind 是同一份名單 —— 後端 allowlist 與這裡不可以各寫一份', () => {
  assert.deepEqual([...EVENT_KINDS], ['open', 'asr', 'correction']);
});
