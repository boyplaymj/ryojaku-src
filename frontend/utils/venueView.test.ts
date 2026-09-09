// utils/venueView.test.ts — [B1-j1]
//
// 這份的每一條都對著 venueView.ts 檔頭列的四個坑。判準不是「函式回對的值」，
// 是「**兩種在畫面上長得一樣的情況，這裡分不分得開**」——
// 所以有相當比例的條目是成對出現的（一條正、一條把它推翻）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    readAddressState,
    addressCopy,
    isAddressVisible,
    venueTypeMeta,
    venueBadges,
    formatRating,
    nextPageDecision,
    listEmptyCopy,
    mergeVenuePages,
    venueHeadline,
    VENUE_PAGE_ROUND_CAP,
    shouldKeepScanning,
    validateCreateVenue,
    type VenueAddressState,
} from './venueView.ts';

const ALL_STATES: VenueAddressState[] = [
    'granted', 'granted-empty', 'withheld-home', 'withheld-review', 'withheld-unexpected',
];

// ─── ① 地址 ──────────────────────────────────────────────────────────────

test('B1j-1 有授權且有地址 ⇒ granted', () => {
    assert.equal(readAddressState({ type: 'hall', status: 'active', exactAddress: '台北市大安區某路 1 號' }), 'granted');
});

test('B1j-2 🔴 授權了但地址是空字串 ⇒ granted-empty，不是被擋', () => {
    // 這一條就是坑 ①。後端明講：放行時鍵一定存在，即使值是空字串。
    // 寫成 `if (!v.exactAddress)` 的話這裡會變成某種 withheld ⇒ 使用者看到
    // 「等核准」，而其實他早就被核准了，是主揪沒填地址。
    assert.equal(readAddressState({ type: 'home', status: 'active', exactAddress: '' }), 'granted-empty');
    assert.equal(readAddressState({ type: 'home', status: 'active', exactAddress: '   ' }), 'granted-empty');
});

test('B1j-3 B1j-2 的反控：granted-empty 與 withheld-home 必須是不同的值', () => {
    // 少了這條，把 granted-empty 直接改寫成 'withheld-home' 也會讓 B1j-2 以外的條目全綠。
    const empty = readAddressState({ type: 'home', status: 'active', exactAddress: '' });
    const withheld = readAddressState({ type: 'home', status: 'active' });
    assert.notEqual(empty, withheld);
});

test('B1j-4 沒有 exactAddress 鍵 + 自建場 + active ⇒ withheld-home', () => {
    assert.equal(readAddressState({ type: 'home', status: 'active' }), 'withheld-home');
});

test('B1j-5 🔴 pending 的自建場 ⇒ withheld-review（順序對齊後端規則 4 在規則 6 之前）', () => {
    // 把 type 的判斷搬到 status 之前，這一條會變成 withheld-home ——
    // 而那個答案「看起來也很合理」，只是與後端給的理由不同。
    assert.equal(readAddressState({ type: 'home', status: 'pending' }), 'withheld-review');
    assert.equal(readAddressState({ type: 'hall', status: 'suspended' }), 'withheld-review');
});

test('B1j-6 登入者看 active 的麻將館卻沒拿到地址 ⇒ withheld-unexpected（不假裝正常）', () => {
    assert.equal(readAddressState({ type: 'hall', status: 'active' }), 'withheld-unexpected');
    assert.equal(readAddressState({ type: 'event', status: 'active' }), 'withheld-unexpected');
});

test('B1j-7 認不得的 type（含 dojo）⇒ withheld-unexpected', () => {
    // 🔴 'dojo' 不是 type（§5.2）。它出現在資料裡就是資料壞了。
    assert.equal(readAddressState({ type: 'dojo', status: 'active' }), 'withheld-unexpected');
    assert.equal(readAddressState({ type: '', status: 'active' }), 'withheld-unexpected');
});

