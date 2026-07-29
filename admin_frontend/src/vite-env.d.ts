/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Console 要打的 API 位址（含 stage 路徑）。build 時由 .env.<mode> 注入。
   * 設計冊 tools/ryojaku-admin-migration/DESIGN.md 決策 D1。
   *
   * 沒有預設值是刻意的 —— 見 services/api.ts 的 fail-closed 說明。
   */
  readonly VITE_API_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
