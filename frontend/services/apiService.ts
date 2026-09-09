/// <reference types="vite/client" />
// API Service for MahjongClub App
// Based on LineBot/websites/mahjongclub-web/src/utils/api.js

import { Capacitor } from '@capacitor/core';
import { MOCK_GAMES, MOCK_MY_GAMES, MOCK_NOTIFICATIONS } from './mockData';
import { STORAGE_KEYS, APP_VERSION } from '../constants';
import { clientPlatformHeader } from '../utils/clientPlatform';
import { authParamFor } from '../utils/authParam';
import type { CorrectionPayload } from '../utils/voiceCorrection';
import type { MetricEventPayload } from '../utils/voiceTaiMetrics';
import type { CreateVenuePayload } from '../types';
import {
  MAINTENANCE_EVENT,
  MAINTENANCE_CLEAR_EVENT,
  noteBlocked,
  noteOk,
} from '../utils/maintenanceSignal';

// fail-closed：原本沒設 VITE_API_BASE_URL 就回退到工程師的「正式」API,
// 等於 staging 版本會安靜地對真實用戶資料下手。寧可整個 app 起不來也不要打錯後端。
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
if (!API_BASE_URL) {
  throw new Error(
    'VITE_API_BASE_URL 未設定。請在 build 前指定後端 API(staging 例: ' +
    'https://ryojaku-api.boyplaymj.com)。' +
    '此處刻意不留預設值,避免誤連正式環境。'
  );
}

// 防止多個 401 同時觸發重複跳轉的旗標
let isRedirectingToLogin = false;

// Helper to check for localhost
const isLocalhost = () => {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
};

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
  [key: string]: any;
}