test('B1j-8 🔴 exactAddress 是 undefined／null／非字串 ⇒ 不算授權', () => {
    // 判準若寫成 `'exactAddress' in v`，第一行會回 granted 系列，
    // 而那個值畫出來是字面的 "undefined"。
    assert.equal(readAddressState({ type: 'hall', status: 'active', exactAddress: undefined }), 'withheld-unexpected');
    assert.equal(readAddressState({ type: 'home', status: 'active', exactAddress: null }), 'withheld-home');
    assert.equal(readAddressState({ type: 'home', status: 'active', exactAddress: 123 }), 'withheld-home');
});

test('B1j-9 null／非物件輸入 ⇒ withheld-unexpected（fail-closed）', () => {
    assert.equal(readAddressState(null), 'withheld-unexpected');
    assert.equal(readAddressState(undefined), 'withheld-unexpected');
});

test('B1j-10 只有 granted 會把地址畫出來', () => {
    for (const s of ALL_STATES) {
        assert.equal(isAddressVisible(s), s === 'granted', `state=${s}`);
    }
});

test('B1j-11 🔴 四種非 granted 的文案兩兩不同 —— 否則分那麼多態沒有意義', () => {
    // 這是 addressCopy 的反控。全部回同一句「沒有地址」也會讓上面每一條照樣綠，
    // 而使用者看到的東西就退回「被誤擋與規則正確運作長得一樣」那個狀態。
    const copies = ALL_STATES.filter(s => s !== 'granted').map(addressCopy);
    assert.equal(new Set(copies).size, copies.length, `文案重複：${JSON.stringify(copies)}`);
    for (const c of copies) assert.notEqual(c.trim(), '');
    assert.equal(addressCopy('granted'), '');
});

// ─── ④ 場地分類 ──────────────────────────────────────────────────────────

test('B1j-12 三種 type 的 emoji／label（§5.1）', () => {
    assert.deepEqual(venueTypeMeta('hall'), { emoji: '🏛', label: '麻將館', canRateVenue: true, known: true });
    assert.deepEqual(venueTypeMeta('home'), { emoji: '🏠', label: '自建場', canRateVenue: false, known: true });
    assert.deepEqual(venueTypeMeta('event'), { emoji: '🎪', label: '活動場', canRateVenue: true, known: true });
});

test('B1j-13 🔴 自建場不可評場地（§7：評主揪，不評場地）', () => {
    assert.equal(venueTypeMeta('home').canRateVenue, false);
    // 反控：另外兩種是 true ⇒ 「一律 false」不會通過。
    assert.equal(venueTypeMeta('hall').canRateVenue, true);
    assert.equal(venueTypeMeta('event').canRateVenue, true);
});

test('B1j-14 認不得的 type ⇒ known=false 且 canRateVenue=false（fail-closed）', () => {
    for (const t of ['dojo', '', 'HALL', undefined, null, 42, {}]) {
        const m = venueTypeMeta(t as unknown);
        assert.equal(m.known, false, `type=${String(t)}`);
        assert.equal(m.canRateVenue, false, `type=${String(t)}`);
    }
});

test('B1j-15 🔴 前端的 type 名單與後端 Go 常數同步', () => {
    // 掃 shared/venue_models.go 的三個常數定義，與這裡認得的 key 比對。
    // 後端加第四種 type 而前端沒跟上時，那種場地會被畫成「未知場地」——
    // 而「未知場地」跟「資料壞了」在畫面上逐字相同。
    const here = dirname(fileURLToPath(import.meta.url));
    const goPath = join(here, '..', '..', 'backend', 'cmd', 'lambdas', 'shared', 'venue_models.go');
    let src: string;
    try {
        src = readFileSync(goPath, 'utf8');
    } catch (e) {
        // fail-closed：讀不到就判紅。讀不到與「常數全刪了」在這條測試上必須不同。
        assert.fail(`讀不到後端常數檔（${goPath}）：${(e as Error).message}`);
    }
    const found = [...src!.matchAll(/VenueType\w+\s*=\s*"([a-z]+)"/g)].map(m => m[1]).sort();
    assert.deepEqual(found, ['event', 'hall', 'home']);
    for (const t of found) assert.equal(venueTypeMeta(t).known, true, `後端有 ${t}，前端不認得`);
});

