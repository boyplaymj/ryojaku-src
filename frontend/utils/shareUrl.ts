// 分享連結用哪個網域 —— 純邏輯，不碰 window／Capacitor／import.meta，可單獨測試。
//
// 為什麼要有這個檔（2026-10-11）：分享連結原本一律是 `${window.location.origin}/#/…`。
// 在瀏覽器裡那是對的；在 Capacitor 原生殼裡 window.location.origin 是殼自己的位址
// （Android `https://localhost`、iOS `capacitor://localhost`）
// ⇒ 從商店版分享出去的連結與 QR code 全部指向收件人自己的 localhost，沒有人打得開。
// 揪團靠的就是把連結貼出去，這條路在 App 上等於從來沒有通過。
//
// ⇒ 原生殼改用建置時烘進去的公開網域（VITE_PUBLIC_WEB_ORIGIN）。
//    🔴 它跟 API 位址同一種東西：烘進 binary 之後改不了，已分享出去的連結也收不回來。

/** 把設定值收斂成 `https://host[:port]`；不合格回 null。 */
export function normalizePublicOrigin(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed === '') return null;

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    // 只收 https：分享出去的連結沒有理由降級。
    if (parsed.protocol !== 'https:') return null;
    // localhost 正是這支要修掉的那個值，設定成它等於沒設定。
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return null;
    // 只收「網域」。帶路徑／query／fragment／帳密的話，接上 `/#/event/…` 會組出另一個網址。
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return null;
    if (parsed.username !== '' || parsed.password !== '') return null;
    return parsed.origin;
}

export interface ShareOriginInput {
    /** Capacitor.isNativePlatform() */
    isNative: boolean;
    /** window.location.origin */
    locationOrigin: string;
    /** 建置時烘進去的公開網域（VITE_PUBLIC_WEB_ORIGIN），可能沒設。 */
    publicOrigin: unknown;
}

/**
 * 分享連結要用的 origin。
 *
 * - 網頁／PWA：用頁面自己的 origin（原本的行為，preview／stg 各自分享各自的連結）。
 * - 原生殼：用公開網域。
 *
 * ⚠️ 原生殼又沒有合格的公開網域時退回 locationOrigin —— 那是一條打不開的連結，
 *    與修之前相同。這裡刻意不拋例外（分享面板不該因此整個壞掉）；
 *    擋住這個狀態的是建置端：.github/workflows/android-debug.yml 會檢查 bundle 裡真的有那個網域。
 */
export function resolveShareOrigin(input: ShareOriginInput): string {
    if (!input.isNative) return input.locationOrigin;
    return normalizePublicOrigin(input.publicOrigin) ?? input.locationOrigin;
}
