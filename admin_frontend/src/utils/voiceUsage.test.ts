// voiceUsage.test.ts — D6 聚合層。
//
// 🔴 順序是刻意的：**校準（C1）排在所有反控前面**。
//    C1 拿一份手算得出答案的資料問一遍，確認這把尺對「正常的一天」讀得出正確的數字；
//    沒有這一條的話，下面每一條反控轉綠都可能只是「它對什麼都回同一個值」。
//    （DESIGN_APP.md 一路上撞過好幾次「沒對過已知答案的尺」。）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  classifyTs,
  countLabel,
  pctLabel,
  SAMPLE_GATE,
  type VoicePage,
} from './voiceUsage.ts';

/** 2026-09-02 12:00:00 UTC。寫死一個時刻，不用真時鐘 —— 真時鐘會讓測試有保鮮期。 */
const NOW_MS = 1_756_814_400_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const DAY = 86_400;

const emptyEvents = { open: 0, asrOk: 0, asrFailed: 0, asrErrors: {}, other: 0 };

function rec(userId: string, hadDiff: boolean, ts: number) {
  return { userId, text: hadDiff ? '大三元' : '', hadDiff, ts };
}

// ── C1 校準：一份手算得出答案的兩頁資料 ───────────────────────────────

test('C1 校準：兩頁正常資料，每一格都等於手算值', () => {
  const pages: VoicePage[] = [
    {
      data: [
        rec('u1', true, NOW_SEC - 1 * DAY),
        rec('u1', false, NOW_SEC - 2 * DAY),
        rec('u2', false, NOW_SEC - 3 * DAY),
      ],
      nextCursor: '{"pk":"x","sk":"y"}',
      skipped: 1,
      pageEvents: { ...emptyEvents, open: 3, asrOk: 2, asrFailed: 1, asrErrors: { 'no-speech': 1 } },
    },
    {
      data: [rec('u3', false, NOW_SEC - 30 * DAY)],
      nextCursor: '',
      skipped: 0,
      pageEvents: { ...emptyEvents, open: 2, asrOk: 1, asrFailed: 1, asrErrors: { 'not-allowed': 1 } },
    },
  ];
  const s = aggregate(pages, { nowMs: NOW_MS });

  assert.equal(s.pagesScanned, 2);
  assert.equal(s.complete, true);
  assert.equal(s.corrections, 4);
  assert.equal(s.distinctUsers, 3);
  assert.equal(s.noDiff, 3);
  assert.equal(s.noDiffRate, 3 / 4);
  // 第 4 筆在 30 天前 ⇒ 不在 7 天窗內。窗內是 u1×2 + u2×1。
  assert.equal(s.windowCorrections, 3);
  assert.equal(s.windowDistinctUsers, 2);
  assert.equal(s.undated, 0);
  assert.equal(s.futureDated, 0);
  assert.equal(s.open, 5);
  assert.equal(s.asrOk, 3);
  assert.equal(s.asrFailed, 2);
  assert.deepEqual(s.asrErrors, { 'no-speech': 1, 'not-allowed': 1 });
  assert.equal(s.asrFailRate, 2 / 5);
  assert.equal(s.otherEvents, 0);
  assert.equal(s.skipped, 1);
});

// ── 跨頁加總：後端 PageEvents 只是「這一頁」 ──────────────────────────

test('T1 反控：pageEvents 逐頁相加，不是取最後一頁', () => {
  const page = (open: number): VoicePage => ({
    data: [],
    nextCursor: '',
    pageEvents: { ...emptyEvents, open },
  });
  // 三頁各 3 ⇒ 9。只取一頁的話會是 3 —— 而 3 與 9 在版面上都只是一個數字。
  assert.equal(aggregate([page(3), page(3), page(3)], { nowMs: NOW_MS }).open, 9);
});

test('T2 skipped 也是逐頁相加', () => {
  const p: VoicePage = { data: [], nextCursor: '', skipped: 2 };
  assert.equal(aggregate([p, p, { ...p, nextCursor: '' }], { nowMs: NOW_MS }).skipped, 6);
});

// ── 掃描完整性：低估的方向是「看起來沒人用」 ─────────────────────────

test('T3 最後一頁還有 nextCursor ⇒ complete=false，計數要標「至少」', () => {
  const s = aggregate(
    [{ data: [rec('u1', true, NOW_SEC)], nextCursor: '{"pk":"a","sk":"b"}' }],
    { nowMs: NOW_MS }
  );
  assert.equal(s.complete, false);
  assert.equal(countLabel(s.corrections, s.complete), '至少 1');
});