test('B1j-16 ⛩ 道館徽章只在 isDojo === true 時出現', () => {
    assert.deepEqual(venueBadges({ isDojo: true }), ['⛩ 道館']);
    assert.deepEqual(venueBadges({ isDojo: false }), []);
    // fail-closed：字串 'true'、1 都不算。
    assert.deepEqual(venueBadges({ isDojo: 'true' as unknown }), []);
    assert.deepEqual(venueBadges({ isDojo: 1 as unknown }), []);
    assert.deepEqual(venueBadges({}), []);
});

// ─── ② 評價 ──────────────────────────────────────────────────────────────

test('B1j-17 🔴 零則評價顯示「尚無評價」，percent 是 null 不是 0（§7）', () => {
    const r = formatRating({ ratingPositive: 0, ratingCount: 0 });
    assert.equal(r.kind, 'none');
    assert.equal(r.text, '尚無評價');
    assert.equal(r.percent, null);
    assert.ok(!r.text.includes('%'), '0% 跟「差評滿貫」在版面上逐字相同');
});

test('B1j-18 有評價時比例與則數一起顯示（§7）', () => {
    const r = formatRating({ ratingPositive: 48, ratingCount: 52 });
    assert.equal(r.kind, 'rate');
    assert.equal(r.percent, 92);
    assert.equal(r.text, '92% ・ 52 則');
});

test('B1j-19 🔴 則數不可省 —— 1/1 的 100% 與 48/52 的 92% 只靠比例分不出好壞', () => {
    const one = formatRating({ ratingPositive: 1, ratingCount: 1 });
    assert.equal(one.percent, 100);
    assert.ok(one.text.includes('1 則'), `則數不見了：${one.text}`);
});

test('B1j-20 差評滿貫是 0% 而不是「尚無評價」（B1j-17 的反控）', () => {
    // 少了這條，`formatRating` 一律回 NO_RATING 也會讓 B1j-17 綠。
    const r = formatRating({ ratingPositive: 0, ratingCount: 7 });
    assert.equal(r.kind, 'rate');
    assert.equal(r.percent, 0);
    assert.equal(r.text, '0% ・ 7 則');
});

test('B1j-21 壞資料一律 none（好評數 > 則數／負數／非整數／缺欄位）', () => {
    for (const v of [
        { ratingPositive: 9, ratingCount: 3 },
        { ratingPositive: -1, ratingCount: 5 },
        { ratingPositive: 1, ratingCount: -5 },
        { ratingPositive: 1.5, ratingCount: 3 },
        { ratingPositive: '3', ratingCount: 3 },
        {},
    ]) {
        assert.equal(formatRating(v as never).kind, 'none', JSON.stringify(v));
    }
});

// ─── ③ 分頁 ──────────────────────────────────────────────────────────────

test('B1j-22 🔴 這一頁 0 筆但還有 nextToken ⇒ 繼續翻（§5.3 點名的坑）', () => {
    // 用 `venues.length === 0` 當終止條件的話，一頁全是自建場就停住，
    // 而畫面顯示「目前還沒有公開的場地」—— 完全合理的樣子。
    assert.equal(nextPageDecision({ nextToken: 'eyJ2ZW51ZUlkIjoiVjEifQ' }, 0), 'fetch');
});

test('B1j-23 nextToken 為空／不存在 ⇒ done', () => {
    assert.equal(nextPageDecision({ nextToken: '' }, 0), 'done');
    assert.equal(nextPageDecision({}, 0), 'done');
    assert.equal(nextPageDecision(null, 0), 'done');
});

test('B1j-24 🔴 打到輪數上限時是 cap-reached，不是 done', () => {
    assert.equal(nextPageDecision({ nextToken: 'tok' }, VENUE_PAGE_ROUND_CAP), 'cap-reached');
    assert.equal(nextPageDecision({ nextToken: 'tok' }, VENUE_PAGE_ROUND_CAP - 1), 'fetch');
    // 沒有 token 時就算超過上限也是 done（真的掃完了）。
    assert.equal(nextPageDecision({}, VENUE_PAGE_ROUND_CAP + 5), 'done');
});

