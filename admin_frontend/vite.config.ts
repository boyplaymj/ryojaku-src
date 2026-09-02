import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 判台引擎（src/engine/mahjong-tai/）是 UMD/CJS，而 Vite 的 commonjs 轉換
    // **預設只處理 node_modules**（commonjsOptions.include 預設 [/node_modules/]）。
    // 引擎在專案原始碼裡 ⇒ 不補這段的話它不會被轉換，`import * as ns` 拿到空的
    // namespace、UMD 也沒把東西掛上 globalThis。
    //
    // 🔴 判準不是 `vite build` rc=0。同 repo 的 frontend 實測過：未改時 rc **0**、
    //    指紋也看得到引擎進了包，但**執行產物直接 throw**（DESIGN_APP.md §11.5）。
    //    ⇒ 驗收要跑 scripts/verify_engine_bundle.mjs（建出來之後真的把它 import 起來）。
    //
    // ⚠️ 這是改 build 設定，但與 build.target 不同級：include 的正則只圈住
    //    engine/mahjong-tai/，**不改變瀏覽器支援範圍**，對其他檔案零影響。
    commonjsOptions: {
      include: [/node_modules/, /engine[\\/]mahjong-tai[\\/]/],
      transformMixedEsModules: true,
    },
  },
})
