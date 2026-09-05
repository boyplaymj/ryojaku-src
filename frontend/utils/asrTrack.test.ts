// utils/asrTrack.test.ts — 兩軌選擇與語意差異（D4-d）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這一組測試守的是三個「錯了不會有東西轉紅」的判斷：
//   ① 選軌的順序（在 iOS 上兩種寫法結果相同 ⇒ 只有 Android 使用者會踩到）
//   ② 原生 partial 是取代、web final 是累加（抄錯不會有型別錯誤，
//      而判台引擎吃到重複的字仍然判得出台種，只有份數會多算）
//   ③ 未知的原生錯誤不可以被講成 Web Speech 的錯誤

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CANDIDATES,
  nativeErrorMessage,
  nativeMatchesToText,
  pickAsrTrack,
  reduceNativeCandidates,
  reduceNativePartial,
  reduceWebCandidates,
  reduceWebFinal,
} from './asrTrack.ts';

test('D4d-1 原生殼一律走原生軌，即使那個 WebView 也有 Web Speech', () => {
  // 🔴 這條就是本檔的核心。Android WebView 兩個條件同時成立，
  //    而「先看 hasWebSpeech」的寫法會在這裡選 web ——
  //    那條路要把音訊送 Google、離線不能用，而使用者裝的是有原生能力的 App。
  assert.equal(pickAsrTrack({ isNative: true, hasWebSpeech: true }), 'native');
});

test('D4d-2 iOS 原生殼（沒有 Web Speech）走原生軌', () => {
  assert.equal(pickAsrTrack({ isNative: true, hasWebSpeech: false }), 'native');
});

test('D4d-3 瀏覽器有 Web Speech 就走 web 軌', () => {
  assert.equal(pickAsrTrack({ isNative: false, hasWebSpeech: true }), 'web');
});

test('D4d-4 兩條路都沒有時回 none，不可以硬選一條', () => {
  // none 的用途是讓 UI 講「這個環境不支援」。若這裡回 'web'，
  // 頁面會去 new 一個不存在的建構子，錯誤會變成看不懂的 TypeError。
  assert.equal(pickAsrTrack({ isNative: false, hasWebSpeech: false }), 'none');
});

test('D4d-5 🔴 原生 partial 是取代語意，不是累加', () => {
  // 原生每次送的是「當前完整辨識」。拿去累加的話：
  //   '大' → '大大三' → '大大三大三元'
  let s = '';
  s = reduceNativePartial(s, ['大']);
  s = reduceNativePartial(s, ['大三']);
  s = reduceNativePartial(s, ['大三元']);
  assert.equal(s, '大三元', '取代語意：留最後一次的完整結果');
});

test('D4d-6 🔴 web final 是累加語意，與原生相反', () => {
  // Web Speech 的 onresult 給的是增量片段。不累加的話只會剩最後一小段。
  let s = '';
  s = reduceWebFinal(s, '大三元');
  s = reduceWebFinal(s, '門清');
  assert.equal(s, '大三元門清');
  // 🔴 把這兩條放在一起是為了讓「兩軌語意相反」這件事在測試上也看得見。
  //    只留其中一條的話，下一個人抄錯方向不會有任何東西紅。
  assert.notEqual(reduceNativePartial('大三元', ['門清']), '大三元門清');
});

test('D4d-7 原生送空事件時保留上一次的文字，不要清空', () => {
  assert.equal(reduceNativePartial('大三元', []), '大三元');
  assert.equal(reduceNativePartial('大三元', undefined), '大三元');
  assert.equal(reduceNativePartial('大三元', ['']), '大三元', '空字串是沒聽到，不是收回');
});

test('D4d-8 nativeMatchesToText 取第一個候選，空的回空字串', () => {
  assert.equal(nativeMatchesToText(['大三元', '大三園']), '大三元');
  assert.equal(nativeMatchesToText([]), '');
  assert.equal(nativeMatchesToText(undefined), '');
  assert.equal(nativeMatchesToText(['']), '');
});

test('D4d-9 認得的原生錯誤講人話', () => {
  assert.match(String(nativeErrorMessage('Permission denied')), /權限/);
  assert.match(String(nativeErrorMessage('SPEECH_RECOGNITION_UNAVAILABLE')), /沒有可用的語音辨識/);
});

