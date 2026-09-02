import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteBlocked,
  noteOk,
  noteWsFrame,
  isInMaintenance,
  normalizePath,
  resetMaintenanceSignal,
  MAINTENANCE_EVENT,
  MAINTENANCE_CLEAR_EVENT,
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

describe('noteWsFrame：WebSocket 這條路', () => {
  // 背景：WS 的整合回應不會送回瀏覽器（實測 commit 110d9bc），所以 503 對使用者
  // 不可觀察 —— 後端改為主動推一幀系統訊息，本組驗前端怎麼判讀它。

  test('維護幀 → 進入維護，且必須被吞掉不往 callback 傳', () => {
    const v = noteWsFrame({ type: 'system', event: 'maintenance' }, 'U1');
    assert.equal(v.event, MAINTENANCE_EVENT);
    assert.equal(v.consumed, true, '系統幀沒有 roomId，漏下去會害 ChatContext 去 fetchRooms()');
    assert.equal(isInMaintenance(), true);
  });

  test('重複的維護幀不再發事件（但一樣要吞掉）', () => {
    noteWsFrame({ type: 'system', event: 'maintenance' }, 'U1');
    const v = noteWsFrame({ type: 'system', event: 'maintenance' }, 'U1');
    assert.equal(v.event, null, '每則被擋的發言都彈一次提示＝洗版');
    assert.equal(v.consumed, true);
  });

  test('認不得的系統幀也要吞掉', () => {
    // 🔴 判準是 type==='system'，不是「我認得這個 event」。日後後端加新的系統幀，
    //    前端還沒跟上時應該安靜忽略，而不是把它當聊天訊息送進渲染路徑。
    const v = noteWsFrame({ type: 'system', event: 'something-new' }, 'U1');
    assert.equal(v.event, null);
    assert.equal(v.consumed, true);
  });

  test('自己的訊息廣播回來 → 解除，但**不可**吞掉（那是要顯示的聊天訊息）', () => {
    noteBlocked('/ledger?userId=A');
    const v = noteWsFrame({ roomId: 'r1', senderId: 'U1', content: 'hi' }, 'U1');
    assert.equal(v.event, MAINTENANCE_CLEAR_EVENT);
    assert.equal(v.consumed, false, '吞掉的話自己發的訊息不會出現在聊天室');
    assert.equal(isInMaintenance(), false);
  });

  test('WS 回音是強訊號：即使當初被擋的是 REST 也解除', () => {
    // 與 noteOk 的差別就在這裡。公開 route 的 200 證明不了旗標關了，
    // 但 chat_ws_send_message 自己會讀旗標回 503 ⇒ 廣播得出來就代表它是關的。
    noteBlocked('/ledger?userId=A');
    noteBlocked('/my-games?userId=A');
    const v = noteWsFrame({ roomId: 'r1', senderId: 'U1' }, 'U1');
    assert.equal(v.event, MAINTENANCE_CLEAR_EVENT);
    assert.equal(isInMaintenance(), false);
  });

  test('別人的訊息不算解除', () => {
    // 別人的訊息是廣播來的，不代表**我**發得出去；而且維護中根本不會有人發得成。
    noteBlocked('/ledger?userId=A');
    const v = noteWsFrame({ roomId: 'r1', senderId: 'U2' }, 'U1');
    assert.equal(v.event, null);
    assert.equal(isInMaintenance(), true);
  });

  test('沒在維護時收到自己的回音，不誤報解除事件', () => {
    const v = noteWsFrame({ roomId: 'r1', senderId: 'U1' }, 'U1');
    assert.equal(v.event, null, '沒進過維護就沒有「解除」這個轉換');
    assert.equal(v.consumed, false);
  });

  test('尚未登入（selfUserId 為 null）不可把任何訊息當成自己的', () => {
    noteBlocked('/ledger?userId=A');
    assert.equal(noteWsFrame({ senderId: 'U2' }, null).event, null);
    assert.equal(noteWsFrame({}, null).event, null, 'senderId 缺席時不可與 null 相等而誤解除');
    assert.equal(isInMaintenance(), true);
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
