// voiceRuleset.test.ts — D5-e／E2 判讀層。
//
// 🔴 順序是刻意的：**校準（C1／C2）排在所有反控前面**。先確認這把尺對
//    「正常的一份」與「正常的沒有」讀得出對的答案；沒有這兩條的話，
//    底下每一條 fail-closed 轉綠都可能只是「它對什麼都回同一個 kind」。
//
// 🔴 本檔驗的是**判讀**，不是網路。所以每一條都直接餵 (status, body)：
//    真的去打 API 的那一層是 `services/api.ts` 的 `getRuleset()`，
//    它的職責只有「把狀態碼與 body 原封不動交出來」——刻意做得沒有邏輯可測。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesLabel,
  checkCommand,
  interpret,
  present,
  presentationsAreDistinct,
  shortSha,
  stageFromTable,
  type RulesetOutcome,
} from './voiceRuleset.ts';

/** 一份正常的 View（欄位值抄自 E1 的 buildView 契約）。 */
const seededView = {
  success: true,
  state: 'seeded',
  table: 'MahjongClubStg_AdminConfigs',
  infoKey: 'VoiceTai:Ruleset',
  version: '0.2.0',
  sha256: 'ce96d53e676ac5f0aa11223344556677889900aabbccddeeff00112233445566',
  bytes: 9237,
  raw: '{"version":"0.2.0","fans":[],"combos":[],"ignores":[],"config":{}}',
  reason: '',
};

// ───────────────────────── 校準 ─────────────────────────

test('C1 正控：一份正常的回應判成 seeded，且原文原封帶出來', () => {
  const out = interpret(200, seededView);
  assert.equal(out.kind, 'seeded');
  assert.equal(out.kind === 'seeded' && out.view.version, '0.2.0');
  assert.equal(out.kind === 'seeded' && out.view.bytes, 9237);
  // 原文不可以被重新塑形 —— malformed 時它是唯一能查出「是誰寫的」的線索。
  assert.equal(out.kind === 'seeded' && out.view.raw, seededView.raw);
});

test('C2 正控：那一列不存在 ⇒ not-seeded（200，不是錯誤）', () => {
  const out = interpret(200, {
    success: true, state: 'not-seeded',
    table: 'MahjongClubStg_AdminConfigs', infoKey: 'VoiceTai:Ruleset',
    version: '', sha256: '', bytes: 0, raw: '', reason: '',
  });
  assert.equal(out.kind, 'not-seeded');
});

test('C3 正控：那一列壞掉 ⇒ malformed，reason 指名哪一鍵', () => {
  const out = interpret(200, {
    ...seededView, state: 'malformed', reason: 'ruleset ignores missing',
  });
  assert.equal(out.kind, 'malformed');
  assert.match(present(out).body, /ignores/);
});

// ──────────────── 狀態碼：E1 給每個碼配了不同的意思 ────────────────

test('S1 🔴 404 是「端點沒部署」，不是「那一列不存在」', () => {
  // E1 為了這個區別，刻意讓「那一列不存在」走 200+not-seeded。
  // 這兩者若在這裡收斂成同一個 kind，後端那個設計就等於沒做。
  const a = interpret(404, { message: 'Not Found' });
  const b = interpret(200, { state: 'not-seeded' });
  assert.equal(a.kind, 'not-deployed');
  assert.equal(a.kind === 'not-deployed' && a.status, 404);
  assert.equal(b.kind, 'not-seeded');
  assert.notEqual(present(a).action, present(b).action);
});

test('S2 🔴 502 是設備問題，⛔ 不可以判成 not-seeded', () => {
  const out = interpret(502, { success: false, error: 'ruleset store unavailable' });
  assert.equal(out.kind, 'store-unavailable');
  // 這一條的方向很重要：讀成 not-seeded 會叫人去播種，而該做的是查 log。
  assert.match(present(out).action, /作廢/);
});

test('S3 403 有三種來源，而 v1 把它們全判成「角色不足」', () => {
  // 🔴 判準是「有沒有 handler 的形狀（success:false）」，不是訊息字串。
  assert.equal(interpret(403, { success: false, error: 'forbidden' }).kind, 'forbidden');
});

