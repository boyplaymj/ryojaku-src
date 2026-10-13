// 「App 被一條連結打開」時，那條連結要帶使用者去哪一頁 —— 純邏輯，不碰 window／Capacitor，可單獨測試。
//
// 背景：前端是 HashRouter，分享出去的連結長成 https://<公開網域>/#/event/<id>。
// 系統把這種連結交給 App（Android App Links／iOS Universal Links）之後，App 只是被叫到前景；
// 要自己把連結裡 `#` 後面那段換成站內路由，否則使用者看到的永遠是首頁。
//
// 🔴 這裡是外面的字串進到 App 內路由的入口，所以只收看得懂的形狀，其餘一律回 null（＝留在原地）：
//    - 只收 https，而且網域必須是我們自己的公開網域（否則任何網站都能把使用者導到 App 內任意頁）
//    - 路徑必須是站台根目錄（/privacy.html 那種是公開網頁，不是 App 的頁面）
//    - `#` 後面只收「本來就會被分享出去」的那幾種頁面

/** 可以從外部連結直接進去的頁面（前綴）。與 components/share 與 ledger 分享卡產生的連結同一組。 */
const SHAREABLE_ROUTE_PREFIXES = ['/event/', '/post/', '/ledger'] as const;

/** 把設定值（https://網域）取出網域；不合格回 null。 */
export function hostOfOrigin(origin: unknown): string | null {
    if (typeof origin !== 'string' || origin.trim() === '') return null;
    try {
        const u = new URL(origin.trim());
        return u.protocol === 'https:' ? u.host : null;
    } catch {
        return null;
    }
}

/**
 * 回要設給 window.location.hash 的值（含開頭的 `#`），或 null。
 *
 * @param rawUrl       系統交進來的完整網址
 * @param allowedHosts 我們自己的公開網域（host，不含 https://）
 */
export function deepLinkToHashRoute(rawUrl: unknown, allowedHosts: readonly (string | null)[]): string | null {
    if (typeof rawUrl !== 'string') return null;
    let u: URL;
    try {
        u = new URL(rawUrl);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:') return null;
    if (u.username !== '' || u.password !== '') return null;
    if (!allowedHosts.some(h => typeof h === 'string' && h !== '' && h === u.host)) return null;
    if (u.pathname !== '/' && u.pathname !== '/index.html') return null;

    const hash = u.hash; // 含開頭的 '#'；沒有 fragment 時是 ''
    if (hash === '' || hash === '#' || hash === '#/') return '#/';
    if (!hash.startsWith('#/')) return null;
    const route = hash.slice(1); // '/event/123?x=1'
    // 路徑穿越與雙斜線沒有正當用途，直接不收。
    if (route.includes('..') || route.includes('//') || route.includes('\\')) return null;
    const path = route.split('?')[0];
    const ok = SHAREABLE_ROUTE_PREFIXES.some(p => (p.endsWith('/') ? path.startsWith(p) && path.length > p.length : path === p));
    return ok ? hash : null;
}
