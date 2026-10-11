// 分享連結的 origin（接線層）。判準在 utils/shareUrl.ts，這裡只負責把三個來源接上去。
import { Capacitor } from '@capacitor/core';
import { resolveShareOrigin } from '../utils/shareUrl';

export function currentShareOrigin(): string {
    return resolveShareOrigin({
        isNative: Capacitor.isNativePlatform(),
        locationOrigin: window.location.origin,
        publicOrigin: (import.meta as any).env?.VITE_PUBLIC_WEB_ORIGIN,
    });
}
