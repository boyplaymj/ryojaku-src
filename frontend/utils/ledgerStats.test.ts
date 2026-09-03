// utils/ledgerStats.test.ts — 帳本頁純計算邏輯的回歸網（[A1-a-1]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這些測試釘的是「從 Ledger.tsx 搬出來時的行為」，不是「應該有的行為」——
// 後面 [A1-a] 拆殼時要靠它們證明沒動到計算；[A1-c] 要改行為時再來改這裡。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEntriesByMonth, computeLedgerStats } from './ledgerStats.ts';
import type { LedgerEntry } from './ledgerStats.ts';

function entry(over: Partial<LedgerEntry> & { date: string }): LedgerEntry {
  return {
    userId: 'u1',
    stakes: '30/10',
    rounds: 3,
    winLoss: 0,
    actualAmount: 0,
    opponents: [],
    mood: 'neutral',
    note: '',
    ...over,
  };
}

test('A1a1-1 空陣列：全部歸零，對手是「無」不是空字串', () => {
  const s = computeLedgerStats([]);
  assert.equal(s.totalEntries, 0);
  assert.equal(s.totalRounds, 0);
  assert.equal(s.totalWinLoss, 0);
  assert.equal(s.averageWin, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.mostFrequentOpponent, '無');
  assert.equal(s.mostWonOpponent, '無');
  assert.deepEqual(s.topStakes, []);
});

test('A1a1-2 跨月過濾：同一批 entries 換 month，只留該月', () => {
  const all = [
    entry({ date: '2026-07-31', ledgerId: 'jul' }),
    entry({ date: '2026-08-01', ledgerId: 'aug1' }),
    entry({ date: '2026-08-15', ledgerId: 'aug2' }),
    entry({ date: '2026-09-01', ledgerId: 'sep' }),
    // 同月不同年 —— 只比月份的話會被誤留
    entry({ date: '2025-08-10', ledgerId: 'aug-last-year' }),
  ];
  const aug = filterEntriesByMonth(all, new Date(2026, 7, 20));
  assert.deepEqual(aug.map(e => e.ledgerId).sort(), ['aug1', 'aug2']);

  const jul = filterEntriesByMonth(all, new Date(2026, 6, 1));
  assert.deepEqual(jul.map(e => e.ledgerId), ['jul']);

  const jun = filterEntriesByMonth(all, new Date(2026, 5, 1));
  assert.deepEqual(jun, []);
  // 輸入不被改動
  assert.equal(all.length, 5);
});

test('A1a1-3 排序：回傳日期由新到舊', () => {
  const all = [
    entry({ date: '2026-08-03' }),
    entry({ date: '2026-08-21' }),
    entry({ date: '2026-08-10' }),
  ];
  const out = filterEntriesByMonth(all, new Date(2026, 7, 1));
  assert.deepEqual(out.map(e => e.date), ['2026-08-21', '2026-08-10', '2026-08-03']);
});

test('A1a1-4 基本加總：totalRounds / totalWinLoss / averageWin，缺值當 0', () => {
  const s = computeLedgerStats([
    entry({ date: '2026-08-01', rounds: 4, winLoss: 300 }),
    entry({ date: '2026-08-02', rounds: 2, winLoss: -100 }),
    // rounds / winLoss 缺值（後端舊資料）—— 搬過來的程式用 `|| 0` 吞掉
    entry({ date: '2026-08-03', rounds: undefined as unknown as number, winLoss: undefined as unknown as number }),
  ]);
  assert.equal(s.totalEntries, 3);
  assert.equal(s.totalRounds, 6);
  assert.equal(s.totalWinLoss, 200);
  assert.equal(s.averageWin, 200 / 3);
});

