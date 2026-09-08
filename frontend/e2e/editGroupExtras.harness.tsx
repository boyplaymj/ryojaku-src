// e2e/editGroupExtras.harness.tsx — 「編輯補充設定」頁的**隔離掛載點**（[A3-p]/E5 實跑用）
//
// 為什麼需要它：`App.tsx` 有 `if (!user) return <Login/>` 這道閘，而這一頁要驗的東西
// （載入既有宣告 → 還原回 UI → 儲存時整欄覆寫送出去的是什麼）全部在
// `pages/EditGroupExtras.tsx` 內部。隔離掛載那一個元件就是對的作用域。
//
// 🔴 與建局那支 harness 的**關鍵差異**：這一頁沒有 `onCreate` 那種 prop 邊界，
//    它直接打 `api.getGameDetail` 與 `api.updateGameExtras`。
//    ⇒ 兩邊都攔在**網路層**（spec 那邊 route `/game-detail` 與 `/update-game`），
//      不在這裡塞假函式 —— 假函式只驗到 dataService 那一層，
//      而「儲存送出去的 body 長什麼樣」要連 apiService 組請求那一段一起涵蓋。
//
// 🔴 界線（引用這份驗收結果時必須一起講）：
//   - 它證明不了 `/edit-group/:id` 這條路由在 `App.tsx` 裡接對了
//     （那條由單元測試 `appRoutes.test.ts` 的前綴白名單那幾條撐著），
//     也證明不了登入閘。
//   - 後端的權限與狀態檢查不在內：這裡的 `/update-game` 一律回成功，
//     前端這層的 `hostUserId` 比對**只是 UX**（本頁註解已寫明）。
//   - 這支只在 dev server 下被載入，不會進 production bundle。
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../contexts/ToastContext';
import EditGroupExtras from '../pages/EditGroupExtras';

// 刻意用 any：這裡不是在驗 User 型別。
const fakeUser: any = {
    userId: 'e2e-harness-user',
    name: '實跑測試',
    realName: '實跑測試',
    phone: '0900000000',
    points: 9999,
};

// `dataService.updateGameExtras` 用 `authService.getCurrentUser()`（讀 localStorage）
// 取身分，**不是**用下面那個 prop。少了這一行，每一次儲存都會在還沒送出前就
// 回「請先登入」—— 而畫面上那個 toast 跟「後端擋下來」長得一樣。
localStorage.setItem('mahjongclub_user_session', JSON.stringify(fakeUser));

// 團局 ID 由 query string 給，spec 才能在同一支 harness 上跑不同情境
// （非主揪／已取消／找不到），而不必為每一種各做一份 harness。
const gameId = new URLSearchParams(location.search).get('gameId') || 'e2e-game-0001';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('harness: 找不到 #root');

// 刻意不包 <React.StrictMode>：dev 下它會把 effect 跑兩次，
// 而這一頁的載入正是一次性 effect ⇒ 那會變成量測雜訊，不是待驗行為。
ReactDOM.createRoot(rootEl).render(
    <MemoryRouter initialEntries={[`/edit-group/${gameId}`]}>
        <ToastProvider>
            <Routes>
                <Route path="/edit-group/:id" element={<EditGroupExtras user={fakeUser} />} />
                {/* 儲存成功後會 navigate 到這裡 —— 它是「存完真的離開了」那條斷言的儀器。
                    少了它，導向會落到 MemoryRouter 的空路由，畫面一片空白，
                    而「導對了」與「頁面炸了」長得一模一樣。 */}
                <Route path="/event/:id" element={<div data-testid="event-page">EVENT PAGE</div>} />
                <Route path="*" element={<div data-testid="nowhere">NOWHERE</div>} />
            </Routes>
        </ToastProvider>
    </MemoryRouter>
);
