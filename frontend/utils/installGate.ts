// 「要不要畫出 App 本體」的判準 —— 從 components/PWAInstallPrompt.tsx 抽出來才有尺。
//
// 為什麼要有這個檔（2026-10-11，上架前驗版本閘時讀到的）：
//   PWAInstallPrompt 包住整個 App（App.tsx），而它原本只在
//   `isStandalone || devBypass` 時才畫 children，其餘一律畫「請先將此網頁加入主畫面」。
//   「已加入主畫面」是靠 display-mode: standalone／navigator.standalone 判的，
//   而 Capacitor 的殼是 WebView：手機 UA、**不是** standalone
//   ⇒ 商店版一打開就是那面「請加入主畫面」的牆，App 本體與版本閘（VersionGuard 是
//      它的 children）一行都不會畫。
//
//   ⚠️ 上面那句是**讀程式碼＋平台行為**得出的，沒有在真機上量過（本機建不出 native build）。
//      量得到的只有網頁那半：同一包 bundle 用手機 UA 開，不模擬 standalone 時版本閘不出現、
//      模擬之後才出現。
//
// 🔴 原生殼必須無條件放行：「加入主畫面」對它沒有意義，那面牆在原生殼裡也沒有任何出路
//    （唯一的出口是畫面上的 DEV BYPASS）。

export interface InstallGateInput {
    /** Capacitor.isNativePlatform() —— 跑在 iOS／Android 原生殼裡。 */
    isNative: boolean;
    /** 已安裝成 PWA（display-mode: standalone／iOS 的 navigator.standalone／TWA）。 */
    isStandalone: boolean;
    /** 使用者按了 DEV BYPASS。 */
    devBypass: boolean;
}

/** true ⇒ 畫 App 本體；false ⇒ 畫安裝引導。 */
export function shouldRenderApp(input: InstallGateInput): boolean {
    return input.isNative || input.isStandalone || input.devBypass;
}
