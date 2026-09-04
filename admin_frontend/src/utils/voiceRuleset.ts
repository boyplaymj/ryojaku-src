// utils/voiceRuleset.ts — 後台唯讀檢視頁的**判讀層**（D5-e／E2）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c（A 案四條紀律）、
//       §D5-e(E1)（端點契約：三種 state 與各自的處置）。
//
// ── 這支存在的理由 ──
//
// 這一頁只回答一個問題：**現在下發給玩家的家規表是哪一份**。
// 而它會遇到的每一種「拿不到／拿到怪東西」，處置**都不一樣**：
//
//   端點沒部署   → 去部署 stack
//   那一列不存在 → 去跑 seed_ruleset.py
//   DDB 讀不到   → 設備問題，讀數作廢，不要拿它下任何結論
//   那一列壞掉   → 有人繞過播種腳本寫了那一列（紀律 1 只有一條寫入路徑）
//
// 🔴 這四種在「頁面上什麼都沒有」這個外觀上**逐字相同**。E1 為此刻意把
//    「不存在」做成 `200 + state:"not-seeded"`、把 404 留給「端點不在」——
//    ⇒ **那個區別必須一路活到畫面上**，否則後端那個設計等於沒做。
//
// 🔴🔴 **而「端點不在」在這條產線上不是 404，是 403。**（2026-09-04 實測，
//    infra/verify_admin_ruleset_live.py 部署前那一輪量到的）
//    REST API Gateway 對**沒佈上的路由**回 403：不帶 token 是
//    `MissingAuthenticationTokenException`、帶了 `Authorization: Bearer …`
//    是 `IncompleteSignatureException`（它把 Bearer 當 SigV4 去解）。
//    ⇒ v1 把 403 一律判成「角色不足」，於是**今天這個狀態**（stack 還沒部署）
//    會在畫面上顯示「換一個有權限的帳號登入」—— 指示是錯的，而且錯得很有說服力。
//    這正是本檔要防的那件事，發生在本檔自己身上。
//
// 🔴 **只能靠 body 形狀分，不能靠 header。** `x-amzn-errortype` 在回應裡（實測有），
//    但 Gateway 沒有給 `Access-Control-Expose-Headers` ⇒ 瀏覽器的 JS **讀不到它**。
//    handler 的 403 是 `{success:false, error:"forbidden"}`，Gateway 的是
//    `{message:"…"}`（沒有 success 這一鍵）。判準用**有沒有 handler 的形狀**，
//    不用訊息字串比對（那句英文是 AWS 的，會改）。
//    ⚠️ 第三種：Gateway 形狀但訊息不是「路由不在」那兩句（例如維護模式的
//    explicit deny）⇒ 走 `gateway-denied`，**不併進上面任何一種** ——
//    它的處置是「去看 Gateway／authorizer」，跟另外兩種都不同。
//    這也是本檔不能用 `api.ts` 的共用 `request()` 的原因（它把所有非 2xx
//    壓成同一種 Error，狀態碼在呼叫端就消失了）。
//
// 🔴 **所有判斷在這裡，頁面只負責畫。** 這些判斷全都是「錯了不會報錯」的那一種：
//    把 unknown state 當成 seeded、把 502 當成 not-seeded，畫面都不會有任何異常，
//    只會安靜地給出一個**對其中一種情形是錯的**指示。唯一能證明它對的方式是
//    拿合成回應去問它，而那要它可測。

/** E1 回的那份事實（`buildView`）。欄位全部標成可缺 —— 舊版後端／半壞的回應不該讓整頁爆掉。 */
export interface RulesetView {
  success?: boolean;
  state?: string;
  table?: string;
  infoKey?: string;
  version?: string;
  sha256?: string;
  bytes?: number;
  raw?: string;
  reason?: string;
}

/**
 * 判讀結果。**每一種都對應一個不同的處置**，所以它們是分開的 kind 而不是
 * 一個 boolean 加一段訊息。
 */