test('T4 反控：中間頁有 cursor 但最後一頁沒有 ⇒ complete=true', () => {
  const s = aggregate(
    [
      { data: [], nextCursor: '{"pk":"a","sk":"b"}' },
      { data: [], nextCursor: '' },
    ],
    { nowMs: NOW_MS }
  );
  assert.equal(s.complete, true);
  assert.equal(countLabel(0, true), '0');
});

test('T5 一頁都沒拿到 ⇒ complete=false（不可以長得像「掃完了，表是空的」）', () => {
  const s = aggregate([], { nowMs: NOW_MS });
  assert.equal(s.complete, false);
  assert.equal(s.corrections, 0);
});

// ── fail-open 不是退回 0 ─────────────────────────────────────────────

test('T6 沒有任何訂正時 noDiffRate 是 null，顯示成 —，不是 0%', () => {
  const s = aggregate([{ data: [], nextCursor: '' }], { nowMs: NOW_MS });
  assert.equal(s.noDiffRate, null);
  assert.equal(pctLabel(s.noDiffRate), '—');
  // 反控：真的是 0% 的時候要印得出 0.0%，否則這一格對「沒資料」與「全都改過」零鑑別力。
  const allDiff = aggregate(
    [{ data: [rec('u1', true, NOW_SEC)], nextCursor: '' }],
    { nowMs: NOW_MS }
  );
  assert.equal(allDiff.noDiffRate, 0);
  assert.equal(pctLabel(allDiff.noDiffRate), '0.0%');
});

test('T7 一次麥克風都沒按過時 asrFailRate 是 null', () => {
  const s = aggregate([{ data: [], nextCursor: '', pageEvents: emptyEvents }], { nowMs: NOW_MS });
  assert.equal(s.asrFailRate, null);
});

// ── 時間戳的三種狀態 ─────────────────────────────────────────────────

test('T8 毫秒級 ts 換算回秒（§4.3b 實際寫進 stg 表過這種列）', () => {
  const msTs = (NOW_SEC - 1 * DAY) * 1000;
  assert.equal(classifyTs(msTs, NOW_SEC).cls, 'seconds');
  assert.equal(classifyTs(msTs, NOW_SEC).sec, NOW_SEC - DAY);
  const s = aggregate([{ data: [rec('u1', true, msTs)], nextCursor: '' }], { nowMs: NOW_MS });
  // 不換算的話會落在西元 5138 年 ⇒ futureDated ⇒ 窗內 0。
  assert.equal(s.windowCorrections, 1);
  assert.equal(s.futureDated, 0);
});

test('T9 ts<=0 記成 undated，不進窗、也不當成 1970', () => {
  const s = aggregate(
    [{ data: [rec('u1', true, 0), rec('u2', true, -5), rec('u3', true, NOW_SEC)], nextCursor: '' }],
    { nowMs: NOW_MS }
  );
  assert.equal(s.undated, 2);
  assert.equal(s.windowCorrections, 1);
  // 但它們仍然是真實的訂正列 ⇒ 總筆數要算它們，否則就變成另一種低估。
  assert.equal(s.corrections, 3);
});

test('T10 未來 ts 單獨記，24 小時內的時鐘超前不算', () => {
  const s = aggregate(
    [
      {
        data: [rec('u1', true, NOW_SEC + 2 * DAY), rec('u2', true, NOW_SEC + 3600)],
        nextCursor: '',
      },
    ],
    { nowMs: NOW_MS }
  );
  assert.equal(s.futureDated, 1);
  assert.equal(s.windowCorrections, 1);
});

test('T11 窗邊界：剛好在界上算進去，早一秒就不算', () => {
  const start = NOW_SEC - 7 * DAY;
  const s = aggregate(
    [{ data: [rec('u1', true, start), rec('u2', true, start - 1)], nextCursor: '' }],
    { nowMs: NOW_MS }
  );
  assert.equal(s.windowCorrections, 1);
  assert.equal(s.windowDistinctUsers, 1);
});

