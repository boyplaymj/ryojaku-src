// utils/memberSlots.test.ts — 「目前人數」格子的回歸網（[A2-④]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    MIN_CAPACITY,
    MAX_CAPACITY,
    CAPACITY_FALLBACK,
    resolveCapacity,
    reportedJoined,
    slotFillCount,
    MIN_JOINED,
    buildMemberSlots,
    memberSlotIcon,
    memberCountLabel,
} from './memberSlots.ts';

test('A2s4-1 容量照 maxMembers 走 —— 這條就是本次要修的缺陷', () => {
    // 缺 1 人的局：容量 2，只該畫兩格。修之前這裡是四格。
    assert.equal(buildMemberSlots(2, 1).length, 2);
    assert.equal(buildMemberSlots(3, 1).length, 3);
    assert.equal(buildMemberSlots(4, 1).length, 4);
});

test('A2s4-2 第一格是主揪且恆滿（後端建局就設 currentPlayers=1）', () => {
    for (const cap of [2, 3, 4]) {
        const slots = buildMemberSlots(cap, 1);
        assert.equal(slots[0].isHost, true, `cap=${cap}`);
        assert.equal(slots[0].filled, true, `cap=${cap} 主揪那格該是滿的`);
        // 只有第一格是主揪
        assert.deepEqual(slots.filter(s => s.isHost).map(s => s.seat), [1], `cap=${cap}`);
    }
});

test('A2s4-3 filled 依 currentMembers 遞增，且座位由 1 起算', () => {
    assert.deepEqual(buildMemberSlots(4, 1).map(s => s.filled), [true, false, false, false]);
    assert.deepEqual(buildMemberSlots(4, 3).map(s => s.filled), [true, true, true, false]);
    assert.deepEqual(buildMemberSlots(4, 4).map(s => s.filled), [true, true, true, true]);
    assert.deepEqual(buildMemberSlots(3, 2).map(s => s.seat), [1, 2, 3]);
});

test('A2s4-4 壞掉的 maxMembers 退回 4 —— 刻意保留改動前的行為', () => {
    // ⚠️ 這條釘的是「壞資料不會因為這次改動而多出新的錯法」，
    //    不是「壞資料被修好了」。playersNeeded 後端零驗證（create_game/main.go:365）。
    for (const bad of [undefined, null, NaN, 0, 1, 5, 99, -3, 2.5, '4', {}]) {
        assert.equal(resolveCapacity(bad as unknown), CAPACITY_FALLBACK, JSON.stringify(bad));
    }
    assert.equal(CAPACITY_FALLBACK, 4);
    assert.equal(buildMemberSlots(undefined, 1).length, 4);
});

test('A2s4-5 合法容量原樣回來（反控：上面那條不是把所有輸入都吃成 4）', () => {
    // 少了這條，resolveCapacity 直接 `return 4` 也會讓 A2s4-4 全綠。
    assert.equal(resolveCapacity(2), 2);
    assert.equal(resolveCapacity(3), 3);
    assert.equal(resolveCapacity(4), 4);
    assert.equal(MIN_CAPACITY, 2);
    assert.equal(MAX_CAPACITY, 4);
});

test('A2s4-6 畫幾格滿：夾在 [1, capacity]', () => {
    assert.equal(slotFillCount(-5, 4), 1);
    assert.equal(slotFillCount(9, 4), 4, '畫不出第 9 格');
    assert.equal(slotFillCount(3, 2), 2);
    assert.equal(slotFillCount(NaN, 4), 1);
    assert.equal(slotFillCount(undefined as unknown, 4), 1);
    assert.equal(slotFillCount(2.7, 4), 2, '非整數往下取');
    assert.equal(slotFillCount(3, 4), 3, '反控：不是所有輸入都被夾成 1 或 capacity');
});