// Helper function to make API requests
async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;

  // Get JWT token from localStorage
  const token = localStorage.getItem(STORAGE_KEYS.JWT);

  const defaultOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      'X-App-Version': APP_VERSION,
      // 🔴 這裡原本是寫死的 'Web'。後端一直在收這個 header、DDB 也一直有
      //    platform 欄位，所以那份資料**看起來像是已經在回答「誰用哪個殼」** ——
      //    而「使用者全是 Web」這個讀數，在一半使用者用 App 殼的世界裡逐字相同。
      //    ⚠️ 拿不到平台時送的是 'unknown' 不是空字串（後端對空值會跳過整個欄位的
      //    更新 ⇒ 舊的 'Web' 會原封留著）。理由見 utils/clientPlatform.ts 檔頭。
      'X-Platform': clientPlatformHeader(Capacitor.getPlatform()),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, { ...defaultOptions, ...options });

    // Parse JSON response
    const data = await response.json().catch(() => ({ success: false, error: 'Invalid response' }));

    // If HTTP error, but we got a JSON response with error message, return it
    if (!response.ok) {
      // 處理 401 未授權：清除登入狀態並強制重新載入
      if (response.status === 401) {
        // public auth 端點的 401 是「憑證/帳密錯誤」，不是既有 session 過期 → 不清 localStorage
        const isAuthEndpoint = endpoint.includes('/app-login') || endpoint.includes('/app-register')
          || endpoint.includes('/verify-user') || endpoint.includes('/auth/google')
          || endpoint.includes('/auth/forgot-password') || endpoint.includes('/auth/reset-password')
          || endpoint.includes('/auth/verify-email');

        if (!isAuthEndpoint) {
          // 使用旗標防止多個併發 401 同時觸發多次跳轉
          if (!isRedirectingToLogin) {
            isRedirectingToLogin = true;
            console.warn('[AUTH] 401 Unauthorized - 清除登入狀態並重新載入頁面');

            // 清除所有登入相關的 localStorage
            localStorage.removeItem(STORAGE_KEYS.JWT);
            localStorage.removeItem(STORAGE_KEYS.USER);
            localStorage.removeItem(STORAGE_KEYS.AUTH_TYPE);
            localStorage.removeItem(STORAGE_KEYS.LINE_ID);

            // 先設定 hash 再強制 reload，確保 React 狀態也被重置
            window.location.hash = '#/?expired=true';
            window.location.reload();
          }
          return { success: false, error: '連線已過期，請重新登入' };
        }

        // 登入/註冊端點的 401 代表帳密錯誤
        return { success: false, error: data.error || '帳號或密碼錯誤' };
      }

      // 維護模式（kill switch）：user authorizer 回 Deny policy → API Gateway 吐 403。
      // 🔴 刻意**不**清 localStorage —— 這正是維護模式不用 401 的整個理由
      //    （見 backend/cmd/lambdas/apis/mahjongclub_authorizer/main.go 的 deny()）。
      //    若哪天有人「順手統一」成走上面那條 401 分支，維護一開就是全體永久登出。
      // ⚠️ 誠實的限制：API Gateway 的 Deny 回的是它自己的制式 body，這裡沒有可辨識的
      //    維護標記。本分支成立的依據是「本專案現況下，REST 路徑的 403 只可能來自
      //    維護模式」（實查：user handler 只有 chat_ws_send_message 回 403，而它走
      //    WebSocket 不經過 apiRequest）—— 這是推論，不是協定保證。
      //    日後若有 REST handler 開始回 403，要回來改這段，否則會把它說成維護中。
      if (response.status === 403) {
        // 🔴 除了回傳字串，還要發一個**全域**訊號。理由：這個 error 是**回傳值**，
        //    而各頁面幾乎都只看 response.success 就走人（Ledger.tsx 直接渲染一本
        //    空帳本），於是「服務維護中」翻譯出來了卻沒有人把它畫出來。
        //    逐頁去改的話，漏掉的那一頁零徵兆 —— 所以載體放在呼叫點之上。
        //    只在「進入維護」那一次發事件，不是每個 403 都發：見 utils/maintenanceSignal.ts。
        if (noteBlocked(endpoint)) {
          window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT));
        }
        return { success: false, error: '服務維護中，請稍後再試' };
      }

      // 🔴 帶上 status。少了它，呼叫端只剩 error 字串可以看，而「404＝後端說沒有」
      //    與「502＝這次沒問到」的處置是相反的（見 utils/rulesetSource.ts 的
      //    classifyRulesetResponse）。靠 parse 錯誤字串去分辨，是把一個協定層的事實
      //    寄生在一句人話上 —— 那句話改個字就會靜靜失效。
      //    ⚠️ 只加不減：既有呼叫端全部只讀 success/error/data，多一個欄位不影響它們。
      return { success: false, status: response.status, error: data.error || `HTTP error! status: ${response.status}` };
    }

    // 曾被 403 擋過的那條路自己通了 ⇒ 維護結束。
    // ⚠️ 不可以簡化成「任何 2xx 就解除」：維護中公開 route 照樣回 200（實測，
    //    見 infra/maintenance_public_routes_probe.sh），那樣寫提示會閃爍。
    if (noteOk(endpoint)) {
      window.dispatchEvent(new CustomEvent(MAINTENANCE_CLEAR_EVENT));
    }

    return data;
  } catch (error) {
    console.error('API request error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}


// ============ System Configuration APIs ============

// 強制更新只有 minRequiredVersion 一個機制；updateUrl 是被擋下時的出口（utils/versionGate.ts）。
// 先前還有 latestVersion 與 forceUpdate，兩者端到端都沒有任何消費者，已一併移除。
export interface VersionConfig {
  minRequiredVersion: string;
  updateUrl: string;
  inviterPoints?: string;
  inviteePoints?: string;
}

export async function getVersionConfig(): Promise<ApiResponse<VersionConfig>> {
  return apiRequest('/app-version-config', {
    method: 'GET',
  });
}

// ============ APP Authentication APIs ============

// Register new APP user
export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  gender?: string;
  ageRange?: string;
  mahjongExperience?: string;
  inviteCode?: string;
}

export async function registerUser(data: RegisterRequest) {
  return apiRequest('/app-register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Login with email/password or encrypted LINE ID
export interface LoginRequest {
  email?: string;
  password?: string;
  encryptedLineId?: string;
}

export async function loginUser(data: LoginRequest) {
  return apiRequest('/app-login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============ 帳號系統 P5（新版 auth：認證信 / 忘記改密碼 / Google）============
// 路徑對齊後端 lambda（P6 APIGW 接線）；需登入的端點由 apiRequest 自動帶 Authorization: Bearer。

// 忘記密碼：寄重設連結（後端一律回防枚舉的成功句）
export async function forgotPassword(email: string) {
  return apiRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

// 重設密碼：用信中 token 設新密碼（免登入）
export async function resetPassword(token: string, newPassword: string) {
  return apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
}

// 驗證信箱：用信中 token（免登入）
export async function verifyEmail(token: string) {
  return apiRequest(`/auth/verify-email?token=${encodeURIComponent(token)}`, { method: 'GET' });
}

// 重寄認證信（免登入；後端一律回防枚舉成功句）
export async function resendVerify(email: string) {
  return apiRequest('/auth/resend-verify', { method: 'POST', body: JSON.stringify({ email }) });
}

// 改密碼（需登入）：驗當前密碼 → 換新
export async function changePassword(currentPassword: string, newPassword: string) {
  return apiRequest('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

// 登出所有其他裝置（需登入）
export async function logoutAllDevices() {
  return apiRequest('/auth/logout-all', { method: 'POST' });
}

// Google 登入/註冊/合併：傳 Google ID token
export async function googleAuth(idToken: string) {
  return apiRequest('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
}

// 綁定 Google 到目前帳號（需登入）
export async function bindGoogle(idToken: string) {
  return apiRequest('/auth/bind-google', { method: 'POST', body: JSON.stringify({ idToken }) });
}

// ---- LINE Login（authorization code 流程；見 services/lineLogin.ts 檔頭）----

// 取一次性 nonce（public，不需登入）。回 { success, nonce }。
export async function lineNonce() {
  return apiRequest('/auth/line/nonce', { method: 'POST', body: '{}' });
}

// LINE 登入/註冊：送 authorization code，由後端拿 channel secret 換 id_token。
// redirectUri 必須與授權當下、以及 LINE console 註冊的值逐字相同。
export async function lineAuth(code: string, redirectUri: string, nonce: string) {
  return apiRequest('/auth/line', { method: 'POST', body: JSON.stringify({ code, redirectUri, nonce }) });
}

// 綁定 LINE 到目前帳號（需登入）。形狀與 lineAuth 相同。
export async function bindLine(code: string, redirectUri: string, nonce: string) {
  return apiRequest('/auth/bind-line', { method: 'POST', body: JSON.stringify({ code, redirectUri, nonce }) });
}

// 解綁登入方式（需登入）：provider = 'google' | 'line'
export async function unbindProvider(provider: string) {
  return apiRequest('/auth/unbind', { method: 'POST', body: JSON.stringify({ provider }) });
}

// ============ WEB Authentication APIs (Legacy) ============

// Verify user and get user info (for LINE Bot users)
export async function verifyUser(userIdentifier: string) {
  return apiRequest(`/verify-user?${authParamFor(userIdentifier)}`, {
    method: 'POST',
  });
}

// Search games
export interface SearchGamesParams {
  type?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
}

export async function searchGames(params: SearchGamesParams = {}) {
  const queryParams = new URLSearchParams();
  if (params.type) queryParams.append('type', params.type);
  if (params.latitude) queryParams.append('latitude', params.latitude.toString());
  if (params.longitude) queryParams.append('longitude', params.longitude.toString());
  if (params.radius) queryParams.append('radius', params.radius.toString());

  // Always try to call real API first - 修正為 GET 方法 (符合文件規格)
  const response = await apiRequest(`/search-games?${queryParams.toString()}`, {
    method: 'GET',
  });

  // If API call succeeds and returns data, use it
  // 根據文件規格，正確的回應格式是 response.data.games
  if (response.success && response.data?.games) {
    console.log('[API] Using real API data for searchGames, count:', response.data.games.length);
    // 保持文件規格的回應格式：{ success: true, data: { games: [...], count: N } }
    return response;
  }

  // If API fails or returns empty, use mock data on localhost
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      data: {
        games: MOCK_GAMES,
        count: MOCK_GAMES.length
      }
    };
  }

  // If not localhost and API failed, return the failed response
  return response;
}

// Notifications
export async function getNotifications(userIdentifier: string, lastKey: string | null = null) {
  let url = `/notifications?userId=${encodeURIComponent(userIdentifier)}`;
  if (lastKey) {
    url += `&lastKey=${encodeURIComponent(lastKey)}`;
  }

  // Always try to call real API first
  const response = await apiRequest(url, {
    method: 'GET',
  });

  // If API call succeeds and returns data, use it
  // 根據文件規格，正確的回應格式包含 notifications, unreadCount, hasMore, lastKey
  if (response.success && response.notifications) {
    console.log('[API] Using real API data for getNotifications');
    return response;
  }

  // If API fails or returns empty, use mock data on localhost
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock notifications for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      notifications: MOCK_NOTIFICATIONS,
      unreadCount: MOCK_NOTIFICATIONS.filter(n => !n.isRead).length,
      hasMore: false,
      lastKey: null
    };
  }

  // If not localhost and API failed, return the failed response
  return response;
}

export async function subscribePush(userIdentifier: string, subscription: PushSubscription) {
  // Generate or get device ID
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + Date.now();
    localStorage.setItem('deviceId', deviceId);
  }

  return apiRequest('/subscribe-push', {
    method: 'POST',
    body: JSON.stringify({
      userId: userIdentifier,
      subscription: subscription.toJSON(),
      deviceId: deviceId
    }),
  });
}

export async function unsubscribePush(userIdentifier: string) {
  // Get device ID from localStorage
  const deviceId = localStorage.getItem('deviceId') || 'unknown_device';

  return apiRequest('/unsubscribe-push', {
    method: 'POST',
    body: JSON.stringify({
      userId: userIdentifier,
      deviceId: deviceId
    }),
  });
}

export async function getSubscriptionStatus(userIdentifier: string) {
  const deviceId = localStorage.getItem('deviceId') || 'unknown';
  return apiRequest('/subscription-status', {
    method: 'POST',
    body: JSON.stringify({
      userId: userIdentifier,
      deviceId: deviceId
    })
  });
}

export async function getVapidKey() {
  return apiRequest(`/vapid-key`, {
    method: 'GET',
  });
}

// Create game
export interface CreateGameRequest {
  type: string;           // "one-time" or "long-term"
  gameType: string;
  placeName: string;
  location: string;
  latitude: number;
  longitude: number;
  needPlayers: number;
  stakes: string;
  startTime: string;
  rules: string[];
  features: string[];
  restrictions: string[];
}

export async function createGame(userIdentifier: string, gameData: CreateGameRequest) {
  return apiRequest(`/create-game?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(gameData),
  });
}

/**
 * [A3-m] 補充設定（第二段）。四個欄位都是 optional —— **沒送＝不動這一項**，
 * 送空陣列＝清空。後端 `update-game` 用指標區分這兩件事，這裡不要用 `?? []` 把它抹平。
 */
export interface UpdateGameRequest {
  gameId: string;
  rules?: string[];
  features?: string[];
  restrictions?: string[];
  images?: string[];
}

export async function updateGame(userIdentifier: string, gameData: UpdateGameRequest) {
  return apiRequest(`/update-game?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(gameData),
  });
}

// Get my games
export async function getMyGames(userIdentifier: string) {
  // Always try to call real API first
  const response = await apiRequest(`/my-games?${authParamFor(userIdentifier)}`, {
    method: 'POST',
  });

  // If API call succeeds and returns data, use it
  // 根據文件規格，正確的回應格式包含 hostedGames, joinedGames, pendingRegistrations
  if (response.success && response.data &&
    (response.data.hostedGames || response.data.joinedGames || response.data.pendingRegistrations)) {
    console.log('[API] Using real API data for getMyGames');
    return response;
  }

  // If API fails or returns empty, use mock data on localhost
  if (isLocalhost()) {
    console.log('[MOCK] API returned empty/failed, using mock my-games for localhost');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      data: MOCK_MY_GAMES
    };
  }

  // If not localhost and API failed, return the failed response
  return response;
}

// Register for a game
export interface RegisterGameRequest {
  gameID: string;
  message?: string;
}

export async function registerGame(userIdentifier: string, gameData: RegisterGameRequest) {
  return apiRequest(`/game-register?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(gameData),
  });
}

// Get user profile
export async function getUserProfile(userIdentifier: string) {
  // Use GET for fetching profile, which is supported by the backend
  return apiRequest(`/user-profile?${authParamFor(userIdentifier)}`, {
    method: 'GET',
  });
}

// Update user profile
export interface UpdateUserProfileRequest {
  displayName?: string;
  gender?: string;
  ageRange?: string;
  mahjongExperience?: string;
  lineId?: string;
  notifyNewGames?: boolean;
  pictureUrl?: string;
}

export async function updateUserProfile(userIdentifier: string, profileData: UpdateUserProfileRequest) {
  return apiRequest(`/user-profile?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(profileData),
  });
}



// Mark notification as read
export interface MarkNotificationReadRequest {
  notificationId: string;
}

export async function markNotificationAsRead(notificationData: MarkNotificationReadRequest) {
  return apiRequest('/notifications', {
    method: 'POST',
    body: JSON.stringify(notificationData),
  });
}

// Get game detail
export interface GameDetailRequest {
  gameId: string;
  lineID?: string; // 可選，用於 LINE Bot 用戶
}

export async function getGameDetail(gameId: string, lineID?: string) {
  const requestBody: GameDetailRequest = { gameId };
  if (lineID) {
    requestBody.lineID = lineID;
  }

  return apiRequest('/game-detail', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });
}

