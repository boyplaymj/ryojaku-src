/// <reference types="vite/client" />
// API Service for MahjongClub App
// Based on LineBot/websites/mahjongclub-web/src/utils/api.js

import { MOCK_GAMES, MOCK_MY_GAMES, MOCK_NOTIFICATIONS } from './mockData';
import { STORAGE_KEYS, APP_VERSION } from '../constants';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yg7y0xkb50.execute-api.ap-southeast-1.amazonaws.com';

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
      'X-Platform': 'Web',
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

      return { success: false, error: data.error || `HTTP error! status: ${response.status}` };
    }

    return data;
  } catch (error) {
    console.error('API request error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}

// Helper to determine auth param
function getAuthParam(userIdentifier: string): string {
  // If it starts with APP_, it's an APP user ID. Otherwise assume it's an encrypted LINE ID.
  // You might need to adjust this logic based on actual ID formats.
  const isAppUser = userIdentifier.startsWith('APP_') || userIdentifier.startsWith('U'); // 'U' is often used for UUIDs too, adjust if needed
  const paramName = isAppUser ? 'userId' : 'lineID';
  return `${paramName}=${encodeURIComponent(userIdentifier)}`;
}

// ============ System Configuration APIs ============

export interface VersionConfig {
  minRequiredVersion: string;
  latestVersion: string;
  updateUrl: string;
  forceUpdate: boolean;
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

// 解綁登入方式（需登入）：provider = 'google' | 'line'
export async function unbindProvider(provider: string) {
  return apiRequest('/auth/unbind', { method: 'POST', body: JSON.stringify({ provider }) });
}

// ============ WEB Authentication APIs (Legacy) ============

// Verify user and get user info (for LINE Bot users)
export async function verifyUser(userIdentifier: string) {
  return apiRequest(`/verify-user?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/create-game?${getAuthParam(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(gameData),
  });
}

// Get my games
export async function getMyGames(userIdentifier: string) {
  // Always try to call real API first
  const response = await apiRequest(`/my-games?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/game-register?${getAuthParam(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(gameData),
  });
}

// Get user profile
export async function getUserProfile(userIdentifier: string) {
  // Use GET for fetching profile, which is supported by the backend
  return apiRequest(`/user-profile?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/user-profile?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/accept-registration?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/reject-registration?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/cancel-game?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/cancel-registration?${getAuthParam(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(registrationData),
  });
}

// Ratings
export async function getRatings(userIdentifier: string, gameId?: string) {
  // 修正為 GET 方法 (符合文件規格)
  let url = `/ratings?${getAuthParam(userIdentifier)}`;

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
  // 根據文件規格，APP 用戶使用 Query Parameter，LINE 用戶使用 Body
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
  return apiRequest(`/redeem-code?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/chat/rooms?${getAuthParam(userIdentifier)}`, {
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
  return apiRequest(`/ledger?${getAuthParam(userIdentifier)}`, {
    method: 'GET',
  });
}

export async function createLedgerAccount(userIdentifier: string, ledgerData: Partial<LedgerEntry>) {
  return apiRequest(`/ledger?${getAuthParam(userIdentifier)}`, {
    method: 'POST',
    body: JSON.stringify(ledgerData),
  });
}

export async function getLedgerSummary(userIdentifier: string) {
  return apiRequest(`/ledger/summary?${getAuthParam(userIdentifier)}`, {
    method: 'GET',
  });
}

export async function updateLedger(userIdentifier: string, ledgerData: Partial<LedgerEntry>) {
  return apiRequest(`/ledger?${getAuthParam(userIdentifier)}`, {
    method: 'PUT',
    body: JSON.stringify(ledgerData),
  });
}

export async function deleteLedger(userIdentifier: string, ledgerId: string, createdAt: number) {
  return apiRequest(`/ledger?${getAuthParam(userIdentifier)}&ledgerId=${encodeURIComponent(ledgerId)}&createdAt=${createdAt}`, {
    method: 'DELETE',
  });
}


// ============ Daily Bonus APIs ============

export async function claimDailyBonus(userIdentifier: string) {
  return apiRequest(`/daily-bonus?${getAuthParam(userIdentifier)}`, {
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

