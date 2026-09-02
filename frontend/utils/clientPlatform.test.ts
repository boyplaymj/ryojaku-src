// utils/clientPlatform.test.ts — X-Platform header 值（D4-e）
//
// 🔴 本檔必須放在 utils/：runner 的 glob 只收 utils/*.test.ts 與 engine/*.test.ts。
//
// 這一組只守一件事，但那件事會讓整個修正白做：
// **拿不到平台時不可以送空字串** —— 後端 UpdateLastLogin 對空值會跳過整個
// platform 欄位的更新（main.go:267-270），於是 DDB 裡舊的 'Web' 原封留著，
// 而登入成功、lastLoginAt 有更新、零錯誤。
// 也就是「值是常數」這個病會變成「值沒被更新」，更難察覺。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNKNOWN_PLATFORM, clientPlatformHeader } from './clientPlatform.ts';

test('D4e-1 Capacitor 的三個平台值原樣送出', () => {
  assert.equal(clientPlatformHeader('ios'), 'ios');
  assert.equal(clientPlatformHeader('android'), 'android');
  assert.equal(clientPlatformHeader('web'), 'web');
});

test('D4e-2 🔴 拿不到平台時送 unknown，絕不送空字串', () => {
  // 送空字串的話後端會跳過 platform 欄位的更新 ⇒ 舊值 'Web' 留著 ⇒
  // 看起來完全正常，而我們正是為了淘汰那個 'Web' 才做這個改動。
  for (const bad of ['', '   ', '\n', null, undefined]) {
    const got = clientPlatformHeader(bad as string | null | undefined);
    assert.equal(got, UNKNOWN_PLATFORM, `輸入 ${JSON.stringify(bad)} 應得 unknown`);
    assert.notEqual(got, '', '空字串會讓後端跳過寫入，等於這個修正沒發生');
  }
});

test('D4e-3 未知的平台名原樣透傳，不被白名單降級成 unknown', () => {
  // 🔴 白名單很誘人，但 Capacitor 將來多一個平台時，它會把那個
  //    **已知的新平台名**丟掉換成 unknown —— 那是把手上真的有的資訊扔了。
  assert.equal(clientPlatformHeader('electron'), 'electron');
  assert.equal(clientPlatformHeader('some-future-platform'), 'some-future-platform');
});

test('D4e-4 新值與歷史資料的 Web 可區分（改版前後分得出來）', () => {
  // 這不是設計目標，是撿到的性質，但值得釘住：
  // 歷史資料是大寫 'Web'（寫死的那個），新值是小寫 'web'。
  // 若哪天有人「順手」把值正規化成大寫，這條會紅，而那會讓兩批資料混在一起。
  assert.equal(clientPlatformHeader('web'), 'web');
  assert.notEqual(clientPlatformHeader('web'), 'Web');
});
