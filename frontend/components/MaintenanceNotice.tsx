import React, { useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { MAINTENANCE_EVENT, MAINTENANCE_CLEAR_EVENT } from '../utils/maintenanceSignal';

// 維護模式（kill switch）開啟時，讓使用者知道發生了什麼事。
//
// 🔴 這個元件存在的理由是一次實測：維護中登入成功後，使用者落在一個**完全正常的
//    首頁**（社群動態、發文框、底部導覽俱全，還印著「安全連線已啟動」），
//    而計帳頁渲染成一本正常的空帳本（+0 PT・場數 0）。
//    「服務維護中」在 apiService 早就翻譯出來了，只是死在各頁面的呼叫點。
//    ⇒ 修法不是逐頁補顯示（漏掉的那頁零徵兆），是把提示掛在呼叫點之上。
//    量測紀錄見 backend/cmd/lambdas/shared/maintenance.go 第六、七輪。
//
// 不自己畫版面，用既有的 ToastProvider（它本來就支援 duration: Infinity 的常駐提示，
// 且會畫關閉鈕、不畫倒數進度條）—— 所以這裡沒有新的視覺語言。
//
// ⚠️ 已知的小邊角：使用者手動關掉提示後，若維護仍在進行中，不會再自動彈出來
//    （noteBlocked 只在「進入維護」那一次回 true）。這是刻意的 ——
//    他既然關掉了，就不要一直彈。維護結束時的解除訊號仍會正常送達。
const MaintenanceNotice: React.FC = () => {
  const { showToast, hideToast } = useToast();
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onEnter = () => {
      if (toastIdRef.current) return; // 已經有一則了，不重複疊
      toastIdRef.current = showToast(
        '系統維護中，部分功能暫時無法使用，請稍後再試。',
        'warning',
        '服務維護中',
        Infinity,
      );
    };

    const onClear = () => {
      if (!toastIdRef.current) return;
      hideToast(toastIdRef.current);
      toastIdRef.current = null;
    };

    window.addEventListener(MAINTENANCE_EVENT, onEnter);
    window.addEventListener(MAINTENANCE_CLEAR_EVENT, onClear);
    return () => {
      window.removeEventListener(MAINTENANCE_EVENT, onEnter);
      window.removeEventListener(MAINTENANCE_CLEAR_EVENT, onClear);
    };
  }, [showToast, hideToast]);

  return null;
};

export default MaintenanceNotice;