export type RulesetOutcome =
  /** 那一列在、而且解得開。這是唯一「正常」的狀態。 */
  | { kind: 'seeded'; view: RulesetView }
  /** 那一列不存在。⛔ 不是錯誤 —— 是「還沒播種」這個事實。 */
  | { kind: 'not-seeded'; view: RulesetView }
  /** 那一列在，但解不開。`reason` 指名哪一鍵。 */
  | { kind: 'malformed'; view: RulesetView }
  /**
   * 這條路由不在。E1 把 404 保留給這一種 —— 但實測 Gateway 給的是 403（見檔頭），
   * 所以兩個碼都會落到這裡。`status` 記下**實際量到的那個碼**，不抹平。
   */
  | { kind: 'not-deployed'; status: number; detail: string }
  /** 502：DDB 讀不到。**設備問題，讀數作廢。** */
  | { kind: 'store-unavailable' }
  /** 403 且帶著 handler 的形狀：token 有效但角色不夠。 */
  | { kind: 'forbidden' }
  /**
   * 403，Gateway 形狀，但訊息不是「路由不在」那一類。
   * 例如 authorizer 的 explicit deny（維護模式 kill switch）。
   * ⛔ 不併進 forbidden：那會叫人去換帳號，而該做的是去看 Gateway。
   */
  | { kind: 'gateway-denied'; detail: string }
  /** 200，但 `state` 是本頁不認得的值。⛔ fail-closed，絕不當成 seeded。 */
  | { kind: 'unknown-state'; state: string; view: RulesetView }
  /** 200，但形狀說不清楚（不是物件／缺 state／自相矛盾）。 */
  | { kind: 'unreadable'; detail: string }
  /** 其他狀態碼，或 fetch 本身失敗。 */
  | { kind: 'error'; status: number | null; detail: string };

/** 本頁認得的 state。多一個值就是契約變了 —— 要被 `unknown-state` 叫出來，不是靜靜通過。 */
const KNOWN_STATES = ['seeded', 'not-seeded', 'malformed'] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Gateway 的錯誤 body 是 `{message: "…"}`，而 explicit deny 那條是大寫的
 * `{Message: "…"}`。⚠️ 兩種都收 —— 只認一種的話，另一種會變成空字串，
 * 而空字串在畫面上與「沒有原因」逐字相同。
 */
const gatewayMessage = (body: unknown): string => {
  if (!isObject(body)) return '';
  return str(body.message) || str(body.Message) || str(body.error);
};

/**
 * 「這條路由沒佈上」的兩句指紋（2026-09-04 對 stg 實測）。
 * ⚠️ 這是 AWS 的英文訊息，**會改**。所以它只用來從 Gateway 形狀裡再分一層，
 *    不用來判斷「是不是 handler 回的」（那一層看的是 success 這一鍵）。
 */
const ROUTE_ABSENT = ['Missing Authentication Token', 'Invalid key=value pair'];

/**
 * 把一次 HTTP 回應判讀成處置。**純函式**：不碰網路、不碰時鐘、不碰 localStorage。
 *
 * @param status HTTP 狀態碼；fetch 本身炸掉時傳 `null`。
 * @param body   已解析的 JSON body（解析失敗傳 `undefined`）。
 */
export function interpret(status: number | null, body: unknown): RulesetOutcome {
  // 🔴 非 200 的分支排在最前面，而且**逐個列舉**，不寫成 `status >= 400 → 錯誤`。
  //    E1 給每個狀態碼配了不同的意思，全部收斂成「錯誤」等於把那份設計丟掉。
  if (status === null) {
    return { kind: 'error', status: null, detail: '連線失敗（fetch 沒有回應）' };
  }
  if (status === 404) {
    return { kind: 'not-deployed', status: 404, detail: gatewayMessage(body) };
  }
  if (status === 502) return { kind: 'store-unavailable' };
  if (status === 403) {
    // 🔴 三種 403，處置全不一樣（檔頭）。判準是「這是不是 handler 回的」——
    //    handler 一律帶 success:false；Gateway 的錯誤回應沒有這一鍵。
    if (isObject(body) && body.success === false) return { kind: 'forbidden' };
    const msg = gatewayMessage(body);
    if (ROUTE_ABSENT.some((m) => msg.includes(m))) {
      return { kind: 'not-deployed', status: 403, detail: msg };
    }
    // ⛔ 認不出來時**不猜**。落到 forbidden 會給出一個很有說服力的錯指示。
    return { kind: 'gateway-denied', detail: msg };
  }
  if (status !== 200) {
    const detail = isObject(body) ? str(body.error) : '';
    return { kind: 'error', status, detail: detail || `未預期的狀態碼 ${status}` };
  }

  if (!isObject(body)) {
    return { kind: 'unreadable', detail: '回應不是 JSON 物件' };
  }
  const view = body as RulesetView;
  const state = str(view.state);
  if (!state) {
    // ⛔ 不預設任何值。缺 `state` 時「一切正常」與「後端回了半份東西」分不出來，
    //    而預設 seeded 會讓後者長得像前者。
    return { kind: 'unreadable', detail: '回應缺少 state 欄位' };
  }
  if (!(KNOWN_STATES as readonly string[]).includes(state)) {
    return { kind: 'unknown-state', state, view };
  }

  if (state === 'not-seeded') {
    // 🔴 矛盾要講出來。E1 對 not-seeded 保證「Version/SHA256/Raw 全空」；
    //    帶著內容的 not-seeded 代表兩邊對這個字的理解已經不同，
    //    而它在畫面上會顯示成一句安穩的「尚未播種」。
    if (str(view.version) || str(view.sha256) || str(view.raw)) {
      return { kind: 'unreadable', detail: 'state=not-seeded 卻帶著內容（version／sha256／raw）' };
    }
    return { kind: 'not-seeded', view };
  }

  if (state === 'malformed') {
    // reason 缺席不改判 —— 那一列確實壞了。但要把「連原因都沒有」講出來，
    // 否則畫面上會是一塊空白，而空白讀起來像「沒事」。
    return { kind: 'malformed', view };
  }

  // seeded：E1 保證 version 與 sha256 都有值（buildView 先算 sha 再 Parse）。
  // 🔴 少了任一個就是矛盾，fail-closed —— 「seeded 但沒有版本」正是
  //    rulesetVersion 失去鑑別力的那種狀態，不可以顯示成正常。
  if (!str(view.version)) {
    return { kind: 'unreadable', detail: 'state=seeded 卻沒有 version' };
  }
  if (!str(view.sha256)) {
    return { kind: 'unreadable', detail: 'state=seeded 卻沒有 sha256' };
  }
  return { kind: 'seeded', view };
}