// Accept registration
export interface AcceptRegistrationRequest {
  registrationId: string;
}

export async function acceptRegistration(userIdentifier: string, registrationData: AcceptRegistrationRequest) {
  return apiRequest(`/accept-registration?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(registrationData),
  });
}

// Reject registration
export interface RejectRegistrationRequest {
  registrationId: string;
  reason?: string;
}

export async function rejectRegistration(userIdentifier: string, registrationData: RejectRegistrationRequest) {
  return apiRequest(`/reject-registration?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(registrationData),
  });
}

// Cancel game
export interface CancelGameRequest {
  gameId: string;
  reason?: string;
}

export async function cancelGame(userIdentifier: string, gameData: CancelGameRequest) {
  return apiRequest(`/cancel-game?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(gameData),
  });
}

// Cancel registration
export interface CancelRegistrationRequest {
  gameID: string;
  registrationID: string;
}

export async function cancelRegistration(userIdentifier: string, registrationData: CancelRegistrationRequest) {
  return apiRequest(`/cancel-registration?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(registrationData),
  });
}

// Ratings
export async function getRatings(userIdentifier: string, gameId?: string) {
  // 修正為 GET 方法 (符合文件規格)
  let url = `/ratings?${authParamFor(userIdentifier)}`;

  // 如果提供了 gameId，則添加到查詢參數中
  if (gameId) {
    url += `&gameId=${encodeURIComponent(gameId)}`;
  }

  return apiRequest(url, {
    method: 'GET',
  });
}

