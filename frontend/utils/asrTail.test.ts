// utils/asrTail.test.ts — 原生軌尾巴時序（§3.5c）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這一組守的是「錯了不會有東西轉紅」的三件事：
//   ① 錄音中的 partial 不可以被當成尾巴（N5-3 是 N5-4 的反控）
//   ② 過期的計時器不可以結束下一次按壓（N5-9 是 N5-8 的反控）
//   ③ 安靜期不可以把絕對上限往後推（N5-6；沒有它，一直有 partial 就永遠不收尾）
//
// ⚠️ 全部餵固定的 `now`，不用 fake timer —— 狀態機刻意不碰時鐘，
//    要是得靠 fake timer 才測得動，驗到的就是 fake timer 不是判斷。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAIL_MAX_MS,
  TAIL_QUIET_MS,
  nativeTailStep,
  tailIdle,
  type TailState,
} from './asrTail.ts';

const T0 = 1_000_000;

test('N5-1 tailIdle 的初值就是「沒有在等」', () => {
  assert.deepEqual(tailIdle(), { pending: false, deadline: 0 });
});

test('N5-2 第一個 stopped → 開始等，並設下絕對上限', () => {
  const r = nativeTailStep(tailIdle(), 'stopped', T0);
  assert.deepEqual(r.action, { type: 'arm', delayMs: TAIL_MAX_MS });
  assert.equal(r.state.pending, true);
  assert.equal(r.state.deadline, T0 + TAIL_MAX_MS);
});

test('N5-3【N5-4 的反控】錄音中的 partial 什麼都不做', () => {
  // 少了這一條，每一發即時文字都會去動計時器 —— 而外觀完全正常：
  // 使用者還按著，本來就還沒到收尾。
  const r = nativeTailStep(tailIdle(), 'partial', T0);
  assert.deepEqual(r.action, { type: 'none' });
  assert.equal(r.state.pending, false);
});

test('N5-4 等待中的 partial → 再等一個安靜期（不是立刻收尾）', () => {
  // 立刻收尾會收到倒數第二發：iOS 的 resultHandler 可能連著送好幾發，
  // 每一發都是「當前完整結果」。
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const r = nativeTailStep(armed, 'partial', T0 + 10);
  assert.deepEqual(r.action, { type: 'arm', delayMs: TAIL_QUIET_MS });
  assert.equal(r.state.pending, true);
});

test('N5-5 連著兩發 partial → 各自重新起算安靜期，且絕對上限不變', () => {
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const a = nativeTailStep(armed, 'partial', T0 + 10);
  const b = nativeTailStep(a.state, 'partial', T0 + 20);
  assert.deepEqual(b.action, { type: 'arm', delayMs: TAIL_QUIET_MS });
  assert.equal(b.state.deadline, T0 + TAIL_MAX_MS);
});

test('N5-6 快到上限時的 partial 只等剩下的那點時間，不可以把上限往後推', () => {
  // 🔴 沒有這一條，「一直有 partial 進來」就會無限期地把收尾往後推，
  //    而那個症狀是「放開之後畫面一直不出結果」——看起來像當掉，不像時序問題。
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const nearEnd = T0 + TAIL_MAX_MS - 40;
  const r = nativeTailStep(armed, 'partial', nearEnd);
  assert.deepEqual(r.action, { type: 'arm', delayMs: 40 });
  assert.equal(r.state.deadline, T0 + TAIL_MAX_MS);
});

test('N5-7 已經過了上限才來的 partial → 當場收尾', () => {
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const r = nativeTailStep(armed, 'partial', T0 + TAIL_MAX_MS + 1);
  assert.deepEqual(r.action, { type: 'finish' });
  assert.equal(r.state.pending, false);
});

test('N5-8 等待中的 timeout → 收尾（＝退回今天的行為，不是壞掉）', () => {
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const r = nativeTailStep(armed, 'timeout', T0 + TAIL_MAX_MS);
  assert.deepEqual(r.action, { type: 'finish' });
  assert.equal(r.state.pending, false);
});

test('N5-9【N5-8 的反控】沒有在等的時候收到 timeout → 什麼都不做', () => {
  // 上一次按壓留下來的過期計時器。讓它結束這一次按壓的話，
  // 症狀是「才剛按下去就說沒聽到內容」——而那與真的沒講話逐字相同。
  const r = nativeTailStep(tailIdle(), 'timeout', T0);
  assert.deepEqual(r.action, { type: 'none' });
  assert.equal(r.state.pending, false);
});

test('N5-10 第二個 stopped（iOS 的 isFinal）→ 立刻收尾，不等好等滿', () => {
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const r = nativeTailStep(armed, 'stopped', T0 + 30);
  assert.deepEqual(r.action, { type: 'finish' });
  assert.equal(r.state.pending, false);
});

test('N5-11 started 一律把殘留的等待清掉', () => {
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const r = nativeTailStep(armed, 'started', T0 + 5);
  assert.deepEqual(r.action, { type: 'none' });
  assert.deepEqual(r.state, tailIdle());
});

test('N5-12 收尾之後回到 idle：再來的 partial 不會又開一輪等待', () => {
  const armed = nativeTailStep(tailIdle(), 'stopped', T0).state;
  const done = nativeTailStep(armed, 'timeout', T0 + TAIL_MAX_MS).state;
  const r = nativeTailStep(done, 'partial', T0 + TAIL_MAX_MS + 10);
  assert.deepEqual(r.action, { type: 'none' });
});

test('N5-13 Android 那條完整路徑：stopped → 最終 partial → 安靜 → 收尾（共一次）', () => {
  // onEndOfSpeech → stopped；onResults → partialResults（完整 5 條）；沒有第二個 stopped。
  let s: TailState = tailIdle();
  const seen: string[] = [];
  for (const [ev, now] of [
    ['stopped', T0],
    ['partial', T0 + 120],
    ['timeout', T0 + 120 + TAIL_QUIET_MS],
  ] as const) {
    const r = nativeTailStep(s, ev, now);
    s = r.state;
    seen.push(r.action.type);
  }
  assert.deepEqual(seen, ['arm', 'arm', 'finish']);
  assert.equal(s.pending, false);
});

test('N5-14 iOS 那條完整路徑：stopped → 最終 partial → 第二個 stopped（共一次收尾）', () => {
  let s: TailState = tailIdle();
  const seen: string[] = [];
  for (const [ev, now] of [
    ['stopped', T0],
    ['partial', T0 + 60],
    ['stopped', T0 + 70],
  ] as const) {
    const r = nativeTailStep(s, ev, now);
    s = r.state;
    seen.push(r.action.type);
  }
  assert.deepEqual(seen, ['arm', 'arm', 'finish']);
  assert.equal(s.pending, false);
});

test('N5-15 兩個常數的關係：安靜期一定要短於絕對上限', () => {
  // 反過來的話安靜期永遠被 min() 夾成上限 ⇒ 「等安靜」這一層靜靜變成 no-op，
  // 而所有其他測試照樣綠。
  assert.ok(TAIL_QUIET_MS < TAIL_MAX_MS, `${TAIL_QUIET_MS} 應該小於 ${TAIL_MAX_MS}`);
});
