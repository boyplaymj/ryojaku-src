// 跑法：node --test utils/accountDeletion.test.ts（需 Node >= 22.18）或 npm test。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACCOUNT_DELETION_GRACE_DAYS, ACCOUNT_DELETED_ERROR, friendlyAccountError } from './accountDeletion.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('friendlyAccountError：只翻譯認得的值，其餘回 null', () => {
    assert.equal(friendlyAccountError('account_deleted'), '這個帳號已經刪除，無法登入。');
    for (const other of ['service unavailable', 'Invalid password', '', null, undefined, 410]) {
        assert.equal(friendlyAccountError(other), null, JSON.stringify(other));
    }
});

// 30 天有三個載體：這裡、刪除頁原稿、後端常數。任何一邊改了而另外兩邊沒改，就是對外承諾與行為不符。
test('停用期天數與刪除頁原稿、後端常數一致', () => {
    assert.equal(ACCOUNT_DELETION_GRACE_DAYS, 30);
    assert.match(read('../legal/delete-account.txt'), /停用期（三十日）/);
    assert.match(read('../../backend/cmd/lambdas/shared/account_deletion.go'), /AccountDeletionGrace = 30 \* 24 \* time\.Hour/);
});

test('error 值與後端三個登入入口回的字串一致', () => {
    for (const lambda of ['mahjongclub_app_login', 'mahjongclub_auth_google', 'mahjongclub_auth_line']) {
        const src = read(`../../backend/cmd/lambdas/apis/${lambda}/main.go`);
        assert.ok(src.includes(`"${ACCOUNT_DELETED_ERROR}"`), `${lambda} 沒有回 "${ACCOUNT_DELETED_ERROR}"`);
    }
});

test('接線：apiRequest 的錯誤分支經過 friendlyAccountError；刪除入口在帳號安全裡，且個人頁有把登出接上', () => {
    assert.match(read('../services/apiService.ts'), /friendlyAccountError\(data\.error\)/);
    const card = read('../components/AccountSecurity.tsx');
    assert.match(card, /authService\.requestAccountDeletion\(\)/);
    // 畫面上講的天數必須來自常數，不可以另外寫死一個數字。
    assert.match(card, /ACCOUNT_DELETION_GRACE_DAYS/);
    assert.doesNotMatch(card, /30 ?天|三十[日天]/, '帳號安全元件裡寫死了天數');
    assert.match(read('../pages/Profile.tsx'), /<AccountSecurity onAccountDeletionRequested=\{onLogout\} \/>/);
});

// 刪除頁第一條寫的路徑要跟 App 裡真的有的字對得上。
test('刪除頁寫的入口名稱，App 裡真的有', () => {
    const page = read('../legal/delete-account.txt');
    assert.match(page, /「個人檔案」的「帳號安全」，選擇「刪除帳號」/);
    assert.match(read('../components/AccountSecurity.tsx'), />刪除帳號</);
});
