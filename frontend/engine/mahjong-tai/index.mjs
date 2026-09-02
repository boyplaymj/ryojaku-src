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
 *   1. vendor/pinyin-pro.js 必須最先載入:
 *      phonetic.js 的 toPinyin() 讀 global.pinyinPro(呼叫時才讀,lazy)。
 *      - ESM 情境(App repo 有 "type":"module"):vendor 的 UMD 走 global 分支,
 *        評估時自己掛上 globalThis.pinyinPro(實測確認,不是推理)。
 *      - CJS 情境(正典 repo 沒有 package.json ⇒ .js 按 CommonJS 載入):
 *        vendor 走 module.exports 分支、不掛 global ⇒ 下面補掛一次。
 *
 *   2. scoring.js / feedback.js 的 UMD root 是
 *      `typeof self !== 'undefined' ? self : this` ——
 *      Node ESM 下 self 與 top-level this 都是 undefined,直接 import 會
 *      TypeError: Cannot set properties of undefined(實測,不是推理)。
 *      瀏覽器有 self 所以沒事;Node 下要先墊 globalThis.self,載完拆掉。
 *      (phonetic.js 的 root 是 window ?? globalThis,不需要墊。)
 *
 *   靜態 import 塞不進「載 vendor 之後、載引擎之前」的補掛與墊 self,
 *   所以用 top-level await 的動態 import 逐步載 —— 順序因此是顯式的。
 *
 * 對外 API 維持原形狀:fan_table 由呼叫端讀好傳進來(parse(text, table)),
 * 本檔刻意不吃 fan_table.json。典型用法(與 demo.html 同一條管線):
 *
 *   import { MahjongPhonetic, MahjongTai } from './engine/mahjong-tai/index.mjs';
 *   MahjongPhonetic.buildIndex(table, table.combos || [], table.ignores || []);
 *   const norm = MahjongPhonetic.normalize(rawText);
 *   const res  = MahjongTai.parse(norm.normalizedText || rawText, table);
 */

// ① vendor 先行(理由見檔頭注意事項 1)
const vendorNs = await import('./vendor/pinyin-pro.js');
if (typeof globalThis.pinyinPro === 'undefined') {
  // CJS 情境:UMD 走了 module.exports 分支,exports 在 namespace 的 default 上
  globalThis.pinyinPro = vendorNs.default ?? vendorNs;
}

// ② Node ESM 沒有 self ⇒ 先墊,讓 scoring/feedback 的 UMD root 落在 globalThis
const hadSelf = typeof globalThis.self !== 'undefined';
if (!hadSelf) globalThis.self = globalThis;

const phoneticNs = await import('./phonetic.js');
const scoringNs = await import('./scoring.js');
const feedbackNs = await import('./feedback.js');

if (!hadSelf) delete globalThis.self; // 只拆自己墊的,瀏覽器的 self 不碰

// ③ 兩種情境各自把東西放在不同地方:
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
