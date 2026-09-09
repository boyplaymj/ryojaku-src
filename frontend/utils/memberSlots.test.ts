// utils/memberSlots.test.ts — 「目前人數」格子的回歸網（[A2-④]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('A2s4-9 🔴 **機械掃描**全 components/ + pages/：不准有硬寫的座位圖（接線，不是宣稱）', () => {
    // 🔴 這條原本是**手打的兩個檔名清單**，而清單漏了 pages/EventDetail.tsx ——
    //    於是它全綠，第三處的四格硬寫原封不動地上線了。
    //    抓到它的不是任何檢查，是**部署後比對 bundle 指紋時數字不符**。
    //    ⇒ 判準改成「掃過每一個檔」，不是「掃我想得到的那幾個」。
    //    新增第四處元件時，這條會自動涵蓋它 —— 不需要有人記得回來加檔名。
    const roots = ['../components', '../pages'];
    const files: string[] = [];
    const walk = (dir: URL) => {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
            const child = new URL(`${ent.name}${ent.isDirectory() ? '/' : ''}`, dir);
            if (ent.isDirectory()) walk(child);
            else if (ent.name.endsWith('.tsx')) files.push(child.pathname);
        }
    };
    for (const r of roots) walk(new URL(`${r}/`, import.meta.url));

    // 反控：掃描本身要真的走到檔案 —— 空清單會讓下面的迴圈變成同義反覆。
    assert.ok(files.length >= 20, `只掃到 ${files.length} 個檔，掃描器壞了`);

    const offenders: string[] = [];
    const users: string[] = [];
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        // 「硬寫座位圖」的指紋：直接把 No2/No3/No4 的檔名寫在原始碼裡。
        if (/icon-user(Joined|Empty)-No[234]@3x\.png/.test(src)) offenders.push(f);
        if (/buildMemberSlots\s*\(/.test(src)) users.push(f);
    }
    assert.deepEqual(offenders, [], `這些檔還在硬寫座位圖，沒有走 memberSlots：\n${offenders.join('\n')}`);

    // 正控：真的有元件在用這份純函式（否則「零違規」也可能是因為大家都不畫格子了）
    assert.ok(users.length >= 3, `只有 ${users.length} 個檔呼叫 buildMemberSlots，預期至少 3`);
    for (const f of users) {
        const src = readFileSync(f, 'utf8');
        assert.match(src, /buildMemberSlots\s*\([^)]*\)\s*\.map\s*\(/, `${f} 有呼叫但沒拿結果去畫格子`);
    }
});
