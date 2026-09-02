/**
 * index.mjs — 判台引擎的 ES module 包裝(D2-1)
 *
 * 🔴 正典在 /opt/sml/repo/tools/mahjong-tai/(方向 A,DESIGN_APP.md §11.1)。
 *    App 那份(/opt/sml/ryojaku-src/frontend/engine/mahjong-tai/)是同步副本,
 *    由 sync_to_app.sh 產生、verify_sync.sh 逐檔 sha256 驗漂移 —— 不要直接改副本。
 *
 * 🔴 三支引擎檔一個字都不改,只在外面包一層。所以本檔放在引擎同層
 *    (不是 engine/ 子目錄):包裝檔的相對 import 必須在兩個 repo 都成立,
 *    唯一的辦法是兩邊目錄形狀相同 ⇒ 同步時整組平搬,sha256 才能逐檔比對。
 *
 * ⚠️ import 順序是有意義的,而且三支引擎的 UMD 判斷式不一樣(實測 node-22,2026-09-02):
 *
 *   1. _umd_prelude.mjs 必須最先:它墊 globalThis.self,
 *      否則 scoring.js / feedback.js 的 UMD root 在 Node ESM 下是 undefined,
 *      直接 import 會 TypeError(理由詳見那支檔案)。
 *
 *   2. vendor/pinyin-pro.js 要在引擎之前載入,但**不必**在 phonetic.js 之前:
 *      phonetic.js 的 toPinyin() 是**呼叫時**才讀 global.pinyinPro(lazy),
 *      所以下面那段 CJS 補掛寫在 import 之後仍然來得及。
 *      - ESM 情境(App repo 有 "type":"module"):vendor 的 UMD 走 global 分支,
 *        評估時自己掛上 globalThis.pinyinPro(實測確認,不是推理)。
 *      - CJS 情境(正典 repo 沒有 package.json ⇒ .js 按 CommonJS 載入):
 *        vendor 走 module.exports 分支、不掛 global ⇒ 下面補掛一次。
 *
 * 🔴 這裡刻意**不用 top-level await**(D2-1 初版用過,已撤)。
 *    理由不是風格:両雀 App 的 vite.config.ts 沒設 build.target ⇒ 吃 Vite 預設
 *    (es2020 那組),而 top-level await 要 es2022 ⇒ **瀏覽器 build 直接 rc=1**
 *    (「Top-level await is not available in the configured target environment」,
 *     2026-09-02 Codex 交叉查驗指出、我重現)。
 *    靜態 import 的求值順序由 ESM 規格保證(依宣告順序、深度優先),
 *    要在中間插副作用就拆一支模組出去 —— 初版註解寫「靜態 import 塞不進去」是錯的。
 *    ⚠️ 另一條路是把 App 的 build.target 改成 es2022,但那會改變**整個產品**的
 *      瀏覽器支援範圍,代價遠大於重寫這一層,所以不走。
 *
 * 對外 API 維持原形狀:fan_table 由呼叫端讀好傳進來(parse(text, table)),
 * 本檔刻意不吃 fan_table.json。典型用法(與 demo.html 同一條管線):
 *
 *   import { MahjongPhonetic, MahjongTai } from './engine/mahjong-tai/index.mjs';
 *   MahjongPhonetic.buildIndex(table, table.combos || [], table.ignores || []);
 *   const norm = MahjongPhonetic.normalize(rawText);
 *   const res  = MahjongTai.parse(norm.normalizedText || rawText, table);
 *   const tai  = res.hits.reduce((s, h) => s + h.tai, 0);  // 純台數
 *
 * ⚠️ res.total **含底**(fan_table.config.base_di,現為 1)。設計冊 DESIGN_APP.md
 *    的台數表全部是「純台數」⇒ 拿它去斷言 res.total 會整排差 1,
 *    而那個差值看起來就像少算一台。要純台數就用上面那行 reduce。
 */

// ① 墊 self(必須最先求值,理由見 _umd_prelude.mjs)
import { shimmedSelf } from './_umd_prelude.mjs';

// ② vendor 與三支引擎。靜態 import ⇒ 順序由 ESM 規格保證,無需 top-level await。
import * as vendorNs from './vendor/pinyin-pro.js';
import * as phoneticNs from './phonetic.js';
import * as scoringNs from './scoring.js';
import * as feedbackNs from './feedback.js';

// ③ CJS 情境補掛 pinyinPro。phonetic.js 是呼叫時才讀,所以這裡補仍然來得及。
if (typeof globalThis.pinyinPro === 'undefined') {
  globalThis.pinyinPro = vendorNs.default ?? vendorNs;
}

// ④ 只拆自己墊的,瀏覽器原本的 self 不碰
if (shimmedSelf) delete globalThis.self;

// ⑤ 兩種情境各自把東西放在不同地方:
//    ESM ⇒ 引擎掛在 globalThis;CJS ⇒ 在 module.exports(= namespace 的 default)
const pick = (globalName, ns) => globalThis[globalName] ?? ns.default;

export const MahjongPhonetic = pick('MahjongPhonetic', phoneticNs);
export const MahjongTai = pick('MahjongTai', scoringNs);
export const MahjongFeedback = pick('MahjongFeedback', feedbackNs);

// 載入即壞就當場講,不要等到呼叫端拿到 undefined 才炸在奇怪的地方
for (const [name, v] of [
  ['MahjongPhonetic', MahjongPhonetic],
  ['MahjongTai', MahjongTai],
  ['MahjongFeedback', MahjongFeedback],
]) {
  if (!v) throw new Error(`mahjong-tai/index.mjs: ${name} 沒載到(UMD 判斷式或載入情境變了)`);
}
