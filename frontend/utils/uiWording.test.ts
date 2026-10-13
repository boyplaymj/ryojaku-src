// 跑法：node --test utils/uiWording.test.ts（需 Node >= 22.18）或 npm test。
//
// App 介面的用字界線（使用者 2026-10-13 拍板）：
//   可以：底台、幾底幾台、籌碼、分數、戰績 —— 那是計分的說法。
//   不可以：把它講成錢 —— 元、錢、金額、盈虧、獲利、收益、損益、賠、賺、現金，以及賭、下注這類字。
// 平台只記分數，不定義一分值多少（設計冊 modules/foundation.md 的金流紅線）。
//
// 這條掃的是「介面上會出現的字」：components／pages／hooks／services／utils 的 .ts／.tsx，
// 去掉註解之後不可以出現上面那些字。條款（TermsOfServiceModal）是在**禁止**這些事，本來就會寫到，不掃。
//
// 🔴 照不到的：後端回來的字串、推播文案、資料庫裡既有的內容、使用者自己打的字。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 「元」要排掉不是錢的用法：大三元（牌型）、單元、公元、次元、元素、元件、元寶。
const MONEY_WORDS = /金額|(?<![三公單次])元(?![素件寶])|錢|盈|虧|獲利|收益|損益|賺|賠|現金|賭|底注|下注|押注|彩金|獎金|NT\$|台幣/;

/** 例外：檔案 → 允許出現的原文片段與理由。 */
const ALLOW: Record<string, { text: string; why: string }[]> = {};

/** 去掉註解：區塊註解（含 JSX 的那種）整段拿掉；行註解只認「行首或空白之後的 //」，免得吃掉網址。 */
export function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
        .split('\n').map(line => line.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
}

function scan(): { hits: string[]; files: number } {
    const hits: string[] = [];
    let files = 0;
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const abs = join(dir, name);
            if (statSync(abs).isDirectory()) { walk(abs); continue; }
            if (!/\.tsx?$/.test(name) || name.endsWith('.test.ts') || name === 'TermsOfServiceModal.tsx') continue;
            files += 1;
            const rel = relative(ROOT, abs).split('\\').join('/');
            stripComments(readFileSync(abs, 'utf8')).split('\n').forEach((line, i) => {
                const m = line.match(MONEY_WORDS);
                if (!m) return;
                if ((ALLOW[rel] ?? []).some(a => line.includes(a.text))) return;
                hits.push(`${rel}:${i + 1} 「${m[0]}」 ${line.trim().slice(0, 60)}`);
            });
        }
    };
    for (const d of ['components', 'pages', 'hooks', 'services', 'utils']) walk(join(ROOT, d));
    for (const f of ['App.tsx', 'constants.ts']) {
        files += 1;
        stripComments(readFileSync(join(ROOT, f), 'utf8')).split('\n').forEach((line, i) => {
            const m = line.match(MONEY_WORDS);
            if (m) hits.push(`${f}:${i + 1} 「${m[0]}」 ${line.trim().slice(0, 60)}`);
        });
    }
    return { hits, files };
}

test('stripComments：拿掉註解，留下字串裡的網址', () => {
    assert.equal(stripComments('const a = "https://x.com"; // 金額'), 'const a = "https://x.com"; ');
    assert.equal(stripComments('a /* 錢 */ b'), 'a         b'.replace(/ {9}/, ' '.repeat(' /* 錢 */ '.length)));
    assert.ok(!/金額/.test(stripComments('{/* 這裡\n   講到金額\n*/}\n<p>分數</p>')));
    assert.ok(/分數/.test(stripComments('{/* 這裡\n   講到金額\n*/}\n<p>分數</p>')));
});

test('判準本身：錢的說法會被抓到，計分的說法與牌型名不會', () => {
    for (const bad of ['實際金額', '100 元', '盈利', '虧損', '獲利', '收益曲線', '累計損益', '小賭怡情', '底台底注', '現金']) {
        assert.ok(MONEY_WORDS.test(bad), bad);
    }
    for (const ok of ['底台', '籌碼', '100/20', '本場分數', '正分', '負分', '戰績結算', '大三元', '單元', '元件', '幾底幾台']) {
        assert.ok(!MONEY_WORDS.test(ok), ok);
    }
});

test('介面上沒有把分數講成錢的字', () => {
    const { hits, files } = scan();
    assert.ok(files > 80, `只掃到 ${files} 個檔 ⇒ 掃描範圍不對，下面的「0 處」不算數`);
    assert.deepEqual(hits, []);
});

// 條款與介面要說同一件事：條款不再禁止「底」「台」，只禁止把它標上金額。
test('條款第五條：不禁止底台，仍禁止明示金額；而且不承諾做不到的監控', () => {
    const terms = readFileSync(join(ROOT, 'components', 'TermsOfServiceModal.tsx'), 'utf8');
    assert.ok(!/「底」、「台」或「X底X台」/.test(terms), '條款還在禁止「底」「台」，而介面自己就在用');
    assert.ok(/「一底XX元」、「XX元／台」或其他明示賭注金額之用語/.test(terms), '禁止明示金額的那一款不見了');
    assert.ok(!/本公司將監控並移除/.test(terms), '條款承諾會監控，而程式裡沒有任何監控');
    // 公開的條款頁是從 modal 抽出來產生的，要跟著是新的。
    const html = readFileSync(join(ROOT, 'public', 'terms.html'), 'utf8');
    assert.ok(!/X底X台/.test(html) && /一底XX元/.test(html), 'public/terms.html 沒有跟著重產');
});

test('隱私權政策：記帳記的是分數，不是金額', () => {
    const privacy = readFileSync(join(ROOT, 'legal', 'privacy.txt'), 'utf8');
    assert.ok(!/金額/.test(privacy), privacy.split('\n').filter(l => /金額/.test(l)).join('\n'));
    assert.ok(/牌局結果與分數/.test(privacy));
});