export interface SubmitRatingRequest {
  gameId: string;
  toUserId: string;
  isPositive: boolean;
  comment?: string;
}

export async function submitRating(userIdentifier: string, ratingData: SubmitRatingRequest) {
  // ⚠️ 這裡刻意**不用** utils/authParam.ts —— 它是同一個判斷的第二份載體，
  //    但兩邊今天已經沒有共同的消費端：後端 submit-rating 的身分
  //    **一律取自 authorizer**（`mahjongclub_web_submit_rating/main.go:174`
  //    `shared.AuthorizerUserID(request)`，缺 context 就 401 fail-closed），
  //    query 的 `userId` 與 body 的 `lineID` 兩個它**都不讀**。
  //    ⇒ 下面這個分支對後端沒有任何影響，是 S5-C 之前的殘骸。
  //    留著不動的理由是「改請求形狀＝動到線上端點，換不到任何東西」；
  //    但**不要**把它跟 authParamFor 統一 —— 那會讓人以為判準只有一份，
  //    而真正決定身分的地方根本不在前端。（2026-09-04 稽核 §3c 順帶查證）
  const isAppUser = userIdentifier.startsWith('APP_');

  if (isAppUser) {
    // APP 用戶：userId 在 Query Parameter，其他資料在 Body
    return apiRequest(`/submit-rating?userId=${encodeURIComponent(userIdentifier)}`, {
      method: 'POST',
      body: JSON.stringify(ratingData),
    });
  } else {
    // LINE 用戶：lineID 在 Body 中
    return apiRequest(`/submit-rating`, {
      method: 'POST',
      body: JSON.stringify({
        lineID: userIdentifier,
        ...ratingData
      }),
    });
  }
}

