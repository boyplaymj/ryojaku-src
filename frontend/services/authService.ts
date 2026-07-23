import { User } from '../types';
import { verifyUser, loginUser, registerUser, LoginRequest, RegisterRequest,
  forgotPassword as apiForgotPassword, resetPassword as apiResetPassword, verifyEmail as apiVerifyEmail,
  changePassword as apiChangePassword, logoutAllDevices as apiLogoutAll, googleAuth as apiGoogleAuth,
  bindGoogle as apiBindGoogle, unbindProvider as apiUnbind, getUserProfile } from './apiService';
import { STORAGE_KEYS } from '../constants';

export const authService = {
  // Register new APP user
  register: async (data: RegisterRequest): Promise<User> => {
    try {
      const response = await registerUser(data);

      if (!response.success || !response.data) {
        throw new Error(response.error || '註冊失敗');
      }

      const user: User = response.data;

      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      localStorage.setItem(STORAGE_KEYS.AUTH_TYPE, 'app');

      if (response.token) {
        localStorage.setItem(STORAGE_KEYS.JWT, response.token);
      }

      return user;
    } catch (error) {
      console.error('Register error:', error);
      throw error;
    }
  },

  // Login with email/password (APP users)
  loginWithEmail: async (email: string, password: string): Promise<User> => {
    try {
      const response = await loginUser({ email, password });

      // Note: API might return 'user' or 'data' depending on implementation
      const userData = response.user || response.data;

      if (!response.success || !userData) {
        throw new Error(response.error || '登入失敗');
      }

      const user: User = userData;

      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      localStorage.setItem(STORAGE_KEYS.AUTH_TYPE, 'app');

      if (response.token) {
        localStorage.setItem(STORAGE_KEYS.JWT, response.token);
      }

      return user;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  },

  // Login with LINE ID (encrypted) - for LINE Bot users or backup login
  loginWithLineId: async (lineId: string): Promise<User> => {
    try {
      // Try APP login first (for APP users who linked LINE account)
      const appResponse = await loginUser({ encryptedLineId: lineId });

      if (appResponse.success && (appResponse.user || appResponse.data)) {
        const user: User = appResponse.user || appResponse.data;
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
        localStorage.setItem(STORAGE_KEYS.LINE_ID, lineId);
        // @ts-ignore
        localStorage.setItem(STORAGE_KEYS.AUTH_TYPE, user.accountType || 'app');

        if (appResponse.token) {
          localStorage.setItem(STORAGE_KEYS.JWT, appResponse.token);
        }

        return user;
      }

      // Fallback to WEB verify user (for LINE Bot users)
      const webResponse = await verifyUser(lineId);

      const webUser = webResponse.user || webResponse.data;

      if (!webResponse.success || !webUser) {
        throw new Error(webResponse.error || '登入失敗');
      }

      const user: User = webUser;

      // Store user data and LINE ID
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      localStorage.setItem(STORAGE_KEYS.LINE_ID, lineId);
      localStorage.setItem(STORAGE_KEYS.AUTH_TYPE, 'linebot');

      if (webResponse.token) {
        localStorage.setItem(STORAGE_KEYS.JWT, webResponse.token);
      }

      return user;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  },

  // Legacy method for backward compatibility (used by Login.tsx)
  login: async (email: string, password: string): Promise<User> => {
    return authService.loginWithEmail(email, password);
  },

  // ===== 帳號系統 P5 =====

  // Google 登入/註冊/合併：後端只回 token+userId → 再撈完整 profile 存起來。
  loginWithGoogle: async (idToken: string): Promise<User> => {
    const resp = await apiGoogleAuth(idToken);
    if (!resp.success || !resp.token || !resp.userId) {
      throw new Error(resp.error || 'Google 登入失敗');
    }
    localStorage.setItem(STORAGE_KEYS.JWT, resp.token);
    localStorage.setItem(STORAGE_KEYS.AUTH_TYPE, 'app');
    try {
      const profileResp = await getUserProfile(resp.userId);
      const user: User = profileResp.data || profileResp.user;
      if (!user) throw new Error('無法取得使用者資料');
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      return user;
    } catch (e) {
      // 撈 profile 失敗 → 清掉剛寫入的半套 session，避免壞狀態
      localStorage.removeItem(STORAGE_KEYS.JWT);
      localStorage.removeItem(STORAGE_KEYS.AUTH_TYPE);
      throw e instanceof Error ? e : new Error('Google 登入後無法取得使用者資料');
    }
  },

  // 忘記密碼（後端一律回防枚舉成功句，不 throw）
  forgotPassword: async (email: string): Promise<void> => {
    await apiForgotPassword(email);
  },

  // 用信中 token 重設密碼（免登入）
  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    const resp = await apiResetPassword(token, newPassword);
    if (!resp.success) throw new Error(resp.error || '重設失敗，連結可能已過期');
  },

  // 用信中 token 驗證信箱（免登入）
  verifyEmail: async (token: string): Promise<void> => {
    const resp = await apiVerifyEmail(token);
    if (!resp.success) throw new Error(resp.error || '驗證失敗，連結可能已過期或已使用');
  },

  // 改密碼（需登入）
  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const resp = await apiChangePassword(currentPassword, newPassword);
    if (!resp.success) throw new Error(resp.error || '改密碼失敗');
  },

  // 登出所有其他裝置（需登入）
  logoutAllDevices: async (): Promise<void> => {
    const resp = await apiLogoutAll();
    if (!resp.success) throw new Error(resp.error || '操作失敗');
  },

  // 綁定 Google 到目前帳號（需登入）
  bindGoogle: async (idToken: string): Promise<void> => {
    const resp = await apiBindGoogle(idToken);
    if (!resp.success) throw new Error(resp.error || '綁定失敗');
  },

  // 解綁登入方式（需登入）
  unbindProvider: async (provider: string): Promise<void> => {
    const resp = await apiUnbind(provider);
    if (!resp.success) throw new Error(resp.error || '解綁失敗');
  },

  getCurrentUser: (): User | null => {
    const stored = localStorage.getItem(STORAGE_KEYS.USER);
    return stored ? JSON.parse(stored) : null;
  },

  getLineId: (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.LINE_ID);
  },

  getAuthType: (): 'app' | 'linebot' | null => {
    return localStorage.getItem(STORAGE_KEYS.AUTH_TYPE) as 'app' | 'linebot' | null;
  },

  getToken: (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.JWT);
  },

  logout: async () => {
    try {
      // 嘗試清理推播訂閱
      const { notificationService } = await import('./notificationService');
      if (notificationService.isPushSupported()) {
        await notificationService.unsubscribe();
      }
    } catch (e) {
      console.warn('[AUTH] Error during push unsubscribe on logout:', e);
    }

    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.LINE_ID);
    localStorage.removeItem(STORAGE_KEYS.AUTH_TYPE);
    localStorage.removeItem(STORAGE_KEYS.JWT);
  }
};