test('S3b 🔴 沒佈上的路由：Gateway 回 403，⛔ 不可以判成角色不足', () => {
  // 2026-09-04 對 stg 實測到的兩句原文（部署前跑 verify_admin_ruleset_live.py）。
  // 不帶 token → MissingAuthenticationToken；帶了 Bearer → IncompleteSignature
  //（Gateway 把它當 SigV4 去解）。後台一定帶 token ⇒ 真正會撞到的是後者。
  for (const msg of [
    'Missing Authentication Token',
    'Invalid key=value pair (missing equal-sign) in Authorization header',
  ]) {
    const out = interpret(403, { message: msg });
    assert.equal(out.kind, 'not-deployed', msg);
    assert.equal(out.kind === 'not-deployed' && out.status, 403);
    assert.match(out.kind === 'not-deployed' ? out.detail : '', /Authorization|Authentication/);
  }
  // 方向：讀成 forbidden 會叫人「換一個有權限的帳號」，而該做的是部署 stack。
  assert.notEqual(
    present(interpret(403, { message: 'Missing Authentication Token' })).action,
    present(interpret(403, { success: false, error: 'forbidden' })).action,
  );
});

test('S3c 🔴 認不出來的 Gateway 403 ⇒ gateway-denied，⛔ 不猜成上面任何一種', () => {
  // explicit deny（維護模式 kill switch）的 body 是大寫的 Message。
  const out = interpret(403, {
    Message: 'User is not authorized to access this resource with an explicit deny',
  });
  assert.equal(out.kind, 'gateway-denied');
  assert.match(out.kind === 'gateway-denied' ? out.detail : '', /explicit deny/);
  assert.match(present(out).action, /Gateway/);
});

test('S3d 正控：判準真的是「有沒有 success 這一鍵」，不是訊息字串', () => {
  // 同一句訊息、多一個 success:false ⇒ 必須翻成 forbidden。
  // 少了這一條，把判準寫成「訊息比對」也會讓 S3／S3b 全綠。
  assert.equal(interpret(403, { message: 'Missing Authentication Token' }).kind, 'not-deployed');
  assert.equal(
    interpret(403, { success: false, message: 'Missing Authentication Token' }).kind,
    'forbidden',
  );
});

test('S4 沒列舉到的狀態碼 ⇒ error，並帶出後端給的訊息', () => {
  const out = interpret(405, { success: false, error: 'method not allowed（本頁唯讀）' });
  assert.equal(out.kind, 'error');
  assert.equal(out.kind === 'error' && out.status, 405);
  assert.match(out.kind === 'error' ? out.detail : '', /唯讀/);
});

test('S5 fetch 本身失敗（status=null）⇒ error，不是任何一種「後端說了什麼」', () => {
  const out = interpret(null, undefined);
  assert.equal(out.kind, 'error');
  assert.equal(out.kind === 'error' && out.status, null);
});

// ──────────────── fail-closed：所有「說不清楚」都不可以讀成正常 ────────────────

test('F1 🔴 不認得的 state ⛔ 不當成 seeded', () => {
  const out = interpret(200, { ...seededView, state: 'partially-seeded' });
  assert.equal(out.kind, 'unknown-state');
  assert.equal(out.kind === 'unknown-state' && out.state, 'partially-seeded');
});

test('F2 缺 state ⇒ unreadable（⛔ 不預設 seeded）', () => {
  const noState: Record<string, unknown> = { ...seededView };
  delete noState.state;
  assert.equal(interpret(200, noState).kind, 'unreadable');
});

test('F3 body 不是物件 ⇒ unreadable', () => {
  assert.equal(interpret(200, 'ok').kind, 'unreadable');
  assert.equal(interpret(200, ['x']).kind, 'unreadable');
  assert.equal(interpret(200, null).kind, 'unreadable');
});

test('F4 🔴 state=seeded 卻沒有 version ⇒ unreadable，不是 seeded', () => {
  // 「seeded 但沒有版本」正是 rulesetVersion 失去鑑別力的那種狀態，
  // 顯示成正常的話，同版異容那個最嚴重的失效模式在這一頁上看起來沒事。
  const out = interpret(200, { ...seededView, version: '' });
  assert.equal(out.kind, 'unreadable');
  assert.match(out.kind === 'unreadable' ? out.detail : '', /version/);
});

test('F5 state=seeded 卻沒有 sha256 ⇒ unreadable', () => {
  const out = interpret(200, { ...seededView, sha256: '' });
  assert.equal(out.kind, 'unreadable');
  assert.match(out.kind === 'unreadable' ? out.detail : '', /sha256/);
});

test('F6 🔴 not-seeded 卻帶著內容 ⇒ unreadable（矛盾要講，不要安穩地說「尚未播種」）', () => {
  const out = interpret(200, { state: 'not-seeded', version: '0.2.0', sha256: '', raw: '' });
  assert.equal(out.kind, 'unreadable');
});