test('D4d-10 🔴 「not implemented on web」要指認成選軌錯誤，不是使用者的問題', () => {
  // 這句話只會在「瀏覽器裡走了原生軌」時出現 ⇒ 它是 pickAsrTrack 的 bug 徵兆。
  // 包裝成「請再試一次」的話，這個 bug 永遠不會被回報。
  const m = String(nativeErrorMessage("Method not implemented on web."));
  assert.match(m, /選錯辨識軌/);
  assert.match(m, /程式的問題/);
});

test('D4d-11 🔴 認不得的原生錯誤回 null，不可以硬給一句訊息', () => {
  // null 的意思是「交給下一層判斷」。若這裡回一句萬用訊息，
  // 未知的原生錯誤會被講成 Web Speech 的錯誤，方向完全相反。
  assert.equal(nativeErrorMessage('some-brand-new-native-error'), null);
  assert.equal(nativeErrorMessage(''), null);
});

// ── N-best 候選採集（§3.5）────────────────────────────────────────────
//
// 🔴 這一組測的全都是「錯了不會有東西轉紅」的判斷：候選採集壞掉時，
//    N-best 整層退化成「只看第 0 條」——也就是**改這支之前的行為**，
//    畫面、台數、飛輪送出的欄位全部正常。除了這裡沒有別的地方看得出來。

test('N3-1 原生候選是**取代**語意，且保留整條清單（不是只留第 0 條）', () => {
  assert.deepEqual(reduceNativeCandidates([], ['大三元', '大聲援']), ['大三元', '大聲援']);
  // 取代：第二次事件來的是「當前完整結果」，不可以接在前一次後面
  assert.deepEqual(
    reduceNativeCandidates(['大三'], ['大三元', '打三元']),
    ['大三元', '打三元'],
  );
});

test('N3-2 🔴 空事件保留上一次的候選（清空＝N-best 靜靜變成 no-op）', () => {
  const prev = ['大三元', '大聲援'];
  assert.deepEqual(reduceNativeCandidates(prev, []), prev);
  assert.deepEqual(reduceNativeCandidates(prev, undefined), prev);
  assert.deepEqual(reduceNativeCandidates(prev, ['', '  ']), prev, '全是空白等於沒聽到');
});

test('N3-3 原生候選截到 MAX_CANDIDATES，且去掉空白條目', () => {
  const many = ['a', ' ', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(reduceNativeCandidates([], many), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(MAX_CANDIDATES, 5, '上限只有一份，改了這裡等於改了 web 軌那邊');
});

test('N3-4 原生候選的第 0 條必須與 reduceNativePartial 取的那條一致', () => {
  // 🔴 兩支各自取「首選」的話，畫面上顯示的即時文字與 N-best 的第 0 條
  //    可能是不同的字串，而它們本來就該是同一條。
  const matches = ['大三元', '打三元'];
  assert.equal(reduceNativeCandidates([], matches)[0], reduceNativePartial('', matches));
});

test('N3-5 web 候選是**累加**語意（與原生相反），逐片段接第 k 條', () => {
  const a = reduceWebCandidates([], ['大三元', '大聲援']);
  assert.deepEqual(a, ['大三元', '大聲援']);
  const b = reduceWebCandidates(a, ['門清自摸', '門前清字母']);
  assert.deepEqual(b, ['大三元門清自摸', '大聲援門前清字母']);
});

test('N3-6 🔴 片段候選數不足時補「該片段的第 0 條」，不是補空字串', () => {
  // 補空字串的話，第 1 條候選會少掉一整段話 ⇒ 變成一條「比較短、leftover 比較少」
  // 的假候選，而 N-best 的判準正好偏好解釋得完整的那條 ⇒ 它會被系統性地誤選。
  const a = reduceWebCandidates([], ['大三元', '大聲援']);
  const b = reduceWebCandidates(a, ['自摸']); // 這個片段只有一條候選
  assert.deepEqual(b, ['大三元自摸', '大聲援自摸']);
});

test('N3-7 web：第一個片段只有一條、第二個片段有多條 ⇒ 從共同前綴分岔', () => {
  const a = reduceWebCandidates([], ['大三元']);
  const b = reduceWebCandidates(a, ['自摸', '字母', '子母']);
  assert.deepEqual(b, ['大三元自摸', '大三元字母', '大三元子母']);
});

test('N3-8 web：空的候選陣列不動既有清單，且結果不超過上限', () => {
  const prev = ['大三元'];
  assert.deepEqual(reduceWebCandidates(prev, []), prev);
  const wide = reduceWebCandidates([], ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(wide.length, MAX_CANDIDATES);
});
