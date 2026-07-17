import {
  getVapidKey,
  subscribePush,
  unsubscribePush,
  getSubscriptionStatus
} from './apiService';
import { authService } from './authService';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const notificationService = {
  isPushSupported: () => {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  },

  getPermissionState: () => {
    if (!('Notification' in window)) return 'denied';
    return Notification.permission;
  },

  subscribe: async () => {
    try {
      // 1. Request permission FIRST to maintain user gesture context
      console.log('[Notification] Requesting permission...');
      const permission = await Notification.requestPermission();
      console.log('[Notification] Permission status:', permission);

      if (permission !== 'granted') {
        if (permission === 'denied') {
          throw new Error('通知權限已被封鎖，請點擊網址旁的鎖頭圖示手動開啟權限。');
        }
        throw new Error('未獲得通知權限');
      }

      const user = authService.getCurrentUser();
      if (!user) throw new Error('使用者未登入');

      // 2. Get VAPID key
      console.log('Fetching VAPID key...');
      const vapidResponse = await getVapidKey();
      // API returns "vapidPublicKey", not "publicKey"
      if (!vapidResponse.success || !vapidResponse.vapidPublicKey) {
        throw new Error(`Failed to get VAPID key: ${vapidResponse.error || 'Unknown error'}`);
      }
      console.log('VAPID key received');

      // 3. Get Service Worker Registration
      console.log('Waiting for Service Worker ready...');
      const registration = await navigator.serviceWorker.ready;
      console.log('Service Worker is ready:', registration);

      // 4. Subscribe
      console.log('Subscribing to PushManager...');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidResponse.vapidPublicKey)
      });
      console.log('PushManager subscription successful:', subscription);

      // 5. Send to backend
      const userIdentifier = user.userId;
      console.log('Sending subscription to backend...');
      const response = await subscribePush(userIdentifier, subscription);
      if (!response.success) {
        throw new Error(response.error || 'Failed to save subscription');
      }
      console.log('Backend subscription saved');

      return true;
    } catch (error) {
      console.error('Failed to subscribe to push:', error);
      throw error;
    }
  },

  unsubscribe: async () => {
    try {
      const user = authService.getCurrentUser();
      if (!user) throw new Error('Not logged in');

      // 1. Notify backend (Register as inactive instead of deleting)
      const userIdentifier = user.userId;
      await unsubscribePush(userIdentifier);

      return true;
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      throw error;
    }
  },

  checkSubscriptionStatus: async () => {
    try {
      const user = authService.getCurrentUser();
      if (!user) return false;

      // Check browser subscription
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) return false;

      // Optional: Check backend status to ensure sync
      const response = await getSubscriptionStatus(user.userId);
      return response.success && response.isSubscribed;
    } catch (error) {
      console.error('Error checking subscription:', error);
      return false;
    }
  }
};