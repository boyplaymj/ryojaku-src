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
  nativeErrorMessage,
  nativeMatchesToText,
  pickAsrTrack,
  reduceNativePartial,
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