/** 版面用的四種語氣。`ok` 只給真的沒問題的那一種。 */
export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export interface Presentation {
  tone: Tone;
  /** 標題：講**事實**，不講情緒。 */
  title: string;
  /** 一句話說明這個狀態是什麼意思。 */
  body: string;
  /** 該做什麼。**每一種都不一樣**，這正是不能合併 kind 的理由。 */
  action: string;
}

/**
 * 把處置寫成人看得懂的三句話。
 *
 * 🔴 `action` 不可以有兩種 kind 共用同一句 —— 那等於在版面上把它們合併回去，
 *    而合併正是這整個模組要避免的事。`presentationsAreDistinct()` 釘住它。
 */
export function present(outcome: RulesetOutcome): Presentation {
  switch (outcome.kind) {
    case 'seeded':
      return {
        tone: 'ok',
        title: '已播種，且解得開',
        body: 'DDB 那一列存在，四個表鍵（fans／combos／ignores／config）齊全，App 端拿得到完整的表。',
        action: '不必做什麼。要確認它與出貨的那份逐 byte 相同，跑下方的 check_ruleset_seeded.py。',
      };
    case 'not-seeded':
      return {
        tone: 'warn',
        title: '那一列不存在（尚未播種）',
        body: '端點活著、也讀得到表，只是那一列還沒被寫過。App 端會退回 bundle 內建的 fan_table.json（D5-d 的降級）。',
        action: '跑 seed_ruleset.py --stage <環境> 播種。',
      };
    case 'malformed':
      return {
        tone: 'bad',
        title: '那一列在，但解不開',
        body: `解析失敗：${str(outcome.view.reason) || '（後端沒有給原因）'}。App 端對這種情形回 502 —— 玩家會退回 bundle，但不會有人被告知。`,
        action: '看下方原文查是誰寫的。紀律 1：唯一的寫入入口是 seed_ruleset.py，這一列出現非它寫的內容本身就是要查的事。',
      };
    case 'not-deployed':
      return {
        tone: 'bad',
        title: `這條路由不在（${outcome.status}）`,
        body: `不是「還沒播種」—— 是後端這支端點還沒上線。E1 刻意把 404 留給這一種，好讓它跟「那一列不存在」分得開；而 REST API Gateway 對沒佈上的路由實際回的是 403（Gateway 原文：${outcome.detail || '（無）'}）。`,
        action: '部署 app stack（infra/deploy_app.sh）。⚠️ 那是整包部署，不是單支函式。',
      };
    case 'gateway-denied':
      return {
        tone: 'bad',
        title: '被 Gateway 擋下（403）',
        body: `擋下這一次的不是這支 lambda，是它前面那一層（authorizer／resource policy）。Gateway 原文：${outcome.detail || '（無）'}。`,
        action: '看 API Gateway 那一層：是不是維護模式 kill switch、或 authorizer 設定變了。⛔ 換帳號沒有用。',
      };
    case 'store-unavailable':
      return {
        tone: 'bad',
        title: 'DDB 讀不到（502）',
        body: '端點活著，但它讀不到那張表。⛔ 這不代表那一列不存在 —— 兩者的處置相反，所以後端刻意不把它合成 not-seeded。',
        action: '設備問題：本頁的讀數作廢，不要拿它下任何結論。先看 lambda 的 CloudWatch log。',
      };
    case 'forbidden':
      return {
        tone: 'bad',
        title: '角色不足（403）',
        body: 'token 有效，但角色不是 admin／super_admin。',
        action: '換一個有權限的帳號登入。',
      };
    case 'unknown-state':
      return {
        tone: 'bad',
        title: `不認得的 state：${outcome.state}`,
        body: '後端回了一個本頁沒見過的狀態值 —— 契約變了，而這一頁還是舊的。',
        action: '⛔ 不要照這一頁的顯示做判斷。先對一次 E1 的 state 清單（cmd/lambdas/apis/mahjongclub_admin_ruleset）。',
      };
    case 'unreadable':
      return {
        tone: 'bad',
        title: '回應說不清楚',
        body: `${outcome.detail}。這是後端與本頁對契約的理解不一致，不是資料本身的問題。`,
        action: '⛔ 讀數作廢。把原始回應貼進 issue，對一次 E1 的 View 結構。',
      };
    case 'error':
      return {
        tone: 'bad',
        title: outcome.status === null ? '連線失敗' : `未預期的狀態碼 ${outcome.status}`,
        body: outcome.detail,
        action: '重試一次；仍然失敗就看 lambda 的 CloudWatch log。',
      };
  }
}

