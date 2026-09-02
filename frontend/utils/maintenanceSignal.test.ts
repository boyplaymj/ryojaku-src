import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteBlocked,
  noteOk,
  isInMaintenance,
  normalizePath,
  resetMaintenanceSignal,
} from './maintenanceSignal.ts';

// 模組級狀態會跨 test case 殘留 —— 不清的話，上一條的殘留會讓下一條「剛好通過」。
beforeEach(() => resetMaintenanceSignal());

describe('normalizePath', () => {
  test('去掉 query string', () => {
    assert.equal(normalizePath('/ledger?userId=A'), '/ledger');
    assert.equal(normalizePath('/ledger?userId=B'), '/ledger');
  });
  test('沒有 query 時原樣回傳', () => {
    assert.equal(normalizePath('/chat/rooms'), '/chat/rooms');
  });
});

describe('noteBlocked：只有進入維護的那一次回 true', () => {
  test('第一次 403 是轉換，之後都不是', () => {
    assert.equal(noteBlocked('/ledger?userId=A'), true, '第一次應為轉換');
    assert.equal(noteBlocked('/ledger?userId=A'), false, '同一條路再撞不是轉換');
    assert.equal(noteBlocked('/my-games?userId=A'), false, '另一條路也不是新轉換');
    assert.equal(isInMaintenance(), true);
  });
});

describe('noteOk：公開 route 的 200 不可以解除維護', () => {
  // 🔴 這是本檔的核心。維護中公開 route 照樣回 200（實測，見
  // infra/maintenance_public_routes_probe.sh），若「任何 2xx 就解除」，
  // 提示會在公開 200 與受保護 403 之間閃爍。
  test('沒被擋過的路回 200 不算解除', () => {
    noteBlocked('/ledger?userId=A');
    assert.equal(noteOk('/app-version-config'), false, '公開 route 不該解除');
    assert.equal(noteOk('/user-info?userId=A'), false, '公開 route 不該解除');
    assert.equal(noteOk('/community-get-posts'), false, '公開 route 不該解除');
    assert.equal(isInMaintenance(), true, '仍應處於維護中');
  });

  test('曾被擋過的路回 200 才解除，且解除是轉換（只回一次 true）', () => {
    noteBlocked('/ledger?userId=A');
    assert.equal(noteOk('/ledger?userId=B'), true, '同一條路（不同參數）應解除');
    assert.equal(isInMaintenance(), false);
    assert.equal(noteOk('/ledger?userId=B'), false, '已經解除了，不該再回 true');
  });

  test('一條路通了就整個解除，不必每條都重走一次', () => {
    // 維護模式是單一全域旗標，任何受保護的路走得通就代表它關掉了。
    noteBlocked('/ledger?userId=A');
    noteBlocked('/my-games?userId=A');
    noteBlocked('/chat/rooms?userId=A');
    assert.equal(noteOk('/ledger?userId=A'), true);
    assert.equal(isInMaintenance(), false, '其餘兩條不必重走');
  });

  test('沒在維護時收到 200 不會誤報解除', () => {
    assert.equal(noteOk('/ledger?userId=A'), false);
    assert.equal(isInMaintenance(), false);
  });
});

describe('完整一輪：進入 → 維護中 → 解除', () => {
  test('403 → 公開 200 → 受保護 200', () => {
    assert.equal(noteBlocked('/ledger?userId=A'), true);
    assert.equal(noteOk('/app-version-config'), false);
    assert.equal(isInMaintenance(), true, '公開 200 之後仍在維護中');
    assert.equal(noteOk('/ledger?userId=A'), true);
    assert.equal(isInMaintenance(), false);
  });
});
