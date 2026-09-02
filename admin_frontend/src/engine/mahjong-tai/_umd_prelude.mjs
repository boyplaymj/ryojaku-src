/**
 * _umd_prelude.mjs — 只做一件事:在載入引擎之前墊好 globalThis.self
 *
 * 為什麼要獨立一支檔案,而不是寫在 index.mjs 裡:
 *   scoring.js / feedback.js 的 UMD root 是 `typeof self !== 'undefined' ? self : this`,
 *   Node ESM 下 self 與 top-level this 都是 undefined ⇒ 直接 import 會
 *   TypeError: Cannot set properties of undefined(實測 node-22)。
 *   所以「墊 self」必須發生在那兩支被求值之前。
 *
 *   而靜態 import 的求值早於同檔案任何一行程式 ⇒ 同一支檔案裡排不出這個順序。
 *   ESM 規格保證「依 import 宣告的順序、深度優先求值」⇒ 把副作用拆成一支
 *   獨立模組並排在最前面,順序就是顯式且靜態的。
 *
 * 🔴 為什麼不用 top-level await 的動態 import(D2-1 初版的做法,已撤):
 *   那樣寫在 Node 下可以跑,但 **瀏覽器 build 會直接失敗** ——
 *   両雀 App 的 vite.config.ts 沒有設 build.target ⇒ 吃 Vite 預設
 *   (chrome87/edge88/es2020/firefox78/safari14),而 top-level await 要 es2022。
 *   實測 `vite build` rc=1:「Top-level await is not available in the
 *   configured target environment」(2026-09-02,Codex 交叉查驗指出、我重現)。
 *   ⇒ 改用靜態 import 是為了不必動 App 的 browser target ——
 *      那會改變整個產品的瀏覽器支援範圍,代價遠大於重寫這層包裝。
 *
 * 瀏覽器本來就有 self,這支在瀏覽器下是 no-op(不會誤拆別人的 self)。
 */

/** 我們有沒有自己墊過?index.mjs 據此決定要不要拆掉,避免動到瀏覽器原本的 self。 */
export const shimmedSelf = typeof globalThis.self === 'undefined';

if (shimmedSelf) globalThis.self = globalThis;
