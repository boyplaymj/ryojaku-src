// 帳號系統 — LINE Login（OAuth 2.0 authorization code 流程）。
//
// 🔴 為什麼不是像 Google 那樣「前端拿 id_token 直接送後端」：
//    LINE Login 只支援 response_type=code（沒有 implicit），而 code 換 token 必須帶
//    client_secret —— 連走 PKCE 都不豁免。secret 不能進前端，所以交換一定在後端做。
//    前端的責任只有三件：拿 nonce → 導去 LINE → 把回來的 code 交給後端。
//    （LIFF 雖能 client-side 取 id_token，但 liff.login() 沒有 nonce 參數，
//      過不了後端「nonce 必填」的契約，故不採用。）
//
// 流程：
//   ① POST /auth/line/nonce → 伺服器發的一次性 nonce
//   ② 存進 sessionStorage（下面有為什麼一定得存），導向 LINE 授權頁
//   ③ LINE 導回 <origin>/auth/line/callback?code=...&state=...
//   ④ 比對 state → 把 {code, redirectUri, nonce} 交給後端

import { lineNonce } from './apiService';

const AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';

// sessionStorage 的鍵。刻意用 sessionStorage 而非 localStorage：
// 分頁關掉就沒了，也不會跨分頁互相汙染。
const STASH_KEY = 'ryojaku.lineAuth';

export const LINE_CHANNEL_ID: string = (import.meta as any).env?.VITE_LINE_LOGIN_CHANNEL_ID || '';

export type LineMode = 'login' | 'bind';

interface LineStash {
  nonce: string;
  state: string;
  mode: LineMode;
  redirectUri: string;
  returnTo: string;
}

// 未設 channel id → 前端不顯示 LINE 鈕（後端也會 fail-closed，這裡只是不要給死按鈕）。
export function isLineConfigured(): boolean {
  return !!LINE_CHANNEL_ID;
}

// callback 的落點。必須跟 LINE console 註冊的 Callback URL **逐字相同**，
// 否則換 token 時 LINE 回 invalid_grant（而那個錯誤看起來像「LINE 壞了」）。
export function lineRedirectURI(): string {
  return `${window.location.origin}/auth/line/callback`;
}

function randomString(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// 開始 LINE 授權：拿 nonce → 存 stash → 整頁導去 LINE。
// 這支不會回傳（成功時瀏覽器已經離開本頁），失敗才 throw。
export async function startLineLogin(mode: LineMode, returnTo = '/'): Promise<void> {
  if (!isLineConfigured()) throw new Error('尚未設定 LINE 登入（缺 VITE_LINE_LOGIN_CHANNEL_ID）');

  const resp = await lineNonce();
  if (!resp?.success || !resp?.nonce) {
    throw new Error(resp?.error || '無法取得 LINE 登入憑證，請稍後再試');
  }

  const redirectUri = lineRedirectURI();
  const stash: LineStash = { nonce: resp.nonce, state: randomString(16), mode, redirectUri, returnTo };

  // ⚠️ 這一步不可省，也不可改用記憶體變數：授權是**整頁跳轉**去 LINE 再跳回來，
  //    中間整個 JS 執行環境會被銷毀重建。nonce 與 state 必須撐過那一趟。
  //    設計冊 §5.G 早期版本寫「不要持久化 nonce」是在 id_token 流程的前提下寫的，
  //    改走 code 流程後那句不成立 —— 正確的規則是：只准 sessionStorage、用完即刪、
  //    不跨分頁、不重複使用（見下面 consumeLineCallback 的無條件清除）。
  sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_CHANNEL_ID,
    redirect_uri: redirectUri,
    state: stash.state,
    scope: 'openid profile',
    nonce: stash.nonce,
  });
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

// 目前這一頁是不是 LINE 導回來的 callback。
export function isLineCallback(): boolean {
  if (!window.location.pathname.endsWith('/auth/line/callback')) return false;
  const q = new URLSearchParams(window.location.search);
  return q.has('code') || q.has('error');
}

export interface LineCallbackResult {
  code: string;
  redirectUri: string;
  nonce: string;
  mode: LineMode;
  returnTo: string;
}

// 讀出 callback 參數並比對 state。
//
// 🔴 無論成功失敗都會清掉 stash。理由是後端那邊 nonce 是「先消耗、後驗證」——
//    只要 /auth/line 被呼叫過一次，那顆 nonce 就燒掉了，留著只會讓使用者按重試時
//    固定拿到 401 invalid or expired nonce，而那個錯誤訊息看起來像後端壞掉。
//    重試一律要從 startLineLogin() 從頭來過。
export function consumeLineCallback(): LineCallbackResult {
  const raw = sessionStorage.getItem(STASH_KEY);
  sessionStorage.removeItem(STASH_KEY);

  const q = new URLSearchParams(window.location.search);
  const err = q.get('error');
  if (err) {
    // 使用者在 LINE 那頁按了取消最常見。
    throw new Error(err === 'access_denied' ? '已取消 LINE 登入' : `LINE 授權失敗（${err}）`);
  }

  const code = q.get('code');
  const state = q.get('state');
  if (!code || !state) throw new Error('LINE 回傳的資料不完整，請重新登入');
  if (!raw) throw new Error('登入流程已逾時或在其他分頁開始，請重新登入');

  let stash: LineStash;
  try {
    stash = JSON.parse(raw);
  } catch {
    throw new Error('登入流程狀態毀損，請重新登入');
  }
  // state 比對擋的是 CSRF：攻擊者把自己的 code 塞進受害者的瀏覽器。
  // 用 !== 直接比即可（state 不是機密，不需要時間常數比較）。
  if (!stash.state || stash.state !== state) throw new Error('登入流程驗證失敗，請重新登入');

  return {
    code,
    redirectUri: stash.redirectUri,
    nonce: stash.nonce,
    mode: stash.mode === 'bind' ? 'bind' : 'login',
    returnTo: stash.returnTo || '/',
  };
}
