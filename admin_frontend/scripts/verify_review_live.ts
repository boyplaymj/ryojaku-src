// verify_review_live.ts — 審核頁的**資料路徑**打真後端跑一次（D6，唯讀）
//
// 🔴 這支關掉的是「沒用真後端點過」那件事的**一半**：
//    回傳形狀對不對、翻頁在真資料上會不會停、聚合層吃得下去。
//    ⚠️ 它**不驗**瀏覽器裡的 React 有沒有畫出來 —— 那要真 admin 登入 + 真瀏覽器。
//       所以本檔通過**不等於**「頁面能用」，只等於「頁面要吃的東西是對的」。
//
// 🔴 用的是 src/utils/ 那兩支**生產程式碼本身**（collectPages / buildReview），
//    不是另外抄一份翻頁邏輯。抄一份的話，這支證明的是「我抄的那份能用」。
//
// admin token 自簽（沿用 infra/verify_voice_corrections.py 的作法：手上沒有 s2admin
// 明文密碼，但有 SSM 的金鑰）。**唯讀**：只發 GET，不寫任何資料。
//
// 用法：
//   node-22 scripts/verify_review_live.ts           唯讀，只驗形狀與翻頁
//   node-22 scripts/verify_review_live.ts --seed    另外寫入真資料走完整條飛輪，再清掉
//
// 🔴 為什麼需要 --seed：唯讀模式在**空表**上跑，而空回應正是「會動」與「壞掉」
//    長得一樣的地方（0 筆、0 個台種、0 則建議，全部都是合法輸出）。
//    --seed 用真使用者寫幾筆進去，讓「有資料時算得對」也被量到。
//    ⚠️ 它會寫真 stg 表，跑完自己清（列 + 帳號三張表），並回頭確認清乾淨。
//    ⚠️ 用掉 2 次 app-register（每 IP 每小時 10 次）。
//
// rc: 0=通過  1=判準失敗  2=設備問題（拿不到金鑰／打不到端點 ⇒ 量不到，不是通過）

import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectPages, MAX_PAGES, type VoicePage } from '../src/utils/voiceUsage.ts';
import { buildReview, type FanTable, type ReviewPage } from '../src/utils/voiceReview.ts';

const REGION = 'ap-southeast-1';
const BASE = 'https://9mu0vajn38.execute-api.ap-southeast-1.amazonaws.com/stg';
const TABLE: FanTable = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/engine/mahjong-tai/fan_table.json', import.meta.url)), 'utf8')
);

let fails = 0;
const ok = (m: string) => console.log(`  ✅ ${m}`);
const no = (m: string) => { fails++; console.log(`  ❌ ${m}`); };
const die = (m: string): never => { console.error(`\n🔴 [設備] ${m}`); process.exit(2); };

const b64 = (b: Buffer) => b.toString('base64url');
function sign(payload: object, secret: string) {
  const h = b64(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64(Buffer.from(JSON.stringify(payload)));
  return `${h}.${p}.${b64(createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
}

function ssm(name: string) {
  try {
    return execFileSync('aws', ['ssm', 'get-parameter', '--region', REGION, '--name', name,
      '--with-decryption', '--query', 'Parameter.Value', '--output', 'text'],
      { encoding: 'utf8' }).trim();
  } catch (e) {
    return die(`讀不到 SSM ${name}：${(e as Error).message.slice(0, 200)}`);
  }
}

const MARK = 'D6REVIEW-DELETEME';
const PREFIX = 'MahjongClubStg_';
// 殘字必須是台數表沒有的詞（同單元測試的理由：已知詞被排除是對的，
// 而被排除的結果 0 則建議跟「引擎沒載到」在斷言上逐字相同）。
const NOVEL_TERM = 'ZZ線上驗收殘字';

function ddb(args: string[]): { rc: number; out: string } {
  try {
    return { rc: 0, out: execFileSync('aws', ['dynamodb', ...args, '--region', REGION], { encoding: 'utf8' }) };
  } catch (e) {
    return { rc: 1, out: String((e as { stderr?: string }).stderr ?? e) };
  }
}

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
}

/** 註冊一個真使用者拿真 token（自簽的 user token 過不了 pwChangedAt 那一關）。 */
async function register(tag: string) {
  const r = await post('/app-register', {
    email: `d6rev+${tag}@example.com`, password: 'D6Rev12345!', displayName: MARK,
  });
  if (r.status !== 200 || !r.body.token) {
    die(`註冊測試帳號失敗（最常見原因：app-register 每 IP 每小時 10 次的限流）。${r.status}：${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const userId = ((r.body.data ?? r.body.user) as { userId?: string } | undefined)?.userId;
  if (!userId) die(`註冊成功但取不到 userId：${JSON.stringify(r.body).slice(0, 200)}`);
  return { token: r.body.token as string, userId: userId as string };
}

function cleanupUser(userId: string) {
  const q = ddb(['query', '--table-name', `${PREFIX}VoiceCorrections`,
    '--key-condition-expression', 'pk = :p',
    '--expression-attribute-values', JSON.stringify({ ':p': { S: `USER#${userId}` } }), '--output', 'json']);
  if (q.rc !== 0) return no(`清理時查不到 ${userId} 的列：${q.out.slice(0, 160)}`);
  const d = JSON.parse(q.out) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: unknown };
  if (d.LastEvaluatedKey) return no(`${userId} 的列未分頁完 —— 不宣稱已清乾淨`);
  for (const it of d.Items ?? []) {
    const r = ddb(['delete-item', '--table-name', `${PREFIX}VoiceCorrections`,
      '--key', JSON.stringify({ pk: it.pk, sk: it.sk })]);
    if (r.rc !== 0) no(`刪列失敗：${r.out.slice(0, 160)}`);
  }
  for (const tbl of ['Users', 'AuthIdentities', 'AuthTokens']) {
    const sc = ddb(['scan', '--table-name', PREFIX + tbl, '--output', 'json']);
    if (sc.rc !== 0) { no(`清帳號時掃 ${tbl} 失敗`); continue; }
    const sd = JSON.parse(sc.out) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: unknown };
    if (sd.LastEvaluatedKey) { no(`${tbl} 未分頁完 —— 不宣稱已清乾淨`); continue; }
    const ks = ddb(['describe-table', '--table-name', PREFIX + tbl,
      '--query', 'Table.KeySchema[].AttributeName', '--output', 'json']);
    const keys = ks.rc === 0 ? (JSON.parse(ks.out) as string[]) : [];
    for (const it of sd.Items ?? []) {
      if (!JSON.stringify(it).includes(userId)) continue;
      if (!keys.length || !keys.every((k) => k in it)) continue;
      const key = Object.fromEntries(keys.map((k) => [k, it[k]]));
      const r = ddb(['delete-item', '--table-name', PREFIX + tbl, '--key', JSON.stringify(key)]);
      if (r.rc !== 0) no(`刪 ${tbl} 失敗：${r.out.slice(0, 160)}`);
    }
  }
}

