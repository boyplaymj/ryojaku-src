import React, { createContext, useContext, useCallback, useRef } from 'react';
import { createRefreshHandlerStack } from '../utils/refreshHandlerStack';

type RefreshHandler = () => Promise<void>;

interface RefreshContextType {
    /** key 是呼叫端的穩定身分（usePullToRefresh 每個實例一把）；同一把 key 重註冊是原地換。 */
    registerRefreshHandler: (key: object, handler: RefreshHandler) => void;
    unregisterRefreshHandler: (key: object) => void;
    onRefresh: () => Promise<void>;
}

const RefreshContext = createContext<RefreshContextType | undefined>(undefined);

export const RefreshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // 🔴 [A2-b-1] 從「單一插槽」改成堆疊（utils/refreshHandlerStack.ts）。
    //    舊版：頁面註冊 → modal 註冊蓋掉它 → modal 關掉把插槽設 null，而頁面的 effect 不會重跑
    //    ⇒ 關掉 modal 之後那一頁的下拉刷新就死了。揪咖頁「我的局」點一張卡再關掉就是這條路。
    //    堆疊：最上面那層負責回應；一層被拿掉，底下那層自然回來。
    // ref 而非 state：註冊／註銷不該觸發整棵樹重渲染，onRefresh 也不需要 stale-closure 保護。
    const stackRef = useRef(createRefreshHandlerStack<RefreshHandler>());

    const registerRefreshHandler = useCallback((key: object, handler: RefreshHandler) => {
        stackRef.current.set(key, handler);
        console.log('RefreshContext: Registering handler', { depth: stackRef.current.size() });
    }, []);

    const unregisterRefreshHandler = useCallback((key: object) => {
        stackRef.current.remove(key);
        console.log('RefreshContext: Unregistering handler', { depth: stackRef.current.size() });
    }, []);

    const onRefresh = useCallback(async () => {
        console.log('RefreshContext: onRefresh called');
        const handler = stackRef.current.current();
        if (handler) {
            console.log('RefreshContext: Executing handler');
            await handler();
            console.log('RefreshContext: Handler execution complete');
        } else {
            console.warn('RefreshContext: No handler registered');
        }
    }, []);

    return (
        <RefreshContext.Provider value={{ registerRefreshHandler, unregisterRefreshHandler, onRefresh }}>
            {children}
        </RefreshContext.Provider>
    );
};

export const useRefresh = () => {
    const context = useContext(RefreshContext);
    if (!context) {
        throw new Error('useRefresh must be used within a RefreshProvider');
    }
    return context;
};

/**
 * 讓元件把自己的刷新邏輯掛到下拉刷新上。
 *
 * @param enabled 預設 true —— 既有的呼叫點一個字都不用改。
 *   傳 false 時**完全不註冊**（不是註冊一個 no-op）：給「同一個元件在兩個地方被用」的情況，
 *   例如 MyGamesSection 在揪咖頁要接下拉刷新、在 Profile 的 MyGamesOverlay 裡不要。
 *   ⚠️ 預設值方向是刻意的：新行為要明講才會發生；反過來（預設關、overlay 傳關）的話，
 *   將來第三個使用者忘了傳就默默多了一層。
 */
export const usePullToRefresh = (handler: RefreshHandler, enabled: boolean = true) => {
    const { registerRefreshHandler, unregisterRefreshHandler } = useRefresh();
    // 每個 hook 實例一把 key：handler 換身分時原地換，不會爬到上層 modal 之上。
    const keyRef = useRef<object>({});

    React.useEffect(() => {
        if (!enabled) return;
        const key = keyRef.current;
        registerRefreshHandler(key, handler);
        return () => unregisterRefreshHandler(key);
    }, [handler, enabled, registerRefreshHandler, unregisterRefreshHandler]);
};
