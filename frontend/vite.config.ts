import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: '.',
        filename: 'sw.js',
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
          type: 'module',
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        injectManifest: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
        },
        manifest: {
          name: '両雀',
          short_name: '両雀',
          description: '快速找到附近的麻將牌局，輕鬆揪團開打！',
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
          categories: ['entertainment', 'games', 'social'],
          orientation: 'portrait',
          icons: [
            {
              src: '/icon.png?v=2',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: '/icon.png?v=2',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    define: {
      // 🔴 這裡曾經有兩行把 GEMINI_API_KEY 字面替換進 client bundle 的 define
      //    （`process.env.API_KEY` 與 `process.env.GEMINI_API_KEY`，稽核 finding 4）。
      //    `define` 是**建置期字面替換** ⇒ 只要哪天有人在 build 環境設了那個 env，
      //    金鑰就會靜默進入所有使用者下載得到的 JS，而且沒有任何東西會報錯 ——
      //    它當時之所以不算洩漏，只是因為「剛好沒人設過那個變數」，
      //    那是**運氣**不是機制，而運氣與正確在建置產物上長得一模一樣。
      // ⚠️ 前端要用 Gemini 的話走後端代理，金鑰不下放瀏覽器。不要把這兩行加回來，
      //    也不要換成 `VITE_GEMINI_API_KEY` —— 那只是換個名字曝露同一個東西
      //    （`VITE_` 前綴的變數本來就是設計成要進 bundle 的）。
      'global': 'window', // Polyfill for Amplify/MapLibre
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      // 判台引擎(engine/mahjong-tai/)的三支是 UMD/CJS,而 Vite 的 commonjs 轉換
      // **預設只處理 node_modules**(commonjsOptions.include 預設 [/node_modules/])。
      // 引擎在專案原始碼裡 ⇒ 不補這段的話它不會被轉換,`import * as ns` 拿到空的
      // namespace、UMD 也沒把東西掛上 globalThis。
      //
      // 🔴 判準不是 `vite build` rc=0:實測未改時 rc **0**、指紋也看得到引擎進了包
      //    (lianzhuang 6 次/dasanyuan 1 次/pinyinPro 7 次),但執行產物直接
      //    throw「mahjong-tai/index.mjs: MahjongTai 沒載到」⇒ 功能是零。
      //    (2026-09-02 實測,含修前反控與修後正控;DESIGN_APP.md §11.5)
      //
      // ⚠️ 這是改 build 設定,但與 build.target 不同級:include 的正則只圈住
      //    engine/mahjong-tai/,**不改變瀏覽器支援範圍**,對其他檔案零影響。
      commonjsOptions: {
        include: [/node_modules/, /engine[\\/]mahjong-tai[\\/]/],
        transformMixedEsModules: true,
      },
    },
  };
});