async function main() {
  const adminSecret = ssm('/ryojaku/stg/ADMIN_JWT_SECRET');
  const token = sign({ sub: 's2admin', role: 'super_admin', exp: Math.floor(Date.now() / 1000) + 600 }, adminSecret);

  let calls = 0;
  const fetchPage = async (cursor: string): Promise<VoicePage> => {
    calls++;
    const url = cursor
      ? `${BASE}/admin/voice-corrections?cursor=${encodeURIComponent(cursor)}`
      : `${BASE}/admin/voice-corrections`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status !== 200) die(`GET /admin/voice-corrections 回 ${r.status}：${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as VoicePage;
  };

  console.log('══ 打真後端（唯讀）══');
  const { pages, hitCap } = await collectPages(fetchPage);
  console.log(`  掃了 ${pages.length} 頁（HTTP ${calls} 次），hitCap=${hitCap}`);

  // 🔴 翻頁**真的會停**。停不下來時的症狀不是慢，是打爆自己的後端 ——
  //    而那件事只有打真 API 才看得到（單元測試餵的是我自己造的 cursor）。
  if (calls <= MAX_PAGES) ok(`翻頁有停下來（${calls} 次 ≤ 上限 ${MAX_PAGES}）`);
  else no(`翻頁沒停：打了 ${calls} 次`);

  const last = pages[pages.length - 1];
  const complete = pages.length > 0 && !last?.nextCursor;
  ok(`complete=${complete}${complete ? '（掃到底）' : '（沒掃到底，數字是下限）'}`);

  // 回傳形狀：這幾個鍵是聚合層與用量卡的契約，缺了只會少幾個數字、不會報錯。
  for (const k of ['data', 'skipped', 'pageEvents'] as const) {
    if (k in (pages[0] ?? {})) ok(`回傳有 ${k}`);
    else no(`回傳缺 ${k} —— 少了它畫面只會少幾個數字，不會有任何錯誤`);
  }
  if (Array.isArray(pages[0]?.data)) ok('data 是陣列不是 null');
  else no(`data 不是陣列而是 ${JSON.stringify(pages[0]?.data)}`);

  console.log('\n══ 餵進生產的聚合層 ══');
  const s = buildReview(pages as ReviewPage[], TABLE, complete);
  console.log(`  totalRows=${s.health.totalRows} fans=${s.fans.length} suggestions=${s.suggestions.length}`);
  console.log(`  tableVersion=${s.health.tableVersion} dataVersions=${JSON.stringify(s.health.dataVersions)}`);
  console.log(`  health: 缺userId=${s.health.rowsWithoutUserId} 形狀壞=${s.health.rowsWithBrokenDiffShape} 表外台種=${s.health.unknownFanIds.length}`);
  ok('buildReview 吃得下真後端的回應（沒有拋例外）');

  // 🔴 現在必然是空的：D4-g 前端埋點還沒部署 ⇒ 沒有人在送。
  //    所以「0 筆」是**預期**，但它不可以被讀成「判得很準」——
  //    這裡把它印成一句話，而不是讓一個 0 自己代表兩件事。
  if (s.health.totalRows === 0) {
    console.log('\n  ℹ️ 0 筆訂正 —— 這是預期的：前端埋點尚未部署，寫入端沒有人在送。');
    console.log('     ⚠️ 這個 0 **不是**「判得很準」，也不是「沒人用」。');
  }

  if (process.argv.includes('--seed')) {
    console.log('\n══ --seed：寫真資料走完整條飛輪 ══');
    const baseRows = s.health.totalRows;
    const ts = Math.floor(Date.now() / 1000);
    const FAN_A = TABLE.fans[0].id;
    const FAN_B = TABLE.fans[1].id;
    const users: { token: string; userId: string }[] = [];
    try {
      for (const tag of [`${ts}a`, `${ts}b`]) users.push(await register(tag));
      for (const u of users) {
        // ① 型一建議的來源：殘字 + 剛好補上一個台種
        let r = await post('/voice-corrections', {
          text: NOVEL_TERM, normalizedText: NOVEL_TERM, parsed: [], corrected: [FAN_A],
          added: [FAN_A], removed: [], unmatched: NOVEL_TERM, hadDiff: true,
          rulesetVersion: TABLE.meta?.version ?? '0.1.0', engineVersion: 'live-probe', ts,
        }, u.token);
        if (r.status !== 200) no(`寫入①失敗 ${r.status}：${JSON.stringify(r.body).slice(0, 160)}`);
        // ② 誤判方向：使用者刪掉一個台種
        r = await post('/voice-corrections', {
          text: '測試', normalizedText: '測試', parsed: [FAN_B], corrected: [],
          added: [], removed: [FAN_B], unmatched: '', hadDiff: true,
          rulesetVersion: TABLE.meta?.version ?? '0.1.0', engineVersion: 'live-probe', ts,
        }, u.token);
        if (r.status !== 200) no(`寫入②失敗 ${r.status}：${JSON.stringify(r.body).slice(0, 160)}`);
      }

      const after = buildReview((await collectPages(fetchPage)).pages as ReviewPage[], TABLE, true);
      if (after.health.totalRows === baseRows + 4) ok(`後台讀回 ${baseRows + 4} 筆（基線 ${baseRows} + 我寫的 4）`);
      else no(`筆數不對：期望 ${baseRows + 4}，實得 ${after.health.totalRows}`);

      const a = after.fans.find((f) => f.fanId === FAN_A);
      const b = after.fans.find((f) => f.fanId === FAN_B);
      if (a && a.timesAdded >= 2) ok(`「${a.name}」被補上 ${a.timesAdded} 次（漏判方向）`);
      else no(`FAN_A 的 timesAdded 不對：${JSON.stringify(a)}`);
      if (b && b.timesRemoved >= 2) ok(`「${b.name}」被刪掉 ${b.timesRemoved} 次（誤判方向）`);
      else no(`FAN_B 的 timesRemoved 不對：${JSON.stringify(b)}`);

      const sug = after.suggestions.find((x) => x.term === NOVEL_TERM);
      if (sug && sug.type === 'add_confusion' && sug.distinctUsers === 2 && sug.autoApplicable) {
        ok(`飛輪端到端成立：真資料 → extractSuggestions → 「${sug.term}」→「${sug.fanName}」（2 位不同使用者）`);
      } else {
        no(`沒有從真資料算出預期的建議：${JSON.stringify(after.suggestions).slice(0, 300)}`);
      }
      if (after.health.rowsWithoutUserId === 0 && after.health.rowsWithBrokenDiffShape === 0) {
        ok('資料健康三格在真資料上都是 0（後端回的形狀是完整的）');
      } else {
        no(`資料健康不是 0：缺userId=${after.health.rowsWithoutUserId} 形狀壞=${after.health.rowsWithBrokenDiffShape}`);
      }
    } finally {
      console.log('\n── 清理（不管上面成敗都要跑）');
      for (const u of users) cleanupUser(u.userId);
      const back = buildReview((await collectPages(fetchPage)).pages as ReviewPage[], TABLE, true);
      if (back.health.totalRows === baseRows) ok(`已清回基線 ${baseRows} 筆`);
      else no(`清理後筆數是 ${back.health.totalRows}，基線是 ${baseRows} —— 有殘留`);
    }
  }

  console.log(`\n${fails === 0 ? '== rc=0：資料路徑打真後端通過 ==' : `== rc=1：${fails} 項失敗 ==`}`);
  console.log('⚠️ 界線：本支不驗瀏覽器裡的 React —— 那仍需真 admin 登入。');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => die(`探針自己炸了：${e?.stack ?? e}`));
