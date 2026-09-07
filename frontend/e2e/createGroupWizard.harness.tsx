// e2e/createGroupWizard.harness.tsx — 發團表單兩步驟精靈的**隔離掛載點**（[A3-c] 實跑用）
//
// 為什麼需要它：`App.tsx` 有 `if (!user) return <Login/>` 這道閘，而 A3-c 改的東西
// 全部在 `pages/CreateGroup.tsx` 內部（`step` 狀態與兩段掛載）。要驗那些行為，
// 隔離掛載那一個元件就是對的作用域 —— 為了走過登入而去接真後端，反而引進一堆
// 與待驗行為無關的失敗模式。
//
// 🔴 界線（引用這份驗收結果時必須一起講）：
//   - 它證明不了 `/create` 這條路由本身還通，也證明不了 `App.tsx` 的登入閘。
//   - `user` 是假的，`onCreate` 直接回 `{ success: true }` ⇒ **`onCreate` 之後**的流程
//     （真的建團、推播引導、跳轉）**不在這份驗收的涵蓋範圍內**。
//     ⚠️ 但送出**邊界本身**在內：T10 斷言交給 `onCreate` 的那份 payload。
//     ⚠️ 個資檢查（`api.getUserInfo` → `isProfileComplete`）**在**範圍內：
//        T10 用 Playwright 對本機那個死路 URL 回一份完整假 profile 讓它過關。
//   - 這支**只在 dev server 下被載入**（vite build 的入口只有 index.html），
//     不會進 production bundle。
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../contexts/ToastContext';
import CreateGroup from '../pages/CreateGroup';

// 刻意用 any：這裡不是在驗 User 型別，補齊 20 個欄位只會讓這支跟著 User 的演進一起腐爛。
const fakeUser: any = {
    userId: 'e2e-harness-user',
    name: '實跑測試',
    realName: '實跑測試',
    phone: '0900000000',
    points: 9999,
};

// [A3-m] 第二段（補充設定）走 `dataService.updateGameExtras`，而它是用
// `authService.getCurrentUser()`（讀 localStorage）取身分，**不是**用上面那個 prop。
// 少了這一行，第二段的每一次儲存都會在還沒送出前就回「請先登入」——
// 而畫面上那個 toast 跟「後端擋下來」長得一樣，會被讀成端點壞了。
localStorage.setItem('mahjongclub_user_session', JSON.stringify(fakeUser));

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('harness: 找不到 #root');

// 刻意不包 <React.StrictMode>：正式入口有包，但 StrictMode 在 dev 會刻意雙呼叫
// effect，讓「載入草稿」那類一次性 effect 跑兩次 —— 那會變成量測雜訊，不是待驗行為。
ReactDOM.createRoot(rootEl).render(
    <MemoryRouter>
        <ToastProvider>
            <CreateGroup
                onCreate={async (gameData) => {
                    // 🔴 這一行就是「送出邊界」的儀器（[A3-i] T10）。
                    //    沒有它的話，「驗證放行了，而 payload 帶的還是那個過期的時間」
                    //    在外面**完全不可觀測** —— 我一度把這件事寫成「沒有尺」，
                    //    其實只是沒往這裡看。onCreate 本來就是可觀測的邊界。
                    (window as any).__created = gameData;
                    // 🔴 [A3-m] 計數是新的儀器：現在「建局」與「補資料」是兩個端點，
                    //    而「第二段又呼叫了一次 onCreate」的症狀是**多扣 120 點**，
                    //    畫面上只會顯示「送出成功」⇒ 沒有計數就完全不可觀測。
                    (window as any).__createCalls = ((window as any).__createCalls || 0) + 1;
                    // 🔴 `data.gameID` 不可省：它是第二段唯一的著陸點。回 `{success:true}`
                    //    的舊版會讓 CreateGroup 走進「拿不到 id」的降級路徑，
                    //    於是所有第二段的驗收都在測那條降級路徑而不是正常流程。
                    return { success: true, data: { gameID: 'e2e-game-0001' } };
                }}
                user={fakeUser}
            />
        </ToastProvider>
    </MemoryRouter>
);