test('B1j-25 🔴 「就這些了」與「我們自己停了」的文案必須不同', () => {
    const done = listEmptyCopy(0, 'done');
    const capped = listEmptyCopy(0, 'cap-reached');
    assert.notEqual(done, capped);
    assert.equal(listEmptyCopy(3, 'done'), '');
    assert.equal(listEmptyCopy(3, 'cap-reached'), '');
});

test('B1j-26 多頁合併會去重、保序、丟掉沒有 venueId 的', () => {
    const card = (id: string): never => ({
        venueId: id, type: 'hall', name: id,
        approxLocation: { latitude: 25, longitude: 121 },
        isDojo: false, ratingPositive: 0, ratingCount: 0,
    } as never);
    const merged = mergeVenuePages([
        [card('V1'), card('V2')],
        [card('V2'), card('V3')],
        undefined,
        [{ venueId: '' } as never, null as never],
    ]);
    assert.deepEqual(merged.map(c => c.venueId), ['V1', 'V2', 'V3']);
});

// ─── 整合 ────────────────────────────────────────────────────────────────

test('B1j-27 venueHeadline 把四件事一次算好', () => {
    const h = venueHeadline({
        venueId: 'V1', type: 'hall', name: '  大安麻將館  ',
        approxLocation: { latitude: 25.03, longitude: 121.54 },
        ownerId: 'U1', certifiedRefereeCount: 0, isDojo: false,
        ratingPositive: 9, ratingCount: 10,
        createdAt: 1, updatedAt: 1, status: 'active',
        exactAddress: '台北市大安區某路 1 號',
    });
    assert.equal(h.emoji, '🏛');
    assert.equal(h.typeLabel, '麻將館');
    assert.equal(h.name, '大安麻將館');
    assert.deepEqual(h.badges, []);
    assert.equal(h.rating.text, '90% ・ 10 則');
    assert.equal(h.addressState, 'granted');
});

test('B1j-28 名字是空白時退回「未命名場地」，不是空字串', () => {
    const h = venueHeadline({ name: '   ' } as never);
    assert.equal(h.name, '未命名場地');
    // 而且無效輸入不會把地址判成 granted。
    assert.equal(h.addressState, 'withheld-review');
});

test('B1j-29 湊夠卡片就停手，湊不夠而且還有下一頁就繼續（成本：無閘門的 Scan）', () => {
    assert.equal(shouldKeepScanning(0, 'fetch', 20), true);
    assert.equal(shouldKeepScanning(19, 'fetch', 20), true);
    assert.equal(shouldKeepScanning(20, 'fetch', 20), false);
});

test('B1j-30 🔴 沒有下一頁時，卡片再少也不繼續掃（否則會空轉打 API）', () => {
    // 反控方向：B1j-29 只證明「湊夠會停」，這條證明「沒得拿也會停」。
    assert.equal(shouldKeepScanning(0, 'done', 20), false);
    assert.equal(shouldKeepScanning(0, 'cap-reached', 20), false);
});

test('B1j-31 建立表單四條驗證各自回**不同**的訊息', () => {
    const ok = { type: 'hall', name: '大安館', latitude: 25, longitude: 121, exactAddress: '' };
    assert.equal(validateCreateVenue(ok), null);
    const msgs = [
        validateCreateVenue({ ...ok, type: 'event' }),   // 玩家不能建活動場
        validateCreateVenue({ ...ok, name: '  ' }),
        validateCreateVenue({ ...ok, latitude: 999 }),
        validateCreateVenue({ type: 'home', name: 'x', latitude: 25, longitude: 121, exactAddress: '' }),
    ];
    for (const m of msgs) assert.ok(m && m.trim() !== '', `缺訊息：${JSON.stringify(msgs)}`);
    // 合成一句「資料不正確」的話，使用者不知道要改哪一格。
    assert.equal(new Set(msgs).size, msgs.length, `訊息重複：${JSON.stringify(msgs)}`);
});

