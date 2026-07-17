import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

// 偵測到新版本時自動更新，不需要用戶確認
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('[SW] 偵測到新版本，自動更新中...');
    updateSW(true);
  },
  onOfflineReady() {
    console.log('[SW] APP 已可離線使用');
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);