test('F7 malformed 沒給 reason 仍判 malformed，但畫面不會是一塊空白', () => {
  const out = interpret(200, { ...seededView, state: 'malformed', reason: '' });
  assert.equal(out.kind, 'malformed');
  // 空白讀起來像「沒事」。
  assert.match(present(out).body, /沒有給原因/);
});

// ──────────────── 版面：合併回去的話，畫面完全正常 ────────────────

test('P1 🔴 九種 kind 的 action 兩兩不同', () => {
  // 本模組唯一的價值就是「不同的情形給不同的指示」。兩個 kind 共用同一句
  // action，等於在使用者看得到的那一層把它們合併回去 —— 而合併之後
  // 沒有任何測試會紅、畫面也完全正常。這一條是唯一擋得住它的東西。
  const all: RulesetOutcome[] = [
    { kind: 'seeded', view: seededView },
    { kind: 'not-seeded', view: {} },
    { kind: 'malformed', view: { reason: 'x' } },
    { kind: 'not-deployed', status: 403, detail: 'x' },
    { kind: 'store-unavailable' },
    { kind: 'forbidden' },
    { kind: 'gateway-denied', detail: 'x' },
    { kind: 'unknown-state', state: 'zzz', view: {} },
    { kind: 'unreadable', detail: 'x' },
    { kind: 'error', status: 500, detail: 'x' },
  ];
  assert.equal(all.length, 10, 'kind 增減時這一條要跟著改 —— 漏掉的那個不會有人發現');
  assert.ok(presentationsAreDistinct(all));
});

test('P2 正控：presentationsAreDistinct 真的會回 false（否則 P1 是同義反覆）', () => {
  const dup: RulesetOutcome[] = [
    { kind: 'not-deployed', status: 404, detail: 'x' },
    { kind: 'not-deployed', status: 403, detail: 'y' },
  ];
  assert.equal(presentationsAreDistinct(dup), false);
});

test('P3 只有 seeded 是 ok 語氣', () => {
  assert.equal(present({ kind: 'seeded', view: seededView }).tone, 'ok');
  assert.equal(present({ kind: 'not-seeded', view: {} }).tone, 'warn');
  for (const o of [
    { kind: 'malformed', view: {} },
    { kind: 'not-deployed', status: 403, detail: 'x' },
    { kind: 'store-unavailable' },
    { kind: 'gateway-denied', detail: 'x' },
  ] as RulesetOutcome[]) {
    assert.equal(present(o).tone, 'bad');
  }
});

// ──────────────── 顯示小工具：0 與「沒有」是兩件事 ────────────────

test('D1 bytesLabel：缺值回 —，⛔ 不回 0', () => {
  assert.equal(bytesLabel(9237), '9,237');
  assert.equal(bytesLabel(0), '0');          // 真的是 0 就顯示 0
  assert.equal(bytesLabel(undefined), '—');  // 沒有值不是 0
  assert.equal(bytesLabel('9237'), '—');
  assert.equal(bytesLabel(NaN), '—');
});

test('D2 shortSha：空值回 — 而不是空字串（版面塌掉讀起來像「這格不存在」）', () => {
  assert.equal(shortSha(''), '—');
  assert.equal(shortSha(undefined), '—');
  assert.equal(shortSha('abcdef0123456789ff'), 'abcdef0123456789…');
  assert.equal(shortSha('short'), 'short');
});

test('D3 🔴 checkCommand 指向 frontend/engine 那一份，不是 repo 正典', () => {
  // 取樣點由問題決定（D5-c2 檔頭）：要問的是「即將出貨的那份跟得上嗎」。
  const cmd = checkCommand('stg');
  assert.match(cmd, /check_ruleset_seeded\.py/);
  assert.match(cmd, /--stage stg/);
  assert.match(cmd, /frontend\/engine\/mahjong-tai\/fan_table\.json/);
  assert.doesNotMatch(cmd, /repo\/tools\/mahjong-tai\/fan_table\.json/);
});

test('D4 checkCommand 沒有環境時給佔位符，不猜一個', () => {
  assert.match(checkCommand(''), /<stg\|prod>/);
});