test('A1a1-5 topStakes：最多 3 筆、按次數遞減、percentage 是四捨五入整數', () => {
  // 7 筆：A×3、B×2、C×1、D×1 ⇒ 只留三筆，D 被切掉
  const s = computeLedgerStats([
    entry({ date: '2026-08-01', stakes: 'A' }),
    entry({ date: '2026-08-02', stakes: 'B' }),
    entry({ date: '2026-08-03', stakes: 'A' }),
    entry({ date: '2026-08-04', stakes: 'C' }),
    entry({ date: '2026-08-05', stakes: 'A' }),
    entry({ date: '2026-08-06', stakes: 'B' }),
    entry({ date: '2026-08-07', stakes: 'D' }),
  ]);
  assert.equal(s.topStakes.length, 3);
  assert.deepEqual(s.topStakes.map(t => t.label), ['A', 'B', 'C']);
  assert.deepEqual(s.topStakes.map(t => t.count), [3, 2, 1]);
  // 3/7=42.857→43、2/7=28.571→29、1/7=14.285→14
  assert.deepEqual(s.topStakes.map(t => t.percentage), [43, 29, 14]);
  for (const t of s.topStakes) assert.ok(Number.isInteger(t.percentage));
});

test('A1a1-6 空 stakes 不進 topStakes；分母仍是全部 entries', () => {
  const s = computeLedgerStats([
    entry({ date: '2026-08-01', stakes: '' }),
    entry({ date: '2026-08-02', stakes: 'X' }),
  ]);
  assert.deepEqual(s.topStakes, [{ label: 'X', count: 1, percentage: 50 }]);
});

test('A1a1-7 對手統計：mostFrequentOpponent 按出場次數；空白名字不算', () => {
  const s = computeLedgerStats([
    entry({ date: '2026-08-01', winLoss: 100, opponents: [{ name: '甲' }, { name: '乙' }, { name: '  ' }] }),
    entry({ date: '2026-08-02', winLoss: -50, opponents: [{ name: '甲' }, { name: '' }] }),
    entry({ date: '2026-08-03', winLoss: 20, opponents: [{ name: '乙' }] }),
    entry({ date: '2026-08-04', winLoss: 20, opponents: [{ name: '乙' }] }),
  ]);
  assert.equal(s.mostFrequentOpponent, '乙');   // 乙 3 場、甲 2 場
  assert.equal(s.mostWonOpponent, '乙');        // 乙 2 勝、甲 1 勝
});

// 🔴 釘住現況：winRate 的「贏」是 winLoss >= 0，opponentWinCounts 的「贏」是 winLoss > 0。
//    兩個門檻不一致。這是從 Ledger.tsx 搬過來時的現況，**不是設計意圖**，[A1-c] 要回頭決定。
//    本測試的目的是讓「任何一邊被改」立刻紅，而不是背書這個行為。
test('A1a1-8 [釘現況・非設計意圖・A1-c 待決] winLoss===0 在 winRate 算贏，在 mostWonOpponent 不算贏', () => {
  const s = computeLedgerStats([
    // 只有一筆、打平、只跟「丙」打
    entry({ date: '2026-08-01', winLoss: 0, opponents: [{ name: '丙' }] }),
  ]);
  // winRate：0 >= 0 ⇒ 1/1 ⇒ 100%
  assert.equal(s.winRate, 100);
  // opponentWinCounts：0 > 0 為假 ⇒ 沒有任何對手被記勝 ⇒ '無'
  assert.equal(s.mostWonOpponent, '無');
  // 而這個人確實出場了
  assert.equal(s.mostFrequentOpponent, '丙');
});

test('A1a1-9 winRate：正 / 零 / 負混合，零算在分子（現況）', () => {
  const s = computeLedgerStats([
    entry({ date: '2026-08-01', winLoss: 100 }),
    entry({ date: '2026-08-02', winLoss: 0 }),
    entry({ date: '2026-08-03', winLoss: -100 }),
    entry({ date: '2026-08-04', winLoss: -1 }),
  ]);
  // (100, 0) 算贏 ⇒ 2/4
  assert.equal(s.winRate, 50);
});
