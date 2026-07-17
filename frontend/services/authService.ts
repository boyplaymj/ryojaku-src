import { User } from '../types';
import { verifyUser, loginUser, registerUser, LoginRequest, RegisterRequest } from './apiService';
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