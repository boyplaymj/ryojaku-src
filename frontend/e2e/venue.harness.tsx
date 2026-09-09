// e2e/venue.harness.tsx — 場地頁與場地列表的**隔離掛載點**（[B1-j6] 實跑用）
//
// 跑法：`E2E_HARNESS=e2e/venue.harness.tsx E2E_SPEC=venue.e2e.cjs npm run e2e`
//
// 為什麼需要它：`App.tsx` 有 `if (!user) return <Login/>` 那道閘，而這兩頁要驗的東西
// 全部在元件內部。隔離掛載那一個元件就是對的作用域。
//
// 🔴 這一層要咬的是**單元測試結構上碰不到**的那件事：
//    `utils/venueView.ts` 的 33 條測試證明「那些純函式算得對」，
//    它們對「**頁面有沒有真的用它們**」零鑑別力 —— VenueDetail.tsx 大可自己寫
//    一行 `if (!v.exactAddress)`，純函式照樣全綠，而使用者看到的是五態塌成兩態。
//    （同 A2s4-9 那個教訓：純函式的往返測試咬不住「有沒有接上」。）
//
// 🔴 界線（引用這份驗收時必須一起講）：
//   - 它證明不了 `/venue/:id`、`/venues` 這幾條路由在 App.tsx 裡接對了
//     （那由 appRoutes.test.ts B1j-34/35/36 撐著），也證明不了登入閘。
//   - 後端的授權判斷完全不在內：這裡的 `/venue-detail` 回什麼是我編的。
//     後端那半由線上矩陣 8/8 撐著（設計冊 §5.3）。**兩層不可互相冒充。**
//   - `/create-venue` 不在這支裡：它要開 MapPicker（Amazon Location Service，
//     真的抓圖磚、會撞白名單），而它的接線由 venueWiring 那條原始碼掃描守著。
//   - 這支只在 dev server 下被載入，不會進 production bundle。
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../contexts/ToastContext';
import VenueDetail from '../pages/VenueDetail';
import VenueList from '../pages/VenueList';

const params = new URLSearchParams(location.search);
// `page=detail|list`；detail 時 `venueId=` 決定 spec 那邊要回哪一份假件。
const page = params.get('page') || 'detail';
const venueId = params.get('venueId') || 'V_E2E_HALL';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('harness: 找不到 #root');

const entry = page === 'list' ? '/venues' : `/venue/${venueId}`;

// 刻意不包 <React.StrictMode>：dev 下它會把 effect 跑兩次，
// 而這兩頁的載入正是一次性 effect ⇒ 那會讓「列表翻了幾次頁」變成量測雜訊
// （而翻頁次數正是 V5 要斷言的東西）。
// 🔴 那層 `bg-[#f9f9f7]` 不是裝飾，是**忠實度**：`index.html` 的 body 是
//    `#050b14`（Cyberpunk 殘留，§1 #10），而正式路由外面包著 `App.tsx` 的
//    `Layout`，它給的是 `bg-[#f9f9f7]`。少了這一層，頁面用的 `text-neutral-900`
//    會畫在近黑底上 ⇒ **截圖是深色底、幾乎看不到字**，而十條斷言照樣全綠
//    （innerText 不在乎對比）。2026-09-09 第一次跑就是這樣，差點把「harness 少一層殼」
//    讀成「這一頁的配色壞了」。
//    ⚠️ 這一層只補背景色，**不是**真的 Layout（TopBar／BottomNav／PullToRefresh 都不在）——
//    「這條路由有沒有殼」由 appRoutes.test.ts B1j-34 撐著，不是這裡。
ReactDOM.createRoot(rootEl).render(
    <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>
          <div className="relative min-h-screen w-full bg-[#f9f9f7]">
            <Routes>
                <Route path="/venue/:id" element={<VenueDetail />} />
                <Route path="/venues" element={<VenueList />} />
                {/* 導頁的儀器：少了它，導向會落到空路由、畫面一片空白，
                    而「導對了」與「頁面炸了」長得一模一樣。 */}
                <Route path="/create-venue" element={<div data-testid="create-venue-page">CREATE VENUE PAGE</div>} />
                <Route path="*" element={<div data-testid="nowhere">NOWHERE</div>} />
            </Routes>
          </div>
        </ToastProvider>
    </MemoryRouter>
);