export async function getUserComments(userId: string, limit = 10, lastKey?: any) {
  let url = `/user-comments?userId=${encodeURIComponent(userId)}&limit=${limit}`;
  if (lastKey) {
    const keyStr = typeof lastKey === 'string' ? lastKey : JSON.stringify(lastKey);
    url += '&lastKey=' + encodeURIComponent(keyStr);
  }
  return apiRequest(url, {
    method: 'GET',
  });
}

// Get user info by userId
export async function getUserInfo(userId: string) {
  // 修正為 GET 方法 (符合文件規格)
  return apiRequest(`/user-info?userId=${encodeURIComponent(userId)}`, {
    method: 'GET',
  });
}

// Redeem code
export interface RedeemCodeRequest {
  code: string;
}

export async function redeemCode(userIdentifier: string, code: string) {
  return apiRequest(`/redeem-code?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

// Get S3 upload URL
export interface GetUploadUrlRequest {
  userId: string;
  fileName: string;
  contentType: string;
}

export async function getUploadUrl(data: GetUploadUrlRequest) {
  return apiRequest('/get-upload-url', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============ Community System APIs ============

export async function getCommunityUploadUrl(userId: string, fileName: string, contentType: string) {
  return apiRequest('/community-get-upload-url', {
    method: 'POST',
    body: JSON.stringify({ userId, fileName, contentType }),
  });
}

export async function getEventUploadUrl(userId: string, fileName: string, contentType: string) {
  return apiRequest('/event-get-upload-url', {
    method: 'POST',
    body: JSON.stringify({ userId, fileName, contentType }),
  });
}

export interface CreatePostRequest {
  userId: string;
  content: string;
  contentType: string;
  images?: string[];
  tags?: string[];
}

export async function createCommunityPost(postData: CreatePostRequest) {
  return apiRequest('/community-create-post', {
    method: 'POST',
    body: JSON.stringify(postData),
  });
}

export async function getCommunityPosts(userId: string, limit = 10, lastKey?: any) {
  let url = '/community-get-posts?limit=' + limit;
  if (userId) {
    url += '&userId=' + encodeURIComponent(userId);
  }
  if (lastKey) {
    // Check if lastKey is object (DynamoDB key) or string
    const keyStr = typeof lastKey === 'string' ? lastKey : JSON.stringify(lastKey);
    url += '&lastKey=' + encodeURIComponent(keyStr);
  }

  // Always try to call real API first
  const response = await apiRequest(url, {
    method: 'GET'
  });

  if (response.success && response.data) {
    return response;
  }

  // Fallback Mock for Localhost
  if (isLocalhost() && !lastKey) {
    // Only return mock on first page for simplicity
    console.log('[MOCK] Using Mock Community Posts');
    const { MOCK_POSTS } = await import('./mockData');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      success: true,
      data: MOCK_POSTS,
      lastKey: null // No more pages in mock
    };
  }

  return response;
}

export async function getUserCommunityPosts(targetUserId: string, limit = 10, lastKey?: any) {
  let url = `/community-get-user-posts?targetUserId=${encodeURIComponent(targetUserId)}&limit=${limit}`;
  if (lastKey) {
    const keyStr = typeof lastKey === 'string' ? lastKey : JSON.stringify(lastKey);
    url += '&lastKey=' + encodeURIComponent(keyStr);
  }

  const response = await apiRequest(url, {
    method: 'GET'
  });

  return response;
}

export async function getCommunityPostDetail(postId: string, userId?: string) {
  let url = `/community-get-post-detail?postId=${encodeURIComponent(postId)}`;
  if (userId) {
    url += `&userId=${encodeURIComponent(userId)}`;
  }
  return apiRequest(url, {
    method: 'GET'
  });
}

export async function likePost(postId: string, userId: string) {
  return apiRequest('/community-like-post', {
    method: 'POST',
    body: JSON.stringify({ postId, userId })
  });
}

export async function addComment(postId: string, userId: string, content: string) {
  return apiRequest('/community-add-comment', {
    method: 'POST',
    body: JSON.stringify({ postId, userId, content })
  });
}

export async function likeComment(postId: string, commentId: string, userId: string) {
  return apiRequest('/community-like-comment', {
    method: 'POST',
    body: JSON.stringify({ postId, commentId, userId })
  });
}

// ============ Chat System APIs ============

export async function getChatRooms(userIdentifier: string) {
  return apiRequest(`/chat/rooms?${authParamFor(userIdentifier)}`, {
    method: 'GET',
  });
}

export async function getChatHistory(roomId: string, lastKey?: string) {
  let url = `/chat/history?roomId=${encodeURIComponent(roomId)}`;
  if (lastKey) {
    url += `&lastKey=${encodeURIComponent(lastKey)}`;
  }
  return apiRequest(url, {
    method: 'GET',
  });
}

export async function markAsRead(userId: string, roomId: string) {
  return apiRequest('/chat-mark-read', {
    method: 'POST',
    body: JSON.stringify({ userId, roomId })
  });
}

export async function getRoomInfo(roomId: string) {
  return apiRequest(`/chat/room-info?roomId=${encodeURIComponent(roomId)}`, {
    method: 'GET',
  });
}

export async function getChatUploadUrl(userId: string, roomId: string, fileName: string, contentType: string) {
  return apiRequest('/chat/get-upload-url', {
    method: 'POST',
    body: JSON.stringify({ userId, roomId, fileName, contentType }),
  });
}

// ============ Mahjong Ledger APIs ============

export interface Opponent {
  name: string;
  userId?: string;
}

export interface LedgerEntry {
  userId: string;
  ledgerId?: string;
  date: string;
  stakes: string;
  rounds: number;
  winLoss: number;
  actualAmount: number;
  opponents: Opponent[];
  mood: string;
  note: string;
  gameId?: string;
  createdAt?: number;
}

export async function getLedger(userIdentifier: string) {
  return apiRequest(`/ledger?${authParamFor(userIdentifier)}`, {
    method: 'GET',
  });
}

export async function createLedgerAccount(userIdentifier: string, ledgerData: Partial<LedgerEntry>) {
  return apiRequest(`/ledger?${authParamFor(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(ledgerData),
  });
}

export async function getLedgerSummary(userIdentifier: string) {
  return apiRequest(`/ledger/summary?${authParamFor(userIdentifier)}`, {
    method: 'GET',
  });
}

export async function updateLedger(userIdentifier: string, ledgerData: Partial<LedgerEntry>) {
  return apiRequest(`/ledger?${authParamFor(userIdentifier)}`, {
    method: 'PUT',
    body: JSON.stringify(ledgerData),
  });
}

export async function deleteLedger(userIdentifier: string, ledgerId: string, createdAt: number) {
  return apiRequest(`/ledger?${authParamFor(userIdentifier)}&ledgerId=${encodeURIComponent(ledgerId)}&createdAt=${createdAt}`, {
    method: 'DELETE',
  });
}


// ============ Daily Bonus APIs ============

export async function claimDailyBonus(userIdentifier: string) {
  return apiRequest(`/daily-bonus?${authParamFor(userIdentifier)}`, {
    method: 'POST',
  });
}

// ============ Admin Activity Config APIs ============

export async function getAdminActivityConfigs() {
  return apiRequest('/admin/activities', {
    method: 'GET',
  });
}

export async function updateAdminActivityConfigs(configs: Record<string, string>) {
  return apiRequest('/admin/activities', {
    method: 'POST',
    body: JSON.stringify(configs),
  });
}

// ============ Push Reward APIs ============

export async function claimPushBonus(userId: string) {
  return apiRequest('/claim-push-bonus', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

// ============ 語音判台：訂正飛輪（D4-c）============
// 正典 /opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §4。後端 auth: user
// ⇒ apiRequest 會自動帶 Authorization，未登入時後端回 401。
//
// 🔴 **每次送出都要呼叫，包含使用者沒有訂正的那些**（§4.4）。
//    只送有差異的話，「訂正筆數 = 0」同時代表「判得很準」與「根本沒人用」，
//    而這兩件事的處置完全相反 —— hadDiff=false 的紀錄就是準確度的分母。
//    payload 由 utils/voiceCorrection.ts 的 buildCorrection() 組，不要在這裡拼。

export async function postVoiceCorrection(payload: CorrectionPayload) {
  return apiRequest('/voice-corrections', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * 漏斗事件（D4-g）。**同一個端點、同一張表**，靠 payload 的 `kind` 區分。
 *
 * 🔴 刻意不開第二個端點：訂正是分子、事件是分母，兩者要能對得起來。
 *    分兩條管道的話，「事件管道壞了」會長得像「沒人用」，而那正是本功能要消滅的誤讀。
 *    附帶的好處是它們共用同一組 auth 與同一份護欄。
 */
export async function postVoiceTaiEvent(payload: MetricEventPayload) {
  return apiRequest('/voice-corrections', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}


// ============ 語音判台：家規台數表下發（D5-d）============
// 正典 /opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c。後端 auth: user
// ⇒ apiRequest 會自動帶 Authorization。
//
// 🔴 回傳原封不動交給 utils/rulesetSource.ts 的 classifyRulesetResponse() 判讀，
//    這裡不解釋任何一種失敗 —— 「404 該清快取、502 不該」那條判準只留一份，
//    而且要留在測得到的那一層（services/ 不在 run-tests.mjs 的 glob 裡）。
//
// ⚠️ 未登入／token 過期時這支會走 apiRequest 既有的 401 分支（清 localStorage
//    並重新載入）。這不是本功能新增的行為：同一頁的 open 事件（POST
//    /voice-corrections）走的是同一組 auth，本頁本來就只在登入後才到得了。

export async function getRuleset(): Promise<ApiResponse> {
  return apiRequest('/ruleset', { method: 'GET' });
}


// ============ 場地 venue（[B1-j1]）============
// 正典 /opt/sml/repo/tools/ryojaku-webapp/PLAYER_APP_REDESIGN.md §5.3。
//
// 🔴 這三支刻意是**薄的**：不解釋回應、不合併形狀、不做任何「沒有地址就顯示…」
//    的判斷。理由與 getRuleset() 那條相同 —— `services/` 不在 run-tests.mjs 的
//    glob 裡，寫在這裡的判斷沒有尺量得到。判讀一律在 utils/venueView.ts。
//
// 🔴 三支的 authorizer **不一樣**，不要看成同一組：
//    - venue-list   : 公開，**刻意沒有** authorizer（回白名單型別 PublicVenueCard）
//    - venue-detail : 要登入。它的全部價值在 CanSeeExactAddress，而那個判斷的
//                     第一個輸入就是 caller userId ⇒ 沒有 authorizer 時每個人都
//                     被判成匿名，連已核准的玩家都拿不到地址（§5.3 那段紅字）。
//    - create-venue : 要登入（ownerId 從 JWT 取，body 上根本沒有那個欄位）。

/**
 * 公開場地列表。`nextToken` 為空才代表掃完了 ——
 * 🔴 **不要**用 `venues.length === 0` 當終止條件（§5.3）。翻頁決策走
 * utils/venueView.ts 的 `nextPageDecision()`，那裡有尺。
 */
export async function listVenues(params: { limit?: number; nextToken?: string } = {}): Promise<ApiResponse> {
  const q = new URLSearchParams();
  if (params.limit) q.append('limit', String(params.limit));
  if (params.nextToken) q.append('nextToken', params.nextToken);
  const qs = q.toString();
  return apiRequest(`/venue-list${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

/**
 * 單一場地。`gameId` 是**自建場地址授權**的憑據：後端會拿它去讀那一局的 venueId
 * 與你的報名狀態（AddressEvidence），不帶就一定拿不到自建場的地址。
 *
 * ⚠️ 麻將館／活動場不需要帶 —— 它們走 `allow:public-venue` 那條。
 * ⚠️ 回應的 `exactAddress` **鍵不存在就是沒授權**（值可能是空字串且那是另一回事）。
 */
export async function getVenueDetail(venueId: string, gameId?: string): Promise<ApiResponse> {
  return apiRequest('/venue-detail', {
    method: 'POST',
    body: JSON.stringify(gameId ? { venueId, gameId } : { venueId }),
  });
}

/**
 * 建立場地。
 *
 * ⚠️ 建出來的 `status` **由後端依 type 決定**，不是這裡送的：
 *    hall → `pending`（要人審，後台 https://ryojaku-console.boyplaymj.com）／
 *    home・event → `active`。前端不要自己預測那個值，讀回應裡的 status。
 */
export async function createVenue(payload: CreateVenuePayload): Promise<ApiResponse> {
  return apiRequest('/create-venue', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
