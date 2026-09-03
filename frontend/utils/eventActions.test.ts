// utils/eventActions.test.ts — 局內「語音判台」入口顯示判準的回歸網（[A1-b]）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 釘的是 2026-09-03 的決定：(isOwner || joined) 且 status 不是 cancelled／closed，
// **不綁** completed（那是評價的條件，判台正好相反）、**不看過期**（那把尺答的是排序）。
// ⚠️ closed 這一條當天訂正過：工單原本寫「closed 要看得到」，實查後端才知道
//    它是「四家評價完成後結案」不是「停止招募」。A1b-5 現在釘的是訂正後的行為。
// 要改條件先來改這裡。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowVoiceTaiEntry } from './eventActions.ts';

test('A1b-1 主揪看得到（recruiting）', () => {
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: false, status: 'recruiting' }), true);
});

test('A1b-2 參加者看得到（recruiting）', () => {
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: false, joined: true, status: 'recruiting' }), true);
});

test('A1b-3 既非主揪也非參加者 → 看不到，不論狀態', () => {
    for (const status of ['recruiting', 'full', 'closed', 'cancelled']) {
        assert.equal(shouldShowVoiceTaiEntry({ isOwner: false, joined: false, status }), false, status);
    }
});

test('A1b-4 cancelled → 即使是主揪／參加者也看不到', () => {
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: false, status: 'cancelled' }), false);
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: false, joined: true, status: 'cancelled' }), false);
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: true, status: 'cancelled' }), false);
});

test('A1b-5 recruiting／full 都看得到 —— 釘住「不綁 completed」', () => {
    for (const status of ['recruiting', 'full']) {
        assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: false, status }), true, `owner/${status}`);
        assert.equal(shouldShowVoiceTaiEntry({ isOwner: false, joined: true, status }), true, `joined/${status}`);
    }
});

test('A1b-5b closed → 看不到（它是「四家評價完成後結案」，不是「停止招募」）', () => {
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: false, status: 'closed' }), false);
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: false, joined: true, status: 'closed' }), false);
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: true, status: 'closed' }), false);
});

test('A1b-5c 沒見過的狀態字串 → 看得到（只有點名的結束狀態才擋）', () => {
    // 防的是「後端加了新狀態，而這裡靜靜把入口關掉」——擋人要靠明確的名單，不是靠白名單漏掉。
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: false, status: 'in_progress' }), true);
});

test('A1b-6 欄位 undefined → false（fail-closed）', () => {
    assert.equal(shouldShowVoiceTaiEntry({}), false);
    assert.equal(shouldShowVoiceTaiEntry({ status: 'recruiting' }), false);
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true }), false);
    assert.equal(shouldShowVoiceTaiEntry({ joined: true }), false);
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: true, joined: true }), false);
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: undefined, joined: undefined, status: undefined }), false);
});

test('A1b-7 只認 boolean true，不認 truthy 雜值（fail-closed）', () => {
    // 型別上進不來，但 runtime 資料來自 API；防的是「1」「'true'」這種東西被當成參與者
    assert.equal(shouldShowVoiceTaiEntry({ isOwner: 1 as unknown as boolean, status: 'recruiting' }), false);
    assert.equal(shouldShowVoiceTaiEntry({ joined: 'true' as unknown as boolean, status: 'recruiting' }), false);
});