/**
 * 反控用：所有 kind 的 `action` 兩兩不同。
 *
 * 🔴 這不是文案潔癖。本模組唯一的價值就是「不同的情形給不同的指示」——
 *    兩個 kind 共用同一句 action，等於在使用者看得到的那一層把它們合併回去，
 *    而合併之後**畫面完全正常**。這是唯一擋得住它的東西。
 */
export function presentationsAreDistinct(outcomes: RulesetOutcome[]): boolean {
  const seen = new Set<string>();
  for (const o of outcomes) {
    const a = present(o).action;
    if (seen.has(a)) return false;
    seen.add(a);
  }
  return true;
}

/**
 * 從**端點回報的表名**推出環境（`stg`／`prod`），推不出來回空字串。
 *
 * 🔴 刻意不用 build 時的環境變數：那是「這個 bundle 是為誰 build 的」，
 *    而這裡要問的是「**剛剛那次讀取讀的是哪張表**」。兩者在正常情況下相同，
 *    不同的時候（打錯環境、authorizer 指到別的 stack）正是最需要看見的時候，
 *    而用 build 常數的話那一刻畫面上會顯示成正確的。⇒ 值要取自被量的東西。
 *
 * ⚠️ 前綴抄自 `seed_ruleset.py` 的 `STAGE_PREFIX`（兩份會漂，但漂掉的代價
 *    只是這裡回空字串 ⇒ 指令印出佔位符，不會印出**指向錯環境的指令**）。
 */
export function stageFromTable(table: unknown): string {
  const t = str(table);
  // ⚠️ 這兩個前綴**不是**前綴關係（第 12 個字元一個是 'S' 一個是 '_'）
  //    ⇒ 單純把兩行對調是 no-op，測試也抓不到（實測過，那是個等價突變）。
  //    真正會壞的是**把底線拿掉**（`startsWith('MahjongClub')`）——
  //    那會讓 stg 的表讀成 prod，而後果是印出一行指向 **prod** 的指令。
  //    D5 釘的是這個，不是順序。
  if (t.startsWith('MahjongClubStg_')) return 'stg';
  if (t.startsWith('MahjongClub_')) return 'prod';
  return '';
}

/**
 * `check_ruleset_seeded.py` 的指令。
 *
 * 🔴 **本頁不下「一不一致」的判定** —— 它手上沒有 repo 正典那一份，
 *    要有就得把 fan_table.json 再複製一份進後台 bundle，那是第三份表而它會漂
 *    （E1 為了同一個理由拒絕把它複製進 lambda）。
 *    ⇒ 這一頁給的是 **DDB 這一側的事實**，逐 byte 那把尺是這支腳本。
 *    把指令印出來，比印一個算不出來的「✅ 一致」誠實。
 *
 * ⚠️ `--table-json` 指向 `frontend/engine/`，**不是 repo 正典** ——
 *    取樣點由問題決定：要問的是「即將出貨的那份跟得上嗎」（D5-c2 檔頭）。
 */
export function checkCommand(stage: string): string {
  const s = stage || '<stg|prod>';
  return [
    'python3 /opt/sml/repo/tools/mahjong-tai/check_ruleset_seeded.py',
    `--stage ${s}`,
    '--table-json /opt/sml/ryojaku-src/frontend/engine/mahjong-tai/fan_table.json',
  ].join(' \\\n  ');
}

/** `1234` → `1,234`；不是數字回 `—`（⛔ 不回 0 —— 0 是一個看起來合法的假事實）。 */
export function bytesLabel(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  return bytes.toLocaleString('en-US');
}

/**
 * sha256 縮寫。⛔ 空值回 `—` 而不是空字串：空字串在版面上會塌掉，
 * 讀起來像「這一格不存在」而不是「這一格沒有值」。
 */
export function shortSha(sha: unknown): string {
  const s = str(sha);
  if (!s) return '—';
  return s.length <= 16 ? s : `${s.slice(0, 16)}…`;
}
