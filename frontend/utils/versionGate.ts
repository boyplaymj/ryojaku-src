// App 版本閘門的純邏輯 —— 不碰 React、不碰 Capacitor，可單獨測試。
//
// 為什麼要有這個檔：舊版 VersionGuard 的「立即更新」按鈕是 window.location.reload()。
// Capacitor 打包的 App 載的是 APK/IPA 裡的 bundle，reload 之後 APP_VERSION 不會變
// ⇒ 只要後台把 minVersion 調高，使用者就得到一塊 zIndex 9999、按不掉的全螢幕遮罩，
// 沒有任何出路。真正的出路是把 updateUrl（商店連結）開到系統瀏覽器。
//
// 因此本模組的核心不變式是：**沒有出路就不准擋**。

/**
 * 允許被當成更新出口的 URL scheme。
 * 刻意不含 http:（商店連結沒有理由降級）、也不含 javascript:／data:（會變成 XSS 出口）。
 */
const ALLOWED_UPDATE_SCHEMES = ['https:', 'market:', 'itms-apps:', 'itms:'];

/** 只接受 1 / 1.2 / 1.2.3 這種純數字版本；帶 -beta、空段落、非數字一律不接受。 */
const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

function parseVersion(value: unknown): number[] | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!VERSION_PATTERN.test(trimmed)) return null;
    return trimmed.split('.').map(Number);
}

/**
 * current 是否落後於 required。
 *
 * 版本字串解析不出來時一律回 false（不擋）。這個方向是刻意的，不是漏寫：
 * 擋錯的代價是使用者完全無法使用 App，放行錯的代價只是舊版多跑一陣子。
 */
export function isOutdated(current: unknown, required: unknown): boolean {
    const currParts = parseVersion(current);
    const reqParts = parseVersion(required);
    if (!currParts || !reqParts) return false;

    for (let i = 0; i < Math.max(currParts.length, reqParts.length); i++) {
        const curr = currParts[i] ?? 0;
        const req = reqParts[i] ?? 0;
        if (curr < req) return true;
        if (curr > req) return false;
    }
    return false;
}

/** 把後台設定的 updateUrl 收斂成「可以安全交給 window.open 的字串」，不合格回 null。 */
export function normalizeUpdateUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed === '') return null;

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    if (!ALLOWED_UPDATE_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.toString();
}

export type UpdateAction =
    /** 開外部商店連結（原生 App 唯一真正有效的出路） */
    | { kind: 'store'; url: string }
    /** 重新載入頁面 —— 只有網頁／PWA 會因此換到新 bundle */
    | { kind: 'reload' }
    /** 沒有任何出路。呼叫端**不可以**在這種狀態下硬擋。 */
    | { kind: 'none' };

export function resolveUpdateAction(opts: { isNative: boolean; updateUrl: unknown }): UpdateAction {
    // 網頁／PWA：reload 會真的重新抓一份 bundle，它本身就是有效出路。
    if (!opts.isNative) return { kind: 'reload' };

    const url = normalizeUpdateUrl(opts.updateUrl);
    if (url) return { kind: 'store', url };

    // 原生 App 又拿不到可用的商店連結 ⇒ 擋下去就是一塊按不掉的磚。
    return { kind: 'none' };
}

export interface VersionGateInput {
    currentVersion: unknown;
    minVersion: unknown;
    isNative: boolean;
    updateUrl: unknown;
}

export interface VersionGateResult {
    blocked: boolean;
    action: UpdateAction;
    /** blocked 為 false、但版本其實過舊時填入原因，供呼叫端記錄。 */
    suppressedReason: 'no-exit' | null;
}

/** 閘門的唯一進入點。 */
export function evaluateVersionGate(input: VersionGateInput): VersionGateResult {
    const action = resolveUpdateAction({ isNative: input.isNative, updateUrl: input.updateUrl });

    if (!isOutdated(input.currentVersion, input.minVersion)) {
        return { blocked: false, action, suppressedReason: null };
    }
    if (action.kind === 'none') {
        return { blocked: false, action, suppressedReason: 'no-exit' };
    }
    return { blocked: true, action, suppressedReason: null };
}