test('A2s4-10 主揪必計入：currentMembers=0／壞值 → 已加入至少 1（收 Codex 覆驗）', () => {
    // 🔴 兩個獨立理由：①後端建局就設 CurrentPlayers:1
    //    ②public/userJoin/ 沒有座位 1 的 empty 圖 ⇒ 圖上主揪永遠在，
    //      文字說 0 就是畫面自己跟自己矛盾。
    // ⚠️ 這條同時釘住「壞資料的 0 被遮住」這個已知代價 —— 那是刻意的，不是漏看。
    for (const bad of [0, -1, NaN, undefined, null, 'x', {}]) {
        assert.equal(reportedJoined(bad as unknown), 1, JSON.stringify(bad));
    }
    assert.equal(MIN_JOINED, 1);
    assert.equal(memberCountLabel(2, 0), '已加入 1/2', '不可以是 0/2');
    // 第一格必須是滿的（否則圖與文字又打架）
    assert.equal(buildMemberSlots(2, 0)[0].filled, true);
});

test('A2s4-11 反控：reportedJoined 不是「什麼都回 1」', () => {
    // 少了這條，reportedJoined 直接 `return 1` 也會讓 A2s4-10 全綠。
    assert.equal(reportedJoined(2), 2);
    assert.equal(reportedJoined(4), 4);
    assert.equal(reportedJoined(9), 9);
});

test('A2s4-12 超過容量的數字**要露出來**，不可以夾成 N/N（收 Codex 覆驗）', () => {
    // 🔴 原本 label 會把 9/4 夾成 4/4 ——「資料壞了」被顯示成「這局滿了」。
    //    我原本的測試註解還宣稱夾住是為了「不讓人消失得沒有徵兆」，那句話是反的。
    assert.equal(memberCountLabel(4, 9), '已加入 9/4');
    assert.equal(memberCountLabel(2, 5), '已加入 5/2');
    // 但格子仍然只畫 capacity 個（畫不出第 9 格）
    assert.equal(buildMemberSlots(4, 9).length, 4);
});

test('A2s4-7 圖檔路徑：主揪那格用 selfIcon，其餘依 filled 分兩組', () => {
    const slots = buildMemberSlots(4, 2);
    assert.match(memberSlotIcon(slots[0]), /selfIcon-No1/);
    assert.match(memberSlotIcon(slots[1]), /icon-userJoined-No2/);
    assert.match(memberSlotIcon(slots[2]), /icon-userEmpty-No3/);
    assert.match(memberSlotIcon(slots[3]), /icon-userEmpty-No4/);
});

test('A2s4-8 文案是「已加入 N/M」，不是「已報名」', () => {
    // 🔴 §4.2 原文寫「已報名 N/4」，兩個詞都錯（見該節 2026-09-09 訂正）。
    //    報名只建 pending，核准才進人數 ⇒ 寫「已報名」會讓主揪以為待審的人已經算進去。
    assert.equal(memberCountLabel(2, 1), '已加入 1/2');
    assert.equal(memberCountLabel(4, 4), '已加入 4/4');
    assert.equal(memberCountLabel(undefined, 1), '已加入 1/4', '壞資料走 fallback');
    assert.ok(!memberCountLabel(4, 2).includes('已報名'));
});

test('A2s4-9 兩個元件真的用了這一份（接線，不是宣稱）', () => {
    // 🔴 為什麼要掃原始碼：純函式全綠而元件仍然硬寫四個 <img> 時，
    //    上面八條測試一條都不會紅 —— 「算得對」與「畫面用了它」在單元層逐字相同。
    for (const rel of ['../components/EventCard.tsx', '../components/EventDetailModal.tsx']) {
        const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
        // 🔴 收 Codex 覆驗：原本只查識別字出現 ⇒ 留一個沒用到的 import 或註解也會綠。
        //    改成比對**呼叫式**（含左括號），而且要求它出現在 JSX 的 .map( 之前。
        assert.match(src, /buildMemberSlots\s*\(/, `${rel} 沒有**呼叫** buildMemberSlots（只有名字不算）`);
        assert.match(src, /buildMemberSlots\s*\([^)]*\)\s*\.map\s*\(/, `${rel} 有呼叫但沒有拿它的結果去畫格子`);
        // 硬寫的 No4 圖檔路徑必須已經消失（那是「四格寫死」的指紋）
        assert.ok(
            !src.includes('icon-userEmpty-No4@3x.png') && !src.includes('icon-userJoined-No4@3x.png'),
            `${rel} 仍然有硬寫的 No4 圖檔路徑 ⇒ 還是四格寫死`
        );
    }
});