test('T12 windowDays 可調，而且真的會改變讀數', () => {
  const pages: VoicePage[] = [{ data: [rec('u1', true, NOW_SEC - 10 * DAY)], nextCursor: '' }];
  assert.equal(aggregate(pages, { nowMs: NOW_MS }).windowCorrections, 0);
  assert.equal(aggregate(pages, { nowMs: NOW_MS, windowDays: 30 }).windowCorrections, 1);
});

// ── 人數與次數是兩件事 ───────────────────────────────────────────────

test('T13 同一人多筆只算一個 distinctUser', () => {
  const s = aggregate(
    [{ data: [rec('u1', true, NOW_SEC), rec('u1', false, NOW_SEC), rec('u1', true, NOW_SEC)], nextCursor: '' }],
    { nowMs: NOW_MS }
  );
  assert.equal(s.corrections, 3);
  assert.equal(s.distinctUsers, 1);
});

test('T14 事件列的不重複人數結構上不可得 ⇒ 恆為 null，不可用 open 次數代替', () => {
  const s = aggregate(
    [{ data: [], nextCursor: '', pageEvents: { ...emptyEvents, open: 42 } }],
    { nowMs: NOW_MS }
  );
  assert.equal(s.openDistinctUsers, null);
  assert.equal(s.open, 42);
});

// ── other 不可以被吸收掉 ─────────────────────────────────────────────

test('T15 認不得的 kind 留在 otherEvents，不併進 open／asr', () => {
  const s = aggregate(
    [{ data: [], nextCursor: '', pageEvents: { ...emptyEvents, other: 4 } }],
    { nowMs: NOW_MS }
  );
  assert.equal(s.otherEvents, 4);
  assert.equal(s.open, 0);
  assert.equal(s.asrOk, 0);
  assert.equal(s.asrFailed, 0);
});

test('T16 asrErrors 跨頁合併同一個代碼', () => {
  const p = (n: number): VoicePage => ({
    data: [],
    nextCursor: '',
    pageEvents: { ...emptyEvents, asrFailed: n, asrErrors: { 'no-speech': n } },
  });
  const s = aggregate([p(2), p(3)], { nowMs: NOW_MS });
  assert.deepEqual(s.asrErrors, { 'no-speech': 5 });
  assert.equal(s.asrFailed, 5);
});

// ── 樣本門檻（§📈「上線後何時回頭看」）─────────────────────────────

test('T17 樣本門檻：兩條各自擋，理由要指名是哪一條沒過', () => {
  const many = (n: number, users: number) => {
    const data = [];
    for (let i = 0; i < n; i++) data.push(rec(`u${i % users}`, true, NOW_SEC));
    return [{ data, nextCursor: '' }] as VoicePage[];
  };

  const fewRows = aggregate(many(SAMPLE_GATE.minCorrections - 1, 5), { nowMs: NOW_MS });
  assert.equal(fewRows.sampleSufficient, false);
  assert.equal(fewRows.sampleGateReasons.length, 1);
  assert.match(fewRows.sampleGateReasons[0], /訂正筆數/);

  const fewUsers = aggregate(many(SAMPLE_GATE.minCorrections, SAMPLE_GATE.minDistinctUsers - 1), {
    nowMs: NOW_MS,
  });
  assert.equal(fewUsers.sampleSufficient, false);
  assert.equal(fewUsers.sampleGateReasons.length, 1);
  assert.match(fewUsers.sampleGateReasons[0], /不重複使用者/);

  const ok = aggregate(many(SAMPLE_GATE.minCorrections, SAMPLE_GATE.minDistinctUsers), {
    nowMs: NOW_MS,
  });
  assert.equal(ok.sampleSufficient, true);
  assert.deepEqual(ok.sampleGateReasons, []);
});

test('T18 樣本不足時 noDiffRate 照樣算得出來 —— 擋的是「引用」不是「計算」', () => {
  const s = aggregate([{ data: [rec('u1', false, NOW_SEC)], nextCursor: '' }], { nowMs: NOW_MS });
  assert.equal(s.sampleSufficient, false);
  assert.equal(s.noDiffRate, 1);
});

// ── 半壞的回應不該讓整張卡爆掉 ───────────────────────────────────────

test('T19 缺 data／缺 pageEvents 的頁不拋，也不亂加', () => {
  const s = aggregate([{}, { nextCursor: '' }], { nowMs: NOW_MS });
  assert.equal(s.corrections, 0);
  assert.equal(s.open, 0);
  assert.equal(s.skipped, 0);
  assert.equal(s.complete, true);
});