test('D5 🔴 stageFromTable：stg 的表不可以被讀成 prod', () => {
  // ⚠️ 這一條抓不到「兩行對調」——那兩個前綴不是前綴關係，對調是等價突變（實測過）。
  //    它抓的是**把底線拿掉**（startsWith('MahjongClub')）那種改法，
  //    而讀錯的後果是這一頁印出一行指向 **prod** 的指令。
  assert.equal(stageFromTable('MahjongClubStg_AdminConfigs'), 'stg');
  assert.equal(stageFromTable('MahjongClub_AdminConfigs'), 'prod');
});

test('D6 stageFromTable 推不出來回空字串（⛔ 不猜 prod）', () => {
  assert.equal(stageFromTable('SomethingElse_AdminConfigs'), '');
  assert.equal(stageFromTable(undefined), '');
  assert.equal(stageFromTable(123), '');
  // 空字串一路走到 checkCommand 就是佔位符，不會印出指向錯環境的指令。
  assert.match(checkCommand(stageFromTable(undefined)), /<stg\|prod>/);
});

// ──────────────── 接線：掃原始碼的守衛（比測試弱的一種證據，但總比沒有好） ────────────────
//
// 🔴 上面 24 條全部只驗 utils 這一支純函式。**判斷正確不等於頁面用了它** ——
//    頁面自己再判一次狀態碼、或 api.ts 改回走共用 request()，這 24 條**一條都不會紅**，
//    而畫面看起來完全正常（那正是這整個模組要防的失效模式，只是換了一層發生）。
//    本專案沒有 DOM runner，所以只能掃原始碼。
// ⚠️ 這是**比測試弱**的證據，不要讀成同一件事。它們的鑑別力由突變 M14～M17 證明。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, '..', rel), 'utf8');

test('W1 🔴 頁面用 interpret()，而且不自己判狀態碼', () => {
  const page = read('pages/VoiceTaiRuleset.tsx');
  assert.match(page, /\binterpret\(/, '頁面沒有呼叫 interpret ⇒ 判讀跑到別的地方去了');
  assert.match(page, /\bpresent\(/, '頁面沒有呼叫 present ⇒ 文案是第二份');
  // 第二份判讀最可能長成「頁面自己看 status」。
  assert.doesNotMatch(page, /===\s*404|===\s*502|===\s*403/, '頁面裡出現了第二份狀態碼判讀');
});

test('W2 🔴 getRuleset 不走共用 request()（它會把狀態碼壓掉）', () => {
  const api = read('services/api.ts');
  const m = api.match(/getRuleset:[\s\S]*?\n {8}\}/);
  assert.ok(m, '找不到 getRuleset —— 這條守衛的定址壞了，不是通過');
  assert.doesNotMatch(m![0], /\brequest\(/, 'getRuleset 走了共用 request()，狀態碼會在呼叫端消失');
  assert.match(m![0], /res\.status/, 'getRuleset 沒有把狀態碼交出去');
});

test('W4 🔴 頁面不可以說版本住在 `meta` 底下 —— DDB 那一列的 version 在頂層', () => {
  // 🔴 這是同一個錯誤宣稱的第三個載體。第一個在 E3 探針（跑一次就印出 None
  //    而被抓到），第二個是我寫的設計冊（寫對了），第三個是**只有人看得到**
  //    的這一句 hint —— 它沒有任何東西會去求值它，所以錯了不會有人知道。
  // ⚠️ 方向：照它去 DDB 找 `meta.version` 會找不到，而那讀起來像「那一列壞了」
  //    或「這一頁在說謊」。兩個結論都是錯的，而且都會叫人去查沒壞的東西。
  // ⚠️ 界線：repo 正典那份 fan_table.json **確實**有 meta.version（seed_ruleset.py
  //    就是從那裡讀出來、寫成 DDB 那一列的頂層 version）。所以錯的不是這個字，
  //    是「拿它描述 DDB 這一側」。這一條只管這一頁。
  const page = read('pages/VoiceTaiRuleset.tsx');
  assert.doesNotMatch(page, /meta\.version/, '頁面把 DDB 那一列的版本說成 meta.version');
  assert.match(page, /頂層/, '頁面沒有講出版本住在頂層 ⇒ 拿掉錯的那句不等於補上對的那句');
});

test('W3 路由與導覽項都註冊了（少任何一邊，這一頁都等於不存在）', () => {
  // 只有路由 ⇒ 沒人找得到；只有導覽 ⇒ 點了是白頁。兩種都不會有錯誤訊息。
  assert.match(read('App.tsx'), /analysis\/voice-tai-ruleset/);
  assert.match(read('App.tsx'), /VoiceTaiRuleset/);
  assert.match(read('components/AdminLayout.tsx'), /analysis\/voice-tai-ruleset/);
});