test('B1j-32 🔴 自建場必填完整地址；麻將館可以不填（B1j-31 的反控）', () => {
    // 少了後半句，「一律要求填地址」也會讓 B1j-31 綠。
    assert.ok(validateCreateVenue({ type: 'home', name: 'x', latitude: 25, longitude: 121, exactAddress: '' }));
    assert.equal(validateCreateVenue({ type: 'home', name: 'x', latitude: 25, longitude: 121, exactAddress: '台北市…' }), null);
    assert.equal(validateCreateVenue({ type: 'hall', name: 'x', latitude: 25, longitude: 121 }), null);
});

test('B1j-33 座標缺漏／NaN 也會被擋（不是只擋超出範圍）', () => {
    for (const bad of [{}, { latitude: NaN, longitude: 121 }, { latitude: 25, longitude: 181 }, { latitude: -91, longitude: 0 }]) {
        assert.ok(validateCreateVenue({ type: 'hall', name: 'x', ...bad }), JSON.stringify(bad));
    }
});

test('B1j-37 三頁真的接上判讀層（掃原始碼，且先把註解拿掉）', () => {
    // 🔴 純函式的 36 條測試對「頁面有沒有用它們」零鑑別力：VenueDetail.tsx 大可
    //    自己寫一行 `if (!v.exactAddress)`，上面每一條照樣綠。e2e/venue.e2e.cjs 咬得住
    //    detail／list 兩頁（真的開瀏覽器），但 **CreateVenue 不在那支裡**
    //    （它要開 MapPicker，會真的抓圖磚）⇒ 這條是它唯一的接線尺。
    //
    // 🔴 **先把註解拿掉再比對**：這幾個檔的檔頭註解裡就寫著 `readAddressState()`
    //    這種字樣，不剝註解的話「提到」與「呼叫」在偵測器眼裡逐字相同
    //    （而那正是這種掃描最容易假綠的地方）。
    const here = dirname(fileURLToPath(import.meta.url));
    const stripComments = (src: string) =>
        src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const read = (...seg: string[]) => stripComments(readFileSync(join(here, '..', ...seg), 'utf8'));

    const cases: [string, string[]][] = [
        ['VenueDetail.tsx', ['venueHeadline(', 'addressCopy(', 'isAddressVisible(']],
        ['VenueList.tsx', ['nextPageDecision(', 'shouldKeepScanning(', 'listEmptyCopy(', 'mergeVenuePages(']],
        ['CreateVenue.tsx', ['validateCreateVenue(', 'locationForSubmit(', 'CREATABLE_VENUE_TYPES']],
    ];
    for (const [file, needles] of cases) {
        const src = read('pages', file);
        for (const n of needles) assert.ok(src.includes(n), `${file} 沒有呼叫 ${n}`);
    }
    // 🔴 偵測器自己的反控：它分不分得出「有」與「沒有」？
    assert.equal(read('pages', 'VenueDetail.tsx').includes('venueGhostFunctionThatDoesNotExist('), false);
    // 🔴 偵測器自己的反控 ②：**剝註解那一步真的有效嗎**。
    //    少了這段，把 stripComments 改成 `s => s` 不會有任何測試紅 ——
    //    而那正是這種掃描假綠的入口（註解裡寫著 `readAddressState()` 也會被算成接上了）。
    //    ⚠️ 刻意用**合成輸入**直接打這個函式，不是去斷言某個真檔的註解裡有什麼字：
    //      後者的前提會被一次無關的註解改寫靜靜推翻，而推翻之後它與「正常運作」逐字相同。
    assert.equal(stripComments('// foo(\nbar(').includes('foo('), false, '單行註解沒被剝掉');
    assert.equal(stripComments('/* foo( */\nbar(').includes('foo('), false, '區塊註解沒被剝掉');
    assert.ok(stripComments('// foo(\nbar(').includes('bar('), '把程式碼也一起剝掉了');
    // 而且它真的被套用在這三個檔上（剝完一定變短 —— 這三個檔都有大段檔頭註解）。
    for (const [file] of cases) {
        const rawLen = readFileSync(join(here, '..', 'pages', file), 'utf8').length;
        assert.ok(read('pages', file).length < rawLen, `${file} 剝註解之後長度沒變 ⇒ 沒套用`);
    }
});
