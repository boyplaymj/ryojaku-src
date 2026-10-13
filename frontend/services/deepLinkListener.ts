// App 被一條連結打開時，把它換成站內路由（接線層）。判準在 utils/deepLink.ts。
//
// 兩種情形都要處理，漏掉任何一種使用者都只會看到首頁：
//   appUrlOpen    App 已經開著，被連結叫到前景
//   getLaunchUrl  App 沒開，被連結冷啟動（這時還沒有人在聽 appUrlOpen）
//
// ⚠️ 沒有在真機上驗過（本機建不出 Android／iOS）。量得到的只有 utils/deepLink.ts 的判準與這裡的接線。
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { deepLinkToHashRoute, hostOfOrigin } from '../utils/deepLink';

function go(url: string | undefined | null): void {
    const hosts = [hostOfOrigin((import.meta as any).env?.VITE_PUBLIC_WEB_ORIGIN)];
    const hash = deepLinkToHashRoute(url, hosts);
    // HashRouter 聽的是 hashchange；值相同時瀏覽器不會觸發事件，也不需要觸發。
    if (hash && window.location.hash !== hash) window.location.hash = hash;
}

/** 回一個取消函式。網頁／PWA 不做任何事（那裡連結本來就是直接開頁面）。 */
export function startDeepLinkListener(): () => void {
    if (!Capacitor.isNativePlatform()) return () => {};
    let cancelled = false;
    let remove: (() => void) | null = null;
    CapacitorApp.addListener('appUrlOpen', event => go(event?.url)).then(handle => {
        if (cancelled) handle.remove();
        else remove = () => { handle.remove(); };
    }).catch(err => console.error('[deepLink] 掛不上 appUrlOpen', err));
    CapacitorApp.getLaunchUrl().then(launch => { if (!cancelled) go(launch?.url); })
        .catch(err => console.error('[deepLink] 讀不到啟動連結', err));
    return () => { cancelled = true; remove?.(); };
}
